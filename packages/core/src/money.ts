/** All money in the system is integer pence (GBP). Never floats, never pounds. */
export type Pence = number;

export const CURRENCY = "gbp" as const;

export function assertPence(value: number, label = "amount"): asserts value is Pence {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of pence, got ${value}`);
  }
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function formatGBP(pence: Pence): string {
  assertPence(pence);
  return gbp.format(pence / 100);
}

/** Basis points: 10000 = 100%. Rounds half away from zero to the nearest penny. */
export function applyBps(pence: Pence, bps: number): Pence {
  assertPence(pence);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error(`Invalid bps ${bps}`);
  return Math.round((pence * bps) / 10000);
}
