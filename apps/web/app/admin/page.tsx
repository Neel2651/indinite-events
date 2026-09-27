import type { Metadata } from "next";
import { Event, Order, Organizer, Ticket } from "@indinite/db";
import { PageHeader, StatCard } from "@/components/staff/shell";
import { price } from "@/lib/format";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverview() {
  const [organisers, published, paid, tickets] = await Promise.all([
    Organizer.countDocuments({ status: "active" }),
    Event.countDocuments({ status: "published", deletedAt: null }),
    Order.aggregate<{ count: number; total: number; fees: number }>([
      { $match: { status: { $in: ["paid", "partially_refunded"] } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$totalPence" }, fees: { $sum: "$applicationFeePence" } } },
    ]),
    Ticket.countDocuments({ status: "valid" }),
  ]);
  const totals = paid[0] ?? { count: 0, total: 0, fees: 0 };
  return (
    <>
      <PageHeader title="Overview" description="Across all organisers." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Active organisers" value={organisers} />
        <StatCard label="Published events" value={published} />
        <StatCard label="Paid orders" value={totals.count} />
        <StatCard label="Passes issued" value={tickets} />
        <StatCard label="Ticket sales" value={price(totals.total)} />
        <StatCard label="Indinite commission" value={price(totals.fees)} />
      </div>
    </>
  );
}
