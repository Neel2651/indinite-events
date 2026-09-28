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

/** Owner's view of everything that changed for this organiser (SPEC §2 audit.read). Scoped by the session's organiser. */
export default async function OrgAuditPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { action = "", type = "", from = "", to = "", before = "" } = sp;
  const { organizer, can } = await requireOrg(slug);
  if (!can("audit.read")) notFound();
  const [{ entries, nextCursor }, actions] = await Promise.all([
    listAuditLogs({ organizerId: organizer.id, action: action || undefined, entityType: type || undefined, before: before || undefined, ...dayBounds(from, to, londonLocalToUtc) }),
    auditActions(organizer.id),
  ]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), ...extra }).toString();

  return (
    <>
      <PageHeader title="Audit log" description="Every change to your bookings, passes, coupons, team and settings, newest first." />
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
