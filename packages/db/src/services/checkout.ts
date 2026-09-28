import { Types, type ClientSession } from "mongoose";
import { canTakeCardPayments, generatePublicId, normalisePassCode, passCode, priceOrder, signTicket, type LineItem, type OrderPricing, type PublicCheckoutInput } from "@indinite/core";
import { audited } from "../audit";
import { enqueueSendTickets } from "../jobs";
import { Event } from "../models/event";
import { Hold } from "../models/hold";
import { Order } from "../models/order";
import { Organizer } from "../models/organizer";
import { Ticket } from "../models/ticket";
import { TicketType } from "../models/ticket-type";
import { quota, SoldOutError } from "../quota";
import { withTransaction } from "../transaction";
import { CouponError, findCoupon, pricingFor, redeemCoupon } from "./pricing";

/** Public checkout holds seats for 30 minutes (SPEC §4.1). */
export const CHECKOUT_HOLD_MS = 30 * 60_000;

/** A checkout problem the customer can act on; `message` is safe to show them. */
export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

/** The hold was released before payment was confirmed. */
export class HoldExpiredError extends Error {
  readonly status = 409;
  constructor(readonly orderId: string) {
    super(`Hold for order ${orderId} was released before payment was confirmed`);
  }
}

export type PaymentConfirmation =
  | { mode: "demo" }
  /** £0 bookings (100% coupon): nothing to charge, so no Stripe session. */
  | { mode: "free" }
  | { mode: "stripe"; checkoutSessionId: string; paymentIntentId: string };

/** A card payment completed after its seats were released, and there aren't enough left: refund in full. */
export class LateSoldOutError extends Error {
  readonly status = 409;
  constructor(readonly orderId: string) {
    super(`Order ${orderId} was paid after its hold expired and the passes have since sold out`);
  }
}

const isDuplicateKey = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === 11000;

export interface PendingOrderOptions {
  source: "online" | "payment_link";
  /** How long seats are held (30 min online; 1–24 h for payment links). */
  holdMs: number;
  /** Payment links: the staff member who created it. */
  createdBy?: string;
  /** Payment links are created by staff, so public sales windows and per-order limits don't apply. */
  staff?: boolean;
  /** Only this organiser's events (staff flows). */
  organizerId?: string;
  /** Real card payments (PAYMENTS_MODE=stripe): the organiser must be an active, un-paused merchant. */
  requireCardPayments?: boolean;
}

/**
 * SPEC §4.1 step 2 / §4.2: validate, price (SPEC §4.7), create a pending order, reserve quota atomically,
 * redeem the coupon and hold everything until payment. Caller sets the request context (actor).
 */
export async function createPendingOrder(input: PublicCheckoutInput, opts: PendingOrderOptions, now = new Date()) {
  const event = await Event.findOne({ _id: input.eventId, status: "published", deletedAt: null, ...(opts.organizerId ? { organizerId: opts.organizerId } : {}) }).lean();
  if (!event) throw new CheckoutError("This event isn't available.", 404);
  if (event.endsAt <= now) throw new CheckoutError("This event has ended.", 409);

  const organizer = await Organizer.findOne({ _id: event.organizerId, status: "active" }).lean();
  if (!organizer) throw new CheckoutError("This event isn't available.", 404);
  if (opts.requireCardPayments && !canTakeCardPayments(organizer)) {
    throw new CheckoutError("Card payments aren't available for this event yet.", 409);
  }

  // Merge duplicate lines so maxPerOrder can't be dodged by splitting.
  const qtyByType = new Map<string, number>();
  for (const item of input.items) qtyByType.set(item.ticketTypeId, (qtyByType.get(item.ticketTypeId) ?? 0) + item.qty);

  const types = await TicketType.find({ _id: { $in: [...qtyByType.keys()] }, eventId: event._id, active: true }).lean();
  if (types.length !== qtyByType.size) throw new CheckoutError("One of those passes isn't available any more.", 409);

  const items: LineItem[] = types
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((t) => {
      const qty = qtyByType.get(String(t._id))!;
      if (!opts.staff) {
        if (t.salesStartAt && t.salesStartAt > now) throw new CheckoutError(`${t.name} isn't on sale yet.`, 409);
        if (t.salesEndAt && t.salesEndAt <= now) throw new CheckoutError(`Sales for ${t.name} have closed.`, 409);
        if (qty > (t.maxPerOrder ?? 10)) throw new CheckoutError(`You can book up to ${t.maxPerOrder} × ${t.name} per order.`);
      }
      return { ticketTypeId: String(t._id), name: t.name, unitPricePence: t.pricePence, qty };
    });

  let coupon: Awaited<ReturnType<typeof findCoupon>> = null;
  if (input.couponCode) {
    try {
      coupon = await findCoupon(organizer._id, event._id, input.couponCode, now);
    } catch (e) {
      if (e instanceof CouponError) throw new CheckoutError(e.message);
      throw e;
    }
  }

  const settings = pricingFor(event, organizer);
  const price = priceOrder({ items, ...settings, discount: coupon?.rule });
  const expiresAt = new Date(now.getTime() + opts.holdMs);

  for (let attempt = 0; ; attempt++) {
    const publicId = generatePublicId(organizer.orderPrefix ?? "NAV");
    try {
      return await withTransaction(async (session) => {
        const [order] = await Order.create(
          [
            {
              publicId,
              organizerId: organizer._id,
              eventId: event._id,
              customer: input.customer,
              source: opts.source,
              status: "pending",
              items,
              ...orderPricingFields(price, settings),
              ...(coupon
                ? { couponCode: coupon.code, couponId: coupon.id, discount: { kind: coupon.rule.kind, value: coupon.rule.value, amountPence: price.discountPence, reason: `Code ${coupon.code}` } }
                : {}),
              createdBy: opts.createdBy,
              expiresAt,
            },
          ],
          { session },
        );

        for (const item of items) {
          try {
            await quota.reserve(item.ticketTypeId, item.qty, session);
          } catch (e) {
            if (e instanceof SoldOutError) throw new CheckoutError(`Sorry, there aren't enough ${item.name} passes left.`, 409);
            throw e;
          }
        }
        if (coupon) {
          try {
            await redeemCoupon(coupon.id, session);
          } catch (e) {
            if (e instanceof CouponError) throw new CheckoutError(e.message, 409);
            throw e;
          }
        }

        await Hold.create(
          [{ orderId: order!._id, items: items.map((i) => ({ ticketTypeId: i.ticketTypeId, qty: i.qty })), expiresAt }],
          { session },
        );

        await audited(session, {
          action: opts.source === "payment_link" ? "order.payment_link_created" : "order.created",
          entity: { type: "order", id: order!._id },
          after: order!.toObject(),
          organizerId: organizer._id,
        });
        return order!.toObject();
      });
    } catch (e) {
      // Order refs are random; a collision is astronomically rare but cheap to retry.
      if (isDuplicateKey(e) && attempt < 3) continue;
      throw e;
    }
  }
}

/** SPEC §4.1: public checkout, seats held for 30 minutes. */
export function createCheckoutOrder(input: PublicCheckoutInput, now = new Date(), opts: { requireCardPayments?: boolean } = {}) {
  return createPendingOrder(input, { source: "online", holdMs: CHECKOUT_HOLD_MS, requireCardPayments: opts.requireCardPayments }, now);
}

/** Order fields for a pricing result (stored so receipts never change). */
export function orderPricingFields(price: OrderPricing, settings: { commissionBps: number; taxBps: number }) {
  return {
    subtotalPence: price.subtotalPence,
    ticketsPence: price.ticketsPence,
    platformFeePence: price.platformFeePence,
    charges: price.charges,
    chargesPence: price.chargesPence,
    taxBps: settings.taxBps,
    taxPence: price.taxPence,
    commissionBps: settings.commissionBps,
    totalPence: price.totalPence,
    applicationFeePence: price.commissionPence,
  };
}

/** Create one signed ticket per pass on the order (inside the caller's transaction). */
export async function issueTickets(
  order: { _id: Types.ObjectId; organizerId: Types.ObjectId; eventId: Types.ObjectId; items: { ticketTypeId: Types.ObjectId; name: string; qty: number }[] },
  session: ClientSession,
  privateKey = qrPrivateKey(),
) {
  const types = await TicketType.find({ _id: { $in: order.items.map((i) => i.ticketTypeId) } }, null, { session }).lean();
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const tickets = order.items.flatMap((item) =>
    Array.from({ length: item.qty }, () => {
      const _id = new Types.ObjectId();
      const qrToken = signTicket(_id.toHexString(), privateKey);
      return {
        _id,
        orderId: order._id,
        organizerId: order.organizerId,
        eventId: order.eventId,
        ticketTypeId: item.ticketTypeId,
        ticketTypeName: item.name,
        qrToken,
        passCode: normalisePassCode(passCode(qrToken)),
        validSessionIds: typeById.get(String(item.ticketTypeId))!.validSessionIds,
      };
    }),
  );
  await Ticket.insertMany(tickets, { session });
  // Audit every ticket individually so its history can be shown on its own.
  for (const t of tickets) {
    await audited(session, {
      action: "ticket.issued",
      entity: { type: "ticket", id: t._id },
      after: { orderId: String(order._id), ticketTypeName: t.ticketTypeName, validSessionIds: t.validSessionIds.map(String) },
      organizerId: order.organizerId,
    });
  }
  return tickets;
}

export function qrPrivateKey(): string {
  const key = process.env.QR_SIGNING_PRIVATE_KEY;
  if (!key) throw new Error("QR_SIGNING_PRIVATE_KEY is not set (pnpm --filter @indinite/core gen:qr-keys)");
  return key;
}

/**
 * SPEC §4.1 step 3: payment confirmed. Commits the hold, marks the order paid, issues signed tickets and
 * queues the ticket email, all in one transaction. The Stripe webhook and demo payments both call this.
 * Idempotent: an order that's already paid is returned unchanged.
 */
export async function fulfilOrder(orderId: string | Types.ObjectId, payment: PaymentConfirmation) {
  const privateKey = qrPrivateKey();
  // Money has been taken by Stripe: honour it even if the hold expired meanwhile (if seats are left).
  const allowLate = payment.mode === "stripe";

  return withTransaction(async (session) => {
    const existing = await Order.findById(orderId, null, { session }).lean();
    if (!existing) throw new Error(`Order ${orderId} not found`);
    if (existing.status === "paid") return { order: existing, ticketsIssued: 0 };
    const late = existing.status === "expired" && allowLate;
    if (existing.status !== "pending" && !late) throw new HoldExpiredError(String(orderId));

    const hold = await Hold.findOneAndUpdate(
      { orderId: existing._id, releasedAt: null },
      { $set: { releasedAt: new Date(), outcome: "committed" } },
      { session, new: true },
    );
    if (hold) {
      for (const item of hold.items) await quota.commitHold(item.ticketTypeId, item.qty, session);
    } else if (allowLate) {
      // SPEC §4.1 step 3: late payment → re-reserve directly; if sold out the caller refunds in full.
      try {
        for (const item of existing.items) await quota.sellDirect(item.ticketTypeId, item.qty, session);
      } catch (e) {
        if (e instanceof SoldOutError) throw new LateSoldOutError(String(orderId));
        throw e;
      }
    } else {
      throw new HoldExpiredError(String(orderId));
    }

    const paidAt = new Date();
    const order = await Order.findOneAndUpdate(
      { _id: existing._id, status: { $in: ["pending", "expired"] } },
      {
        $set: {
          status: "paid",
          paidAt,
          ...(payment.mode === "stripe"
            ? { "stripe.checkoutSessionId": payment.checkoutSessionId, "stripe.paymentIntentId": payment.paymentIntentId }
            : {}),
        },
      },
      { session, new: true },
    ).lean();
    if (!order) throw new HoldExpiredError(String(orderId));

    const tickets = await issueTickets(order, session, privateKey);

    await audited(session, {
      action: "order.paid",
      entity: { type: "order", id: order._id },
      before: { status: existing.status },
      after: { status: order.status, paidAt },
      reason: payment.mode === "demo" ? "demo_payment" : payment.mode === "free" ? "free_order" : late || !hold ? "late_payment" : undefined,
      organizerId: order.organizerId,
      metadata: { paymentsMode: payment.mode, ticketsIssued: tickets.length },
    });
    await enqueueSendTickets({ orderId: String(order._id), reason: "paid" }, { session });

    return { order, ticketsIssued: tickets.length };
  });
}
