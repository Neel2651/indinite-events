import Link from "next/link";
import type { AuditEntry } from "@indinite/db";
import { formatDayTime } from "@/lib/format";
import { inputClass } from "./ui";

const TYPES: Record<string, string> = {
  order: "Order",
  ticket: "Pass",
  event: "Event",
  ticketType: "Pass type",
  organizer: "Organiser",
  discount: "Coupon",
  member: "Team member",
  scan: "Scan",
  refund: "Refund",
  report: "Export / print",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v instanceof Date) return formatDayTime(v);
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  }
  return String(v);
}

export function AuditFilters({ action, entityType, from, to, actions }: { action: string; entityType: string; from: string; to: string; actions: string[] }) {
  const groups = [...new Set(actions.map((a) => a.split(".")[0]!))];
  return (
    <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
      <label className="block text-sm">
        Action
        <select name="action" defaultValue={action} className={`${inputClass} w-auto`}>
          <option value="">All actions</option>
          {groups.map((g) => (
            <optgroup key={g} label={TYPES[g] ?? g}>
              <option value={`${g}.`}>All {TYPES[g]?.toLowerCase() ?? g} actions</option>
              {actions
                .filter((a) => a.startsWith(`${g}.`))
                .map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        About
        <select name="type" defaultValue={entityType} className={`${inputClass} w-auto`}>
          <option value="">Anything</option>
          {Object.entries(TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        From
        <input type="date" name="from" defaultValue={from} className={`${inputClass} w-auto`} />
      </label>
      <label className="block text-sm">
        To
        <input type="date" name="to" defaultValue={to} className={`${inputClass} w-auto`} />
      </label>
      <button type="submit" className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold">
        Filter
      </button>
    </form>
  );
}

export function AuditTable({ entries, showOrganiser, entityHref }: { entries: AuditEntry[]; showOrganiser?: boolean; entityHref?: (e: AuditEntry) => string | null }) {
  if (entries.length === 0) return <p className="rounded-lg border border-border bg-card px-4 py-6 text-muted-foreground">Nothing matches these filters.</p>;
  return (
    <ol className="divide-y divide-border rounded-lg border border-border bg-card">
      {entries.map((e) => {
        const href = entityHref?.(e) ?? null;
        return (
          <li key={e.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p>
                <span className="font-semibold">{e.action}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {TYPES[e.entity.type] ?? e.entity.type}{" "}
                  {href ? (
                    <Link href={href} className="font-semibold text-brand-orange-strong hover:underline">
                      {e.entity.id.slice(-8)}
                    </Link>
                  ) : (
                    e.entity.id.slice(-8)
                  )}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDayTime(e.at)} · {e.actor.name}
                {showOrganiser && e.organizer ? ` · ${e.organizer.name}` : ""}
              </p>
            </div>
            {e.reason && <p className="mt-1 text-muted-foreground">“{e.reason}”</p>}
            {e.changes.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  {e.changes.length} change{e.changes.length === 1 ? "" : "s"}
                </summary>
                <div className="overflow-x-auto">
                <table className="mt-2 w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 text-left font-semibold">Field</th>
                      <th className="py-1 pr-3 text-left font-semibold">Before</th>
                      <th className="py-1 text-left font-semibold">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.changes.map((c) => (
                      <tr key={c.path} className="align-top">
                        <td className="py-1 pr-3 font-mono">{c.path}</td>
                        <td className="break-all py-1 pr-3">{show(c.before)}</td>
                        <td className="break-all py-1">{show(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** "from"/"to" date inputs (UK calendar days) → query bounds. */
export function dayBounds(from: string, to: string, londonLocalToUtc: (v: string) => Date | null) {
  const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const start = ok(from) ? londonLocalToUtc(`${from}T00:00`) : null;
  let end: Date | null = null;
  if (ok(to)) {
    const next = new Date(`${to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    end = londonLocalToUtc(next.toISOString().slice(0, 16));
  }
  return { ...(start ? { from: start } : {}), ...(end ? { to: end } : {}) };
}
