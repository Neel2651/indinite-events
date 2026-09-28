import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { londonLocalToUtc } from "@indinite/core";
import { auditActions, listAuditLogs, Organizer } from "@indinite/db";
import { AuditFilters, AuditTable, dayBounds } from "@/components/staff/audit-log";
import { PageHeader } from "@/components/staff/shell";
import { inputClass } from "@/components/staff/ui";

export const metadata: Metadata = { title: "Audit log" };

type Props = { searchParams: Promise<{ action?: string; type?: string; org?: string; from?: string; to?: string; before?: string }> };

export default async function AdminAuditPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { action = "", type = "", org = "", from = "", to = "", before = "" } = sp;
  const organizerId = Types.ObjectId.isValid(org) ? org : undefined;
  const [{ entries, nextCursor }, actions, organisers] = await Promise.all([
    listAuditLogs({ organizerId, action: action || undefined, entityType: type || undefined, before: before || undefined, ...dayBounds(from, to, londonLocalToUtc) }),
    auditActions(),
    Organizer.find({}, { name: 1, slug: 1 }).sort({ name: 1 }).lean(),
  ]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), ...extra }).toString();

  return (
    <>
      <PageHeader title="Audit log" description="Every change across Indinite, newest first. Email addresses and phone numbers are redacted." />
      <form className="mb-2 flex flex-wrap items-end gap-3" role="search" aria-label="Organiser">
        <label className="block text-sm">
          Organiser
          <select name="org" defaultValue={org} className={`${inputClass} w-auto`}>
            <option value="">All organisers and Indinite</option>
            {organisers.map((o) => (
              <option key={String(o._id)} value={String(o._id)}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {action && <input type="hidden" name="action" value={action} />}
        {type && <input type="hidden" name="type" value={type} />}
        <button type="submit" className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold">
          Show
        </button>
      </form>
      <AuditFilters action={action} entityType={type} from={from} to={to} actions={actions} />
      <AuditTable
        entries={entries}
        showOrganiser
        entityHref={(e) => (!Types.ObjectId.isValid(e.entity.id) ? null : e.entity.type === "event" ? `/admin/events/${e.entity.id}` : e.entity.type === "organizer" ? `/admin/organisers/${e.entity.id}` : null)}
      />
      <div className="mt-4 flex gap-4 text-sm">
        {before && (
          <Link href={`/admin/audit?${qs({ before: "" })}`} className="font-semibold text-brand-orange-strong hover:underline">
            Newest
          </Link>
        )}
        {nextCursor && (
          <Link href={`/admin/audit?${qs({ before: nextCursor })}`} className="font-semibold text-brand-orange-strong hover:underline">
            Older entries
          </Link>
        )}
      </div>
    </>
  );
}
