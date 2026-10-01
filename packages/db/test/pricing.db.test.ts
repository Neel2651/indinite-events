/** Real-MongoDB tests: event pricing settings, coupons and payment links (SPEC §4.2, §4.7). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import { CheckoutError, Discount, Event, Hold, Order, Organizer, TicketType, createCheckoutOrder, createPaymentLinkOrder, fulfilOrder, releaseHold } from "../src";

let replSet: MongoMemoryReplSet;
let orgId: string;
let eventId: string;
let passId: string;

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  // 6% set explicitly (the default for new organisers is 10% since 1 Oct 2026); these tests' maths uses 6%.
  const org = await Organizer.create({ name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1", commissionBps: 600 });
  orgId = String(org._id);
  const event = await Event.create({
    organizerId: org._id,
    slug: "e",
    title: "Navratri",
    venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
    sessions: [{ label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) }],
    status: "published",
    taxBps: 2000,
    charges: [{ name: "Venue fee", kind: "fixed", value: 30 }],
  });
  eventId = String(event._id);
  const tt = await TicketType.create({ eventId: event._id, name: "Night pass", pricePence: 1200, quota: 100, validSessionIds: [event.sessions[0]!._id] });
  passId = String(tt._id);
  await Discount.create({ organizerId: org._id, eventId: event._id, code: "GARBA10", kind: "percent", value: 1000, maxUses: 1, createdBy: "seed" });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const customer = { name: "Asha", email: "asha@example.com" };
const asCustomer = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "customer" } }, fn);

describe("pricing, coupons and payment links", () => {
  it("prices with the organiser default 6%, organiser charges and event tax", async () => {
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }));
    // £12 + £0.72 + £0.30 + 20% tax (£2.60) = £15.62
    expect(order).toMatchObject({ subtotalPence: 1200, platformFeePence: 72, chargesPence: 30, taxPence: 260, totalPence: 1562, commissionBps: 600, applicationFeePence: 72 });
  });

  it("uses an event's commission override", async () => {
    await Event.updateOne({ _id: eventId }, { $set: { commissionBps: 1000 } });
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }));
    expect(order).toMatchObject({ platformFeePence: 120, commissionBps: 1000 });
    await Event.updateOne({ _id: eventId }, { $set: { commissionBps: null } });
  });

  it("applies a coupon once, and gives the use back if the booking expires", async () => {
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], couponCode: "garba10" }));
    expect(order).toMatchObject({ couponCode: "GARBA10", ticketsPence: 1080, platformFeePence: 65 });
    expect((await Discount.findOne({ code: "GARBA10" }).lean())!.used).toBe(1);

    await expect(asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], couponCode: "GARBA10" }))).rejects.toThrow(/fully used/);
    await expect(asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], couponCode: "NOPE" }))).rejects.toBeInstanceOf(CheckoutError);

    const hold = await Hold.findOne({ orderId: order._id }).lean();
    await runWithContext({ actor: systemActor }, () => releaseHold(hold!._id, "expired"));
    expect((await Discount.findOne({ code: "GARBA10" }).lean())!.used).toBe(0);
  });

  it("creates a payment link booking held for its validity, payable later", async () => {
    const order = await runWithContext({ actor: { type: "user", id: "u1" } }, () =>
      createPaymentLinkOrder(orgId, "u1", { eventId, customer, items: [{ ticketTypeId: passId, qty: 2 }], validForHours: 24 }),
    );
    expect(order).toMatchObject({ source: "payment_link", status: "pending", createdBy: "u1", totalPence: 2604 + 521 });
    expect(order.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    await runWithContext({ actor: systemActor }, () => fulfilOrder(order._id, { mode: "demo" }));
    expect((await Order.findById(order._id).lean())!.status).toBe("paid");
  });

  it("won't create a payment link for another organiser's event", async () => {
    const other = new mongoose.Types.ObjectId().toHexString();
    await expect(
      runWithContext({ actor: { type: "user", id: "u1" } }, () => createPaymentLinkOrder(other, "u1", { eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], validForHours: 2 })),
    ).rejects.toThrow(/isn't available/);
  });
});
