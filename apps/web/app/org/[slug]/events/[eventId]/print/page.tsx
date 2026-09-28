import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Event, gatePrintList, recordExport } from "@indinite/db";
import { PrintButton } from "@/components/staff/print-button";
import { inputClass } from "@/components/staff/ui";
import { formatDay, formatDayTime, formatTime } from "@/lib/format";
import { asStaff, requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Printable gate list", robots: { index: false } };

type Props = { params: Promise<{ slug: string; eventId: string }>; searchParams: Promise<{ night?: string; gates?: string }> };

/** Fallback if phones fail at the gate (M9): valid passes for one night, split alphabetically into gate sheets. */
export default async function PrintListPage({ params, searchParams }: Props) {
  const { slug, eventId } = await params;
  const { night = "", gates = "2" } = await searchParams;
  const { user, organizer, can } = await requireOrg(slug);
  if (!(can("scan.perform") || can("reports.read")) || !Types.ObjectId.isValid(eventId)) notFound();
  const event = await Event.findOne({ _id: eventId, organizerId: new Types.ObjectId(organizer.id), deletedAt: null }, { title: 1, sessions: 1 }).lean();
  if (!event) notFound();
  const gateCount = Math.min(Math.max(Number(gates) || 1, 1), 12);
  const list = night ? await gatePrintList(organizer.id, eventId, night, gateCount) : null;
  if (list) await asStaff(user, () => recordExport({ kind: "print", scope: { organizerId: organizer.id, eventId }, rows: list.total, detail: { night: list.night.label, gates: gateCount } }), organizer.id);
  const printedAt = new Date();

  return (
    <>
      <div className="mb-6 print:hidden">
        <h1 className="text-2xl sm:text-3xl">Printable gate list</h1>
        <p className="mt-1 text-muted-foreground">{event.title}. A paper backup if the scanners can&apos;t be used. Printing it is recorded in the audit log.</p>
        <form className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            Night
            <select name="night" defaultValue={night} required className={`${inputClass} w-auto`}>
              <option value="" disabled>
                Choose a night
              </option>
              {event.sessions.map((s) => (
                <option key={String(s._id)} value={String(s._id)}>
                  {s.label} · {formatDay(s.startsAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Number of gates
            <input type="number" name="gates" min={1} max={12} defaultValue={gateCount} className={`${inputClass} w-24`} />
          </label>
          <button type="submit" className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold">
            Show list
          </button>
          {list && <PrintButton />}
        </form>
        {night && !list && <p className="mt-3 text-sm text-destructive">That night isn&apos;t on this event.</p>}
      </div>

      {list && (
        <div className="space-y-8">
          <p className="text-sm text-muted-foreground print:hidden">
            {list.total} valid {list.total === 1 ? "pass" : "passes"} for {list.night.label}, split into {list.sheets.length} {list.sheets.length === 1 ? "sheet" : "sheets"} by surname.
          </p>
          {list.sheets.map((sheet) => (
            <section key={sheet.gate} className="break-after-page rounded-lg border border-border bg-card p-6 print:rounded-none print:border-0 print:p-0">
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
                <h2 className="text-xl">
                  Gate {sheet.gate}: surnames {sheet.from}–{sheet.to}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {list.event.title} · {list.night.label}, {formatDay(list.night.startsAt)} {formatTime(list.night.startsAt)} · printed {formatDayTime(printedAt)}
                </p>
              </header>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="w-10 py-1.5 font-semibold">
                      <span className="sr-only">Checked in</span>
                    </th>
                    <th className="py-1.5 font-semibold">Name</th>
                    <th className="py-1.5 font-semibold">Pass code</th>
                    <th className="py-1.5 font-semibold">Pass type</th>
                    <th className="py-1.5 font-semibold">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r) => (
                    <tr key={r.code} className="border-b border-border/60 break-inside-avoid">
                      <td className="py-1.5">
                        <span className="inline-block size-4 border border-foreground" aria-hidden />
                      </td>
                      <td className="py-1.5 font-semibold">{r.name}</td>
                      <td className="py-1.5 font-mono">{r.code}</td>
                      <td className="py-1.5">{r.type}</td>
                      <td className="py-1.5">{r.orderRef}</td>
                    </tr>
                  ))}
                  {sheet.rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-3 text-muted-foreground">
                        No passes for this night.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">Tick each pass as it enters. Check the pass code matches. Each pass admits one person per night.</p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
