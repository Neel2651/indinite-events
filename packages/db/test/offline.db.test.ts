/** Real-MongoDB tests for organiser offline bookings (SPEC §4.3). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair } from "@indinite/core";
import { runWithContext } from "@indinite/core/context";
import { AuditLog, CheckoutError, CommissionLedger, Event, Job, Organizer, Ticket, TicketType, issueOfflineOrder } from "../src";

let replSet: MongoMemoryReplSet;
let orgId: string;
let otherOrgId: string;
let eventId: string;
let seasonId: string;

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const [org, other] = await Organizer.create(
    [
      { name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1", commissionBps: 800, orderPrefix: "ORG" },
      { name: "Other", slug: "other", contactEmail: "x@example.com", authOrgId: "a2", commissionBps: 800 },
    ],
    { ordered: true },
  );
  orgId = String(org!._id);
  otherOrgId = String(other!._id);
  const event = await Event.create({
    organizerId: org!._id,
    slug: "e",
    title: "Navratri",
    venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
    sessions: [{ label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) }],
    status: "published",
  });
  eventId = String(event._id);
  // Not on sale online yet: box office can still sell.
  const tt = await TicketType.create({ eventId: event._id, name: "Season", pricePence: 4500, quota: 3, validSessionIds: [event.sessions[0]!._id], salesStartAt: new Date(Date.now() + 3_600_000) });
  seasonId = String(tt._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const asUser = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id: "u-box" } }, fn);
const customer = { name: "Ravi Patel", email: "Ravi@Example.com" };

describe("offline bookings", () => {
  it("issues a cash booking: paid order, sold seats, signed tickets, commission owed, audit and email", async () => {
    const { order, ticketsIssued } = await asUser(() =>
      issueOfflineOrder(orgId, "u-box", { eventId, customer, items: [{ ticketTypeId: seasonId, qty: 2 }], method: "cash", note: "Paid at the door" }),
    );
    expect(order).toMatchObject({ source: "offline", status: "paid", subtotalPence: 9000, platformFeePence: 720, totalPence: 9720, applicationFeePence: 720, offline: { method: "cash", note: "Paid at the door", issuedBy: "u-box" } });
    expect(order.publicId).toMatch(/^ORG-/);
    expect(order.customer?.email).toBe("ravi@example.com");
    expect(ticketsIssued).toBe(2);
    expect(await Ticket.countDocuments({ orderId: order._id })).toBe(2);
    expect(await TicketType.findById(seasonId).lean()).toMatchObject({ sold: 2, held: 0 });
    expect(await CommissionLedger.findOne({ orderId: order._id }).lean()).toMatchObject({ kind: "offline_sale_owed", amountPence: 720 });
    expect(await AuditLog.findOne({ action: "order.issued_offline", "entity.id": String(order._id) }).lean()).toMatchObject({ reason: "Paid at the door", actor: { type: "user", id: "u-box" } });
    expect(await Job.countDocuments({ jobId: `${order._id}:offline_issued:once` })).toBe(1);
  });

  it("issues complimentary passes at £0, with commission owed on the normal price", async () => {
    const { order } = await asUser(() =>
      issueOfflineOrder(orgId, "u-box", { eventId, customer, items: [{ ticketTypeId: seasonId, qty: 1 }], method: "complimentary", note: "Sponsor guest" }),
    );
    expect(order).toMatchObject({ totalPence: 0, applicationFeePence: 360 });
    expect(await CommissionLedger.findOne({ orderId: order._id }).lean()).toMatchObject({ amountPence: 360, eventId: new mongoose.Types.ObjectId(eventId) });
  });

  it("never oversells and rolls back fully", async () => {
    await expect(
      asUser(() => issueOfflineOrder(orgId, "u-box", { eventId, customer, items: [{ ticketTypeId: seasonId, qty: 1 }], method: "cash", note: "One more" })),
    ).rejects.toBeInstanceOf(CheckoutError);
    expect(await TicketType.findById(seasonId).lean()).toMatchObject({ sold: 3 });
  });

  it("refuses another organiser's event and a missing note", async () => {
    await expect(
      asUser(() => issueOfflineOrder(otherOrgId, "u-box", { eventId, customer, items: [{ ticketTypeId: seasonId, qty: 1 }], method: "cash", note: "Sneaky" })),
    ).rejects.toThrow(/isn't one of yours/);
    await expect(
      asUser(() => issueOfflineOrder(orgId, "u-box", { eventId, customer, items: [{ ticketTypeId: seasonId, qty: 1 }], method: "cash", note: "" })),
    ).rejects.toThrow();
  });
});
