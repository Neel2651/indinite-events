import { applicationFeeFor, canTakeCardPayments, cardFeeOf, chargeTypeFor } from "@indinite/core";
import { runWithContext, stripeActor } from "@indinite/core/context";
import { audited } from "../audit";
import { enqueueSendRefundEmail } from "../jobs";
import { Event } from "../models/event";
import { Hold } from "../models/hold";
import { Order } from "../models/order";
import { Organizer } from "../models/organizer";
import { WebhookEvent } from "../models/webhook-event";
import { requireStripe, snapshotAccount, type Stripe } from "../stripe";
import { withTransaction } from "../transaction";
import { CheckoutError, fulfilOrder, HoldExpiredError, LateSoldOutError } from "./checkout";
import { releaseHold } from "./holds";
import { disconnectMerchantAccount, syncMerchantAccount } from "./merchant";
import { syncExternalRefunds } from "./stripe-refunds";
import { stripeTarget } from "./stripe-target";

/** Stripe needs a Checkout Session to live at least 30 minutes (and at most 24 hours). */
const MIN_SESSION_MS = 31 * 60_000;
const MAX_SESSION_MS = 24 * 3_600_000 - 60_000;

/**
 * M4: send a pending order (public checkout or payment link) to Stripe Checkout. Express organisers are paid by a
 * destination charge; organisers who connected their existing Stripe account by a direct charge on that account.
 * Returns the URL to redirect the customer to. £0 orders are confirmed straight away.
 */
export async function startCardCheckout(orderId: string, urls: { successUrl: string; cancelUrl: string }, now = new Date()): Promise<{ url: string; free?: boolean }> {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new CheckoutError("Booking not found.", 404);
  if (order.status === "paid") return { url: urls.successUrl };
  if (order.status !== "pending") throw new CheckoutError("This booking has expired. Please start again.", 409);

  if (order.totalPence === 0) {
    await runWithContext({ actor: { type: "system", id: "system" } }, () => fulfilOrder(order._id, { mode: "free" }));
    return { url: urls.successUrl, free: true };
  }

  const org = await Organizer.findById(order.organizerId).lean();
  if (!org || !canTakeCardPayments(org)) throw new CheckoutError("Card payments aren't available for this event yet.", 409);
  const gw = requireStripe();

  // Reuse an open session (e.g. the customer pressed Pay twice).
  if (order.stripe?.checkoutSessionId && order.stripe.url && order.stripe.sessionExpiresAt && order.stripe.sessionExpiresAt.getTime() > now.getTime() + 60_000) {
    return { url: order.stripe.url };
  }

  // The session must last ≥ 30 min; extend the hold to match if needed.
  let expiresAt = order.expiresAt ?? new Date(now.getTime() + MIN_SESSION_MS);
  if (expiresAt.getTime() < now.getTime() + MIN_SESSION_MS) {
    expiresAt = new Date(now.getTime() + MIN_SESSION_MS);
    await withTransaction(async (session) => {
      await Order.updateOne({ _id: order._id, status: "pending" }, { $set: { expiresAt } }, { session });
      await Hold.updateOne({ orderId: order._id, releasedAt: null }, { $set: { expiresAt } }, { session });
    });
  }
  const sessionExpiresAt = new Date(Math.min(expiresAt.getTime(), now.getTime() + MAX_SESSION_MS));

  const event = await Event.findById(order.eventId, { title: 1 }).lean();
  const chargeType = chargeTypeFor(org.stripeAccountType);
  const accountId = org.stripeAccountId!;
  const applicationFeePence = applicationFeeFor({ totalPence: order.totalPence, platformFeePence: order.platformFeePence ?? order.applicationFeePence, cardFeePence: order.cardFeePence }, cardFeeOf(org), chargeType);
  const description = `${event?.title ?? "Event"}: ${order.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}`;
  const session = await gw.createCheckoutSession({
    orderId: String(order._id),
    publicId: order.publicId,
    description,
    customerEmail: order.customer!.email,
    totalPence: order.totalPence,
    applicationFeePence,
    accountId,
    chargeType,
    expiresAt: sessionExpiresAt,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
  });

  await withTransaction(async (s) => {
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          "stripe.checkoutSessionId": session.id,
          "stripe.url": session.url,
          "stripe.sessionExpiresAt": sessionExpiresAt,
          "stripe.applicationFeePence": applicationFeePence,
          "stripe.accountId": accountId,
          "stripe.chargeType": chargeType,
        },
      },
      { session: s },
    );
    await audited(s, {
      action: "order.checkout_started",
      entity: { type: "order", id: order._id },
      after: { checkoutSessionId: session.id, applicationFeePence, chargeType },
      organizerId: order.organizerId,
    });
  });
  return { url: session.url };
}

/**
 * Checkout completed: issue passes. If the passes sold out while the customer was paying late, refund the
 * whole payment (fees included: the booking failed on our side) and tell them.
 */
export async function confirmCardPayment(orderId: string, checkoutSessionId: string, paymentIntentId: string) {
  try {
    return await fulfilOrder(orderId, { mode: "stripe", checkoutSessionId, paymentIntentId });
  } catch (e) {
    const cancelled = e instanceof HoldExpiredError && (await Order.exists({ _id: orderId, status: "cancelled" }));
    if (!(e instanceof LateSoldOutError) && !cancelled) throw e;
    const order = await Order.findById(orderId).lean();
    if (!order || order.status === "refunded" || (order.refunds ?? []).some((r) => r.stripeRefundId && r.refundedBy === "system")) return null;
    const why = cancelled ? "The booking was cancelled before the payment completed" : "Passes sold out before your payment completed";
    const refund = await requireStripe().createRefund({
      paymentIntentId,
      amountPence: order.totalPence,
      stripeAccount: stripeTarget(order).stripeAccount,
      reverseTransfer: true,
      refundApplicationFee: true,
      idempotencyKey: `late-soldout-${orderId}`,
      metadata: { orderId: String(order._id), publicId: order.publicId, reason: cancelled ? "paid_after_cancel" : "sold_out_after_late_payment" },
    });
    await withTransaction(async (session) => {
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: { $ne: "refunded" }, "refunds.refundedBy": { $ne: "system" } },
        {
          // A cancelled booking stays cancelled; its payment is simply returned.
          $set: { ...(cancelled ? {} : { status: "refunded" }), "stripe.checkoutSessionId": checkoutSessionId, "stripe.paymentIntentId": paymentIntentId },
          $inc: { refundedPence: order.totalPence },
          $push: { refunds: { ticketIds: [], amountPence: order.totalPence, method: "stripe", stripeRefundId: refund.id, reason: why, refundedBy: "system" } },
        },
        { session, new: true },
      ).lean();
      if (!updated) return;
      await audited(session, {
        action: cancelled ? "order.payment_after_cancel_refunded" : "order.late_payment_refunded",
        entity: { type: "order", id: order._id },
        before: { status: order.status },
        after: { status: cancelled ? order.status : "refunded", refundedPence: order.totalPence },
        reason: why,
        organizerId: order.organizerId,
        metadata: { stripeRefundId: refund.id },
      });
      await enqueueSendRefundEmail({ orderId: String(order._id), kind: cancelled ? "cancelled" : "sold_out" }, { session });
    });
    return null;
  }
}

/**
 * Stripe webhook (SPEC rule 6): record the event id first; skip anything already processed.
 * Throws on failure so Stripe retries (the event stays unprocessed until it succeeds).
 */
export async function handleStripeEvent(event: Stripe.Event, appUrl?: string): Promise<{ duplicate: boolean }> {
  let previous: { processedAt?: Date | null } | null;
  try {
    previous = await WebhookEvent.findOneAndUpdate(
      { stripeEventId: event.id },
      { $setOnInsert: { stripeEventId: event.id, type: event.type, receivedAt: new Date() } },
      { upsert: true, new: false },
    ).lean();
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && e.code === 11000) return { duplicate: true };
    throw e;
  }
  if (previous?.processedAt) return { duplicate: true };

  try {
    await runWithContext({ actor: stripeActor, requestId: `stripe:${event.id}` }, () => processEvent(event, appUrl));
    await WebhookEvent.updateOne({ stripeEventId: event.id }, { $set: { processedAt: new Date(), error: null } });
    return { duplicate: false };
  } catch (e) {
    await WebhookEvent.updateOne({ stripeEventId: event.id }, { $set: { error: e instanceof Error ? e.message.slice(0, 500) : "error" } });
    throw e;
  }
}

/**
 * Events about a payment on an organiser's own account (direct charge) carry `event.account`: act only if it's
 * the account the order was paid into. Platform events (destination charges) have no `event.account`.
 */
async function fromOrdersAccount(orderId: string, account: string | undefined): Promise<boolean> {
  const order = await Order.findById(orderId, { "stripe.accountId": 1, "stripe.chargeType": 1 }).lean();
  if (!order) return true; // confirmCardPayment reports a missing order
  const direct = order.stripe?.chargeType === "direct";
  const ok = direct ? account === order.stripe?.accountId : !account;
  if (!ok) console.warn(`[stripe webhook] event for order ${orderId} came from ${account ?? "the platform"}, not the order's account; ignored`);
  return ok;
}

async function processEvent(event: Stripe.Event, appUrl?: string) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      if (s.payment_status !== "paid") return;
      const orderId = s.metadata?.orderId ?? s.client_reference_id;
      const paymentIntentId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (!orderId || !paymentIntentId) return;
      if (!(await fromOrdersAccount(orderId, event.account))) return;
      await confirmCardPayment(orderId, s.id, paymentIntentId);
      return;
    }
    case "checkout.session.expired": {
      const s = event.data.object;
      const orderId = s.metadata?.orderId ?? s.client_reference_id;
      if (!orderId) return;
      const order = await Order.findById(orderId, { status: 1, "stripe.checkoutSessionId": 1 }).lean();
      // Only if this is still the order's current session (a newer one may be open).
      if (!order || order.status !== "pending" || order.stripe?.checkoutSessionId !== s.id) return;
      if (!(await fromOrdersAccount(orderId, event.account))) return;
      const hold = await Hold.findOne({ orderId: order._id, releasedAt: null }, { _id: 1 }).lean();
      if (hold) await releaseHold(hold._id, "checkout_expired");
      return;
    }
    case "charge.refunded": {
      // A refund made in the Stripe dashboard (ours are already recorded and marked source=indinite).
      const charge = event.data.object;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (pi) await syncExternalRefunds(pi);
      return;
    }
    case "account.updated":
      await syncMerchantAccount(snapshotAccount(event.data.object), appUrl);
      return;
    case "account.application.deauthorized":
      if (event.account) await disconnectMerchantAccount(event.account);
      return;
    default:
      return; // Not needed.
  }
}


