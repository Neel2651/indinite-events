"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { ForbiddenError } from "@indinite/core";
import { audited, CancelError, cancelOrder, enqueueSendTickets, Order, RefundError, refundTickets, StripeNotConfiguredError, Ticket, withTransaction } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

export async function resendTicketsAction(slug: string, publicId: string): Promise<{ ok?: string; error?: string }> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("order.resendTickets")) return { error: "You don't have permission to resend passes." };
  const order = await Order.findOne({ publicId, organizerId: new Types.ObjectId(organizer.id) }, { status: 1, customer: 1 }).lean();
  if (!order) return { error: "Order not found." };
  if (order.status === "refunded" || order.status === "cancelled") return { error: `This booking was ${order.status}, so there are no passes to send.` };
  if (order.status !== "paid" && order.status !== "partially_refunded") return { error: "This booking hasn't been paid yet, so there are no passes to send. Resend the payment link instead." };
  const [valid, gone] = await Promise.all([Ticket.countDocuments({ orderId: order._id, status: "valid" }), Ticket.countDocuments({ orderId: order._id, status: { $ne: "valid" } })]);
  if (valid === 0) return { error: "Every pass on this booking has been refunded or cancelled, so there's nothing to send." };
  await asStaff(
    user,
    () =>
      withTransaction(async (session) => {
        await audited(session, { action: "order.resend_requested", entity: { type: "order", id: order._id }, organizerId: organizer.id });
        await enqueueSendTickets({ orderId: String(order._id), reason: "resend" }, { session });
      }),
    organizer.id,
  );
  revalidatePath(`/org/${slug}/orders/${publicId}`);
  const passes = `${valid} ${valid === 1 ? "pass" : "passes"}`;
  return {
    ok: gone
      ? `Sending the ${passes} still valid to ${order.customer?.email}. ${gone} refunded or cancelled ${gone === 1 ? "pass isn't" : "passes aren't"} included.`
      : `Sending ${passes} to ${order.customer?.email} again.`,
  };
}

/** SPEC §4.6: organiser owner or super admin, before the event starts, ticket price only. The organiser comes from the URL + membership. */
export async function refundAction(slug: string, publicId: string, ticketIds: string[], reason: string): Promise<{ ok?: string; error?: string }> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("order.refund")) return { error: "Only the organiser's owner or Indinite can refund." };
  try {
    const r = await asStaff(user, () => refundTickets({ user, organizerId: organizer.id, publicId, ticketIds, reason }), organizer.id);
    revalidatePath(`/org/${slug}/orders/${publicId}`);
    const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(r.amountPence / 100);
    return {
      ok:
        r.method === "stripe"
          ? `Refunded ${amount} to the customer's card. They've been emailed.`
          : r.method === "outside_indinite"
            ? `Recorded a refund of ${amount}. Please repay the customer yourself. They've been emailed.`
            : "Passes cancelled. The customer has been emailed.",
    };
  } catch (e) {
    if (e instanceof RefundError || e instanceof StripeNotConfiguredError) return { error: e.message };
    if (e instanceof ForbiddenError) return { error: "Only the organiser's owner or Indinite can refund." };
    console.error("[refund] failed", e instanceof Error ? e.message : e);
    return { error: "The refund didn't go through. Nothing was changed; please try again." };
  }
}

/** Cancel: unpaid bookings (order.cancelPending) or paid cash / account / complimentary bookings (owner). */
export async function cancelOrderAction(slug: string, publicId: string, reason: string): Promise<{ ok?: string; error?: string }> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("order.cancelPending") && !can("order.cancel")) return { error: "You don't have permission to cancel bookings." };
  try {
    const r = await asStaff(user, () => cancelOrder({ user, organizerId: organizer.id, publicId, reason }), organizer.id);
    revalidatePath(`/org/${slug}/orders/${publicId}`);
    return { ok: r.passes ? `Booking cancelled. ${r.passes} ${r.passes === 1 ? "pass no longer works" : "passes no longer work"} and the customer has been emailed.` : "Booking cancelled and its passes released." };
  } catch (e) {
    if (e instanceof CancelError) return { error: e.message };
    console.error("[cancel] failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't cancel the booking. Nothing was changed." };
  }
}
