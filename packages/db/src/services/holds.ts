import type { Types } from "mongoose";
import { audited } from "../audit";
import { Hold } from "../models/hold";
import { Order } from "../models/order";
import { quota } from "../quota";
import { withTransaction } from "../transaction";
import { releaseCoupon } from "./pricing";

/**
 * Release one expired hold: return seats to sale and expire the pending order.
 * Safe to call concurrently with the Stripe webhook — the conditional update on the hold
 * means only one of "commit" or "release" can ever win.
 */
export async function releaseHold(holdId: Types.ObjectId | string, reason: "expired" | "checkout_expired") {
  return withTransaction(async (session) => {
    const hold = await Hold.findOneAndUpdate(
      { _id: holdId, releasedAt: null },
      { $set: { releasedAt: new Date(), outcome: "released" } },
      { session, new: true },
    );
    if (!hold) return false; // already committed or released

    for (const item of hold.items) await quota.releaseHold(item.ticketTypeId, item.qty, session);

    const before = await Order.findById(hold.orderId, null, { session }).lean();
    if (before?.couponId) await releaseCoupon(before.couponId, session);
    const order = await Order.findOneAndUpdate(
      { _id: hold.orderId, status: "pending" },
      { $set: { status: "expired" } },
      { session, new: true },
    ).lean();

    await audited(session, {
      action: "order.hold_released",
      entity: { type: "order", id: hold.orderId },
      before: before ? { status: before.status } : null,
      after: order ? { status: order.status } : null,
      reason,
      organizerId: before?.organizerId,
      metadata: { holdId: String(hold._id), items: hold.items.map((i) => ({ ticketTypeId: String(i.ticketTypeId), qty: i.qty })) },
    });
    return true;
  });
}

/** Called every minute by the worker; releases holds past their expiry. */
export async function sweepExpiredHolds(limit = 200): Promise<number> {
  const expired = await Hold.find({ releasedAt: null, expiresAt: { $lt: new Date() } }, { _id: 1 })
    .limit(limit)
    .lean();
  let released = 0;
  for (const h of expired) if (await releaseHold(h._id, "expired")) released++;
  return released;
}
