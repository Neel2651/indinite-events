import { customerCardFeePence, type CardFeeSettings } from "./merchant";
import { applyBps, assertPence, formatGBP, type Pence } from "./money";

export interface LineItem {
  ticketTypeId: string;
  name: string;
  /** The pass's normal price (even for complimentary orders; commission is based on it). */
  unitPricePence: Pence;
  qty: number;
}

/**
 * percent discounts are in basis points (1000 = 10%); fixed discounts are in pence. Coupon limits, both measured
 * on the ticket subtotal before fees (agreed 28 Sep 2026): `maxAmountPence` caps a percent discount,
 * `minSubtotalPence` is the minimum ticket spend for the code to apply.
 */
export type Discount = ({ kind: "percent"; value: number } | { kind: "fixed"; value: Pence }) & {
  maxAmountPence?: Pence | null;
  minSubtotalPence?: Pence | null;
};

/** How much a discount takes off a ticket subtotal, or why it doesn't apply. */
export function discountAmount(subtotalPence: Pence, d: Discount): { amountPence: Pence } | { ineligible: string } {
  assertPence(subtotalPence, "subtotalPence");
  if (d.minSubtotalPence && subtotalPence < d.minSubtotalPence) {
    return { ineligible: `Spend at least ${formatGBP(d.minSubtotalPence)} on tickets to use this code.` };
  }
  let amount: Pence;
  if (d.kind === "percent") {
    assertBps(d.value, "discount");
    amount = applyBps(subtotalPence, d.value);
    if (d.maxAmountPence != null) {
      assertPence(d.maxAmountPence, "maxAmountPence");
      amount = Math.min(amount, d.maxAmountPence);
    }
  } else {
    assertPence(d.value, "fixed discount");
    amount = d.value;
  }
  return { amountPence: Math.min(amount, subtotalPence) };
}

/** Organiser charge, applied per ticket: fixed pence, or bps of the ticket price. Goes to the organiser. */
export interface OrderCharge {
  name: string;
  kind: "fixed" | "percent";
  value: number;
}

export interface PricingInput {
  items: LineItem[];
  /** Indinite's platform fee = commission, bps of the ticket price (600 = 6%). Added on top. */
  commissionBps: number;
  charges?: OrderCharge[];
  /** Tax on tickets + platform fee + charges (2000 = 20%). */
  taxBps?: number;
  /** Coupon, applied to the ticket price before fees. */
  discount?: Discount;
  /** Free passes: customer pays nothing, but commission is still owed on the normal price. */
  complimentary?: boolean;
  /**
   * Complimentary only: passes still inside the event's commission-free allowance. Undefined = no allowance
   * (commission on every pass).
   */
  complimentaryFreeLeft?: number;
  /** Card bookings only: when `payer` is "customer", a card processing fee is added after tax. */
  cardFee?: CardFeeSettings;
}

export interface OrderPricing {
  /** Tickets at their normal price. */
  subtotalPence: Pence;
  discountPence: Pence;
  /** Set when the discount's minimum spend isn't met (no discount is applied); services refuse the booking. */
  discountIneligible?: string;
  /** Tickets after discount (what the customer pays for the passes themselves). */
  ticketsPence: Pence;
  platformFeePence: Pence;
  charges: { name: string; amountPence: Pence }[];
  chargesPence: Pence;
  taxPence: Pence;
  /** Card processing fee paid by the customer (0 unless the organiser's card fee payer is "customer"). */
  cardFeePence: Pence;
  totalPence: Pence;
  /** Indinite's income from this order: the platform fee (for comps, % of the normal price). */
  commissionPence: Pence;
  /** What the organiser keeps if the money goes through Stripe: total − commission − customer card fee. */
  organizerPence: Pence;
}

/**
 * SPEC §4.7 pricing: tickets − coupon → + platform fee (commission %) → + organiser charges (per ticket)
 * → + tax on all of that. Example: £12 ticket, 6% fee, £0.30 charge, 20% tax
 *   = 12.00 + 0.72 + 0.30 + 2.60 = £15.62.
 */
export function priceOrder(input: PricingInput): OrderPricing {
  const { items, commissionBps, charges = [], taxBps = 0, discount, complimentary = false, complimentaryFreeLeft, cardFee } = input;
  if (items.length === 0) throw new Error("Order must contain at least one item");
  assertBps(commissionBps, "commissionBps");
  assertBps(taxBps, "taxBps");

  let subtotalPence = 0;
  let qty = 0;
  for (const item of items) {
    assertPence(item.unitPricePence, `unitPricePence of ${item.name}`);
    if (!Number.isInteger(item.qty) || item.qty < 1) throw new Error(`Invalid qty for ${item.name}`);
    subtotalPence += item.unitPricePence * item.qty;
    qty += item.qty;
  }

  if (complimentary) {
    const { commissionPence } = complimentaryCommission(items, commissionBps, complimentaryFreeLeft ?? 0);
    return {
      subtotalPence,
      discountPence: subtotalPence,
      ticketsPence: 0,
      platformFeePence: 0,
      charges: [],
      chargesPence: 0,
      taxPence: 0,
      cardFeePence: 0,
      totalPence: 0,
      commissionPence,
      organizerPence: 0,
    };
  }

  let discountPence = 0;
  let discountIneligible: string | undefined;
  if (discount) {
    const d = discountAmount(subtotalPence, discount);
    if ("ineligible" in d) discountIneligible = d.ineligible;
    else discountPence = d.amountPence;
  }
  const ticketsPence = subtotalPence - discountPence;
  const platformFeePence = applyBps(ticketsPence, commissionBps);

  const chargeLines = charges.map((c) => {
    if (c.kind === "fixed") {
      assertPence(c.value, `charge ${c.name}`);
      return { name: c.name, amountPence: c.value * qty };
    }
    assertBps(c.value, `charge ${c.name}`);
    return { name: c.name, amountPence: applyBps(ticketsPence, c.value) };
  });
  const chargesPence = chargeLines.reduce((s, c) => s + c.amountPence, 0);

  const taxPence = applyBps(ticketsPence + platformFeePence + chargesPence, taxBps);
  const beforeCardFee = ticketsPence + platformFeePence + chargesPence + taxPence;
  const cardFeePence = cardFee?.payer === "customer" ? customerCardFeePence(beforeCardFee, cardFee) : 0;
  const totalPence = beforeCardFee + cardFeePence;

  return {
    subtotalPence,
    discountPence,
    ...(discountIneligible ? { discountIneligible } : {}),
    ticketsPence,
    platformFeePence,
    charges: chargeLines,
    chargesPence,
    taxPence,
    cardFeePence,
    totalPence,
    commissionPence: platformFeePence,
    organizerPence: totalPence - platformFeePence - cardFeePence,
  };
}

/** Commission-free complimentary passes per event unless the super admin changes it (agreed 28 Sep 2026). */
export const DEFAULT_FREE_COMPLIMENTARY_PASSES = 5;

/**
 * Commission on complimentary passes (SPEC §4.7): the first `freeLeft` passes are free of commission, and the
 * organiser owes the platform fee on each further pass's normal price. The allowance covers the highest-priced
 * passes first.
 */
export function complimentaryCommission(items: LineItem[], commissionBps: number, freeLeft: number): { commissionPence: Pence; freePasses: number; chargedPasses: number } {
  assertBps(commissionBps, "commissionBps");
  if (!Number.isInteger(freeLeft) || freeLeft < 0) throw new Error(`freeLeft must be a non-negative integer, got ${freeLeft}`);
  const prices = items.flatMap((i) => Array.from({ length: i.qty }, () => i.unitPricePence)).sort((a, b) => b - a);
  const freePasses = Math.min(freeLeft, prices.length);
  const chargeable = prices.slice(freePasses).reduce((s, p) => s + p, 0);
  return { commissionPence: applyBps(chargeable, commissionBps), freePasses, chargedPasses: prices.length - freePasses };
}

function assertBps(v: number, label: string) {
  if (!Number.isInteger(v) || v < 0 || v > 10000) throw new Error(`${label} must be 0–10000 bps, got ${v}`);
}

/** Effective discount as bps of subtotal, used to enforce role-based discount limits. */
export function discountAsBps(subtotalPence: Pence, discount: Discount): number {
  if (discount.kind === "percent") return discount.value;
  if (subtotalPence === 0) return 0;
  return Math.ceil((Math.min(discount.value, subtotalPence) * 10000) / subtotalPence);
}

export const DEFAULT_COMMISSION_BPS = 600;

/** 5000 → "50%", 1250 → "12.5%". */
export const formatBpsPercent = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const pct = formatBpsPercent;

/** Receipt lines for an order (emails, pay page, confirmation), in the SPEC §4.7 order. */
export function receiptLines(o: {
  items: { name: string; qty: number; unitPricePence: number }[];
  discountPence?: number | null;
  discountLabel?: string | null;
  complimentary?: boolean;
  platformFeePence?: number | null;
  commissionBps?: number | null;
  charges?: { name?: string | null; amountPence?: number | null }[] | null;
  taxPence?: number | null;
  taxBps?: number | null;
  cardFeePence?: number | null;
}): { label: string; amountPence: number; negative?: boolean }[] {
  const lines: { label: string; amountPence: number; negative?: boolean }[] = o.items.map((i) => ({ label: `${i.qty} × ${i.name}`, amountPence: i.unitPricePence * i.qty }));
  if (o.discountPence) lines.push({ label: o.complimentary ? "Complimentary" : (o.discountLabel ?? "Discount"), amountPence: o.discountPence, negative: true });
  if (o.platformFeePence) lines.push({ label: `Platform fee (${pct(o.commissionBps ?? 0)})`, amountPence: o.platformFeePence });
  for (const c of o.charges ?? []) if (c.amountPence) lines.push({ label: c.name ?? "Charge", amountPence: c.amountPence });
  if (o.taxPence) lines.push({ label: `Tax (${pct(o.taxBps ?? 0)})`, amountPence: o.taxPence });
  if (o.cardFeePence) lines.push({ label: "Card processing fee", amountPence: o.cardFeePence });
  return lines;
}
