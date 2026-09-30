import { formatGBP } from "@indinite/core";
import { audited } from "../audit";
import { enqueueSendRefundEmail } from "../jobs";
import { Order } from "../models/order";
import { Scan } from "../models/scan";
import { Ticket } from "../models/ticket";
import { quota } from "../quota";
import { requireStripe } from "../stripe";
import { directChargeReachable, stripeTarget } from "./stripe-target";
import { withTransaction } from "../transaction";

/**
 * Refunds made directly in the Stripe dashboard (charge.refunded, and the reconciliation job), agreed 28 Sep 2026:
 * - refunded in full: every unscanned pass is refunded (stops working, seat back on sale), the order is marked
 *   refunded and the customer is emailed;
 * - part refund: the amount is recorded and the order flagged for staff to review (Stripe doesn't say which
 *   passes the money was for). Passes stay valid.
 * Our own refunds carry metadata.source = "indinite" and are already recorded, so they're skipped.
 */
export async function syncExternalRefunds(paymentIntentId: string): Promise<{ recorded: number; full: boolean } | null> {
  const order = await Order.findOne({ "stripe.paymentIntentId": paymentIntentId }).lean();
  if (!order) return null;
  // Paid into an organiser's own account that's since been disconnected: Indinite can't see its refunds.
  if (!(await directChargeReachable(order))) return null;
  const refunds = (await requireStripe().listRefunds(paymentIntentId, stripeTarget(order).stripeAccount)).filter((r) => r.status === "succeeded" || r.status === "pending");
  const known = new Set((order.refunds ?? []).map((r) => r.stripeRefundId).filter(Boolean));
  const external = refunds.filter((r) => r.metadata?.source !== "indinite" && !known.has(r.id));
  if (!external.length) return { recorded: 0, full: false };

  const refundedOnStripe = refunds.reduce((n, r) => n + r.amountPence, 0);
  const full = refundedOnStripe >= order.totalPence;

  return withTransaction(async (session) => {
    const fresh = await Order.findById(order._id, null, { session }).lean();
    if (!fresh) return null;
    const already = new Set((fresh.refunds ?? []).map((r) => r.stripeRefundId).filter(Boolean));
    const todo = external.filter((r) => !already.has(r.id));
    if (!todo.length) return { recorded: 0, full: false };
    const todoAmount = todo.reduce((n, r) => n + r.amountPence, 0);

    let refundedTicketIds: string[] = [];
    let keptScanned = 0;
    if (full) {
      const valid = await Ticket.find({ orderId: fresh._id, status: "valid" }, null, { session }).lean();
      const scanned = new Set(
        (await Scan.find({ ticketId: { $in: valid.map((t) => t._id) }, result: { $in: ["admitted", "manual_admit"] } }, { ticketId: 1 }, { session }).lean()).map((s) => String(s.ticketId)),
      );
      const toRefund = valid.filter((t) => !scanned.has(String(t._id)));
      keptScanned = valid.length - toRefund.length;
      if (toRefund.length) {
        await Ticket.updateMany({ _id: { $in: toRefund.map((t) => t._id) }, status: "valid" }, { $set: { status: "refunded" } }, { session });
        const perType = new Map<string, number>();
        for (const t of toRefund) perType.set(String(t.ticketTypeId), (perType.get(String(t.ticketTypeId)) ?? 0) + 1);
        for (const [typeId, qty] of perType) await quota.returnSold(typeId, qty, session);
      }
      refundedTicketIds = toRefund.map((t) => String(t._id));
    }

    const status = full ? "refunded" : fresh.status === "paid" ? "partially_refunded" : fresh.status;
    const note = full
      ? keptScanned
        ? `Refunded in full in Stripe, but ${keptScanned} pass${keptScanned === 1 ? " had" : "es had"} already been used at the gate.`
        : undefined
      : `${formatGBP(todoAmount)} refunded in Stripe outside Indinite. Check which passes to cancel.`;
    await Order.updateOne(
      { _id: fresh._id },
      {
        $set: { status, ...(note ? { needsReview: true, reviewNote: note } : {}) },
        $inc: { refundedPence: todoAmount },
        $push: {
          refunds: {
            $each: todo.map((r, i) => ({
              ticketIds: i === 0 ? refundedTicketIds : [],
              amountPence: r.amountPence,
              method: "stripe_dashboard",
              stripeRefundId: r.id,
              reason: "Refunded in the Stripe dashboard",
              refundedBy: "stripe",
            })),
          },
        },
      },
      { session },
    );
    await audited(session, {
      action: "order.refunded_in_stripe",
      entity: { type: "order", id: fresh._id },
      before: { status: fresh.status, refundedPence: fresh.refundedPence ?? 0 },
      after: { status, refundedPence: (fresh.refundedPence ?? 0) + todoAmount },
      reason: full ? "Refunded in full in the Stripe dashboard" : "Part refund in the Stripe dashboard",
      organizerId: fresh.organizerId,
      metadata: { stripeRefundIds: todo.map((r) => r.id), amountPence: todoAmount, passesRefunded: refundedTicketIds.length, needsReview: Boolean(note) },
    });
    for (const id of refundedTicketIds) {
      await audited(session, { action: "ticket.refunded", entity: { type: "ticket", id }, before: { status: "valid" }, after: { status: "refunded" }, reason: "Refunded in the Stripe dashboard", organizerId: fresh.organizerId });
    }
    if (full) await enqueueSendRefundEmail({ orderId: String(fresh._id), kind: "stripe_refund", refundIndex: (fresh.refunds?.length ?? 0) }, { session });
    return { recorded: todo.length, full };
  });
}
