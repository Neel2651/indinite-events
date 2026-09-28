"use client";

import { useActionState, useEffect, useRef } from "react";
import { eventPricingAction, recordPaymentAction, type State } from "@/app/admin/finance/[eventId]/actions";
import { FormError, inputClass } from "./ui";

function Ok({ state }: { state: State }) {
  if (!state?.ok) return null;
  return (
    <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
      {state.ok}
    </p>
  );
}

export function RecordPaymentForm({ eventId, outstandingPounds }: { eventId: string; outstandingPounds: string }) {
  const [state, action, pending] = useActionState<State, FormData>(recordPaymentAction.bind(null, eventId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <label className="block text-sm">
        Amount received (£)
        <input name="amount" inputMode="decimal" required defaultValue={outstandingPounds} className={inputClass} />
      </label>
      <label className="block text-sm">
        Note
        <input name="note" required minLength={3} maxLength={300} placeholder="e.g. BACS ref DG-OCT-01" className={inputClass} />
      </label>
      <FormError message={state?.error} />
      <Ok state={state} />
      <button type="submit" disabled={pending} className="btn-cta w-full disabled:opacity-60">
        {pending ? "Saving…" : "Mark as paid"}
      </button>
    </form>
  );
}

export function EventPricingForm({ eventId, commission, tax, organiserRate, freeComps, compsIssued }: { eventId: string; commission: string; tax: string; organiserRate: string; freeComps: number; compsIssued: number }) {
  const [state, action, pending] = useActionState<State, FormData>(eventPricingAction.bind(null, eventId), null);
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        Platform fee / commission (%)
        <input name="commission" type="number" min={0} max={100} step={0.01} defaultValue={commission} placeholder={`${organiserRate} (organiser's rate)`} className={inputClass} />
        <span className="mt-1 block text-xs text-muted-foreground">Leave empty to use the organiser&apos;s rate ({organiserRate}%).</span>
      </label>
      <label className="block text-sm">
        Tax (%)
        <input name="tax" type="number" min={0} max={100} step={0.01} defaultValue={tax} className={inputClass} />
        <span className="mt-1 block text-xs text-muted-foreground">Charged on tickets + platform fee + charges. 0 if not applicable.</span>
      </label>
      <label className="block text-sm">
        Free complimentary passes
        <input name="freeComps" type="number" min={0} max={10000} step={1} defaultValue={freeComps} className={inputClass} />
        <span className="mt-1 block text-xs text-muted-foreground">
          No commission on this many complimentary passes. After that the organiser owes the platform fee on each pass&apos;s normal price. {compsIssued} issued so far.
        </span>
      </label>
      <FormError message={state?.error} />
      <Ok state={state} />
      <button type="submit" disabled={pending} className="rounded-full border border-border px-5 py-2.5 font-semibold disabled:opacity-60">
        {pending ? "Saving…" : "Save rates"}
      </button>
    </form>
  );
}
