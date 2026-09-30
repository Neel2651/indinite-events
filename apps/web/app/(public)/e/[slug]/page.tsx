import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePaymentsMode, embedUrlFor } from "@indinite/core";
import { BookingForm } from "@/components/booking-form";
import { getEventBySlug } from "@/lib/queries";
import { formatDateRange, formatDay, formatDayTime, formatTime, price } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEventBySlug((await params).slug);
  return event ? { title: event.title, description: event.description.slice(0, 160) } : {};
}

export default async function EventPage({ params }: Props) {
  const event = await getEventBySlug((await params).slug);
  if (!event) notFound();

  // The first image is the hero background; the gallery shows every image and video in the admin's order.
  const cover = event.media.find((m) => m.type === "image");
  const gallery = event.media.flatMap((m) => {
    if (m.type === "image") return [{ ...m, embed: null as string | null }];
    const embed = embedUrlFor(m.url);
    return embed ? [{ ...m, embed }] : [];
  });

  return (
    <>
      <section className="dark relative isolate overflow-hidden bg-background text-foreground">
        {cover && (
          <>
            { }
            <img src={cover.url} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-45" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-navy via-brand-navy/70 to-transparent" aria-hidden />
          </>
        )}
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-24">
          <div className="flex flex-wrap items-center gap-3">
            <span className="badge-pill">{event.sessions.length} NIGHTS · {event.venue.postcode}</span>
            <BookingStatus open={event.bookingsOpen} opensAt={event.bookingsOpenAt} soldOut={event.closedReason === "sold_out"} />
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl leading-tight sm:text-5xl">{event.title}</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {formatDateRange(event.startsAt, event.endsAt)} · {event.venue.name}, {event.venue.address}
          </p>
          {(event.venue.lat != null && event.venue.lng != null) || event.venue.mapUrl ? (
            <a
              href={event.venue.lat != null && event.venue.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${event.venue.lat},${event.venue.lng}` : event.venue.mapUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline-pill mt-5 inline-block"
            >
              Get directions<span className="sr-only"> (opens Google Maps)</span>
            </a>
          ) : null}
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[1fr_380px]">
        <div className="space-y-10">
          {event.description && (
            <section>
              <h2 className="text-2xl">About</h2>
              <p className="mt-3 max-w-prose whitespace-pre-line text-muted-foreground">{event.description}</p>
            </section>
          )}
          {gallery.length > 0 && (
            <section>
              <h2 className="text-2xl">Gallery</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {gallery.map((m, i) => (
                  <li key={m.url} className={i === 0 || m.embed ? "sm:col-span-2" : undefined}>
                    {m.embed ? (
                      <iframe
                        src={m.embed}
                        title={m.alt || "Event video"}
                        loading="lazy"
                        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="aspect-video w-full rounded-lg border-0 bg-brand-navy"
                      />
                    ) : (
                       
                      <img src={m.url} alt={m.alt} loading="lazy" className="aspect-[16/9] w-full rounded-lg object-cover" />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2 className="text-2xl">Nights</h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-3">
              {event.sessions.map((s) => (
                <li key={s.id} className="rounded-md border border-border px-4 py-3">
                  <span className="font-display font-semibold">{s.label}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDay(s.startsAt)}, {formatTime(s.startsAt)}–{formatTime(s.endsAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="card-brand h-fit space-y-5">
          <h2 className="text-xl">Book passes</h2>
          <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
            <strong>No refunds.</strong> If the event is cancelled, or for any refund request, contact the organiser.{" "}
            <Link href="/refund-policy" className="font-semibold text-brand-orange-strong hover:underline">
              Refund policy
            </Link>
          </p>
          {event.ticketTypes.length === 0 && <p className="text-muted-foreground">Passes aren&apos;t on sale yet.</p>}
          {event.bookingsOpen && !event.onlinePaymentsAvailable ? (
            <div className="space-y-3">
              <p className="text-muted-foreground">Card payments for this event are coming soon. Please check back shortly or contact the organiser.</p>
              <button type="button" className="btn-cta w-full opacity-60" disabled>
                Card payments coming soon
              </button>
            </div>
          ) : event.bookingsOpen ? (
            <BookingForm
              eventId={event.id}
              paymentsMode={resolvePaymentsMode(process.env)}
              pricing={event.pricing}
              sessions={event.sessions.map((s) => ({ id: s.id, label: s.label, dayLabel: formatDay(s.startsAt), timeLabel: `${formatTime(s.startsAt)}–${formatTime(s.endsAt)}` }))}
              // Everything that's listed, so sold-out and closed nights still show why.
              ticketTypes={event.ticketTypes
                .filter((t) => t.onSale || t.blocked === "Sold out" || t.blocked === "Bookings closed" || t.blocked === "Started")
                .map((t) => ({
                  id: t.id,
                  name: t.name,
                  pricePence: t.pricePence,
                  available: t.available,
                  maxPerOrder: t.maxPerOrder,
                  nightsLabel: nightsLabel(t.nights, event.sessions.length),
                  validSessionIds: t.validSessionIds,
                  dayPassName: t.dayPass?.name ?? null,
                  blocked: t.blocked,
                }))}
            />
          ) : (
            <>
              {event.ticketTypes.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-4 border-b border-border pb-4 last:border-0">
                  <div>
                    <p className="font-display font-semibold">{t.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {nightsLabel(t.nights, event.sessions.length)}
                      {t.salesStartAt ? ` · On sale ${formatDayTime(t.salesStartAt)}` : t.blocked ? ` · ${t.blocked}` : ""}
                    </p>
                  </div>
                  <span className="font-display font-bold">{price(t.pricePence)}</span>
                </div>
              ))}
              <button type="button" className="btn-cta w-full opacity-60" disabled>
                {event.closedReason === "sold_out" ? "Sold out" : event.bookingsOpenAt ? `Bookings open ${formatDayTime(event.bookingsOpenAt)}` : "Bookings closed"}
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function BookingStatus({ open, opensAt, soldOut }: { open: boolean; opensAt: Date | null; soldOut: boolean }) {
  if (open) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold tracking-widest text-brand-navy">
        <span className="size-2 rounded-full bg-success" aria-hidden />
        BOOKINGS OPEN
      </span>
    );
  }
  return (
    <span className="rounded-full bg-secondary px-4 py-1.5 text-xs font-semibold tracking-widest text-secondary-foreground">
      {soldOut ? "SOLD OUT" : opensAt ? `BOOKINGS OPEN ${formatDayTime(opensAt).toUpperCase()}` : "BOOKINGS CLOSED"}
    </span>
  );
}

function nightsLabel(nights: number, total: number) {
  return nights === total ? "All nights" : `${nights} night${nights > 1 ? "s" : ""}`;
}
