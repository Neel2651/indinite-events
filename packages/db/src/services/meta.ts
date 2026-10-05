import { Types } from "mongoose";
import { capiPurchasePayload } from "@indinite/core/meta-capi";
import { decryptSetting } from "@indinite/core/secrets";
import { audited } from "../audit";
import { AuditLog } from "../models/audit-log";
import { Event } from "../models/event";
import { Order } from "../models/order";
import { withTransaction } from "../transaction";

/**
 * Meta Conversions API (SPEC §4.11): what the worker needs to send a server Purchase, and the record that it was
 * sent. Browser details (IP, user agent, fbp, fbc) are kept only until a real (non-test) send succeeds.
 */

const WEBSITE_SOURCES = ["online", "payment_link"] as const;
const PAID = ["paid", "partially_refunded"] as const;

/** Payment links: the customer's browser details are saved when they press Pay (the link was made by staff). */
export async function recordMetaTracking(orderId: string, cookies: { fbp?: string; fbc?: string }, client: { ip?: string; userAgent?: string }) {
  const clip = (v: string | undefined, n: number) => (v ? v.slice(0, n) : undefined);
  const t = { fbp: clip(cookies.fbp, 200), fbc: clip(cookies.fbc, 500), ip: clip(client.ip, 64), userAgent: clip(client.userAgent, 500) };
  if (!Object.values(t).some(Boolean)) return;
  await withTransaction(async (session) => {
    const order = await Order.findOne({ _id: orderId, status: "pending" }, { eventId: 1, organizerId: 1 }, { session }).lean();
    if (!order) return;
    const event = await Event.findById(order.eventId, { metaPixelId: 1 }, { session }).lean();
    if (!event?.metaPixelId) return;
    await Order.updateOne({ _id: order._id }, { $set: { metaTracking: t } }, { session });
    // No values in the diff: only that they were saved.
    await audited(session, { action: "order.meta_tracking_saved", entity: { type: "order", id: order._id }, organizerId: order.organizerId });
  });
}

export interface MetaPurchaseData {
  publicId: string;
  paidAt: Date;
  customer: { email: string; phone?: string | null };
  lines: { ticketTypeId: string; qty: number }[];
  totalPence: number;
  tracking: { ip?: string | null; userAgent?: string | null; fbp?: string | null; fbc?: string | null } | null;
  event: { slug: string; pixelId: string; encryptedToken: string; testEventCode: string | null };
}

/**
 * Everything for one order's server Purchase, or the reason it can't be sent. Without saved browser details
 * (orders from before 5 Oct 2026), IP and user agent come from the order's creation audit entry.
 */
export async function loadMetaPurchase(orderId: string): Promise<{ ok: true; data: MetaPurchaseData } | { ok: false; reason: string }> {
  if (!Types.ObjectId.isValid(orderId)) return { ok: false, reason: "order not found" };
  const order = await Order.findById(orderId).lean();
  if (!order) return { ok: false, reason: "order not found" };
  if (!(PAID as readonly string[]).includes(order.status ?? "") || !order.paidAt) return { ok: false, reason: `order is ${order.status}` };
  if (!(WEBSITE_SOURCES as readonly string[]).includes(order.source)) return { ok: false, reason: "not a website booking" };
  if (!order.customer?.email) return { ok: false, reason: "order has no email" };
  const event = await Event.findById(order.eventId, { slug: 1, metaPixelId: 1, metaTestEventCode: 1, metaCapiToken: 1 }).select("+metaCapiToken").lean();
  if (!event?.metaPixelId || !event.metaCapiToken) return { ok: false, reason: "event has no Meta pixel and access token" };

  let tracking: MetaPurchaseData["tracking"] = order.metaTracking ?? null;
  if (!tracking?.userAgent) {
    const created = await AuditLog.findOne(
      { "entity.type": "order", "entity.id": String(order._id), action: { $in: ["order.created", "order.payment_link_created"] } },
      { ip: 1, userAgent: 1 },
    ).lean();
    if (order.source === "online" && created?.userAgent) tracking = { ...tracking, ip: tracking?.ip ?? created.ip ?? null, userAgent: created.userAgent };
  }

  return {
    ok: true,
    data: {
      publicId: order.publicId,
      paidAt: order.paidAt,
      customer: { email: order.customer.email, phone: order.customer.phone ?? null },
      lines: order.items.map((i) => ({ ticketTypeId: String(i.ticketTypeId), qty: i.qty })),
      totalPence: order.totalPence,
      tracking,
      event: { slug: event.slug, pixelId: event.metaPixelId, encryptedToken: event.metaCapiToken, testEventCode: event.metaTestEventCode ?? null },
    },
  };
}

/** Meta accepted the Purchase. A real send deletes the saved browser details; a test send keeps them for the real one. */
export async function recordMetaPurchaseSent(orderId: string, result: { eventsReceived: number; test: boolean }) {
  await withTransaction(async (session) => {
    const order = await Order.findById(orderId, { organizerId: 1 }, { session }).lean();
    if (!order) return;
    const metaCapi = { sentAt: new Date(), eventsReceived: result.eventsReceived, test: result.test };
    await Order.updateOne({ _id: order._id }, { $set: { metaCapi }, ...(result.test ? {} : { $unset: { metaTracking: 1 } }) }, { session });
    await audited(session, { action: "order.meta_purchase_sent", entity: { type: "order", id: order._id }, after: metaCapi, organizerId: order.organizerId });
  });
}

/**
 * Paid website orders not yet sent to Meta (or only sent in test mode), for events with a pixel and an access
 * token, paid since `since` (Meta accepts server events up to 7 days old).
 */
export async function findUnsentMetaPurchases(opts: { since: Date; eventSlug?: string }) {
  const events = await Event.find(
    { metaPixelId: { $exists: true }, metaCapiTokenHint: { $exists: true }, deletedAt: null, ...(opts.eventSlug ? { slug: opts.eventSlug } : {}) },
    { slug: 1, title: 1, metaTestEventCode: 1 },
  ).lean();
  const orders = await Order.find(
    {
      eventId: { $in: events.map((e) => e._id) },
      source: { $in: WEBSITE_SOURCES },
      status: { $in: PAID },
      paidAt: { $gte: opts.since },
      $or: [{ metaCapi: { $exists: false } }, { "metaCapi.test": true }],
    },
    { publicId: 1, eventId: 1, totalPence: 1, paidAt: 1 },
  )
    .sort({ paidAt: 1 })
    .lean();
  return { events, orders };
}

export class MetaSendError extends Error {}

/**
 * Send one order's server Purchase to Meta (worker job `meta-purchase`). Skips (without retrying) orders that can't
 * be sent; throws MetaSendError on a failed request so the job is retried. The token goes in the body, never the URL.
 */
export async function sendMetaPurchase(orderId: string): Promise<{ sent: boolean; reason?: string; publicId?: string; test?: boolean }> {
  const loaded = await loadMetaPurchase(orderId);
  if (!loaded.ok) return { sent: false, reason: loaded.reason };
  const d = loaded.data;
  const order = await Order.findById(orderId, { metaCapi: 1 }).lean();
  // Already sent for real (a test send can be followed by the real one).
  if (order?.metaCapi?.sentAt && !order.metaCapi.test) return { sent: false, reason: "already sent", publicId: d.publicId };

  const token = decryptSetting(d.event.encryptedToken);
  const appUrl = (process.env.APP_URL ?? "https://events.indinite.co.uk").replace(/\/+$/, "");
  const body = {
    ...capiPurchasePayload({
      publicId: d.publicId,
      paidAt: d.paidAt,
      eventSourceUrl: `${appUrl}/e/${d.event.slug}`,
      customer: d.customer,
      tracking: d.tracking,
      lines: d.lines,
      totalPence: d.totalPence,
      testEventCode: d.event.testEventCode,
    }),
    access_token: token,
  };
  const base = (process.env.META_GRAPH_API_BASE ?? "https://graph.facebook.com").replace(/\/+$/, "");
  const version = process.env.META_GRAPH_API_VERSION || "v24.0";
  const res = await fetch(`${base}/${version}/${d.event.pixelId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string; code?: number } };
  // Meta's error message never contains the token; ours never includes the body.
  if (!res.ok) throw new MetaSendError(`Meta answered ${res.status}${json.error?.message ? `: ${json.error.message}` : ""}`);

  const test = Boolean(d.event.testEventCode);
  await recordMetaPurchaseSent(orderId, { eventsReceived: json.events_received ?? 0, test });
  return { sent: true, publicId: d.publicId, test };
}
