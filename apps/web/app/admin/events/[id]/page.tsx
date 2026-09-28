import type { Metadata } from "next";
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
import { formatDayTime, price } from "@/lib/format";

export const metadata: Metadata = { title: "Event" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export default async function AdminEventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!Types.ObjectId.isValid(id)) notFound();
  const event = await Event.findOne({ _id: id, deletedAt: null }).lean();
  if (!event) notFound();
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
            {organizer && (
              <Link href={`/org/${organizer.slug}`} className="font-semibold text-brand-orange-strong hover:underline">
                Organiser panel
              </Link>
            )}
            <Link href="/admin/events" className="font-semibold text-brand-orange-strong hover:underline">
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
              initial={{
                title: event.title,
                slug: event.slug,
                description: event.description ?? "",
                venueName: event.venue.name,
                venueAddress: event.venue.address,
                postcode: event.venue.postcode,
                mapUrl: event.venue.mapUrl ?? "",
                nights: event.sessions.map((s) => ({ id: String(s._id), label: s.label, start: utcToLondonLocal(s.startsAt), end: utcToLondonLocal(s.endsAt), locked: usedNights.has(String(s._id)) })),
              }}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-1 text-lg">Pass types</h2>
            <p className="mb-4 text-sm text-muted-foreground">Price changes apply to new bookings only. The quota can&apos;t go below what&apos;s already sold or being paid for.</p>
            {types.length > 0 && (
              <ul className="mb-6 divide-y divide-border rounded-md border border-border">
                {types.map((t) => (
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
            <h3 className="mb-3 font-display font-semibold">Add a pass type</h3>
            <TicketTypeForm eventId={id} nights={nights} />
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
          <section className="rounded-lg border border-destructive/40 bg-card p-6">
            <h2 className="mb-3 text-lg">Delete event</h2>
            <DeleteEventForm eventId={id} hasOrders={Boolean(hasOrders)} />
          </section>
        </aside>
      </div>
    </>
  );
}
