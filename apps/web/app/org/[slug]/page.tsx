import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { Event, gateStats, Order, Ticket } from "@indinite/db";
import { InstallAppCard } from "@/components/staff/install-app-card";
import { PageHeader, StatCard } from "@/components/staff/shell";
import { formatDateRange, formatDay, price } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Dashboard" };

export default async function OrgDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { organizer, can } = await requireOrg((await params).slug);
  const organizerId = new Types.ObjectId(organizer.id);
  const canSeeMoney = can("order.read");

  const [events, sales, passes] = await Promise.all([
    Event.find({ organizerId, deletedAt: null }).sort({ startsAt: 1 }).lean(),
    canSeeMoney
      ? Order.aggregate<{ count: number; total: number }>([
          { $match: { organizerId, status: { $in: ["paid", "partially_refunded"] } } },
          { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$totalPence" } } },
        ])
      : Promise.resolve([]),
    Ticket.countDocuments({ organizerId, status: "valid" }),
  ]);
  const totals = sales[0] ?? { count: 0, total: 0 };
  // Check-ins per night for events that haven't finished yet (SPEC M6 dashboard).
  const canSeeCheckins = can("reports.read") || can("scan.perform");
  const now = new Date();
  const live = canSeeCheckins ? events.filter((e) => e.status === "published" && e.endsAt > now) : [];
  const checkins = await Promise.all(live.map(async (e) => ({ event: e, nights: (await gateStats(String(e._id))) ?? [] })));

  return (
    <>
      <PageHeader title="Dashboard" description={`Everything for ${organizer.name}.`} />
      <InstallAppCard />
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatCard label="Passes sold" value={passes} />
        {canSeeMoney && <StatCard label="Paid orders" value={totals.count} />}
        {canSeeMoney && <StatCard label="Ticket sales" value={price(totals.total)} hint="Before refunds and Indinite commission" />}
      </div>

      {checkins.map(({ event, nights }) => (
        <section key={String(event._id)} className="mt-8 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl">Check-ins · {event.title}</h2>
            <Link href={`/org/${organizer.slug}/checkins`} className="text-sm font-semibold text-brand-orange-strong hover:underline">
              Gates and live view
            </Link>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {nights.map((n) => {
              const pct = n.expected ? Math.round((n.admitted / n.expected) * 100) : 0;
              return (
                <li key={n.sessionId} className="rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">{n.label}</p>
                  <p className="text-xs text-muted-foreground">{formatDay(n.startsAt)}</p>
                  <p className="mt-2 font-display text-xl font-bold tabular-nums">
                    {n.admitted}
                    <span className="text-sm font-normal text-muted-foreground"> / {n.expected}</span>
                  </p>
                  <div className="mt-1 h-1.5 rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${n.label}: ${pct}% checked in`}>
                    <div className="h-1.5 rounded-full bg-brand-orange" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl">Events</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-muted-foreground">No events yet. Indinite sets up events for you.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {events.map((e) => (
              <li key={String(e._id)} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="font-semibold">{e.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDateRange(e.startsAt, e.endsAt)} · {e.sessions.length} nights
                  </span>
                </span>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold capitalize">{e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
