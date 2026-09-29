import QRCode from "qrcode";
import { passCode, receiptLines } from "@indinite/core";
import type { PassData, TicketsEmailData } from "./types";

/**
 * Builds the ticket email / PDF data from an order, its event and its valid passes. Shared by the worker
 * (email attachment) and the web app (download from the ticket page), so both give the customer the same PDF.
 * Callers load the records (this package has no database access) and decide who may see them.
 */
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/** "All 9 nights" or "Fri 16 Oct, Sat 17 Oct". */
export function nightsLabel(validSessionIds: unknown[], sessions: { _id: unknown; startsAt: Date }[]) {
  const valid = new Set(validSessionIds.map(String));
  const nights = sessions.filter((s) => valid.has(String(s._id)));
  if (nights.length === sessions.length && sessions.length > 1) return `All ${sessions.length} nights`;
  return nights.map((s) => dayFmt.format(s.startsAt)).join(", ");
}

export interface OrderForPasses {
  publicId: string;
  customer: { name: string };
  items: { name: string; qty: number; unitPricePence: number }[];
  discount?: { amountPence?: number | null; reason?: string | null } | null;
  offline?: { method?: string | null } | null;
  platformFeePence?: number | null;
  commissionBps?: number | null;
  charges?: { name?: string | null; amountPence?: number | null }[] | null;
  taxPence?: number | null;
  taxBps?: number | null;
  cardFeePence?: number | null;
  totalPence: number;
}

export interface EventForPasses {
  title: string;
  startsAt: Date;
  endsAt: Date;
  venue: { name: string; address: string; postcode: string };
  sessions: { _id: unknown; startsAt: Date }[];
}

export interface TicketForPasses {
  _id: unknown;
  ticketTypeName: string;
  validSessionIds: unknown[];
  qrToken: string;
}

export async function buildPassesData(input: {
  order: OrderForPasses;
  event: EventForPasses;
  tickets: TicketForPasses[];
  viewUrl: string;
  demo: boolean;
  reason: TicketsEmailData["reason"];
}): Promise<TicketsEmailData> {
  const { order, event, tickets } = input;
  const passes: PassData[] = await Promise.all(
    tickets.map(async (t, i) => ({
      ticketId: String(t._id),
      ticketTypeName: t.ticketTypeName,
      nightsLabel: nightsLabel(t.validSessionIds, event.sessions),
      qrContentId: `pass-${i + 1}-${String(t._id)}`,
      qrPng: await QRCode.toBuffer(t.qrToken, { errorCorrectionLevel: "M", margin: 1, width: 480 }),
      shortCode: passCode(t.qrToken),
    })),
  );
  return {
    publicId: order.publicId,
    customerName: order.customer.name,
    event: { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, venue: event.venue },
    lines: receiptLines({
      items: order.items,
      discountPence: order.discount?.amountPence,
      discountLabel: order.discount?.reason,
      complimentary: order.offline?.method === "complimentary",
      platformFeePence: order.platformFeePence,
      commissionBps: order.commissionBps,
      charges: order.charges,
      taxPence: order.taxPence,
      taxBps: order.taxBps,
      cardFeePence: order.cardFeePence,
    }),
    totalPence: order.totalPence,
    tickets: passes,
    viewUrl: input.viewUrl,
    demo: input.demo,
    reason: input.reason,
  };
}
