import "server-only";
import { passNight } from "@indinite/emails";
import { available, bookability, canTakeCardPayments, UNBOOKABLE_LABEL, cardFeeOf, PUBLIC_ID_RE, receiptLines, resolvePaymentsMode, type CardFeeSettings, type OrderCharge } from "@indinite/core";
import { connectDb, Event, Order, Organizer, pricingFor, Ticket, TicketType, eventBookingState } from "@indinite/db";

export interface PublicTicketType {
  id: string;
  name: string;
  description: string;
  pricePence: number;
  available: number;
  maxPerOrder: number;
  nights: number;
  onSale: boolean;
  /** When sales start, if they haven't yet. */
  salesStartAt: Date | null;
  validSessionIds: string[];
  /** Day pass member (one night of a group), or null for season / weekend passes. */
  dayPass: { groupId: string; name: string } | null;
  /** Why it can't be booked online right now ("Sold out", "Bookings closed", …), or null if it can. */
  blocked: string | null;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  venue: { name: string; address: string; postcode: string; mapUrl?: string | null };
  startsAt: Date;
  endsAt: Date;
  sessions: { id: string; label: string; startsAt: Date; endsAt: Date }[];
  media: { type: string; url: string; alt: string }[];
  fromPence: number | null;
  ticketTypes: PublicTicketType[];
  /** At least one pass is on sale right now. */
  bookingsOpen: boolean;
  /** Why nothing can be booked (when bookingsOpen is false): sold out, closed by hand, or not on sale yet. */
  closedReason: "sold_out" | "closed" | "not_yet" | "over" | null;
  /** Earliest upcoming sales start, when bookings aren't open yet. */
  bookingsOpenAt: Date | null;
  /** SPEC §4.7 pricing settings, for showing the breakdown before checkout. */
  pricing: { commissionBps: number; taxBps: number; charges: OrderCharge[]; cardFee: CardFeeSettings };
  /** Online booking possible now: demo mode, or (Stripe mode) the organiser is an active merchant. */
  onlinePaymentsAvailable: boolean;
}

const PUBLIC_FILTER = { status: "published", deletedAt: null } as const;

async function withTicketTypes(events: Awaited<ReturnType<typeof loadEvents>>): Promise<PublicEvent[]> {
  const ids = events.map((e) => e._id);
  const types = await TicketType.find({ eventId: { $in: ids }, active: true }).sort({ sortOrder: 1 }).lean();
  const orgs = await Organizer.find(
    { _id: { $in: events.map((e) => e.organizerId) } },
    { commissionBps: 1, cardFee: 1, stripeAccountId: 1, chargesEnabled: 1, detailsSubmitted: 1, stripeDisabledReason: 1, stripeCurrentlyDue: 1, onlineSalesPaused: 1 },
  ).lean();
  const stripeMode = resolvePaymentsMode(process.env) === "stripe";
  const orgById = new Map(orgs.map((o) => [String(o._id), o]));
  const now = new Date();

  return events.map((e) => {
    const state = eventBookingState(e);
    const tts = types
      .filter((t) => String(t.eventId) === String(e._id))
      .map((t) => ({
        id: String(t._id),
        name: t.name,
        description: t.description ?? "",
        pricePence: t.pricePence,
        available: available({ quota: t.quota, sold: t.sold ?? 0, held: t.held ?? 0 }),
        maxPerOrder: t.maxPerOrder ?? 10,
        nights: t.validSessionIds.length,
        ...(() => {
          const b = bookability({ ...t, validSessionIds: t.validSessionIds.map(String), available: available({ quota: t.quota, sold: t.sold ?? 0, held: t.held ?? 0 }) }, state, now, "online");
          return { onSale: b.ok, blocked: b.ok ? null : UNBOOKABLE_LABEL[b.reason], reason: b.ok ? null : b.reason };
        })(),
        salesStartAt: t.salesStartAt && t.salesStartAt > now ? t.salesStartAt : null,
        validSessionIds: t.validSessionIds.map(String),
        dayPass: t.dayPass?.groupId ? { groupId: String(t.dayPass.groupId), name: t.dayPass.name ?? t.name } : null,
      }));
    const bookingsOpen = tts.some((t) => t.onSale);
    const reasons = new Set(tts.map((t) => t.reason));
    const closedReason: PublicEvent["closedReason"] = bookingsOpen
      ? null
      : state.bookingsClosed
        ? "closed"
        : reasons.has("not_on_sale_yet")
          ? "not_yet"
          : tts.length > 0 && [...reasons].every((r) => r === "sold_out")
            ? "sold_out"
            : [...reasons].some((r) => r === "night_closed" || r === "event_closed")
              ? "closed"
              : "over";
    const upcoming = tts.map((t) => t.salesStartAt).filter((d): d is Date => d !== null);
    return {
      id: String(e._id),
      slug: e.slug,
      title: e.title,
      description: e.description ?? "",
      venue: e.venue,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      sessions: e.sessions.map((s) => ({ id: String(s._id), label: s.label, startsAt: s.startsAt, endsAt: s.endsAt })),
      media: [...(e.media ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((m) => ({ type: m.type, url: m.url, alt: m.alt ?? "" })),
      fromPence: tts.length ? Math.min(...tts.map((t) => t.pricePence)) : null,
      ticketTypes: tts.map(({ reason: _r, ...t }) => t),
      bookingsOpen,
      closedReason,
      pricing: { ...pricingFor(e, orgById.get(String(e.organizerId)) ?? {}), cardFee: cardFeeOf(orgById.get(String(e.organizerId)) ?? {}) },
      onlinePaymentsAvailable: !stripeMode || canTakeCardPayments(orgById.get(String(e.organizerId)) ?? {}),
      bookingsOpenAt: !bookingsOpen && upcoming.length ? new Date(Math.min(...upcoming.map((d) => d.getTime()))) : null,
    };
  });
}

function loadEvents(filter: Record<string, unknown>) {
  return Event.find({ ...PUBLIC_FILTER, ...filter }).sort({ startsAt: 1 }).lean();
}

export async function getPublishedEvents(): Promise<PublicEvent[]> {
  await connectDb();
  return withTicketTypes(await loadEvents({ endsAt: { $gt: new Date() } }));
}

export async function getEventBySlug(slug: string): Promise<PublicEvent | null> {
  await connectDb();
  const [event] = await withTicketTypes(await loadEvents({ slug }));
  return event ?? null;
}

export interface OrderConfirmation {
  publicId: string;
  status: string;
  paidAt: Date | null;
  totalPence: number;
  items: { name: string; qty: number; unitPricePence: number }[];
  lines: { label: string; amountPence: number; negative?: boolean }[];
  event: { title: string; slug: string; startsAt: Date; endsAt: Date; venue: string };
  /** Refunded automatically because the passes sold out while the customer was paying. */
  soldOutRefund: boolean;
  /** Paid bookings: valid passes by night, for per-night PDF downloads. */
  nightGroups: NightGroup[];
}

/**
 * Confirmation page read model. Anyone holding the order ref can open the page, so it deliberately
 * carries no customer details and no QR tokens — passes are delivered by email (M5).
 */
export async function getOrderConfirmation(publicId: string): Promise<OrderConfirmation | null> {
  if (!PUBLIC_ID_RE.test(publicId)) return null;
  await connectDb();
  const order = await Order.findOne({ publicId }).lean();
  if (!order) return null;
  const event = await Event.findById(order.eventId).lean();
  if (!event) return null;
  return {
    publicId: order.publicId,
    status: order.status ?? "pending",
    paidAt: order.paidAt ?? null,
    totalPence: order.totalPence,
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, unitPricePence: i.unitPricePence })),
    lines: linesFor(order),
    event: { title: event.title, slug: event.slug, startsAt: event.startsAt, endsAt: event.endsAt, venue: `${event.venue.name}, ${event.venue.postcode}` },
    soldOutRefund: (order.refunds ?? []).some((r) => r.refundedBy === "system"),
    nightGroups:
      order.status === "paid" || order.status === "partially_refunded"
        ? nightGroupsFor((await Ticket.find({ orderId: order._id, status: "valid" }, { validSessionIds: 1 }).lean()).map((t) => passNight(t.validSessionIds, event.sessions)))
        : [],
  };
}

export interface OrderTicketsView {
  publicId: string;
  customerName: string;
  status: string;
  paidAt: Date | null;
  items: { name: string; qty: number; unitPricePence: number }[];
  lines: { label: string; amountPence: number; negative?: boolean }[];
  discountPence: number;
  totalPence: number;
  event: { title: string; slug: string; startsAt: Date; endsAt: Date; venue: string; ended: boolean };
  tickets: { id: string; typeName: string; nights: string; qrToken: string | null; nightKey: string; nightDate: string; nightSort: number }[];
  /** Passes by night (one-night passes per night, then "All nights"): for headings and per-night PDFs. */
  nightGroups: NightGroup[];
}

export interface NightGroup {
  /** Session id, or "multi". */
  key: string;
  title: string;
  count: number;
}

function nightGroupsFor(tickets: { nightKey: string; nightSort: number }[]): NightGroup[] {
  const by = new Map<string, NightGroup & { sort: number }>();
  for (const t of tickets) {
    const g = by.get(t.nightKey) ?? { key: t.nightKey, title: t.nightKey === "multi" ? "All nights" : nightFmt.format(new Date(t.nightSort)), count: 0, sort: t.nightKey === "multi" ? Number.MAX_SAFE_INTEGER : t.nightSort };
    g.count++;
    by.set(t.nightKey, g);
  }
  return [...by.values()].sort((a, b) => a.sort - b.sort).map(({ sort: _s, ...g }) => g);
}

const nightFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/**
 * Ticket view (SPEC §4.4). Only call after verifying the signed link. QR tokens are withheld once the
 * event has ended.
 */
export async function getOrderTickets(publicId: string, now = new Date()): Promise<OrderTicketsView | null> {
  if (!PUBLIC_ID_RE.test(publicId)) return null;
  await connectDb();
  const order = await Order.findOne({ publicId }).lean();
  if (!order) return null;
  const event = await Event.findById(order.eventId).lean();
  if (!event) return null;
  const ended = event.endsAt <= now;
  const tickets = await Ticket.find({ orderId: order._id, status: "valid" }).sort({ _id: 1 }).lean();
  const views = tickets
    .map((t) => {
      const valid = new Set(t.validSessionIds.map(String));
      const nights = event.sessions.filter((s) => valid.has(String(s._id)));
      return {
        id: String(t._id),
        typeName: t.ticketTypeName,
        nights:
          nights.length === event.sessions.length && nights.length > 1
            ? `All ${nights.length} nights`
            : nights.map((n) => nightFmt.format(n.startsAt)).join(", "),
        qrToken: ended ? null : t.qrToken,
        ...passNight(t.validSessionIds, event.sessions),
      };
    })
    .sort((a, b) => (a.nightKey === "multi" ? 1 : 0) - (b.nightKey === "multi" ? 1 : 0) || a.nightSort - b.nightSort);
  return {
    publicId: order.publicId,
    customerName: order.customer?.name ?? "",
    status: order.status ?? "pending",
    paidAt: order.paidAt ?? null,
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, unitPricePence: i.unitPricePence })),
    lines: linesFor(order),
    discountPence: order.discount?.amountPence ?? 0,
    totalPence: order.totalPence,
    event: {
      title: event.title,
      slug: event.slug,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venue: `${event.venue.name}, ${event.venue.address}, ${event.venue.postcode}`,
      ended,
    },
    tickets: views,
    nightGroups: nightGroupsFor(views),
  };
}

type OrderLike = {
  items: { name: string; qty: number; unitPricePence: number }[];
  discount?: { amountPence?: number | null; reason?: string | null } | null;
  offline?: { method?: string | null } | null;
  platformFeePence?: number | null;
  commissionBps?: number | null;
  charges?: { name?: string | null; amountPence?: number | null }[] | null;
  taxPence?: number | null;
  taxBps?: number | null;
  cardFeePence?: number | null;
};

function linesFor(order: OrderLike) {
  return receiptLines({
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
  });
}
