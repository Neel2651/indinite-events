"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { ForbiddenError } from "@indinite/core";
import { audited, enqueueSendTickets, Order, RefundError, refundTickets, StripeNotConfiguredError, withTransaction } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

export async function resendTicketsAction(slug: string, publicId: string): Promise<{ ok?: string; error?: string }> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("order.resendTickets")) return { error: "You don't have permission to resend passes." };
  const order = await Order.findOne({ publicId, organizerId: new Types.ObjectId(organizer.id) }, { status: 1, customer: 1 }).lean();
  if (!order || (order.status !== "paid" && order.status !== "partially_refunded")) return { error: "Only paid orders can be resent." };
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
  return { ok: `Passes will be emailed to ${order.customer?.email} again.` };
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
