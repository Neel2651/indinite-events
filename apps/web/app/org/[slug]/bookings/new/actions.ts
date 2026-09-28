"use server";

import { ForbiddenError, offlineIssueSchema, paymentLinkBookingSchema, resolvePaymentsMode, type Discount } from "@indinite/core";
import { linkSecret, signOrderLink } from "@indinite/core/links";
import { Types } from "mongoose";
import { appUrl } from "@indinite/auth";
import { CheckoutError, CouponError, createPaymentLinkOrder, enqueueSendPaymentLink, Event, findCoupon, issueOfflineOrder } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

export type OfflineResult =
  | { ok: true; publicId: string; totalPence: number; passes: number; viewUrl: string; email: string }
  | { ok: false; error: string };

/** Organiser comes from the URL slug and the user's access; never from the form. */
export async function issueOfflineAction(slug: string, payload: unknown): Promise<OfflineResult> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("order.issueOffline")) return { ok: false, error: "You don't have permission to issue bookings." };
  const parsed = offlineIssueSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  try {
    const { order, ticketsIssued } = await asStaff(user, () => issueOfflineOrder(organizer.id, user.id, parsed.data), organizer.id);
    const t = signOrderLink(order.publicId, linkSecret());
    return {
      ok: true,
      publicId: order.publicId,
      totalPence: order.totalPence,
      passes: ticketsIssued,
      viewUrl: `/orders/${encodeURIComponent(order.publicId)}?t=${encodeURIComponent(t)}`,
      email: order.customer?.email ?? "",
    };
  } catch (e) {
    if (e instanceof CheckoutError) return { ok: false, error: e.message };
    if (e instanceof ForbiddenError) return { ok: false, error: "You don't have permission to issue bookings." };
    console.error("[offline booking] failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't issue the booking. Nothing was saved. Please try again." };
  }
}

export type PaymentLinkResult = { ok: true; publicId: string; totalPence: number; url: string; email: string; expiresAt: string } | { ok: false; error: string };

/** "Generate payment link": pending booking held for the link's validity; customer is emailed the link. */
export async function createPaymentLinkAction(slug: string, payload: unknown): Promise<PaymentLinkResult> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("order.createPaymentLink")) return { ok: false, error: "You don't have permission to create payment links." };
  const parsed = paymentLinkBookingSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  try {
    const order = await asStaff(user, () => createPaymentLinkOrder(organizer.id, user.id, parsed.data, { requireCardPayments: resolvePaymentsMode(process.env) === "stripe", user }), organizer.id);
    const ttl = Math.max(60_000, (order.expiresAt?.getTime() ?? Date.now()) - Date.now());
    const t = signOrderLink(order.publicId, linkSecret(), Date.now(), ttl);
    const url = `${appUrl()}/pay/${encodeURIComponent(order.publicId)}?t=${encodeURIComponent(t)}`;
    await enqueueSendPaymentLink({ orderId: String(order._id), url });
    return { ok: true, publicId: order.publicId, totalPence: order.totalPence, url, email: order.customer?.email ?? "", expiresAt: (order.expiresAt ?? new Date()).toISOString() };
  } catch (e) {
    if (e instanceof CheckoutError) return { ok: false, error: e.message };
    console.error("[payment link] failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't create the payment link. Nothing was saved." };
  }
}

/** Check a coupon for the booking form's price preview. */
export async function checkCouponAction(slug: string, eventId: string, code: string): Promise<{ ok: true; code: string; rule: Discount } | { ok: false; error: string }> {
  const { organizer } = await requireOrg(slug);
  if (!Types.ObjectId.isValid(eventId) || !(await Event.exists({ _id: eventId, organizerId: organizer.id }))) return { ok: false, error: "Choose an event." };
  try {
    const c = await findCoupon(organizer.id, eventId, code);
    return c ? { ok: true, code: c.code, rule: c.rule } : { ok: false, error: "Enter a code." };
  } catch (e) {
    return { ok: false, error: e instanceof CouponError ? e.message : "Couldn't check that code." };
  }
}
