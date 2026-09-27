/** Security tests for online gate claims: a pass gets in once per night, whatever the device does. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair, passCode, signTicket } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import { Event, Organizer, Scan, Ticket, TicketType, claimScan, createCheckoutOrder, fulfilOrder, syncScans } from "../src";

let replSet: MongoMemoryReplSet;
const keys = generateQrKeyPair();
let eventId: string;
let night1: string;
let night2: string;
let tokens: string[] = [];

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = keys.privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const org = await Organizer.create({ name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1" });
  const event = await Event.create({
    organizerId: org._id,
    slug: "e",
    title: "Navratri",
    venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
    sessions: [
      { label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) },
      { label: "Night 2", startsAt: new Date(Date.now() + 172_800_000), endsAt: new Date(Date.now() + 176_400_000) },
    ],
    status: "published",
  });
  eventId = String(event._id);
  [night1, night2] = event.sessions.map((s) => String(s._id)) as [string, string];
  const tt = await TicketType.create({ eventId: event._id, name: "Night 1", pricePence: 1000, quota: 10, validSessionIds: [event.sessions[0]!._id] });
  const order = await runWithContext({ actor: { type: "customer" } }, () =>
    createCheckoutOrder({ eventId, customer: { name: "A", email: "a@example.com" }, items: [{ ticketTypeId: String(tt._id), qty: 3 }] }),
  );
  await runWithContext({ actor: systemActor }, () => fulfilOrder(order._id, { mode: "demo" }));
  tokens = (await Ticket.find({ orderId: order._id }).sort({ _id: 1 }).lean()).map((t) => t.qrToken);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const claim = (over: Partial<Parameters<typeof claimScan>[0]>) =>
  claimScan({ eventId, sessionId: night1, gate: "Gate A", deviceId: "d1", scannerUserId: "u1", clientScanId: randomUUID(), publicKeyHex: keys.publicKeyHex, ...over });

describe("gate claims", () => {
  it("admits a pass exactly once, even when 30 gates scan the same QR at the same moment", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => claim({ token: tokens[0], gate: `Gate ${i % 4}`, deviceId: `d${i}` })));
    expect(results.filter((r) => r.result === "admitted")).toHaveLength(1);
    expect(results.filter((r) => r.result === "already_used")).toHaveLength(29);
    expect(results.find((r) => r.result === "already_used")!.prior).toBeTruthy();
    expect(await Scan.countDocuments({ result: "admitted" })).toBe(1);
  });

  it("refuses the same pass again later, including a screenshot on another phone", async () => {
    expect((await claim({ token: tokens[0], gate: "Gate Z", deviceId: "other-phone" })).result).toBe("already_used");
  });

  it("returns the same answer when a device retries after a timeout", async () => {
    const id = randomUUID();
    const first = await claim({ token: tokens[1], clientScanId: id });
    const retry = await claim({ token: tokens[1], clientScanId: id });
    expect(first.result).toBe("admitted");
    expect(retry.result).toBe("admitted");
    expect(await Scan.countDocuments({ clientScanId: id })).toBe(1);
  });

  it("refuses forged, edited and foreign codes", async () => {
    const fake = generateQrKeyPair();
    const t = await Ticket.findOne({ qrToken: tokens[2] }).lean();
    expect(await claim({ token: signTicket(String(t!._id), fake.privateKeyHex) })).toMatchObject({ result: "invalid", reason: "bad_signature" });
    const [v, id, sig] = tokens[2]!.split(".");
    const other = new mongoose.Types.ObjectId().toHexString();
    expect((await claim({ token: `${v}.${other}.${sig}` })).result).toBe("invalid");
    expect(await claim({ token: "https://example.com/free-entry" })).toMatchObject({ result: "invalid", reason: "unreadable" });
    // Genuine signature, but a ticket from somewhere else.
    expect(await claim({ token: signTicket(other, keys.privateKeyHex) })).toMatchObject({ result: "invalid", reason: "unknown_ticket" });
    void id;
  });

  it("refuses passes on the wrong night and refunded passes", async () => {
    expect((await claim({ token: tokens[2], sessionId: night2 })).result).toBe("wrong_session");
    await Ticket.updateOne({ qrToken: tokens[2] }, { $set: { status: "refunded" } });
    expect((await claim({ token: tokens[2] })).result).toBe("cancelled");
    await Ticket.updateOne({ qrToken: tokens[2] }, { $set: { status: "valid" } });
  });

  it("accepts the typed code, but not codes guessed from a neighbouring ticket id", async () => {
    const t = await Ticket.findOne({ qrToken: tokens[2] }).lean();
    const oldStyleGuess = String(t!._id).slice(-8).toUpperCase(); // what the previous scheme printed
    expect((await claim({ code: oldStyleGuess })).result).toBe("invalid");
    expect((await claim({ code: passCode(tokens[2]!).toLowerCase() })).result).toBe("admitted");
    expect((await claim({ code: passCode(tokens[2]!) })).result).toBe("already_used");
  });

  it("a slow claim followed by the offline fallback is stored once (same clientScanId)", async () => {
    // Fresh night so this pass hasn't been used.
    const id = randomUUID();
    const t = await Ticket.findOne({ qrToken: tokens[1] }).lean();
    await Ticket.updateOne({ _id: t!._id }, { $addToSet: { validSessionIds: new mongoose.Types.ObjectId(night2) } });
    const claimed = await claim({ token: tokens[1], sessionId: night2, clientScanId: id });
    expect(claimed.result).toBe("admitted");
    const synced = await runWithContext({ actor: { type: "user", id: "u1" } }, () =>
      syncScans({ eventId, scannerUserId: "u1", canManualAdmit: false, scans: [{ clientScanId: id, ticketId: String(t!._id), sessionId: night2, gate: "Gate A", deviceId: "d1", result: "admitted", scannedAt: new Date().toISOString() }] }),
    );
    expect(synced.results[0]!.result).toBe("admitted");
    expect(await Scan.countDocuments({ ticketId: t!._id, sessionId: new mongoose.Types.ObjectId(night2) })).toBe(1);
  });
});
