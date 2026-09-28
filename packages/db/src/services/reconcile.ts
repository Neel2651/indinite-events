import { Hold } from "../models/hold";
import { Order } from "../models/order";
import { WebhookEvent } from "../models/webhook-event";
import { stripeGateway } from "../stripe";
import { confirmCardPayment } from "./card-payments";
import { releaseHold } from "./holds";
import { syncExternalRefunds } from "./stripe-refunds";

export interface ReconcileResult {
  confirmed: number;
  released: number;
  refundsRecorded: number;
  failedWebhooks: number;
}

/**
 * Worker job (every 15 minutes): catch anything Stripe's webhooks missed. Runs as the system actor.
 * - pending card bookings whose Checkout Session was paid → confirm (issue passes); expired sessions → release seats
 * - card orders from the last 14 days → record refunds made in the Stripe dashboard
 * - webhook events that failed and are still unprocessed → reported in the log
 */
export async function reconcileStripe(now = new Date(), opts: { lookbackDays?: number; limit?: number } = {}): Promise<ReconcileResult | null> {
  const gw = stripeGateway();
  if (!gw) return null;
  const limit = opts.limit ?? 200;
  const result: ReconcileResult = { confirmed: 0, released: 0, refundsRecorded: 0, failedWebhooks: 0 };

  // Give the webhook a couple of minutes first.
  const pending = await Order.find({ status: "pending", "stripe.checkoutSessionId": { $exists: true }, updatedAt: { $lt: new Date(now.getTime() - 2 * 60_000) } }, { _id: 1, stripe: 1 })
    .limit(limit)
    .lean();
  for (const o of pending) {
    try {
      const s = await gw.retrieveCheckoutSession(o.stripe!.checkoutSessionId!);
      if (s.status === "complete" && s.paymentStatus === "paid" && s.paymentIntentId) {
        await confirmCardPayment(String(o._id), s.id, s.paymentIntentId);
        result.confirmed++;
      } else if (s.status === "expired") {
        const hold = await Hold.findOne({ orderId: o._id, releasedAt: null }, { _id: 1 }).lean();
        if (hold && (await releaseHold(hold._id, "reconciliation"))) result.released++;
      }
    } catch (e) {
      console.error(`[reconcile] order ${String(o._id)}:`, e instanceof Error ? e.message : e);
    }
  }

  const since = new Date(now.getTime() - (opts.lookbackDays ?? 14) * 86_400_000);
  const paid = await Order.find({ status: { $in: ["paid", "partially_refunded"] }, "stripe.paymentIntentId": { $exists: true }, paidAt: { $gte: since } }, { "stripe.paymentIntentId": 1 })
    .limit(limit * 5)
    .lean();
  for (const o of paid) {
    try {
      const r = await syncExternalRefunds(o.stripe!.paymentIntentId!);
      result.refundsRecorded += r?.recorded ?? 0;
    } catch (e) {
      console.error(`[reconcile] refunds for order ${String(o._id)}:`, e instanceof Error ? e.message : e);
    }
  }

  result.failedWebhooks = await WebhookEvent.countDocuments({ processedAt: null, error: { $ne: null }, receivedAt: { $lt: new Date(now.getTime() - 10 * 60_000) } });
  if (result.failedWebhooks) console.error(`[reconcile] ${result.failedWebhooks} Stripe webhook event(s) failed and haven't been processed. Check webhookEvents.error.`);
  return result;
}
