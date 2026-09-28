import { Types } from "mongoose";
import { CommissionLedger } from "../models/commission-ledger";
import { Event } from "../models/event";
import { Order } from "../models/order";

const PAID = ["paid", "partially_refunded", "refunded"];

export interface EventFinance {
  eventId: string;
  title: string;
  organizerId: string;
  /** Everything customers paid, all channels, minus refunds. */
  totalSalesPence: number;
  /** Refunded to customers (ticket price only; fees kept, except full refunds when a late payment couldn't be honoured). */
  refundedPence: number;
  orders: number;
  passes: number;
  /** Cash + organiser's own account: money the organiser holds directly. */
  direct: {
    cashPence: number;
    accountPence: number;
    complimentaryPasses: number;
    /** Commission the organiser owes Indinite on direct and complimentary sales. */
    commissionOwedPence: number;
    commissionPaidPence: number;
    outstandingPence: number;
  };
  /** Online card + payment links: money through Indinite (Stripe). */
  platform: {
    grossPence: number;
    /** Paid out to the organiser (total − platform fee). */
    organizerCreditedPence: number;
    platformFeesPence: number;
  };
  /** Indinite's income: platform fees collected + commission owed on direct sales. */
  ourIncomePence: number;
  payments: { at: Date; amountPence: number; note: string }[];
}

/** SPEC §4.7 finance view, per event (refunds are subtracted once M8 lands). */
export async function eventFinance(eventId: string): Promise<EventFinance | null> {
  if (!Types.ObjectId.isValid(eventId)) return null;
  const event = await Event.findById(eventId, { title: 1, organizerId: 1 }).lean();
  if (!event) return null;
  const [groups, ledger] = await Promise.all([
    Order.aggregate<{ _id: { source: string; method: string | null }; total: number; fees: number; refunded: number; orders: number; passes: number }>([
      { $match: { eventId: event._id, status: { $in: PAID } } },
      {
        $group: {
          _id: { source: "$source", method: { $ifNull: ["$offline.method", null] } },
          // Net of refunds.
          total: { $sum: { $subtract: ["$totalPence", { $ifNull: ["$refundedPence", 0] }] } },
          refunded: { $sum: { $ifNull: ["$refundedPence", 0] } },
          // Indinite keeps its fee on refunds, except when the whole booking was refunded by the system
          // (late payment after the passes sold out), where the fee was returned too.
          fees: { $sum: { $cond: [{ $in: ["system", { $ifNull: ["$refunds.refundedBy", []] }] }, 0, "$applicationFeePence"] } },
          orders: { $sum: 1 },
          passes: { $sum: { $sum: "$items.qty" } },
        },
      },
    ]),
    CommissionLedger.find({ eventId: event._id }).sort({ createdAt: 1 }).lean(),
  ]);
  const pick = (source: string, method: string | null = null) => groups.filter((g) => g._id.source === source && g._id.method === method);
  const sum = (gs: typeof groups, k: "total" | "fees" | "passes") => gs.reduce((n, g) => n + g[k], 0);

  const online = [...pick("online"), ...pick("payment_link")];
  const cash = pick("offline", "cash");
  const account = pick("offline", "bank_transfer");
  const comp = pick("offline", "complimentary");
  const owed = ledger.filter((l) => l.kind === "offline_sale_owed").reduce((n, l) => n + l.amountPence, 0);
  const paid = ledger.filter((l) => l.kind === "settled").reduce((n, l) => n + l.amountPence, 0);
  const platformFees = sum(online, "fees");

  return {
    eventId: String(event._id),
    title: event.title,
    organizerId: String(event.organizerId),
    totalSalesPence: groups.reduce((n, g) => n + g.total, 0),
    refundedPence: groups.reduce((n, g) => n + g.refunded, 0),
    orders: groups.reduce((n, g) => n + g.orders, 0),
    passes: groups.reduce((n, g) => n + g.passes, 0),
    direct: {
      cashPence: sum(cash, "total"),
      accountPence: sum(account, "total"),
      complimentaryPasses: sum(comp, "passes"),
      commissionOwedPence: owed,
      commissionPaidPence: paid,
      outstandingPence: owed - paid,
    },
    platform: {
      grossPence: sum(online, "total"),
      organizerCreditedPence: sum(online, "total") - platformFees,
      platformFeesPence: platformFees,
    },
    ourIncomePence: platformFees + owed,
    payments: ledger.filter((l) => l.kind === "settled").map((l) => ({ at: l.createdAt as Date, amountPence: l.amountPence, note: l.note ?? "" })),
  };
}

export async function allEventsFinance(organizerId?: string) {
  const events = await Event.find({ deletedAt: null, ...(organizerId ? { organizerId } : {}) }, { _id: 1 }).sort({ startsAt: 1 }).lean();
  return (await Promise.all(events.map((e) => eventFinance(String(e._id))))).filter((f): f is EventFinance => f !== null);
}
