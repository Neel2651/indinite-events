/**
 * Whether a pass type can be booked right now (agreed 30 Sep 2026). One set of rules for the booking forms and
 * every checkout service; the atomic quota update is still the final word on capacity.
 *
 * - Sold out: nothing left of that pass type (for a day pass, that one night).
 * - Online and payment links: a pass stops selling when its LAST night starts (a day pass: when its night
 *   starts; a season or weekend pass keeps selling until its last night starts). Box office can sell until its
 *   last night ends.
 * - Closed by hand (owner or super admin): the whole event, or single nights. Stops online sales and new payment
 *   links; box office can still issue passes. A pass is closed when every one of its nights is closed.
 * - Sales windows (salesStartAt / salesEndAt) apply to public checkout only, as before.
 * Channels: "online" (public checkout), "payment_link" (staff create, customer pays online: time and manual-close
 * rules apply, sales windows don't), "staff" (box office cash / account / complimentary).
 */
export type Channel = "online" | "payment_link" | "staff";

export type Unbookable =
  | "inactive"
  | "sold_out"
  | "started"
  | "ended"
  | "event_closed"
  | "night_closed"
  | "not_on_sale_yet"
  | "sales_ended";

export interface BookableType {
  name: string;
  active?: boolean | null;
  available: number;
  validSessionIds: string[];
  salesStartAt?: Date | string | null;
  salesEndAt?: Date | string | null;
}

export interface BookableEventState {
  sessions: { id: string; startsAt: Date | string; endsAt: Date | string }[];
  bookingsClosed?: boolean;
  closedSessionIds?: string[];
}

export type Bookability = { ok: true } | { ok: false; reason: Unbookable; message: string };

const time = (d: Date | string) => new Date(d).getTime();

export function bookability(type: BookableType, event: BookableEventState, now: Date, channel: Channel): Bookability {
  const no = (reason: Unbookable, message: string): Bookability => ({ ok: false, reason, message });
  if (type.active === false) return no("inactive", `${type.name} isn't on sale.`);
  const nights = event.sessions.filter((s) => type.validSessionIds.includes(s.id));
  if (nights.length === 0) return no("inactive", `${type.name} isn't on sale.`);
  const lastStart = Math.max(...nights.map((n) => time(n.startsAt)));
  const lastEnd = Math.max(...nights.map((n) => time(n.endsAt)));
  const t = now.getTime();

  if (t >= lastEnd) return no("ended", `${type.name} is for a night that has ended.`);
  if (channel !== "staff") {
    if (t >= lastStart) return no("started", nights.length === 1 ? `${type.name} is no longer on sale: the night has started.` : `${type.name} is no longer on sale: its last night has started.`);
    if (event.bookingsClosed) return no("event_closed", "Bookings for this event are closed.");
    const closed = new Set(event.closedSessionIds ?? []);
    if (nights.every((n) => closed.has(n.id))) return no("night_closed", `Bookings for ${type.name} are closed.`);
  }
  if (channel === "online") {
    if (type.salesStartAt && time(type.salesStartAt) > t) return no("not_on_sale_yet", `${type.name} isn't on sale yet.`);
    if (type.salesEndAt && time(type.salesEndAt) <= t) return no("sales_ended", `Sales for ${type.name} have closed.`);
  }
  if (type.available <= 0) return no("sold_out", `${type.name} has sold out.`);
  return { ok: true };
}

/** Short label for a pass or night that can't be booked. */
export const UNBOOKABLE_LABEL: Record<Unbookable, string> = {
  inactive: "Not on sale",
  sold_out: "Sold out",
  started: "Started",
  ended: "Ended",
  event_closed: "Bookings closed",
  night_closed: "Bookings closed",
  not_on_sale_yet: "Not on sale yet",
  sales_ended: "Sales closed",
};
