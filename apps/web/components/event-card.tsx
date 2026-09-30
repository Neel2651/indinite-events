import Link from "next/link";
import type { PublicEvent } from "@/lib/queries";
import { formatDateRange, formatDayTime, price } from "@/lib/format";

/**
 * The whole card opens the event (1 Oct 2026): the title's link stretches over the card ("stretched link"), so
 * there's one link per card, announced by the event's name.
 */
export function EventCard({ event }: { event: PublicEvent }) {
  const cover = event.media.find((m) => m.type === "image");
  return (
    <article className="card-brand group relative flex cursor-pointer flex-col overflow-hidden p-0 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span
        className={`pointer-events-none absolute left-4 top-4 z-10 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-widest text-foreground ${
          event.bookingsOpen ? "bg-white" : "bg-brand-yellow"
        }`}
      >
        {event.bookingsOpen && <span className="size-2 rounded-full bg-success" aria-hidden />}
        {event.bookingsOpen
          ? "BOOKINGS OPEN"
          : event.closedReason === "sold_out"
            ? "SOLD OUT"
            : event.bookingsOpenAt
              ? `OPENS ${formatDayTime(event.bookingsOpenAt).toUpperCase()}`
              : "BOOKINGS CLOSED"}
      </span>
      {cover ? (
         
        <img src={cover.url} alt={cover.alt} className="aspect-[16/9] w-full object-cover" />
      ) : (
        <div className="aspect-[16/9] w-full bg-brand-navy" aria-hidden />
      )}
      <div className="flex flex-1 flex-col gap-3 p-6">
        <h2 className="text-xl leading-snug">
          <Link href={`/e/${event.slug}`} className="outline-none after:absolute after:inset-0 after:z-0 after:content-['']">
            {event.title}
          </Link>
        </h2>
        <p className="text-muted-foreground">
          {formatDateRange(event.startsAt, event.endsAt)} · {event.sessions.length}{" "}
          {event.sessions.length === 1 ? "night" : "nights"}
        </p>
        <p className="text-muted-foreground">
          {event.venue.name}, {event.venue.postcode}
        </p>
        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="font-display font-bold">
            {event.fromPence !== null ? `From ${price(event.fromPence)}` : "Prices coming soon"}
          </span>
          {/*
            Looks like a button; taps and the pointer pass through to the card's link. (A hover filter here would
            lift it above the link's overlay and swallow the click, so the hover is a shadow instead.)
          */}
          <span aria-hidden="true" className="btn-cta pointer-events-none text-sm transition-shadow group-hover:shadow-lg">
            View passes
          </span>
        </div>
      </div>
    </article>
  );
}
