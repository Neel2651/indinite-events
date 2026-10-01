import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { londonLocalToUtc } from "@indinite/core";
import { auditActions, listAuditLogs } from "@indinite/db";
import { AuditFilters, AuditTable, dayBounds } from "@/components/staff/audit-log";
import { PageHeader } from "@/components/staff/shell";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Audit log" };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ action?: string; type?: string; from?: string; to?: string; before?: string }> };

/**
 * Owner's view of what their team changed for this organiser (SPEC §2 audit.read). Scoped by the session's organiser,
 * and only their own team's actions (1 Oct 2026): Indinite, system, Stripe and customer entries are for Admin → Audit.
 */
export default async function OrgAuditPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { action = "", type = "", from = "", to = "", before = "" } = sp;
  const { organizer, can } = await requireOrg(slug);
  if (!can("audit.read")) notFound();
  const [{ entries, nextCursor }, actions] = await Promise.all([
    listAuditLogs({ organizerId: organizer.id, teamOnly: true, action: action || undefined, entityType: type || undefined, before: before || undefined, ...dayBounds(from, to, londonLocalToUtc) }),
    auditActions(organizer.id, { teamOnly: true }),
  ]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), ...extra }).toString();

  return (
    <>
      <PageHeader title="Audit log" description="What you and your team changed: bookings, passes, events, coupons, team and settings, newest first." />
      <AuditFilters action={action} entityType={type} from={from} to={to} actions={actions} />
      <AuditTable entries={entries} />
      <div className="mt-4 flex gap-4 text-sm">
        {before && (
          <Link href={`/org/${slug}/audit?${qs({ before: "" })}`} className="font-semibold text-brand-orange-strong hover:underline">
            Newest
          </Link>
        )}
        {nextCursor && (
          <Link href={`/org/${slug}/audit?${qs({ before: nextCursor })}`} className="font-semibold text-brand-orange-strong hover:underline">
            Older entries
          </Link>
        )}
      </div>
    </>
  );
}
