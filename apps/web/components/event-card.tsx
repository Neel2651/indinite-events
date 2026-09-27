import Link from "next/link";
import type { PublicEvent } from "@/lib/queries";
import { formatDateRange, formatDayTime, price } from "@/lib/format";

export function EventCard({ event }: { event: PublicEvent }) {
  const cover = event.media.find((m) => m.type === "image");
  return (
    <article className="card-brand relative flex flex-col overflow-hidden p-0">
      <span
        className={`absolute left-4 top-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-widest text-foreground ${
          event.bookingsOpen ? "bg-white" : "bg-brand-yellow"
        }`}
      >
        {event.bookingsOpen && <span className="size-2 rounded-full bg-success" aria-hidden />}
        {event.bookingsOpen
          ? "BOOKINGS OPEN"
          : event.bookingsOpenAt
            ? `OPENS ${formatDayTime(event.bookingsOpenAt).toUpperCase()}`
            : "BOOKINGS CLOSED"}
      </span>
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.url} alt={cover.alt} className="aspect-[16/9] w-full object-cover" />
      ) : (
        <div className="aspect-[16/9] w-full bg-brand-navy" aria-hidden />
      )}
      <div className="flex flex-1 flex-col gap-3 p-6">
        <h2 className="text-xl leading-snug">{event.title}</h2>
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
          <Link href={`/e/${event.slug}`} className="btn-cta text-sm">
            View passes
          </Link>
        </div>
      </div>
    </article>
  );
}
