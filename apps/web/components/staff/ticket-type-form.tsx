"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createTicketTypeAction, deleteTicketTypeAction, updateTicketTypeAction, type ActionState } from "@/app/admin/events/actions";
import { FieldError, FormError, inputClass } from "./ui";
import { useFormAction } from "@/lib/use-form-action";

export interface TicketTypeValues {
  id?: string;
  name: string;
  description: string;
  /** Pounds, e.g. "12.50". */
  price: string;
  quota: number;
  maxPerOrder: number;
  nights: string[];
  salesStartAt: string;
  salesEndAt: string;
  sortOrder: number;
  active: boolean;
  /** sold + held: the lowest the quota can go. */
  committed?: number;
}

export function TicketTypeForm({ eventId, nights, initial }: { eventId: string; nights: { id: string; label: string }[]; initial?: TicketTypeValues }) {
  const editing = Boolean(initial?.id);
  const [state, action, pending] = useFormAction(
    editing ? updateTicketTypeAction.bind(null, eventId, initial!.id!) : createTicketTypeAction.bind(null, eventId),
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !editing) formRef.current?.reset();
  }, [state, editing]);
  const v = initial;
  const idp = v?.id ?? "new";

  return (
    <form ref={formRef} onSubmit={action} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm">
        Name
        <input name="name" required maxLength={80} defaultValue={v?.name} className={inputClass} placeholder="e.g. Season pass – adult" />
        <FieldError state={state} name="name" />
      </label>
      <label className="block text-sm">
        Price (£)
        <input name="price" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={v?.price} className={inputClass} placeholder="45.00" />
        <FieldError state={state} name="price" />
      </label>
      <label className="block text-sm sm:col-span-2">
        Description (optional)
        <input name="description" maxLength={500} defaultValue={v?.description} className={inputClass} placeholder="e.g. Ages 13 and over" />
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm">Valid for</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {nights.map((n) => (
            <label key={n.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <input type="checkbox" name="nights" value={n.id} defaultChecked={v ? v.nights.includes(n.id) : true} className="accent-[var(--brand-orange)]" />
              {n.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        Quota (total passes)
        <input name="quota" type="number" required min={v?.committed ?? 0} max={100000} defaultValue={v?.quota} className={inputClass} aria-describedby={`quota-help-${idp}`} />
        <FieldError state={state} name="quota" />
        {v?.committed ? (
          <span id={`quota-help-${idp}`} className="mt-1 block text-xs text-muted-foreground">
            {v.committed} already sold or being paid for.
          </span>
        ) : null}
      </label>
      <label className="block text-sm">
        Most per online booking
        <input name="maxPerOrder" type="number" required min={1} max={50} defaultValue={v?.maxPerOrder ?? 10} className={inputClass} />
        <FieldError state={state} name="maxPerOrder" />
      </label>
      <label className="block text-sm">
        Online sales start (optional, UK time)
        <input name="salesStartAt" type="datetime-local" defaultValue={v?.salesStartAt} className={inputClass} />
      </label>
      <label className="block text-sm">
        Online sales end (optional, UK time)
        <input name="salesEndAt" type="datetime-local" defaultValue={v?.salesEndAt} className={inputClass} />
      </label>
      <label className="block text-sm">
        Display order
        <input name="sortOrder" type="number" defaultValue={v?.sortOrder ?? 0} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 self-end pb-3 text-sm">
        <input type="checkbox" name="active" defaultChecked={v?.active ?? true} className="accent-[var(--brand-orange)]" />
        On sale (untick to hide it)
      </label>
      <div className="space-y-3 sm:col-span-2">
        <FormError message={state?.error} />
        {state?.ok && (
          <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {state.ok}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={pending} className="btn-cta disabled:opacity-60">
            {pending ? "Saving…" : editing ? "Save pass type" : "Add pass type"}
          </button>
          {editing && <DeleteTicketType eventId={eventId} ticketTypeId={v!.id!} name={v!.name} />}
        </div>
      </div>
    </form>
  );
}

function DeleteTicketType({ eventId, ticketTypeId, name }: { eventId: string; ticketTypeId: string; name: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete “${name}”? If passes have been sold it will be switched off instead.`)) return;
          start(async () => setMsg(await deleteTicketTypeAction(eventId, ticketTypeId)));
        }}
        className="rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete pass type"}
      </button>
      {msg?.error && <FormError message={msg.error} />}
      {msg?.ok && <p role="status" className="self-center text-sm text-success">{msg.ok}</p>}
    </>
  );
}
