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

export type CardFeePayer = "platform" | "organizer" | "customer";

export const CARD_FEE_PAYERS: readonly CardFeePayer[] = ["platform", "organizer", "customer"];

/** Stripe's card processing fee as configured by the super admin (default 1.5% + 20p, UK cards). */
export interface CardFeeSettings {
  /**
   * Who bears Stripe's fee: Indinite (out of the platform fee), the organiser (deducted from their payout) or the
   * customer (added to card bookings as a "Card processing fee" line).
   */
  payer: CardFeePayer;
  bps: number;
  fixedPence: Pence;
}

export const DEFAULT_CARD_FEE: CardFeeSettings = { payer: "platform", bps: 150, fixedPence: 20 };

/** An organiser's stored card fee settings, with defaults. */
export function cardFeeOf(org: { cardFee?: { payer?: string | null; bps?: number | null; fixedPence?: number | null } | null }): CardFeeSettings {
  const payer = org.cardFee?.payer;
  return {
    payer: CARD_FEE_PAYERS.includes(payer as CardFeePayer) ? (payer as CardFeePayer) : DEFAULT_CARD_FEE.payer,
    bps: org.cardFee?.bps ?? DEFAULT_CARD_FEE.bps,
    fixedPence: org.cardFee?.fixedPence ?? DEFAULT_CARD_FEE.fixedPence,
  };
}

export function cardFeePence(totalPence: Pence, s: Pick<CardFeeSettings, "bps" | "fixedPence">): Pence {
  assertPence(totalPence, "totalPence");
  if (totalPence === 0) return 0;
  return Math.min(totalPence, applyBps(totalPence, s.bps) + s.fixedPence);
}

/**
 * Card processing fee the customer pays when `payer` is "customer": grossed up so that it covers Stripe's fee on
 * the whole charge (base + this fee). `basePence` is the order total before the fee. Not taxed.
 */
export function customerCardFeePence(basePence: Pence, s: Pick<CardFeeSettings, "bps" | "fixedPence">): Pence {
  assertPence(basePence, "basePence");
  if (basePence === 0) return 0;
  if (!Number.isInteger(s.bps) || s.bps < 0 || s.bps >= 10000) throw new Error(`Invalid card fee bps ${s.bps}`);
  return Math.ceil((basePence * s.bps + s.fixedPence * 10000) / (10000 - s.bps));
}

/**
 * Stripe application fee for a destination charge: Indinite's platform fee, plus Stripe's card fee when the
 * organiser or customer bears it (with destination charges Stripe takes its fee from the platform, so we recover
 * it here). A customer-paid fee is fixed on the order when it's priced (`cardFeePence`).
 */
export function applicationFeeFor(o: { totalPence: Pence; platformFeePence: Pence; cardFeePence?: Pence | null }, fee: CardFeeSettings): Pence {
  const extra = o.cardFeePence ? o.cardFeePence : fee.payer === "organizer" ? cardFeePence(o.totalPence, fee) : 0;
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
