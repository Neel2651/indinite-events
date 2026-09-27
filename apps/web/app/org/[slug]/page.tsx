import type { Metadata } from "next";
import { Types } from "mongoose";
import { Event, Order, Ticket } from "@indinite/db";
import { PageHeader, StatCard } from "@/components/staff/shell";
import { formatDateRange, price } from "@/lib/format";
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

  return (
    <>
      <PageHeader title="Dashboard" description={`Everything for ${organizer.name}.`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Passes sold" value={passes} />
        {canSeeMoney && <StatCard label="Paid orders" value={totals.count} />}
        {canSeeMoney && <StatCard label="Ticket sales" value={price(totals.total)} hint="Before refunds and Indinite commission" />}
      </div>

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
