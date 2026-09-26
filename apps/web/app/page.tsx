import { EventCard } from "@/components/event-card";
import { getPublishedEvents, type PublicEvent } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let events: PublicEvent[] = [];
  let unavailable = false;
  try {
    events = await getPublishedEvents();
  } catch (e) {
    console.error("Failed to load events", e);
    unavailable = true;
  }

  return (
    <>
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <span className="badge-pill">NAVRATRI 2026 · UK</span>
          <h1 className="mt-6 max-w-3xl text-4xl leading-[1.1] sm:text-6xl">Nine nights of garba. Your pass in your inbox.</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Pick your event, pay securely, and get a QR pass by email to scan at the gate.
          </p>
        </div>
      </section>

      <section className="bg-brand-cream">
        <div className="mx-auto max-w-6xl px-5 py-14">
          {unavailable ? (
            <p className="text-muted-foreground">Events can&apos;t be loaded right now. Please try again in a minute.</p>
          ) : events.length === 0 ? (
            <p className="text-muted-foreground">No events are on sale yet. Check back soon.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              {events.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
