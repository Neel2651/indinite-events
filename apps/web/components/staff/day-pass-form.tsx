"use client";

import { useActionState, useState, useTransition } from "react";
import { createDayPassAction, deleteDayPassAction, updateDayPassAction, type ActionState } from "@/app/admin/events/actions";
import { FormError, inputClass } from "./ui";

export interface DayPassNightRow {
  sessionId: string;
  label: string;
  /** "Sun 11 Oct · 16:00" */
  when: string;
  selected: boolean;
  /** Pounds, "10.00" */
  price: string;
  quota: number;
  active: boolean;
  /** sold + held: quota can't go below this. */
  committed?: number;
  sold?: number;
}

export interface DayPassValues {
  groupId?: string;
  name: string;
  description: string;
  maxPerOrder: number;
  salesStartAt: string;
  salesEndAt: string;
  sortOrder: number;
  nights: DayPassNightRow[];
}

/**
 * Day pass (30 Sep 2026): one pass per night with its own price and quota, so customers can book several nights
 * in one order. Creates or edits the whole group.
 */
export function DayPassForm({ eventId, initial }: { eventId: string; initial: DayPassValues }) {
  const editing = Boolean(initial.groupId);
  const ids = initial.nights.map((n) => n.sessionId);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    editing ? updateDayPassAction.bind(null, eventId, initial.groupId!, ids) : createDayPassAction.bind(null, eventId, ids),
    null,
  );
  const [rows, setRows] = useState(initial.nights);
  const [allPrice, setAllPrice] = useState("");
  const [allQuota, setAllQuota] = useState("");
  // After "Add day pass" the page remounts this form (keyed by the number of day passes), so it starts empty.
  const set = (i: number, patch: Partial<DayPassNightRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Name
          <input name="name" required maxLength={70} defaultValue={initial.name} className={inputClass} placeholder="e.g. Day pass – adult" />
        </label>
        <label className="block text-sm">
          Most per night per online booking
          <input name="maxPerOrder" type="number" min={1} max={50} required defaultValue={initial.maxPerOrder} className={inputClass} />
        </label>
        <label className="block text-sm sm:col-span-2">
          Description (optional)
          <input name="description" maxLength={500} defaultValue={initial.description} className={inputClass} placeholder="e.g. Entry for one night. Ages 13 and over." />
        </label>
        <label className="block text-sm">
          Online sales start (optional, UK time)
          <input name="salesStartAt" type="datetime-local" defaultValue={initial.salesStartAt} className={inputClass} />
        </label>
        <label className="block text-sm">
          Online sales end (optional, UK time)
          <input name="salesEndAt" type="datetime-local" defaultValue={initial.salesEndAt} className={inputClass} />
          <span className="mt-1 block text-xs text-muted-foreground">Each night also stops selling online when it starts.</span>
        </label>
        <input type="hidden" name="sortOrder" value={initial.sortOrder} />
      </div>

      <fieldset className="rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Nights, prices and quotas</legend>
        <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="block">
            Price for all (£)
            <input value={allPrice} onChange={(e) => setAllPrice(e.target.value)} inputMode="decimal" className={`${inputClass} w-28`} placeholder="10.00" />
          </label>
          <label className="block">
            Quota for all
            <input value={allQuota} onChange={(e) => setAllQuota(e.target.value)} type="number" min={0} className={`${inputClass} w-28`} placeholder="150" />
          </label>
          <button
            type="button"
            onClick={() => setRows((rs) => rs.map((r) => (r.selected ? { ...r, ...(allPrice ? { price: allPrice } : {}), ...(allQuota ? { quota: Math.max(Number(allQuota), r.committed ?? 0) } : {}) } : r)))}
            className="mb-0.5 rounded-full border border-border px-4 py-2 font-semibold"
          >
            Apply to ticked nights
          </button>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.sessionId} className="grid grid-cols-2 items-end gap-2 py-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
              <input type="hidden" name={`label_${r.sessionId}`} value={r.label} />
              <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-1">
                <input type="checkbox" name={`night_${r.sessionId}`} checked={r.selected} onChange={(e) => set(i, { selected: e.target.checked })} className="accent-[var(--brand-orange)]" />
                <span>
                  <span className="font-semibold">{r.label}</span> <span className="text-muted-foreground">· {r.when}</span>
                  {r.sold ? <span className="block text-xs text-muted-foreground">{r.sold} sold</span> : null}
                </span>
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  Price (£)<span className="sr-only"> for {r.label}</span>
                </span>
                <input name={`price_${r.sessionId}`} value={r.price} onChange={(e) => set(i, { price: e.target.value })} disabled={!r.selected} inputMode="decimal" placeholder="£" className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  Quota<span className="sr-only"> for {r.label}</span>
                  {r.committed ? ` (min ${r.committed})` : ""}
                </span>
                <input
                  name={`quota_${r.sessionId}`}
                  type="number"
                  min={r.committed ?? 0}
                  value={r.quota}
                  onChange={(e) => set(i, { quota: Number(e.target.value) })}
                  disabled={!r.selected}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 pb-3 text-xs">
                <input type="checkbox" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} disabled={!r.selected} className="accent-[var(--brand-orange)]" />
                {r.active ? "On sale" : "Off"}
                {!r.active && <input type="hidden" name={`active_${r.sessionId}`} value="off" />}
              </label>
            </li>
          ))}
        </ul>
        {editing && <p className="mt-2 text-xs text-muted-foreground">Unticking a night deletes it if nobody has booked it; otherwise it&apos;s switched off and existing passes keep working.</p>}
      </fieldset>

      <FormError message={state?.error} />
      {state?.ok && (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {state.ok}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="btn-cta disabled:opacity-60">
          {pending ? "Saving…" : editing ? "Save day pass" : "Add day pass"}
        </button>
        {editing && <DeleteDayPass eventId={eventId} groupId={initial.groupId!} name={initial.name} />}
      </div>
    </form>
  );
}

function DeleteDayPass({ eventId, groupId, name }: { eventId: string; groupId: string; name: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => confirm(`Delete “${name}” for every night? Nights with bookings are switched off instead.`) && start(async () => setMsg(await deleteDayPassAction(eventId, groupId)))}
        className="rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete day pass"}
      </button>
      <FormError message={msg?.error} />
      {msg?.ok && <p role="status" className="self-center text-sm text-success">{msg.ok}</p>}
    </>
  );
}
