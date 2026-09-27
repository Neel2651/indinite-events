"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { audited, enqueueSendTickets, Order, withTransaction } from "@indinite/db";
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
