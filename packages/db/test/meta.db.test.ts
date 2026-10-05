/**
 * Real-MongoDB tests for the Meta Conversions API (SPEC §4.11): per-event encrypted token, browser details saved
 * at checkout, the Purchase job queued by fulfilment, the send (against a fake Graph API) and the backfill query.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import { decryptSetting } from "@indinite/core/secrets";
import {
  AuditLog,
  Event,
  Job,
  MetaSendError,
  Order,
  Organizer,
  TicketType,
  createCheckoutOrder,
  findUnsentMetaPurchases,
  fulfilOrder,
  issueOfflineOrder,
  sendMetaPurchase,
  updateEvent,
} from "../src";

let replSet: MongoMemoryReplSet;
let graph: Server;
const requests: { url: string; body: Record<string, unknown> }[] = [];
let graphStatus = 200;
const TOKEN = "EAAGm0PX4ZCpsBAAtesttoken1234567890abcd";
const PIXEL = "1234567890123456";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.APP_URL = "https://events.example.test";
  graph = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", body: JSON.parse(raw || "{}") });
      res.writeHead(graphStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(graphStatus === 200 ? { events_received: 1 } : { error: { message: "Invalid OAuth access token", code: 190 } }));
    });
  });
  await new Promise<void>((r) => graph.listen(0, "127.0.0.1", r));
  process.env.META_GRAPH_API_BASE = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
}, 120_000);

afterAll(async () => {
  graph?.close();
  await mongoose.disconnect();
  await replSet?.stop();
});

const browser = { ip: "81.2.69.160", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" };
const asCustomer = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "customer" }, ...browser }, fn);
const asSystem = <T>(fn: () => Promise<T>) => runWithContext({ actor: systemActor }, fn);
const asOwner = <T>(organizerId: string, fn: () => Promise<T>) =>
  runWithContext({ actor: { type: "user", id: "owner-1", role: "member" }, organizerId }, fn);
const customer = { name: "Asha Patel", email: " Asha@Example.com ", phone: "07700 900123" };

let orgId: string;
let eventId: string;
let nightId: string;
let sessions: { id: string; label: string; startsAt: Date; endsAt: Date }[];
let slug: string;

beforeEach(async () => {
  requests.length = 0;
  graphStatus = 200;
  await Promise.all(mongoose.modelNames().filter((n) => n !== "AuditLog").map((n) => mongoose.model(n).deleteMany({})));
  const org = await Organizer.create({ name: "OM Events", slug: `om-${Date.now()}`, contactEmail: "o@example.com", authOrgId: `a-${Date.now()}`, commissionBps: 1000, orderPrefix: "OME" });
  slug = `united-raas-${Date.now()}`;
  const event = await Event.create({
    organizerId: org._id,
    slug,
    title: "United Raas 2.0",
    venue: { name: "Hall", address: "1 Road", postcode: "HA1 1AA" },
    sessions: [{ label: "Day 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) }],
    status: "published",
  });
  const [night] = await TicketType.create([{ eventId: event._id, name: "Day 1", pricePence: 2000, quota: 100, validSessionIds: [event.sessions[0]!._id] }]);
  orgId = String(org._id);
  eventId = String(event._id);
  nightId = String(night!._id);
  sessions = event.sessions.map((s) => ({ id: String(s._id), label: s.label, startsAt: s.startsAt, endsAt: s.endsAt }));
});

/** Save Meta settings through the audited event service, as the editor does. */
const saveMeta = (meta: { metaPixelId?: string; metaCapiToken?: string; metaCapiTokenRemove?: boolean; metaTestEventCode?: string }) =>
  asOwner(orgId, () => updateEvent(eventId, { title: "United Raas 2.0", slug, description: "", venue: { name: "Hall", address: "1 Road", postcode: "HA1 1AA" }, sessions, ...meta }));

const book = (cookies?: { fbp?: string; fbc?: string }) =>
  asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: nightId, qty: 2 }] }, new Date(), { metaCookies: cookies }));

describe("per-event Conversions API token", () => {
  it("is stored encrypted, never in the audit log; blank keeps it and Remove clears it", async () => {
    await saveMeta({ metaPixelId: PIXEL, metaCapiToken: TOKEN, metaTestEventCode: "TEST96780" });
    const saved = await Event.findById(eventId).select("+metaCapiToken").lean();
    expect(saved!.metaCapiToken).not.toContain(TOKEN);
    expect(decryptSetting(saved!.metaCapiToken!)).toBe(TOKEN);
    expect(saved).toMatchObject({ metaCapiTokenHint: "abcd", metaTestEventCode: "TEST96780" });
    // Not selected by default (editor, public pages).
    expect((await Event.findById(eventId).lean())!.metaCapiToken).toBeUndefined();
    const logs = await AuditLog.find({ "entity.id": eventId }).lean();
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(JSON.stringify(logs)).toContain("saved (ends …abcd)");

    await saveMeta({ metaPixelId: PIXEL }); // blank token: kept; blank test code: cleared
    const kept = await Event.findById(eventId).select("+metaCapiToken").lean();
    expect(decryptSetting(kept!.metaCapiToken!)).toBe(TOKEN);
    expect(kept!.metaTestEventCode).toBeUndefined();

    await saveMeta({ metaPixelId: PIXEL, metaCapiTokenRemove: true });
    const removed = await Event.findById(eventId).select("+metaCapiToken").lean();
    expect(removed!.metaCapiToken).toBeUndefined();
    expect(removed!.metaCapiTokenHint).toBeUndefined();
  });
});

describe("server Purchase", () => {
  it("saves browser details only for pixel events, keeps them out of the audit diff", async () => {
    const plain = await book({ fbp: "fb.1.1.1" });
    expect((await Order.findById(plain._id).lean())!.metaTracking).toBeUndefined();

    await saveMeta({ metaPixelId: PIXEL });
    const o = await book({ fbp: "fb.1.1790000000000.123", fbc: "fb.1.1790000000000.AbCd" });
    expect((await Order.findById(o._id).lean())!.metaTracking).toEqual({ fbp: "fb.1.1790000000000.123", fbc: "fb.1.1790000000000.AbCd", ...browser });
    const created = await AuditLog.findOne({ action: "order.created", "entity.id": String(o._id) }).lean();
    expect(JSON.stringify(created!.changes)).not.toContain("fb.1.1790000000000.123");
  });

  it("queues one job on payment only with a pixel and a token, then sends the brief's payload with the shared event ID", async () => {
    await saveMeta({ metaPixelId: PIXEL });
    const noToken = await book();
    await asSystem(() => fulfilOrder(noToken._id, { mode: "demo" }));
    expect(await Job.countDocuments({ queue: "meta-purchase" })).toBe(0);

    await saveMeta({ metaPixelId: PIXEL, metaCapiToken: TOKEN, metaTestEventCode: "TEST96780" });
    const o = await book({ fbp: "fb.1.1790000000000.123" });
    await asSystem(() => fulfilOrder(o._id, { mode: "demo" }));
    await asSystem(() => fulfilOrder(o._id, { mode: "demo" })); // webhook retry: no second job
    expect(await Job.find({ queue: "meta-purchase" }).lean()).toMatchObject([{ jobId: `meta-purchase:${String(o._id)}`, data: { orderId: String(o._id) } }]);

    const r = await asSystem(() => sendMetaPurchase(String(o._id)));
    expect(r).toMatchObject({ sent: true, test: true });
    expect(requests).toHaveLength(1);
    const { url, body } = requests[0]!;
    expect(url).toBe(`/v24.0/${PIXEL}/events`);
    expect(url).not.toContain(TOKEN); // the token goes in the body
    expect(body.access_token).toBe(TOKEN);
    expect(body.test_event_code).toBe("TEST96780");
    const paid = (await Order.findById(o._id).lean())!;
    expect((body.data as unknown[])[0]).toEqual({
      event_name: "Purchase",
      event_time: Math.floor(paid.paidAt!.getTime() / 1000),
      event_id: `purchase_${paid.publicId}`,
      action_source: "website",
      event_source_url: `https://events.example.test/e/${slug}`,
      user_data: { em: [sha("asha@example.com")], ph: [sha("447700900123")], client_ip_address: browser.ip, client_user_agent: browser.userAgent, fbp: "fb.1.1790000000000.123" },
      custom_data: { currency: "GBP", value: paid.totalPence / 100, content_ids: [nightId], content_type: "product", num_items: 2 },
    });
    // Test send: browser details kept for the real one.
    expect(paid.metaCapi).toMatchObject({ eventsReceived: 1, test: true });
    expect(paid.metaTracking).toBeDefined();

    // Live: cleared test code, sent again for real, then browser details deleted; audited without personal data.
    await saveMeta({ metaPixelId: PIXEL });
    expect(await asSystem(() => sendMetaPurchase(String(o._id)))).toMatchObject({ sent: true, test: false });
    expect(requests[1]!.body).not.toHaveProperty("test_event_code");
    const live = (await Order.findById(o._id).lean())!;
    expect(live.metaTracking).toBeUndefined();
    expect(live.metaCapi).toMatchObject({ test: false });
    const logs = await AuditLog.find({ action: "order.meta_purchase_sent", "entity.id": String(o._id) }).lean();
    expect(logs).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toMatch(/asha|81\.2\.69|iPhone|fb\.1/i);
    // Never twice for real.
    expect(await asSystem(() => sendMetaPurchase(String(o._id)))).toMatchObject({ sent: false, reason: "already sent" });
  });

  it("retries when Meta refuses, and never sends box office orders", async () => {
    await saveMeta({ metaPixelId: PIXEL, metaCapiToken: TOKEN });
    const o = await book();
    await asSystem(() => fulfilOrder(o._id, { mode: "demo" }));
    graphStatus = 400;
    await expect(asSystem(() => sendMetaPurchase(String(o._id)))).rejects.toThrow(MetaSendError);
    await expect(asSystem(() => sendMetaPurchase(String(o._id)))).rejects.toThrow(/Invalid OAuth access token/);
    expect((await Order.findById(o._id).lean())!.metaCapi).toBeUndefined();

    await Job.deleteMany({});
    const box = await asOwner(orgId, () => issueOfflineOrder(orgId, "owner-1", { eventId, customer: { name: "Box", email: "box@example.com" }, items: [{ ticketTypeId: nightId, qty: 1 }], method: "cash", note: "At the door" }));
    expect(await asSystem(() => sendMetaPurchase(String(box.order._id)))).toMatchObject({ sent: false, reason: "not a website booking" });
    expect(await Job.countDocuments({ queue: "meta-purchase" })).toBe(0);
  });

  it("backfill finds unsent paid orders, and takes IP and user agent from the audit log for older orders", async () => {
    await saveMeta({ metaPixelId: PIXEL, metaCapiToken: TOKEN });
    const old = await book();
    await asSystem(() => fulfilOrder(old._id, { mode: "demo" }));
    // An order from before 5 Oct: no saved browser details.
    await Order.updateOne({ _id: old._id }, { $unset: { metaTracking: 1 } });

    const { orders } = await findUnsentMetaPurchases({ since: new Date(Date.now() - 7 * 86_400_000) });
    expect(orders.map((o) => String(o._id))).toEqual([String(old._id)]);
    expect((await findUnsentMetaPurchases({ since: new Date(Date.now() + 60_000) })).orders).toHaveLength(0);

    await asSystem(() => sendMetaPurchase(String(old._id)));
    const sent = requests.at(-1)!.body.data as { user_data: Record<string, unknown> }[];
    expect(sent[0]!.user_data).toMatchObject({ client_ip_address: browser.ip, client_user_agent: browser.userAgent });
    expect(sent[0]!.user_data).not.toHaveProperty("fbp");
    expect((await findUnsentMetaPurchases({ since: new Date(Date.now() - 7 * 86_400_000) })).orders).toHaveLength(0);
  });
});
