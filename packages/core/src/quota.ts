/**
 * Quota is enforced with single atomic conditional updates on ticketTypes.
 * Never read-then-write. If modifiedCount === 0 the operation did not fit.
 * These builders are pure so they can be unit-tested and reused by packages/db.
 */
export interface QuotaDoc {
  quota: number;
  sold: number;
  held: number;
}

function assertQty(qty: number) {
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`Invalid qty ${qty}`);
}

/** Reserve (hold) seats during checkout / payment link validity. */
export function reserveOp(ticketTypeId: unknown, qty: number) {
  assertQty(qty);
  return {
    filter: {
      _id: ticketTypeId,
      active: true,
      $expr: { $lte: [{ $add: ["$sold", "$held", qty] }, "$quota"] },
    },
    update: { $inc: { held: qty } },
  } as const;
}

/** Move a hold to sold (payment confirmed). */
export function commitHoldOp(ticketTypeId: unknown, qty: number) {
  assertQty(qty);
  return {
    filter: { _id: ticketTypeId, held: { $gte: qty } },
    update: { $inc: { held: -qty, sold: qty } },
  } as const;
}

/** Release a hold (expired / abandoned checkout). */
export function releaseHoldOp(ticketTypeId: unknown, qty: number) {
  assertQty(qty);
  return {
    filter: { _id: ticketTypeId, held: { $gte: qty } },
    update: { $inc: { held: -qty } },
  } as const;
}

/** Sell directly without a hold (offline "already paid" issue, or late payment re-reserve). */
export function sellDirectOp(ticketTypeId: unknown, qty: number) {
  assertQty(qty);
  return {
    filter: {
      _id: ticketTypeId,
      active: true,
      $expr: { $lte: [{ $add: ["$sold", "$held", qty] }, "$quota"] },
    },
    update: { $inc: { sold: qty } },
  } as const;
}

/** Return sold seats to sale (refund with quota release enabled). */
export function returnSoldOp(ticketTypeId: unknown, qty: number) {
  assertQty(qty);
  return {
    filter: { _id: ticketTypeId, sold: { $gte: qty } },
    update: { $inc: { sold: -qty } },
  } as const;
}

export function available(doc: QuotaDoc): number {
  return Math.max(0, doc.quota - doc.sold - doc.held);
}

/** Change a ticket type's quota (admin), never below what's already sold or held. Check matchedCount. */
export function setQuotaOp(ticketTypeId: unknown, quota: number) {
  if (!Number.isInteger(quota) || quota < 0) throw new Error(`Invalid quota ${quota}`);
  return {
    filter: { _id: ticketTypeId, $expr: { $lte: [{ $add: ["$sold", "$held"] }, quota] } },
    update: { $set: { quota } },
  } as const;
}
