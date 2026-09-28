/** Real-MongoDB tests for coupons and staff discounts on payment links (SPEC §4.2, §4.7). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair, type AuthUser, type OrgRole } from "@indinite/core";
import { runWithContext } from "@indinite/core/context";
import { AuditLog, CheckoutError, createCheckoutOrder, createCoupon, createPaymentLinkOrder, Discount, Event, Hold, issueOfflineOrder, Order, Organizer, releaseHold, TicketType } from "../src";

let replSet: MongoMemoryReplSet;
let orgId: string;
let eventId: string;
let passId: string;

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const org = await Organizer.create({ name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1", commissionBps: 600, maxDiscountBpsForManager: 2000 });
  orgId = String(org._id);
  const event = await Event.create({
    organizerId: org._id,
    slug: "e",
    title: "Navratri",
    venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
    sessions: [{ label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) }],
    status: "published",
  });
  eventId = String(event._id);
  const tt = await TicketType.create({ eventId: event._id, name: "Season", pricePence: 1000, quota: 500, maxPerOrder: 50, validSessionIds: [event.sessions[0]!._id] });
  passId = String(tt._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const member = (id: string, role: OrgRole): AuthUser => ({ id, isSuperAdmin: false, memberships: [{ organizerId: orgId, role }] });
const as = <T>(id: string, fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id } }, fn);
const customer = { name: "Asha", email: "asha@example.com" };
const link = (user: AuthUser, qty: number, discount?: { kind: "percent" | "fixed"; value: number; reason?: string }, couponCode?: string) =>
  as(user.id, () => createPaymentLinkOrder(orgId, user.id, { eventId, customer, items: [{ ticketTypeId: passId, qty }], discount, couponCode, validForHours: 2 }, { user }));

describe("staff discounts on payment links", () => {
  it("applies a manager's discount within their limit, stores who gave it and audits it", async () => {
    const order = await link(member("u-man", "manager"), 3, { kind: "percent", value: 2000, reason: "Group booking" });
    expect(order).toMatchObject({ subtotalPence: 3000, ticketsPence: 2400, discount: { kind: "percent", value: 2000, amountPence: 600, reason: "Group booking", appliedBy: "u-man" } });
    const audit = await AuditLog.findOne({ action: "order.payment_link_created", "entity.id": String(order._id) }).lean();
    expect(audit?.actor).toMatchObject({ id: "u-man" });
    expect(JSON.stringify(audit?.changes)).toContain("appliedBy");
  });

  it("refuses more than the manager's limit (percent or £), and any discount from box office", async () => {
    await expect(link(member("u-man", "manager"), 3, { kind: "percent", value: 2500 })).rejects.toThrow("You can give up to 20% off. Ask the organiser's owner for more.");
    await expect(link(member("u-man", "manager"), 1, { kind: "fixed", value: 300 })).rejects.toThrow(/up to 20% off/);
    await expect(link(member("u-box", "box_office"), 1, { kind: "percent", value: 100 })).rejects.toThrow("You don't have permission to give discounts.");
    expect(await Order.countDocuments({ createdBy: "u-box" })).toBe(0);
  });

  it("lets the owner give any discount, but never a coupon and a discount together", async () => {
    const order = await link(member("u-own", "owner"), 2, { kind: "fixed", value: 5000 });
    expect(order).toMatchObject({ discount: { amountPence: 2000 }, ticketsPence: 0, totalPence: 0 });
    await asCoupon({ code: "BOTH10", kind: "percent", value: 1000 });
    await expect(link(member("u-own", "owner"), 1, { kind: "percent", value: 1000 }, "BOTH10")).rejects.toThrow("Use either a coupon code or a discount, not both.");
  });
});

async function asCoupon(input: { code: string; kind: "percent" | "fixed"; value: number; maxUses?: number; maxDiscountPence?: number; minSubtotalPence?: number }) {
  return as("u-own", () => createCoupon(orgId, "u-own", { eventId: null, maxUses: null, validFrom: null, validTo: null, ...input }));
}

describe("coupon limits and audit", () => {
  it("caps a percent code at its maximum and records the redemption against the coupon", async () => {
    const c = await asCoupon({ code: "CAP50", kind: "percent", value: 5000, maxDiscountPence: 1000 });
    const order = await runWithContext({ actor: { type: "customer", id: "c1" } }, () => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 4 }], couponCode: "cap50" }));
    expect(order).toMatchObject({ subtotalPence: 4000, discount: { amountPence: 1000, reason: "Code CAP50" }, couponCode: "CAP50" });
    expect(await AuditLog.findOne({ action: "coupon.redeemed", "entity.id": String(c._id) }).lean()).toMatchObject({ metadata: { publicId: order.publicId, amountPence: 1000 } });
  });

  it("refuses a code below its minimum ticket spend, online and at the box office", async () => {
    await asCoupon({ code: "MIN30", kind: "fixed", value: 500, minSubtotalPence: 3000 });
    await expect(runWithContext({ actor: { type: "customer", id: "c1" } }, () => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 2 }], couponCode: "MIN30" }))).rejects.toThrow("Spend at least £30.00 on tickets to use this code.");
    await expect(as("u-box", () => issueOfflineOrder(orgId, "u-box", { eventId, customer, items: [{ ticketTypeId: passId, qty: 2 }], method: "cash", note: "Paid", couponCode: "MIN30" }))).rejects.toBeInstanceOf(CheckoutError);
    const ok = await runWithContext({ actor: { type: "customer", id: "c1" } }, () => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 3 }], couponCode: "MIN30" }));
    expect(ok.discount?.amountPence).toBe(500);
  });

  it("gives the use back (audited) when an unpaid booking expires", async () => {
    const c = await asCoupon({ code: "BACK1", kind: "percent", value: 1000, maxUses: 1 });
    const order = await runWithContext({ actor: { type: "customer", id: "c1" } }, () => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], couponCode: "BACK1" }));
    expect((await Discount.findById(c._id).lean())!.used).toBe(1);
    const hold = await Hold.findOne({ orderId: order._id }).lean();
    await runWithContext({ actor: { type: "system", id: "system" } }, () => releaseHold(hold!._id, "expired"));
    expect((await Discount.findById(c._id).lean())!.used).toBe(0);
    expect(await AuditLog.findOne({ action: "coupon.released", "entity.id": String(c._id) }).lean()).toMatchObject({ reason: "expired", metadata: { publicId: order.publicId } });
  });

  it("never goes over max uses when many people use the code at once", async () => {
    const c = await asCoupon({ code: "RUSH5", kind: "percent", value: 1000, maxUses: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => runWithContext({ actor: { type: "customer", id: `c${i}` } }, () => createCheckoutOrder({ eventId, customer: { name: "A", email: `a${i}@example.com` }, items: [{ ticketTypeId: passId, qty: 1 }], couponCode: "RUSH5" }))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await Discount.findById(c._id).lean())!.used).toBe(5);
  });

  it("rejects a £ code with a max discount, and end dates before start dates", async () => {
    await expect(asCoupon({ code: "BADCAP", kind: "fixed", value: 500, maxDiscountPence: 100 })).rejects.toThrow(/only applies to % codes/);
    await expect(as("u-own", () => createCoupon(orgId, "u-own", { code: "BADDATE", eventId: null, kind: "percent", value: 1000, maxUses: null, validFrom: new Date("2026-10-05"), validTo: new Date("2026-10-04") }))).rejects.toThrow(/end date must be after/);
  });
});
