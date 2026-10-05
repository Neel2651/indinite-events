import Link from "next/link";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { utcToLondonLocal } from "@indinite/core";
import { Event, Order, Organizer, Ticket, TicketType } from "@indinite/db";
import { DeleteEventForm, EventStatusActions } from "@/components/staff/event-admin-actions";
import { EventForm } from "@/components/staff/event-form";
import { MediaManager } from "@/components/staff/media-manager";
import { PageHeader } from "@/components/staff/shell";
import { TicketTypeForm } from "@/components/staff/ticket-type-form";
import { adminSetBookingsClosedAction } from "@/app/admin/events/actions";
import { BookingsControl } from "@/components/staff/bookings-control";
import { DayPassForm, type DayPassNightRow } from "@/components/staff/day-pass-form";
import { formatDay, formatDayTime, formatTime, price } from "@/lib/format";

/** Admin (`/admin/events/[id]`) or the organiser's own panel (`/org/[slug]/events/[eventId]`). */
export type EditorContext = { kind: "admin" } | { kind: "org"; slug: string; organizerId: string };

/**
 * The event editor: details and nights, pass types and day passes, images, publishing, bookings and delete.
 * Shared by Admin → Events and organiser owners (1 Oct 2026). Every action it uses checks the permission against the
 * event's organiser on the server. In the organiser panel, an event of another organiser is a 404.
 */
export async function EventEditor({ id, created, context }: { id: string; created?: string; context: EditorContext }) {
  if (!Types.ObjectId.isValid(id)) notFound();
  const event = await Event.findOne({ _id: id, deletedAt: null, ...(context.kind === "org" ? { organizerId: new Types.ObjectId(context.organizerId) } : {}) }).lean();
  if (!event) notFound();
  const listPath = context.kind === "org" ? `/org/${context.slug}/events` : "/admin/events";
  const [organizer, types, ticketNights, hasOrders] = await Promise.all([
    Organizer.findById(event.organizerId, { name: 1, slug: 1 }).lean(),
    TicketType.find({ eventId: event._id }).sort({ sortOrder: 1, name: 1 }).lean(),
    Ticket.distinct("validSessionIds", { eventId: event._id }),
    Order.exists({ eventId: event._id }),
  ]);
  const usedNights = new Set([...types.flatMap((t) => t.validSessionIds.map(String)), ...ticketNights.map(String)]);
  const nights = event.sessions.map((s) => ({ id: String(s._id), label: s.label }));
  const media = [...(event.media ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((m) => ({ type: m.type as "image" | "video", url: m.url, alt: m.alt ?? "" }));
  const status = event.status ?? "draft";
  // Day passes: one pass type per night, shown and edited as one group.
  const singles = types.filter((t) => !t.dayPass?.groupId);
  const groups = [...new Map(types.filter((t) => t.dayPass?.groupId).map((t) => [String(t.dayPass!.groupId), t.dayPass!.name ?? t.name])).entries()].map(([groupId, name]) => ({
    groupId,
    name,
    members: types.filter((t) => String(t.dayPass?.groupId) === groupId),
  }));
  const when = (d: Date) => `${formatDay(d)} · ${formatTime(d)}`;
  const nightRows = (members: typeof types = []): DayPassNightRow[] =>
    event.sessions.map((s) => {
      const m = members.find((x) => String(x.validSessionIds[0]) === String(s._id));
      return {
        sessionId: String(s._id),
        label: s.label,
        when: when(s.startsAt),
        selected: members.length ? Boolean(m) : true,
        price: m ? (m.pricePence / 100).toFixed(2) : "",
        quota: m?.quota ?? 0,
        active: m ? (m.active ?? true) : true,
        committed: m ? (m.sold ?? 0) + (m.held ?? 0) : 0,
        sold: m?.sold ?? 0,
      };
    });
  const closedNights = new Map((event.closedNights ?? []).map((n) => [String(n.sessionId), n]));

  return (
    <>
      <PageHeader
        title={event.title}
        description={`${organizer?.name ?? "Unknown organiser"} · ${status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft"}`}
        actions={
          <div className="flex gap-3 text-sm">
            {status === "published" && (
              <Link href={`/e/${event.slug}`} className="font-semibold text-brand-orange-strong hover:underline">
                View public page
              </Link>
            )}
            {organizer && context.kind === "admin" && (
              <Link href={`/org/${organizer.slug}`} className="font-semibold text-brand-orange-strong hover:underline">
                Organiser panel
              </Link>
            )}
            <Link href={listPath} className="font-semibold text-brand-orange-strong hover:underline">
              All events
            </Link>
          </div>
        }
      />
      {created && (
        <p role="status" className="mb-6 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          Event created as a draft. Add pass types and images, then publish it.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-lg">Details and nights</h2>
            <EventForm
              eventId={id}
              returnTo={listPath}
              initial={{
                title: event.title,
                slug: event.slug,
                description: event.description ?? "",
                metaPixelId: event.metaPixelId ?? "",
                metaCapiTokenHint: event.metaCapiTokenHint ?? "",
                metaTestEventCode: event.metaTestEventCode ?? "",
                venueName: event.venue.name,
                venueAddress: event.venue.address,
                postcode: event.venue.postcode,
                mapUrl: event.venue.mapUrl ?? "",
                lat: event.venue.lat != null ? String(event.venue.lat) : "",
                lng: event.venue.lng != null ? String(event.venue.lng) : "",
                nights: event.sessions.map((s) => ({ id: String(s._id), label: s.label, start: utcToLondonLocal(s.startsAt), end: utcToLondonLocal(s.endsAt), locked: usedNights.has(String(s._id)) })),
              }}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-1 text-lg">Pass types</h2>
            <p className="mb-4 text-sm text-muted-foreground">Price changes apply to new bookings only. The quota can&apos;t go below what&apos;s already sold or being paid for.</p>
            {groups.length > 0 && (
              <ul className="mb-6 divide-y divide-border rounded-md border border-border">
                {groups.map((g) => (
                  <li key={g.groupId}>
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <span>
                          <span className="font-semibold">{g.name}</span>
                          <span className="ml-2 rounded-full bg-brand-yellow px-2 py-0.5 text-xs font-semibold text-brand-navy">Day pass</span>
                          <span className="block text-xs text-muted-foreground">
                            {g.members.length} night{g.members.length === 1 ? "" : "s"} · {g.members.reduce((n, m) => n + (m.sold ?? 0), 0)} sold
                          </span>
                        </span>
                        <span className="text-sm">
                          {price(Math.min(...g.members.map((m) => m.pricePence)))}
                          {new Set(g.members.map((m) => m.pricePence)).size > 1 ? ` – ${price(Math.max(...g.members.map((m) => m.pricePence)))}` : ""}
                        </span>
                      </summary>
                      <div className="border-t border-border bg-muted/30 p-4">
                        <DayPassForm
                          eventId={id}
                          initial={{
                            groupId: g.groupId,
                            name: g.name,
                            description: g.members[0]?.description ?? "",
                            maxPerOrder: g.members[0]?.maxPerOrder ?? 10,
                            salesStartAt: g.members[0]?.salesStartAt ? utcToLondonLocal(g.members[0].salesStartAt) : "",
                            salesEndAt: g.members[0]?.salesEndAt ? utcToLondonLocal(g.members[0].salesEndAt) : "",
                            sortOrder: Math.floor((g.members[0]?.sortOrder ?? 0) / 100),
                            nights: nightRows(g.members),
                          }}
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {singles.length > 0 && (
              <ul className="mb-6 divide-y divide-border rounded-md border border-border">
                {singles.map((t) => (
                  <li key={String(t._id)}>
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <span>
                          <span className="font-semibold">{t.name}</span>
                          {!t.active && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">Off sale</span>}
                          <span className="block text-xs text-muted-foreground">
                            {t.validSessionIds.length} night{t.validSessionIds.length === 1 ? "" : "s"}
                            {t.salesStartAt ? ` · on sale from ${formatDayTime(t.salesStartAt)}` : ""}
                          </span>
                        </span>
                        <span className="text-sm">
                          {price(t.pricePence)} · {t.sold} sold{t.held ? `, ${t.held} held` : ""} of {t.quota}
                        </span>
                      </summary>
                      <div className="border-t border-border bg-muted/30 p-4">
                        <TicketTypeForm
                          eventId={id}
                          nights={nights}
                          initial={{
                            id: String(t._id),
                            name: t.name,
                            description: t.description ?? "",
                            price: (t.pricePence / 100).toFixed(2),
                            quota: t.quota,
                            maxPerOrder: t.maxPerOrder ?? 10,
                            nights: t.validSessionIds.map(String),
                            salesStartAt: t.salesStartAt ? utcToLondonLocal(t.salesStartAt) : "",
                            salesEndAt: t.salesEndAt ? utcToLondonLocal(t.salesEndAt) : "",
                            sortOrder: t.sortOrder ?? 0,
                            active: t.active ?? true,
                            committed: (t.sold ?? 0) + (t.held ?? 0),
                          }}
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <details className="mb-4 rounded-md border border-border">
              <summary className="cursor-pointer px-4 py-3 font-display font-semibold">Add a day pass (customers pick nights, price and quota per night)</summary>
              <div className="border-t border-border p-4">
                <DayPassForm key={`new-${groups.length}`} eventId={id} initial={{ name: "", description: "", maxPerOrder: 10, salesStartAt: "", salesEndAt: "", sortOrder: 0, nights: nightRows() }} />
              </div>
            </details>
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer px-4 py-3 font-display font-semibold">Add a pass for one or more set nights (e.g. season or weekend pass)</summary>
              <div className="border-t border-border p-4">
                <TicketTypeForm eventId={id} nights={nights} />
              </div>
            </details>
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-lg">Images and videos</h2>
            <MediaManager eventId={id} media={media} />
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg">Publishing</h2>
            <EventStatusActions eventId={id} status={status} />
          </section>
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg">Bookings</h2>
            <BookingsControl
              eventClosed={Boolean(event.bookingsClosed?.closed)}
              eventReason={event.bookingsClosed?.reason}
              nights={event.sessions.map((s) => ({ id: String(s._id), label: s.label, dayLabel: formatDay(s.startsAt), closed: closedNights.has(String(s._id)), reason: closedNights.get(String(s._id))?.reason }))}
              onSet={adminSetBookingsClosedAction.bind(null, id)}
            />
          </section>
          <section className="rounded-lg border border-destructive/40 bg-card p-6">
            <h2 className="mb-3 text-lg">Delete event</h2>
            <DeleteEventForm eventId={id} hasOrders={Boolean(hasOrders)} returnTo={listPath} />
          </section>
        </aside>
      </div>
    </>
  );
}
