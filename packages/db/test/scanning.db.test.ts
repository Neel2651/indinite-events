/** Real-MongoDB tests for gate scanning sync and conflict resolution. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { runWithContext } from "@indinite/core/context";
import { AuditLog, Event, Order, Organizer, Scan, Ticket, getScanManifest, syncScans, gateStats, type IncomingScan } from "../src";

let replSet: MongoMemoryReplSet;
let eventId: string;
let night1: string;
let night2: string;
let ticketA: string;
let refunded: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const org = await Organizer.create({ name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1", commissionBps: 800 });
  const event = await Event.create({
    organizerId: org._id,
    slug: "e",
    title: "Navratri",
    venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
    sessions: [
      { label: "Night 1", startsAt: new Date("2026-10-11T18:30:00Z"), endsAt: new Date("2026-10-11T22:30:00Z") },
      { label: "Night 2", startsAt: new Date("2026-10-12T18:30:00Z"), endsAt: new Date("2026-10-12T22:30:00Z") },
    ],
    status: "published",
  });
  eventId = String(event._id);
  [night1, night2] = event.sessions.map((s) => String(s._id)) as [string, string];
  const order = await Order.create({
    publicId: "NAV-AAAAAA",
    organizerId: org._id,
    eventId: event._id,
    customer: { name: "Asha", email: "asha@example.com" },
    source: "online",
    status: "paid",
    items: [{ ticketTypeId: new mongoose.Types.ObjectId(), name: "Night 1", unitPricePence: 1000, qty: 2 }],
    subtotalPence: 2000,
    totalPence: 2000,
    applicationFeePence: 160,
  });
  const base = { orderId: order._id, organizerId: org._id, eventId: event._id, ticketTypeId: new mongoose.Types.ObjectId(), ticketTypeName: "Night 1", validSessionIds: [night1] };
  const [a, r] = await Ticket.create([{ ...base, qrToken: "t1" }, { ...base, qrToken: "t2", status: "refunded" }], { ordered: true });
  ticketA = String(a!._id);
  refunded = String(r!._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const scan = (over: Partial<IncomingScan>): IncomingScan => ({
  clientScanId: randomUUID(),
  ticketId: ticketA,
  sessionId: night1,
  gate: "Gate A",
  deviceId: "phone-1",
  result: "admitted",
  scannedAt: "2026-10-11T19:00:00Z", // Night 1, after gates opened
  ...over,
});
const sync = (scans: IncomingScan[], canManualAdmit = false) =>
  runWithContext({ actor: { type: "user", id: "u1" } }, () => syncScans({ eventId, scannerUserId: "u1", canManualAdmit, scans }));

describe("scanning", () => {
  it("builds a manifest with order refs and pass positions, and no emails", async () => {
    const m = (await getScanManifest(eventId))!;
    expect(m.tickets).toHaveLength(2);
    expect(m.tickets[0]).toMatchObject({ orderRef: "NAV-AAAAAA", position: 1, count: 2 });
    expect(JSON.stringify(m)).not.toContain("asha@example.com");
  });

  it("first gate wins when two devices admit the same pass offline", async () => {
    const first = scan({ gate: "Gate A", scannedAt: "2026-10-11T18:40:00Z" });
    const second = scan({ gate: "Gate B", deviceId: "phone-2", scannedAt: "2026-10-11T18:41:00Z" });
    const [r1, r2] = await Promise.all([sync([first]), sync([second])]);
    const outcomes = [r1.results[0]!.result, r2.results[0]!.result].sort();
    expect(outcomes).toEqual(["admitted", "already_used"]);
    expect(await Scan.countDocuments({ ticketId: ticketA, sessionId: night1, result: "admitted" })).toBe(1);
  });

  it("is idempotent when a device re-sends the same scans", async () => {
    const s = scan({ ticketId: ticketA, sessionId: night1, result: "already_used" });
    await sync([s]);
    const again = await sync([s]);
    expect(again.results[0]!.result).toBe("already_used");
    expect(await Scan.countDocuments({ clientScanId: s.clientScanId })).toBe(1);
  });

  it("corrects an offline admit of a refunded pass", async () => {
    const r = await sync([scan({ ticketId: refunded })]);
    expect(r.results[0]!.result).toBe("cancelled");
  });

  it("manual admit needs permission and a reason, and is audited", async () => {
    const denied = await sync([scan({ sessionId: night2, result: "manual_admit", reason: "Bought wrong night", scannedAt: "2026-10-12T19:00:00Z" })], false);
    expect(denied.results[0]!.result).not.toBe("manual_admit");

    const ok = await sync([scan({ sessionId: night2, result: "manual_admit", reason: "Bought wrong night, manager approved", scannedAt: "2026-10-12T19:00:00Z" })], true);
    expect(ok.results[0]!.result).toBe("manual_admit");
    expect(await AuditLog.countDocuments({ action: "scan.manual_admit" })).toBe(1);
  });

  it("reports gate stats per night", async () => {
    const stats = (await gateStats(eventId))!;
    const n1 = stats.find((s) => s.sessionId === night1)!;
    expect(n1.admitted).toBe(1);
    expect(n1.expected).toBe(1);
    expect(n1.gates.map((g) => g.gate).sort()).toEqual(["Gate A", "Gate B"]);
  });
});
