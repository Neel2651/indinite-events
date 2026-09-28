import type { Metadata } from "next";
import Link from "next/link";
import { merchantStatus, MERCHANT_STATUS_LABELS } from "@indinite/core";
import { Event, Organizer } from "@indinite/db";
import { CommissionCell } from "@/components/staff/commission-cell";
import { CreateOrganizerForm } from "@/components/staff/create-organizer-form";
import { PageHeader } from "@/components/staff/shell";

export const metadata: Metadata = { title: "Organisers" };

export default async function OrganisersPage() {
  const organisers = await Organizer.find().sort({ name: 1 }).lean();
  const eventCounts = await Event.aggregate<{ _id: unknown; n: number }>([
    { $match: { deletedAt: null } },
    { $group: { _id: "$organizerId", n: { $sum: 1 } } },
  ]);
  const eventsBy = new Map(eventCounts.map((e) => [String(e._id), e.n]));

  return (
    <>
      <PageHeader title="Organisers" description="Event organisers selling through Indinite." />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold">Commission</th>
              <th className="px-4 py-3 font-semibold">Events</th>
              <th className="px-4 py-3 font-semibold">Payments</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {organisers.map((o) => (
              <tr key={String(o._id)}>
                <td className="px-4 py-3">
                  <span className="font-semibold">{o.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {o.slug} · {o.orderPrefix}-
                  </span>
                </td>
                <td className="px-4 py-3">{o.contactEmail}</td>
                <td className="px-4 py-3">
                  <CommissionCell organizerId={String(o._id)} percent={o.commissionBps / 100} />
                </td>
                <td className="px-4 py-3">{eventsBy.get(String(o._id)) ?? 0}</td>
                <td className="px-4 py-3">
                  {MERCHANT_STATUS_LABELS[merchantStatus(o)]}
                  {o.onlineSalesPaused && <span className="block text-xs text-warning">Online sales paused</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/organisers/${String(o._id)}`} className="font-semibold text-brand-orange-strong hover:underline">
                    Manage
                  </Link>
                  <span className="text-muted-foreground"> · </span>
                  <Link href={`/org/${o.slug}`} className="font-semibold text-brand-orange-strong hover:underline">
                    Open panel
                  </Link>
                  <span className="text-muted-foreground"> · </span>
                  <Link href={`/org/${o.slug}/members`} className="font-semibold text-brand-orange-strong hover:underline">
                    Team
                  </Link>
                </td>
              </tr>
            ))}
            {organisers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                  No organisers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-10 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl">Create organiser</h2>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          Organisers can&apos;t sign up themselves. Create them here and invite their owner, who can then invite their team.
        </p>
        <CreateOrganizerForm />
      </section>
    </>
  );
}
