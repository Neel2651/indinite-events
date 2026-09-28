import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Event, gateStats } from "@indinite/db";
import { AutoRefresh } from "@/components/staff/auto-refresh";
import { PageHeader } from "@/components/staff/shell";
import { formatDay, formatTime } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Check-ins" };

export default async function CheckinsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { organizer, can } = await requireOrg((await params).slug);
  if (!can("reports.read") && !can("scan.perform")) notFound();
  const events = await Event.find({ organizerId: new Types.ObjectId(organizer.id), deletedAt: null, status: "published" }).sort({ startsAt: 1 }).lean();
  const stats = await Promise.all(events.map(async (e) => ({ event: e, nights: (await gateStats(String(e._id))) ?? [] })));

  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader title="Check-ins" description="Live entries per night and gate. Updates every 15 seconds." />
      {stats.length === 0 && <p className="text-muted-foreground">No published events.</p>}
      {stats.map(({ event, nights }) => (
        <section key={String(event._id)} className="mb-8 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl">{event.title}</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <a href={`/org/${organizer.slug}/events/${String(event._id)}/print`} className="font-semibold text-brand-orange-strong hover:underline">
                Printable gate list
              </a>
              {can("reports.read") && (
                <>
                  <a href={`/org/${organizer.slug}/export/checkins?event=${String(event._id)}`} className="font-semibold text-brand-orange-strong hover:underline">
                    Download check-ins (CSV)
                  </a>
                  <a href={`/org/${organizer.slug}/export/attendees?event=${String(event._id)}`} className="font-semibold text-brand-orange-strong hover:underline">
                    Download attendees (CSV)
                  </a>
                </>
              )}
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Night</th>
                  <th className="py-2 pr-4 font-semibold">In</th>
                  <th className="py-2 pr-4 font-semibold">Gates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {nights.map((n) => {
                  const pct = n.expected ? Math.round((n.admitted / n.expected) * 100) : 0;
                  return (
                    <tr key={n.sessionId} className="align-top">
                      <td className="py-3 pr-4">
                        <span className="font-semibold">{n.label}</span>
                        <span className="block text-xs text-muted-foreground">{formatDay(n.startsAt)}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-display text-lg font-bold">{n.admitted}</span>
                        <span className="text-muted-foreground"> / {n.expected}</span>
                        <div className="mt-1 h-1.5 w-28 rounded-full bg-muted" aria-hidden>
                          <div className="h-1.5 rounded-full bg-brand-orange" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        {n.gates.length === 0 ? (
                          <span className="text-muted-foreground">No scans yet</span>
                        ) : (
                          <ul className="space-y-1">
                            {n.gates.map((g) => (
                              <li key={g.gate}>
                                <span className="font-semibold">{g.gate}</span>: {g.admitted} in
                                {g.manual > 0 && ` (${g.manual} by override)`}
                                {g.refused > 0 && `, ${g.refused} refused`}
                                {g.lastScanAt && <span className="text-muted-foreground"> · last scan {formatTime(g.lastScanAt)}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
