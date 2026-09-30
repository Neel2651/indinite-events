import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Event, TicketType } from "@indinite/db";
import { PageHeader } from "@/components/staff/shell";
import { formatDateRange } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Events" };

const STATUS: Record<string, string> = { draft: "Draft", published: "Published", archived: "Archived" };

/** Organiser owners manage their own events (1 Oct 2026): drafts, published and archived. */
export default async function OrgEventsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ deleted?: string }> }) {
  const { slug } = await params;
  const { deleted } = await searchParams;
  const { organizer, can } = await requireOrg(slug);
  if (!can("event.update")) notFound();
  const organizerId = new Types.ObjectId(organizer.id);
  const events = await Event.find({ organizerId, deletedAt: null }).sort({ startsAt: 1 }).lean();
  const sold = await TicketType.aggregate<{ _id: Types.ObjectId; sold: number }>([
    { $match: { eventId: { $in: events.map((e) => e._id) } } },
    { $group: { _id: "$eventId", sold: { $sum: "$sold" } } },
  ]);
  const soldBy = new Map(sold.map((s) => [String(s._id), s.sold]));

  return (
    <>
      <PageHeader
        title="Events"
        description="Create and edit your events, pass types and images, and publish them."
        actions={
          can("event.create") ? (
            <Link href={`/org/${organizer.slug}/events/new`} className="btn-cta">
              Create event
            </Link>
          ) : undefined
        }
      />
      {deleted && (
        <p role="status" className="mb-6 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          Event deleted.
        </p>
      )}
      <section className="rounded-lg border border-border bg-card">
        {events.length === 0 ? (
          <p className="p-6 text-muted-foreground">No events yet. Create your first event, add passes and images, then publish it.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={String(e._id)}>
                <Link href={`/org/${organizer.slug}/events/${String(e._id)}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 hover:bg-muted/50">
                  <span>
                    <span className="font-semibold">{e.title}</span>
                    <span className="block text-sm text-muted-foreground">
                      {formatDateRange(e.startsAt, e.endsAt)} · {e.sessions.length} night{e.sessions.length === 1 ? "" : "s"} · {soldBy.get(String(e._id)) ?? 0} passes sold
                    </span>
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${e.status === "published" ? "bg-success/15 text-success" : "bg-muted"}`}>{STATUS[e.status ?? "draft"]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
