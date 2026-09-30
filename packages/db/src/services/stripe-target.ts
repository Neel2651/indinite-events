import type { ChargeType } from "@indinite/core";
import { Organizer } from "../models/organizer";

/**
 * Where an order's card payment lives on Stripe. Express organisers are paid by destination charges (made on
 * Indinite's account); organisers who connected their existing account are paid by direct charges, made on their
 * own account, so every later call for that payment (refunds, cancel, reconciliation) needs `stripeAccount`.
 * Orders from before 1 Oct 2026 have no charge type: they're destination charges.
 */
export interface StripeTarget {
  chargeType: ChargeType;
  /** The organiser's account, for direct charges only (sent as the Stripe-Account header). */
  stripeAccount?: string;
}

export function stripeTarget(order: { stripe?: { chargeType?: string | null; accountId?: string | null } | null }): StripeTarget {
  return order.stripe?.chargeType === "direct" && order.stripe.accountId ? { chargeType: "direct", stripeAccount: order.stripe.accountId } : { chargeType: "destination" };
}

/**
 * A direct charge can only be managed through Indinite while that account is still connected to the organiser.
 * After a disconnect, Indinite can't see or refund the payment: it has to be refunded in the organiser's Stripe.
 */
export async function directChargeReachable(order: { organizerId: unknown; stripe?: { chargeType?: string | null; accountId?: string | null } | null }): Promise<boolean> {
  const t = stripeTarget(order);
  if (t.chargeType !== "direct") return true;
  const org = await Organizer.findById(order.organizerId, { stripeAccountId: 1 }).lean();
  return org?.stripeAccountId === t.stripeAccount;
}
