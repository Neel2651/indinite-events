import { applyBps, assertPence, type Pence } from "./money";

/**
 * Organiser merchant (Stripe Connect Express) status, SPEC §4.8.
 * - not_started: no Stripe account yet
 * - in_progress: account created, owner hasn't finished Stripe's form
 * - pending_verification: form submitted, Stripe is checking
 * - active: Stripe allows card payments
 * - restricted: Stripe needs more information before payments can continue
 */
export type MerchantStatus = "not_started" | "in_progress" | "pending_verification" | "active" | "restricted";

export interface MerchantFields {
  stripeAccountId?: string | null;
  chargesEnabled?: boolean | null;
  detailsSubmitted?: boolean | null;
  stripeDisabledReason?: string | null;
  stripeCurrentlyDue?: string[] | null;
  onlineSalesPaused?: boolean | null;
}

export function merchantStatus(o: MerchantFields): MerchantStatus {
  if (!o.stripeAccountId) return "not_started";
  if (o.chargesEnabled) return (o.stripeCurrentlyDue?.length ?? 0) > 0 && o.stripeDisabledReason ? "restricted" : "active";
  if (!o.detailsSubmitted) return "in_progress";
  return o.stripeDisabledReason && !String(o.stripeDisabledReason).includes("pending") ? "restricted" : "pending_verification";
}

/** Card payments and payment links are allowed only for active, un-paused organisers (when Stripe is on). */
export function canTakeCardPayments(o: MerchantFields): boolean {
  return merchantStatus(o) === "active" && !o.onlineSalesPaused;
}

export const MERCHANT_STATUS_LABELS: Record<MerchantStatus, string> = {
  not_started: "Not started",
  in_progress: "Setup in progress",
  pending_verification: "Waiting for Stripe",
  active: "Active",
  restricted: "Action needed",
};

/** Stripe's card processing fee as configured by the super admin (default 1.5% + 20p, UK cards). */
export interface CardFeeSettings {
  /** Who bears Stripe's fee: Indinite (out of the platform fee) or the organiser (deducted from their payout). */
  payer: "platform" | "organizer";
  bps: number;
  fixedPence: Pence;
}

export const DEFAULT_CARD_FEE: CardFeeSettings = { payer: "platform", bps: 150, fixedPence: 20 };

export function cardFeePence(totalPence: Pence, s: Pick<CardFeeSettings, "bps" | "fixedPence">): Pence {
  assertPence(totalPence, "totalPence");
  if (totalPence === 0) return 0;
  return Math.min(totalPence, applyBps(totalPence, s.bps) + s.fixedPence);
}

/**
 * Stripe application fee for a destination charge: Indinite's platform fee, plus Stripe's card fee when the
 * organiser bears it (with destination charges Stripe takes its fee from the platform, so we recover it here).
 */
export function applicationFeeFor(o: { totalPence: Pence; platformFeePence: Pence }, fee: CardFeeSettings): Pence {
  const extra = fee.payer === "organizer" ? cardFeePence(o.totalPence, fee) : 0;
  return Math.min(o.totalPence, o.platformFeePence + extra);
}

/**
 * Refundable amount per pass (SPEC §4.6): only the ticket price actually paid, i.e. each pass's share of
 * the ticket subtotal after the coupon. Platform fee, organiser charges and tax are never refunded.
 * `units` are the order's passes in issue order with their normal unit price. The shares always add up
 * to exactly (subtotal − discount), so refunding every pass never exceeds what was paid for tickets.
 */
export function ticketRefundShares(units: { ticketId: string; unitPricePence: Pence }[], discountPence: Pence, complimentary = false): Map<string, Pence> {
  const shares = new Map<string, Pence>();
  if (complimentary) {
    for (const u of units) shares.set(u.ticketId, 0);
    return shares;
  }
  const subtotal = units.reduce((s, u) => s + u.unitPricePence, 0);
  const discount = Math.min(discountPence, subtotal);
  if (subtotal === 0) {
    for (const u of units) shares.set(u.ticketId, 0);
    return shares;
  }
  const off = units.map((u) => Math.floor((discount * u.unitPricePence) / subtotal));
  let leftover = discount - off.reduce((s, d) => s + d, 0);
  for (let i = 0; leftover > 0 && i < units.length; i++) {
    if (off[i]! < units[i]!.unitPricePence) {
      off[i]! += 1;
      leftover--;
    }
  }
  units.forEach((u, i) => shares.set(u.ticketId, u.unitPricePence - off[i]!));
  return shares;
}
