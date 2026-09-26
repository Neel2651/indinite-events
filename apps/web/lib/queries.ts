import "server-only";
import { available } from "@indinite/core";
import { connectDb, Event, TicketType } from "@indinite/db";

export interface PublicTicketType {
  id: string;
  name: string;
  description: string;
  pricePence: number;
  available: number;
  maxPerOrder: number;
  nights: number;
  onSale: boolean;
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
}

const PUBLIC_FILTER = { status: "published", deletedAt: null } as const;

async function withTicketTypes(events: Awaited<ReturnType<typeof loadEvents>>): Promise<PublicEvent[]> {
  const ids = events.map((e) => e._id);
  const types = await TicketType.find({ eventId: { $in: ids }, active: true }).sort({ sortOrder: 1 }).lean();
  const now = new Date();

  return events.map((e) => {
    const tts: PublicTicketType[] = types
      .filter((t) => String(t.eventId) === String(e._id))
      .map((t) => ({
        id: String(t._id),
        name: t.name,
        description: t.description ?? "",
        pricePence: t.pricePence,
        available: available({ quota: t.quota, sold: t.sold ?? 0, held: t.held ?? 0 }),
        maxPerOrder: t.maxPerOrder ?? 10,
        nights: t.validSessionIds.length,
        onSale: (!t.salesStartAt || t.salesStartAt <= now) && (!t.salesEndAt || t.salesEndAt > now),
      }));
    return {
      id: String(e._id),
      slug: e.slug,
      title: e.title,
      description: e.description ?? "",
      venue: e.venue,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      sessions: e.sessions.map((s) => ({ id: String(s._id), label: s.label, startsAt: s.startsAt, endsAt: s.endsAt })),
      media: (e.media ?? []).map((m) => ({ type: m.type, url: m.url, alt: m.alt ?? "" })),
      fromPence: tts.length ? Math.min(...tts.map((t) => t.pricePence)) : null,
      ticketTypes: tts,
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
