import type { ClientSession, Types } from "mongoose";
import { DEFAULT_COMMISSION_BPS, type Discount as DiscountRule, type OrderCharge } from "@indinite/core";
import { audited } from "../audit";
import { Discount } from "../models/discount";

/** Pricing settings for an event: event override → organiser rate → 6% default. */
export function pricingFor(
  event: { commissionBps?: number | null; taxBps?: number | null; charges?: { name: string; kind: string; value: number }[] | null },
  organizer: { commissionBps?: number | null },
): { commissionBps: number; taxBps: number; charges: OrderCharge[] } {
  return {
    commissionBps: event.commissionBps ?? organizer.commissionBps ?? DEFAULT_COMMISSION_BPS,
    taxBps: event.taxBps ?? 0,
    charges: (event.charges ?? []).map((c) => ({ name: c.name, kind: c.kind as OrderCharge["kind"], value: c.value })),
  };
}

export class CouponError extends Error {
  readonly status = 400;
}

/** A coupon that can be used on this event right now (doesn't redeem it). */
export async function findCoupon(organizerId: Types.ObjectId | string, eventId: Types.ObjectId | string, code: string, now = new Date()) {
  const normalised = code.trim().toUpperCase();
  if (!normalised) return null;
  const coupon = await Discount.findOne({ organizerId, code: normalised, $or: [{ eventId: null }, { eventId: { $exists: false } }, { eventId }] }).lean();
  if (!coupon) throw new CouponError("That code isn't valid for this event.");
  if (coupon.validFrom && coupon.validFrom > now) throw new CouponError("That code isn't active yet.");
  if (coupon.validTo && coupon.validTo <= now) throw new CouponError("That code has expired.");
  if (coupon.maxUses && (coupon.used ?? 0) >= coupon.maxUses) throw new CouponError("That code has been fully used.");
  return {
    id: coupon._id,
    code: coupon.code!,
    rule: { kind: coupon.kind, value: coupon.value, maxAmountPence: coupon.maxDiscountPence ?? null, minSubtotalPence: coupon.minSubtotalPence ?? null } as DiscountRule,
  };
}

/** Atomically use one redemption (inside the order's transaction), audited against the coupon. */
export async function redeemCoupon(couponId: Types.ObjectId, session: ClientSession, order?: { orderId: Types.ObjectId; publicId: string; amountPence: number; organizerId: Types.ObjectId }) {
  const res = await Discount.updateOne(
    { _id: couponId, $or: [{ maxUses: null }, { maxUses: { $exists: false } }, { $expr: { $lt: ["$used", "$maxUses"] } }] },
    { $inc: { used: 1 } },
    { session },
  );
  if (res.modifiedCount !== 1) throw new CouponError("That code has just been fully used.");
  if (order) {
    await audited(session, {
      action: "coupon.redeemed",
      entity: { type: "discount", id: couponId },
      organizerId: order.organizerId,
      metadata: { orderId: String(order.orderId), publicId: order.publicId, amountPence: order.amountPence },
    });
  }
}

/** Give a redemption back (order expired unpaid or cancelled), audited against the coupon. */
export async function releaseCoupon(couponId: Types.ObjectId, session: ClientSession, order?: { orderId: Types.ObjectId; publicId: string; organizerId: Types.ObjectId; reason: string }) {
  const res = await Discount.updateOne({ _id: couponId, used: { $gt: 0 } }, { $inc: { used: -1 } }, { session });
  if (order && res.modifiedCount === 1) {
    await audited(session, {
      action: "coupon.released",
      entity: { type: "discount", id: couponId },
      reason: order.reason,
      organizerId: order.organizerId,
      metadata: { orderId: String(order.orderId), publicId: order.publicId },
    });
  }
}
