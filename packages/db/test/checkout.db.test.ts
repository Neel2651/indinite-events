/**
 * Real-MongoDB tests for checkout → fulfilment (the path shared by demo payments and the Stripe webhook).
 * Run locally: pnpm --filter @indinite/db test:db
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair, verifyTicketToken } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import {
  AuditLog,
  CheckoutError,
  Event,
  Hold,
  Job,
  Order,
  Organizer,
  Ticket,
  TicketType,
  createCheckoutOrder,
  fulfilOrder,
  releaseHold,
  HoldExpiredError,
} from "../src";

let replSet: MongoMemoryReplSet;
const keys = generateQrKeyPair();

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = keys.privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const asCustomer = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "customer" } }, fn);
const asSystem = <T>(fn: () => Promise<T>) => runWithContext({ actor: systemActor }, fn);
const customer = { name: "Asha Patel", email: "asha@example.com" };

let eventId: string;
let seasonId: string;
let nightId: string;
let laterId: string;

beforeEach(async () => {
  await Promise.all(mongoose.modelNames().filter((n) => n !== "AuditLog").map((n) => mongoose.model(n).deleteMany({})));
  const org = await Organizer.create({ name: "Org", slug: `org-${Date.now()}`, contactEmail: "o@example.com", authOrgId: `a-${Date.now()}`, commissionBps: 800 });
  const event = await Event.create({
    organizerId: org._id,
    slug: `e-${Date.now()}`,
    title: "Navratri",
    venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
    sessions: [
      { label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) },
      { label: "Night 2", startsAt: new Date(Date.now() + 172_800_000), endsAt: new Date(Date.now() + 176_400_000) },
    ],
    status: "published",
  });
  const [s1, s2] = event.sessions.map((s) => s._id);
  const [season, night, later] = await TicketType.create(
    [
      { eventId: event._id, name: "Season", pricePence: 4500, quota: 5, validSessionIds: [s1, s2], maxPerOrder: 4 },
      { eventId: event._id, name: "Night 1", pricePence: 1000, quota: 100, validSessionIds: [s1] },
      { eventId: event._id, name: "Later", pricePence: 1000, quota: 100, validSessionIds: [s2], salesStartAt: new Date(Date.now() + 3_600_000) },
    ],
    { ordered: true },
  );
  eventId = String(event._id);
  seasonId = String(season!._id);
  nightId = String(night!._id);
  laterId = String(later!._id);
});

describe("checkout and demo fulfilment", () => {
  it("creates a pending order with a hold, then fulfils it into signed tickets", async () => {
    const order = await asCustomer(() =>
      createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: seasonId, qty: 2 }, { ticketTypeId: nightId, qty: 1 }] }),
    );
    // Platform fee (8% for this organiser) is added on top.
    expect(order).toMatchObject({ status: "pending", subtotalPence: 10000, platformFeePence: 800, totalPence: 10800, applicationFeePence: 800 });
    expect(order.publicId).toMatch(/^NAV-[0-9A-Z]{6}$/);
    expect(await TicketType.findById(seasonId).lean()).toMatchObject({ held: 2, sold: 0 });

    const { order: paid, ticketsIssued } = await asSystem(() => fulfilOrder(order._id, { mode: "demo" }));
    expect(paid.status).toBe("paid");
    expect(ticketsIssued).toBe(3);
    expect(await TicketType.findById(seasonId).lean()).toMatchObject({ held: 0, sold: 2 });
    expect(await Hold.findOne({ orderId: order._id }).lean()).toMatchObject({ outcome: "committed" });

    const tickets = await Ticket.find({ orderId: order._id }).lean();
    expect(tickets).toHaveLength(3);
    for (const t of tickets) expect(verifyTicketToken(t.qrToken, keys.publicKeyHex)).toEqual({ ok: true, ticketId: String(t._id) });
    expect(tickets.find((t) => t.ticketTypeName === "Season")!.validSessionIds).toHaveLength(2);

    expect(await Job.countDocuments({ jobId: `${order._id}:paid:once` })).toBe(1);
    const paidAudit = await AuditLog.findOne({ action: "order.paid", "entity.id": String(order._id) }).lean();
    expect(paidAudit).toMatchObject({ reason: "demo_payment", actor: { type: "system" }, metadata: { paymentsMode: "demo", ticketsIssued: 3 } });
    const createdAudit = await AuditLog.findOne({ action: "order.created", "entity.id": String(order._id) }).lean();
    expect(JSON.stringify(createdAudit)).not.toContain("asha@example.com");
  });

  it("is idempotent: fulfilling twice issues tickets once", async () => {
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: nightId, qty: 2 }] }));
    await asSystem(() => fulfilOrder(order._id, { mode: "demo" }));
    const again = await asSystem(() => fulfilOrder(order._id, { mode: "demo" }));
    expect(again.ticketsIssued).toBe(0);
    expect(await Ticket.countDocuments({ orderId: order._id })).toBe(2);
    expect(await TicketType.findById(nightId).lean()).toMatchObject({ sold: 2, held: 0 });
  });

  it("refuses to fulfil once the hold has been released", async () => {
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: nightId, qty: 1 }] }));
    const hold = await Hold.findOne({ orderId: order._id }).lean();
    await asSystem(() => releaseHold(hold!._id, "expired"));
    await expect(asSystem(() => fulfilOrder(order._id, { mode: "demo" }))).rejects.toBeInstanceOf(HoldExpiredError);
    expect(await Ticket.countDocuments({ orderId: order._id })).toBe(0);
  });

  it("rejects sold-out, not-yet-on-sale and over-limit requests without leaving anything behind", async () => {
    await expect(asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: laterId, qty: 1 }] }))).rejects.toThrow(/isn't on sale yet/);
    await expect(asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: seasonId, qty: 5 }] }))).rejects.toThrow(/up to 4/);
    // Split lines are merged before the per-order limit is checked.
    await expect(
      asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: seasonId, qty: 3 }, { ticketTypeId: seasonId, qty: 2 }] })),
    ).rejects.toThrow(/up to 4/);

    await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: seasonId, qty: 4 }] }));
    const soldOut = asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: nightId, qty: 1 }, { ticketTypeId: seasonId, qty: 2 }] }));
    await expect(soldOut).rejects.toBeInstanceOf(CheckoutError);
    await expect(soldOut).rejects.toThrow(/aren't enough Season/);

    // The failed order rolled back entirely, including the Night 1 reservation made before Season failed.
    expect(await Order.countDocuments()).toBe(1);
    expect(await TicketType.findById(nightId).lean()).toMatchObject({ held: 0 });
    expect(await TicketType.findById(seasonId).lean()).toMatchObject({ held: 4 });
  });

  it("never oversells under concurrent checkouts", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: seasonId, qty: 1 }] }))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await TicketType.findById(seasonId).lean()).toMatchObject({ held: 5 });
  });
});
