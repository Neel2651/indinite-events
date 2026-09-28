/** Real-MongoDB test: per-event finance view and commission settlements (SPEC §4.7). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import { Event, Organizer, TicketType, createCheckoutOrder, eventFinance, fulfilOrder, issueOfflineOrder, recordCommissionPayment, setEventCharges, setEventPricing, SettingsError } from "../src";

let replSet: MongoMemoryReplSet;
let orgId: string;
let eventId: string;
let passId: string;

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const org = await Organizer.create({ name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1" });
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
  passId = String((await TicketType.create({ eventId: event._id, name: "Night pass", pricePence: 1000, quota: 100, validSessionIds: [event.sessions[0]!._id] }))._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const admin = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id: "admin" } }, fn);
const customer = { name: "Asha", email: "asha@example.com" };

describe("finance", () => {
  it("rejects charges on another organiser's event", async () => {
    await expect(admin(() => setEventCharges(new mongoose.Types.ObjectId().toHexString(), eventId, []))).rejects.toBeInstanceOf(SettingsError);
  });

  it("splits sales into direct (organiser owes us) and via platform, and tracks settlements", async () => {
    await admin(() => setEventPricing(eventId, { commissionBps: 1000, taxBps: 0 })); // 10% for easy maths
    await admin(() => setEventCharges(orgId, eventId, [{ name: "Venue fee", kind: "fixed", value: 50 }]));

    // Online: 2 × £10 → £20 + £2 fee + £1 venue = £23; Indinite £2, organiser £21.
    const online = await runWithContext({ actor: { type: "customer" } }, () => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 2 }] }));
    await runWithContext({ actor: systemActor }, () => fulfilOrder(online._id, { mode: "demo" }));
    // Cash: 1 × £10 → £11.50 collected by organiser; owes £1.
    await admin(() => issueOfflineOrder(orgId, "u", { eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], method: "cash", note: "Door" }));
    // Organiser's account: 3 × £10 → £34.50; owes £3.
    await admin(() => issueOfflineOrder(orgId, "u", { eventId, customer, items: [{ ticketTypeId: passId, qty: 3 }], method: "bank_transfer", note: "BACS ref 12" }));
    // Comp: 1 × £10 → £0; inside the event's free allowance (5), so nothing owed.
    await admin(() => issueOfflineOrder(orgId, "u", { eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], method: "complimentary", note: "Guest" }));

    await admin(() => recordCommissionPayment(eventId, "admin", 300, "Part payment, BACS"));
    const f = (await eventFinance(eventId))!;
    expect(f.totalSalesPence).toBe(2300 + 1150 + 3450);
    expect(f.direct).toEqual({ cashPence: 1150, accountPence: 3450, complimentaryPasses: 1, commissionOwedPence: 400, commissionPaidPence: 300, outstandingPence: 100 });
    expect(f.platform).toEqual({ grossPence: 2300, organizerCreditedPence: 2100, platformFeesPence: 200, cardFeesPence: 0 });
    expect(f.ourIncomePence).toBe(600);
    expect(f.payments).toHaveLength(1);
  });
});
