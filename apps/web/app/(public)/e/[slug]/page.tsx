import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePaymentsMode } from "@indinite/core";
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

  const [cover, ...gallery] = event.media.filter((m) => m.type === "image");

  return (
    <>
      <section className="dark relative isolate overflow-hidden bg-background text-foreground">
        {cover && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover.url} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-45" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-navy via-brand-navy/70 to-transparent" aria-hidden />
          </>
        )}
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-24">
          <div className="flex flex-wrap items-center gap-3">
            <span className="badge-pill">{event.sessions.length} NIGHTS · {event.venue.postcode}</span>
            <BookingStatus open={event.bookingsOpen} opensAt={event.bookingsOpenAt} />
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl leading-tight sm:text-5xl">{event.title}</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {formatDateRange(event.startsAt, event.endsAt)} · {event.venue.name}, {event.venue.address}
          </p>
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
          {(cover || gallery.length > 0) && (
            <section>
              <h2 className="text-2xl">Gallery</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {[cover!, ...gallery].filter(Boolean).map((m, i) => (
                  <li key={m.url} className={i === 0 ? "sm:col-span-2" : undefined}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.alt} loading="lazy" className="aspect-[16/9] w-full rounded-lg object-cover" />
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
              ticketTypes={event.ticketTypes
                .filter((t) => t.onSale)
                .map((t) => ({
                  id: t.id,
                  name: t.name,
                  pricePence: t.pricePence,
                  available: t.available,
                  maxPerOrder: t.maxPerOrder,
                  nightsLabel: nightsLabel(t.nights, event.sessions.length),
                  validSessionIds: t.validSessionIds,
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
                      {t.salesStartAt ? ` · On sale ${formatDayTime(t.salesStartAt)}` : t.available === 0 ? " · Sold out" : ""}
                    </p>
                  </div>
                  <span className="font-display font-bold">{price(t.pricePence)}</span>
                </div>
              ))}
              <button type="button" className="btn-cta w-full opacity-60" disabled>
                {event.bookingsOpenAt ? `Bookings open ${formatDayTime(event.bookingsOpenAt)}` : "Bookings closed"}
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function BookingStatus({ open, opensAt }: { open: boolean; opensAt: Date | null }) {
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
      {opensAt ? `BOOKINGS OPEN ${formatDayTime(opensAt).toUpperCase()}` : "BOOKINGS CLOSED"}
    </span>
  );
}

function nightsLabel(nights: number, total: number) {
  return nights === total ? "All nights" : `${nights} night${nights > 1 ? "s" : ""}`;
}
