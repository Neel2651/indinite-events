import { applyBps, assertPence, type Pence } from "./money";

export interface LineItem {
  ticketTypeId: string;
  name: string;
  unitPricePence: Pence;
  qty: number;
}

/** percent discounts are in basis points (1000 = 10%); fixed discounts are in pence. */
export type Discount = { kind: "percent"; value: number } | { kind: "fixed"; value: Pence };

export interface OrderTotals {
  subtotalPence: Pence;
  discountPence: Pence;
  totalPence: Pence;
  applicationFeePence: Pence;
}

export function calculateOrder(items: LineItem[], commissionBps: number, discount?: Discount): OrderTotals {
  if (items.length === 0) throw new Error("Order must contain at least one item");

  let subtotalPence = 0;
  for (const item of items) {
    assertPence(item.unitPricePence, `unitPricePence of ${item.name}`);
    if (!Number.isInteger(item.qty) || item.qty < 1) throw new Error(`Invalid qty for ${item.name}`);
    subtotalPence += item.unitPricePence * item.qty;
  }

  let discountPence = 0;
  if (discount) {
    if (discount.kind === "percent") {
      discountPence = applyBps(subtotalPence, discount.value);
    } else {
      assertPence(discount.value, "fixed discount");
      discountPence = discount.value;
    }
    discountPence = Math.min(discountPence, subtotalPence);
  }

  const totalPence = subtotalPence - discountPence;
  const applicationFeePence = applyBps(totalPence, commissionBps);

  return { subtotalPence, discountPence, totalPence, applicationFeePence };
}

/** Effective discount as bps of subtotal, used to enforce role-based discount limits. */
export function discountAsBps(subtotalPence: Pence, discount: Discount): number {
  if (discount.kind === "percent") return discount.value;
  if (subtotalPence === 0) return 0;
  return Math.ceil((Math.min(discount.value, subtotalPence) * 10000) / subtotalPence);
}
