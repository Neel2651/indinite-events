import { Types } from "mongoose";
import { assertCan, ticketRefundShares, type AuthUser } from "@indinite/core";
import { audited } from "../audit";
import { enqueueSendRefundEmail } from "../jobs";
import { Event } from "../models/event";
import { Order } from "../models/order";
import { Scan } from "../models/scan";
import { Ticket } from "../models/ticket";
import { quota } from "../quota";
import { requireStripe } from "../stripe";
import { directChargeReachable, stripeTarget } from "./stripe-target";
import { withTransaction } from "../transaction";

/**
 * Refunds (SPEC §4.6, agreed 28 Sep 2026):
 * - only the organiser OWNER or an Indinite super admin (not managers, box office or finance);
 * - only before the event starts, and only passes that haven't been scanned;
 * - only the ticket price actually paid (after coupon) — platform fee, organiser charges and tax are never refunded;
 * - card/payment-link orders are refunded through Stripe (Indinite keeps its fee; the amount comes back from the
 *   organiser's balance); cash / organiser's-account orders are recorded here and repaid by the organiser directly,
 *   as are card payments made into the organiser's own Stripe account after it's been disconnected (Indinite can
 *   no longer refund those: the organiser refunds them in their Stripe dashboard);
 *   complimentary passes are simply cancelled.
 * Refunded passes stop working at the gate and their seats go back on sale.
 */

export class RefundError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400) {
    super(message);
  }
}

export interface RefundQuote {
  eligible: boolean;
  reason?: string;
  method: "stripe" | "outside_indinite" | "none";
  eventStartsAt: Date;
  tickets: { id: string; ticketTypeName: string; refundablePence: number; status: string; scanned: boolean }[];
}

async function loadForRefund(organizerId: string, publicId: string) {
  const order = await Order.findOne({ publicId, organizerId: new Types.ObjectId(organizerId) }).lean();
  if (!order) throw new RefundError("Order not found.", 404);
  const event = await Event.findById(order.eventId, { startsAt: 1, title: 1 }).lean();
  if (!event) throw new RefundError("Event not found.", 404);
  const tickets = await Ticket.find({ orderId: order._id }).sort({ _id: 1 }).lean();
  const scanned = new Set(
    (await Scan.find({ ticketId: { $in: tickets.map((t) => t._id) }, result: { $in: ["admitted", "manual_admit"] } }, { ticketId: 1 }).lean()).map((s) => String(s.ticketId)),
  );
  const unitPrice = new Map(order.items.map((i) => [String(i.ticketTypeId), i.unitPricePence]));
  const complimentary = order.offline?.method === "complimentary";
  const shares = ticketRefundShares(
    tickets.map((t) => ({ ticketId: String(t._id), unitPricePence: unitPrice.get(String(t.ticketTypeId)) ?? 0, ticketTypeId: String(t.ticketTypeId) })),
    order.discount?.amountPence ?? 0,
    complimentary,
    order.discount?.ticketTypeIds,
  );
  const method: RefundQuote["method"] =
    order.source === "offline" ? (complimentary ? "none" : "outside_indinite") : (await directChargeReachable(order)) ? "stripe" : "outside_indinite";
  return { order, event, tickets, scanned, shares, method };
}

function eligibility(order: { status?: string | null }, eventStartsAt: Date, now: Date): string | undefined {
  if (order.status !== "paid" && order.status !== "partially_refunded") return "Only paid orders can be refunded.";
  if (now >= eventStartsAt) return "Refunds close when the event starts.";
  return undefined;
}

/** What the owner would see before refunding (amounts per pass, and whether a refund is allowed now). */
export async function quoteRefund(organizerId: string, publicId: string, now = new Date()): Promise<RefundQuote> {
  const { order, event, tickets, scanned, shares, method } = await loadForRefund(organizerId, publicId);
  const reason = eligibility(order, event.startsAt, now);
  return {
    eligible: !reason,
    reason,
    method,
    eventStartsAt: event.startsAt,
    tickets: tickets.map((t) => ({
      id: String(t._id),
      ticketTypeName: t.ticketTypeName,
      refundablePence: shares.get(String(t._id)) ?? 0,
      status: t.status ?? "valid",
      scanned: scanned.has(String(t._id)),
    })),
  };
}

export async function refundTickets(input: { user: AuthUser; organizerId: string; publicId: string; ticketIds: string[]; reason: string; now?: Date }) {
  const { user, organizerId, publicId } = input;
  const now = input.now ?? new Date();
  assertCan(user, "order.refund", { organizerId });
  const reason = input.reason.trim();
  if (reason.length < 3) throw new RefundError("Add a reason for the refund.");
  const wanted = [...new Set(input.ticketIds)];
  if (wanted.length === 0) throw new RefundError("Choose at least one pass to refund.");

  const { order, event, tickets, scanned, shares, method } = await loadForRefund(organizerId, publicId);
  const blocked = eligibility(order, event.startsAt, now);
  if (blocked) throw new RefundError(blocked, 409);

  const byId = new Map(tickets.map((t) => [String(t._id), t]));
  for (const id of wanted) {
    const t = byId.get(id);
    if (!t) throw new RefundError("One of those passes isn't on this order.", 404);
    if (t.status !== "valid") throw new RefundError(`Pass ${id.slice(-6)} has already been refunded or cancelled.`, 409);
    if (scanned.has(id)) throw new RefundError("A pass that has been used at the gate can't be refunded.", 409);
  }
  const amountPence = wanted.reduce((s, id) => s + (shares.get(id) ?? 0), 0);

  // Card payments: refund through Stripe first. The idempotency key makes a retry after a failure safe.
  let stripeRefundId: string | undefined;
  if (method === "stripe" && amountPence > 0) {
    if (!order.stripe?.paymentIntentId) throw new RefundError("This order has no card payment to refund.", 409);
    const refund = await requireStripe().createRefund({
      paymentIntentId: order.stripe.paymentIntentId,
      amountPence,
      stripeAccount: stripeTarget(order).stripeAccount,
      reverseTransfer: true, // take it back from the organiser's balance
      refundApplicationFee: false, // Indinite's platform fee isn't refundable
      idempotencyKey: `refund-${order._id}-${[...wanted].sort().join(".")}`,
      metadata: { orderId: String(order._id), publicId: order.publicId, tickets: String(wanted.length) },
    });
    stripeRefundId = refund.id;
  }

  return withTransaction(async (session) => {
    const ids = wanted.map((id) => new Types.ObjectId(id));
    // Conditional: a concurrent refund of the same passes can't succeed twice.
    const res = await Ticket.updateMany({ _id: { $in: ids }, orderId: order._id, status: "valid" }, { $set: { status: "refunded" } }, { session });
    if (res.modifiedCount !== ids.length) throw new RefundError("Those passes were just refunded by someone else. Refresh and check.", 409);

    // Seats go back on sale.
    const perType = new Map<string, number>();
    for (const id of wanted) {
      const typeId = String(byId.get(id)!.ticketTypeId);
      perType.set(typeId, (perType.get(typeId) ?? 0) + 1);
    }
    for (const [typeId, qty] of perType) await quota.returnSold(typeId, qty, session);

    const remaining = tickets.filter((t) => t.status === "valid" && !wanted.includes(String(t._id))).length;
    const updated = await Order.findOneAndUpdate(
      { _id: order._id },
      {
        $set: { status: remaining === 0 ? "refunded" : "partially_refunded" },
        $inc: { refundedPence: amountPence },
        $push: { refunds: { ticketIds: ids, amountPence, method: amountPence === 0 ? "none" : method, stripeRefundId, reason, refundedBy: user.id } },
      },
      { session, new: true },
    ).lean();

    await audited(session, {
      action: "order.refunded",
      entity: { type: "order", id: order._id },
      before: { status: order.status, refundedPence: order.refundedPence ?? 0 },
      after: { status: updated!.status, refundedPence: updated!.refundedPence },
      reason,
      organizerId: order.organizerId,
      metadata: { tickets: wanted.length, amountPence, method, stripeRefundId },
    });
    for (const id of wanted) {
      await audited(session, {
        action: "ticket.refunded",
        entity: { type: "ticket", id },
        before: { status: "valid" },
        after: { status: "refunded", refundedPence: shares.get(id) ?? 0 },
        reason,
        organizerId: order.organizerId,
      });
    }
    await enqueueSendRefundEmail({ orderId: String(order._id), kind: "refund", refundIndex: (updated!.refunds?.length ?? 1) - 1 }, { session });
    return { amountPence, method, stripeRefundId, status: updated!.status, tickets: wanted.length };
  });
}
