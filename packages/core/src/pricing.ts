import { customerCardFeePence, type CardFeeSettings } from "./merchant";
import { applyBps, assertPence, type Pence } from "./money";

export interface LineItem {
  ticketTypeId: string;
  name: string;
  /** The pass's normal price (even for complimentary orders; commission is based on it). */
  unitPricePence: Pence;
  qty: number;
}

/** percent discounts are in basis points (1000 = 10%); fixed discounts are in pence. */
export type Discount = { kind: "percent"; value: number } | { kind: "fixed"; value: Pence };

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
  /** Card bookings only: when `payer` is "customer", a card processing fee is added after tax. */
  cardFee?: CardFeeSettings;
}

export interface OrderPricing {
  /** Tickets at their normal price. */
  subtotalPence: Pence;
  discountPence: Pence;
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
  const { items, commissionBps, charges = [], taxBps = 0, discount, complimentary = false, cardFee } = input;
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
    const commissionPence = applyBps(subtotalPence, commissionBps);
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
  if (discount) {
    if (discount.kind === "percent") {
      assertBps(discount.value, "discount");
      discountPence = applyBps(subtotalPence, discount.value);
    } else {
      assertPence(discount.value, "fixed discount");
      discountPence = discount.value;
    }
    discountPence = Math.min(discountPence, subtotalPence);
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

const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

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
