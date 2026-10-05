import type { Metadata } from "next";
import Link from "next/link";
import { Event, Organizer, TicketType } from "@indinite/db";
import { PageHeader } from "@/components/staff/shell";
import { formatDateRange } from "@/lib/format";

export const metadata: Metadata = { title: "Events" };

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-foreground" },
  published: { label: "Published", cls: "bg-success/15 text-success" },
  archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
};

export default async function AdminEventsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  const events = await Event.find({ deletedAt: null }).sort({ startsAt: -1 }).lean();
  const [orgs, totals] = await Promise.all([
    Organizer.find({ _id: { $in: events.map((e) => e.organizerId) } }, { name: 1, slug: 1 }).lean(),
    TicketType.aggregate<{ _id: unknown; sold: number; quota: number; types: number }>([
      { $match: { eventId: { $in: events.map((e) => e._id) } } },
      { $group: { _id: "$eventId", sold: { $sum: "$sold" }, quota: { $sum: { $cond: ["$active", "$quota", 0] } }, types: { $sum: 1 } } },
    ]),
  ]);
  const orgBy = new Map(orgs.map((o) => [String(o._id), o]));
  const totalBy = new Map(totals.map((t) => [String(t._id), t]));

  return (
    <>
      <PageHeader
        title="Events"
        description="Create events, their nights and pass types, and publish them to the public site."
        actions={
          <Link href="/admin/events/new" className="btn-cta">
            New event
          </Link>
        }
      />
      {deleted && (
        <p role="status" className="mb-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          Event deleted.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">Organiser</th>
              <th className="px-4 py-3 font-semibold">Dates</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Sold</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((e) => {
              const t = totalBy.get(String(e._id));
              const st = STATUS[e.status ?? "draft"] ?? STATUS.draft!;
              return (
                <tr key={String(e._id)}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{e.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      /e/{e.slug} · {e.sessions.length} night{e.sessions.length === 1 ? "" : "s"} · {t?.types ?? 0} pass type{t?.types === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{orgBy.get(String(e.organizerId))?.name ?? "—"}</td>
                  <td className="px-4 py-3">{formatDateRange(e.startsAt, e.endsAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                    {e.metaTestEventCode && <span className="ml-1 rounded-full bg-warning/20 px-2.5 py-0.5 text-xs font-semibold">Meta test mode</span>}
                  </td>
                  <td className="px-4 py-3">
                    {t?.sold ?? 0} / {t?.quota ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/events/${String(e._id)}`} className="font-semibold text-brand-orange-strong hover:underline">
                      Manage<span className="sr-only"> {e.title}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                  No events yet. Create the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
