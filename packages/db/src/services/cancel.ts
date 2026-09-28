import { Types } from "mongoose";
import { can, type AuthUser } from "@indinite/core";
import { audited } from "../audit";
import { enqueueSendRefundEmail } from "../jobs";
import { CommissionLedger } from "../models/commission-ledger";
import { Hold } from "../models/hold";
import { Order } from "../models/order";
import { Scan } from "../models/scan";
import { Ticket } from "../models/ticket";
import { quota } from "../quota";
import { stripeGateway } from "../stripe";
import { withTransaction } from "../transaction";
import { releaseHoldInSession } from "./holds";
import { releaseCoupon } from "./pricing";

/**
 * Cancel a booking (agreed 28 Sep 2026):
 * - unpaid (pending) booking, e.g. a payment link no longer wanted: anyone with `order.cancelPending`. Seats and
 *   the coupon use come back; an open Stripe checkout is closed first.
 * - paid cash / organiser's account / complimentary booking: owner or super admin (`order.cancel`), only if no
 *   pass has been scanned. Passes stop working, seats go back on sale, the coupon use and the commission owed are
 *   reversed (the complimentary allowance isn't given back), and the customer is emailed.
 * - card bookings are refunded instead (SPEC §4.6).
 */

export class CancelError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

export async function cancelOrder(input: { user: AuthUser; organizerId: string; publicId: string; reason: string }) {
  const { user, organizerId, publicId } = input;
  const reason = input.reason.trim();
  if (reason.length < 3) throw new CancelError("Add a reason for cancelling.");
  const order = await Order.findOne({ publicId, organizerId: new Types.ObjectId(organizerId) }).lean();
  if (!order) throw new CancelError("Order not found.", 404);
  const resource = { organizerId };

  if (order.status === "pending") {
    if (!can(user, "order.cancelPending", resource)) throw new CancelError("You don't have permission to cancel bookings.", 403);
    // Close the Stripe page first so the customer can't pay after we cancel. If they already paid, don't cancel.
    const gw = stripeGateway();
    if (order.stripe?.checkoutSessionId && gw) {
      await gw.expireCheckoutSession(order.stripe.checkoutSessionId);
      const s = await gw.retrieveCheckoutSession(order.stripe.checkoutSessionId);
      if (s.status === "complete") throw new CancelError("The customer has just paid for this booking, so it can't be cancelled. Refresh the page.", 409);
    }
    return withTransaction(async (session) => {
      const hold = await Hold.findOne({ orderId: order._id, releasedAt: null }, { _id: 1 }, { session }).lean();
      const released = hold ? await releaseHoldInSession(session, hold._id, "cancelled") : false;
      const res = await Order.updateOne(
        { _id: order._id, status: released ? "cancelled" : "pending" },
        { $set: { status: "cancelled", cancellation: { reason, by: user.id, at: new Date() } } },
        { session },
      );
      if (res.matchedCount !== 1) throw new CancelError("This booking has just been paid or has expired. Refresh the page.", 409);
      await audited(session, { action: "order.cancelled", entity: { type: "order", id: order._id }, before: { status: "pending" }, after: { status: "cancelled" }, reason, organizerId: order.organizerId });
      return { status: "cancelled" as const, passes: 0 };
    });
  }

  if (order.status !== "paid" && order.status !== "partially_refunded") {
    throw new CancelError(order.status === "cancelled" ? "This booking is already cancelled." : "Only unpaid or paid bookings can be cancelled.", 409);
  }
  if (order.source !== "offline") throw new CancelError("Card bookings are cancelled by refunding them. Use Refund below.", 409);
  if (!can(user, "order.cancel", resource)) throw new CancelError("Only the organiser's owner can cancel a paid booking.", 403);

  const tickets = await Ticket.find({ orderId: order._id, status: "valid" }).lean();
  if (await Scan.exists({ ticketId: { $in: tickets.map((t) => t._id) }, result: { $in: ["admitted", "manual_admit"] } })) {
    throw new CancelError("Some passes on this booking have been used at the gate, so it can't be cancelled.", 409);
  }

  return withTransaction(async (session) => {
    const ids = tickets.map((t) => t._id);
    const res = await Ticket.updateMany({ _id: { $in: ids }, status: "valid" }, { $set: { status: "cancelled" } }, { session });
    if (res.modifiedCount !== ids.length) throw new CancelError("Those passes just changed. Refresh and try again.", 409);
    const perType = new Map<string, number>();
    for (const t of tickets) perType.set(String(t.ticketTypeId), (perType.get(String(t.ticketTypeId)) ?? 0) + 1);
    for (const [typeId, qty] of perType) await quota.returnSold(typeId, qty, session);

    if (order.couponId) await releaseCoupon(order.couponId, session, { orderId: order._id, publicId: order.publicId, organizerId: order.organizerId, reason: "cancelled" });

    // Reverse whatever commission this booking still owes.
    const ledger = await CommissionLedger.find({ orderId: order._id }, null, { session }).lean();
    const owed = ledger.filter((l) => l.kind === "offline_sale_owed").reduce((n, l) => n + l.amountPence, 0) - ledger.filter((l) => l.kind === "offline_sale_reversed").reduce((n, l) => n + l.amountPence, 0);
    if (owed > 0) {
      await CommissionLedger.create([{ organizerId: order.organizerId, eventId: order.eventId, orderId: order._id, amountPence: owed, kind: "offline_sale_reversed", note: `Cancelled ${order.publicId}`, recordedBy: user.id }], { session });
    }

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status },
      { $set: { status: "cancelled", cancellation: { reason, by: user.id, at: new Date() } } },
      { session, new: true },
    ).lean();
    if (!updated) throw new CancelError("This booking just changed. Refresh and try again.", 409);
    await audited(session, {
      action: "order.cancelled",
      entity: { type: "order", id: order._id },
      before: { status: order.status },
      after: { status: "cancelled" },
      reason,
      organizerId: order.organizerId,
      metadata: { passes: ids.length, commissionReversedPence: Math.max(0, owed) },
    });
    for (const t of tickets) {
      await audited(session, { action: "ticket.cancelled", entity: { type: "ticket", id: t._id }, before: { status: "valid" }, after: { status: "cancelled" }, reason, organizerId: order.organizerId });
    }
    await enqueueSendRefundEmail({ orderId: String(order._id), kind: "cancelled" }, { session });
    return { status: "cancelled" as const, passes: ids.length };
  });
}
