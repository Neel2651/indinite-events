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

  it("issues complimentary passes at £0, free of commission inside the event's allowance", async () => {
    const { order } = await asUser(() =>
      issueOfflineOrder(orgId, "u-box", { eventId, customer, items: [{ ticketTypeId: seasonId, qty: 1 }], method: "complimentary", note: "Sponsor guest" }),
    );
    expect(order).toMatchObject({ totalPence: 0, applicationFeePence: 0 });
    expect(await CommissionLedger.findOne({ orderId: order._id }).lean()).toBeNull();
    expect(await Event.findById(eventId, { complimentaryIssued: 1 }).lean()).toMatchObject({ complimentaryIssued: 1 });
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

describe("complimentary allowance (SPEC §4.7)", () => {
  const makeEvent = async (slug: string, freeComplimentaryPasses?: number) => {
    const event = await Event.create({
      organizerId: new mongoose.Types.ObjectId(orgId),
      slug,
      title: `Comps ${slug}`,
      venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
      sessions: [{ label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) }],
      status: "published",
      ...(freeComplimentaryPasses === undefined ? {} : { freeComplimentaryPasses }),
    });
    const tt = await TicketType.create({ eventId: event._id, name: "Season", pricePence: 4500, quota: 50, validSessionIds: [event.sessions[0]!._id] });
    return { eventId: String(event._id), typeId: String(tt._id) };
  };
  const comp = (e: { eventId: string; typeId: string }, qty: number) =>
    asUser(() => issueOfflineOrder(orgId, "u-box", { eventId: e.eventId, customer, items: [{ ticketTypeId: e.typeId, qty }], method: "complimentary", note: "Guest list" }));

  it("gives 5 free passes by default, then charges commission on each extra pass", async () => {
    const e = await makeEvent("comps-default");
    const first = await comp(e, 3);
    expect(first.order.applicationFeePence).toBe(0);
    const second = await comp(e, 3); // 2 free, 1 over the allowance: 8% of £45
    expect(second.order.applicationFeePence).toBe(360);
    expect(await CommissionLedger.findOne({ orderId: second.order._id }).lean()).toMatchObject({ amountPence: 360, kind: "offline_sale_owed" });
    expect(await AuditLog.findOne({ action: "order.issued_offline", "entity.id": String(second.order._id) }).lean()).toMatchObject({ metadata: { freeComplimentaryPasses: 2, commissionOwedPence: 360 } });
    const third = await comp(e, 2);
    expect(third.order.applicationFeePence).toBe(720);
  });

  it("uses the admin's allowance for the event", async () => {
    const e = await makeEvent("comps-zero", 0);
    expect((await comp(e, 1)).order.applicationFeePence).toBe(360);
  });

  it("never gives away more free passes than the allowance under concurrent bookings", async () => {
    const e = await makeEvent("comps-race", 2);
    const results = await Promise.all(Array.from({ length: 6 }, () => comp(e, 1)));
    const free = results.filter((r) => r.order.applicationFeePence === 0).length;
    expect(free).toBe(2);
    expect(await Event.findById(e.eventId, { complimentaryIssued: 1 }).lean()).toMatchObject({ complimentaryIssued: 6 });
    const owed = await CommissionLedger.find({ eventId: new mongoose.Types.ObjectId(e.eventId) }).lean();
    expect(owed.reduce((n, l) => n + l.amountPence, 0)).toBe(4 * 360);
  });
});
