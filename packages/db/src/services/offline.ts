
import { generatePublicId, offlineIssueSchema, paymentLinkBookingSchema, priceOrder, type LineItem, type OfflineIssueInput, type PaymentLinkBookingInput } from "@indinite/core";
import { audited } from "../audit";
import { enqueueSendTickets } from "../jobs";
import { CommissionLedger } from "../models/commission-ledger";
import { Event } from "../models/event";
import { Order } from "../models/order";
import { Organizer } from "../models/organizer";
import { TicketType } from "../models/ticket-type";
import { quota, SoldOutError } from "../quota";
import { withTransaction } from "../transaction";
import { CheckoutError, createPendingOrder, issueTickets, orderPricingFields, qrPrivateKey } from "./checkout";
import { CouponError, findCoupon, pricingFor, redeemCoupon } from "./pricing";

const isDuplicateKey = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === 11000;

export const OFFLINE_METHOD_LABELS = { cash: "Cash", bank_transfer: "Organiser's account", complimentary: "Complimentary" } as const;

/**
 * SPEC §4.3: organiser staff issue passes that were paid outside Stripe (cash, bank transfer) or are free.
 * - organizerId must come from the signed-in user's organiser (URL + permission check), never the form.
 * - Seats are sold directly with the atomic quota update (no hold).
 * - Sales windows and the online per-order limit don't apply: box office also sells on the door.
 * - Priced like online (SPEC §4.7): the customer pays tickets + platform fee + charges + tax to the organiser,
 *   and the organiser owes Indinite the platform fee (commission), recorded in the ledger.
 * - Complimentary: £0 to the customer, but commission is owed on the passes' normal price.
 * Caller must have checked `order.issueOffline` and wrapped this in a request context (actor = user).
 */
export async function issueOfflineOrder(organizerId: string, issuedBy: string, rawInput: OfflineIssueInput) {
  const input = offlineIssueSchema.parse(rawInput);
  const organizer = await Organizer.findOne({ _id: organizerId, status: "active" }).lean();
  if (!organizer) throw new CheckoutError("Organiser not found.", 404);
  const event = await Event.findOne({ _id: input.eventId, organizerId: organizer._id, deletedAt: null }).lean();
  if (!event) throw new CheckoutError("That event isn't one of yours.", 404);
  if (event.status !== "published") throw new CheckoutError("This event isn't published yet.", 409);

  const qtyByType = new Map<string, number>();
  for (const item of input.items) qtyByType.set(item.ticketTypeId, (qtyByType.get(item.ticketTypeId) ?? 0) + item.qty);
  const types = await TicketType.find({ _id: { $in: [...qtyByType.keys()] }, eventId: event._id, active: true }).lean();
  if (types.length !== qtyByType.size) throw new CheckoutError("One of those passes isn't available.", 409);

  const complimentary = input.method === "complimentary";
  const items: LineItem[] = types
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((t) => ({ ticketTypeId: String(t._id), name: t.name, unitPricePence: t.pricePence, qty: qtyByType.get(String(t._id))! }));
  let coupon: Awaited<ReturnType<typeof findCoupon>> = null;
  if (input.couponCode && !complimentary) {
    try {
      coupon = await findCoupon(organizer._id, event._id, input.couponCode);
    } catch (e) {
      if (e instanceof CouponError) throw new CheckoutError(e.message);
      throw e;
    }
  }
  const settings = pricingFor(event, organizer);
  const price = priceOrder({ items, ...settings, complimentary, discount: coupon?.rule });
  const privateKey = qrPrivateKey();

  for (let attempt = 0; ; attempt++) {
    const publicId = generatePublicId(organizer.orderPrefix ?? "NAV");
    try {
      return await withTransaction(async (session) => {
        for (const item of items) {
          try {
            await quota.sellDirect(item.ticketTypeId, item.qty, session);
          } catch (e) {
            if (e instanceof SoldOutError) throw new CheckoutError(`There aren't enough ${item.name} passes left.`, 409);
            throw e;
          }
        }
        const now = new Date();
        const [order] = await Order.create(
          [
            {
              publicId,
              organizerId: organizer._id,
              eventId: event._id,
              customer: input.customer,
              source: "offline",
              status: "paid",
              items,
              ...orderPricingFields(price, settings),
              ...(coupon
                ? { couponCode: coupon.code, couponId: coupon.id, discount: { kind: coupon.rule.kind, value: coupon.rule.value, amountPence: price.discountPence, reason: `Code ${coupon.code}` } }
                : complimentary
                  ? { discount: { kind: "percent", value: 10000, amountPence: price.discountPence, reason: "Complimentary", appliedBy: issuedBy } }
                  : {}),
              offline: { method: input.method, note: input.note, issuedBy },
              createdBy: issuedBy,
              paidAt: now,
            },
          ],
          { session },
        );
        if (coupon) await redeemCoupon(coupon.id, session);
        const tickets = await issueTickets(order!, session, privateKey);
        if (price.commissionPence > 0) {
          await CommissionLedger.create(
            [{ organizerId: organizer._id, eventId: event._id, orderId: order!._id, amountPence: price.commissionPence, kind: "offline_sale_owed", note: `${OFFLINE_METHOD_LABELS[input.method]} ${publicId}` }],
            { session },
          );
        }
        await audited(session, {
          action: "order.issued_offline",
          entity: { type: "order", id: order!._id },
          after: order!.toObject(),
          reason: input.note,
          organizerId: organizer._id,
          metadata: { method: input.method, tickets: tickets.length, commissionOwedPence: price.commissionPence },
        });
        await enqueueSendTickets({ orderId: String(order!._id), reason: "offline_issued" }, { session });
        return { order: order!.toObject(), ticketsIssued: tickets.length };
      });
    } catch (e) {
      if (isDuplicateKey(e) && attempt < 3) continue;
      throw e;
    }
  }
}


/**
 * SPEC §4.2: staff create a pending booking and a payment link (valid 1–24 h, seats held meanwhile).
 * The customer pays on /pay/<ref>; Stripe Checkout once connected, instant approval in demo mode.
 */
export async function createPaymentLinkOrder(organizerId: string, createdBy: string, rawInput: PaymentLinkBookingInput, opts: { requireCardPayments?: boolean } = {}) {
  const input = paymentLinkBookingSchema.parse(rawInput);
  return createPendingOrder(
    { eventId: input.eventId, customer: input.customer, items: input.items, couponCode: input.couponCode },
    { source: "payment_link", holdMs: input.validForHours * 3_600_000, createdBy, staff: true, organizerId, requireCardPayments: opts.requireCardPayments },
  );
}
