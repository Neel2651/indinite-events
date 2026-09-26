import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEventBySlug } from "@/lib/queries";
import { formatDateRange, formatDay, formatTime, price } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEventBySlug((await params).slug);
  return event ? { title: event.title, description: event.description.slice(0, 160) } : {};
}

export default async function EventPage({ params }: Props) {
  const event = await getEventBySlug((await params).slug);
  if (!event) notFound();

  return (
    <>
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <span className="badge-pill">{event.sessions.length} NIGHTS · {event.venue.postcode}</span>
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
          <h2 className="text-xl">Passes</h2>
          {event.ticketTypes.length === 0 && <p className="text-muted-foreground">Passes aren&apos;t on sale yet.</p>}
          {event.ticketTypes.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-4 border-b border-border pb-4 last:border-0">
              <div>
                <p className="font-display font-semibold">{t.name}</p>
                <p className="text-sm text-muted-foreground">
                  {t.nights === event.sessions.length ? "All nights" : `${t.nights} night${t.nights > 1 ? "s" : ""}`}
                  {t.available === 0 ? " · Sold out" : t.available <= 20 ? ` · ${t.available} left` : ""}
                </p>
              </div>
              <span className="font-display font-bold">{price(t.pricePence)}</span>
            </div>
          ))}
          {/* M4: quantity pickers + "Continue to payment" (Stripe Checkout) */}
          <button type="button" className="btn-cta w-full opacity-60" disabled>
            Checkout opens soon
          </button>
        </aside>
      </div>
    </>
  );
}
