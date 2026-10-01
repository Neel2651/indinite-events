"use client";

import { useEffect, useRef } from "react";
import { eventPricingAction, recordPaymentAction, type State } from "@/app/admin/finance/[eventId]/actions";
import { FormError, inputClass } from "./ui";
import { useFormAction } from "@/lib/use-form-action";

function Ok({ state }: { state: State }) {
  if (!state?.ok) return null;
  return (
    <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
      {state.ok}
    </p>
  );
}

export function RecordPaymentForm({ eventId, outstandingPounds }: { eventId: string; outstandingPounds: string }) {
  const [state, action, pending] = useFormAction(recordPaymentAction.bind(null, eventId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} onSubmit={action} className="space-y-3">
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

export function EventPricingForm({ eventId, commission, tax, organiserRate, compsIssued }: { eventId: string; commission: string; tax: string; organiserRate: string; compsIssued: number }) {
  const [state, action, pending] = useFormAction(eventPricingAction.bind(null, eventId), null);
  return (
    <form onSubmit={action} className="space-y-3">
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
      <p className="text-xs text-muted-foreground">
        Complimentary passes: {compsIssued} issued so far. The organiser owes the platform fee on each one&apos;s normal price (no free allowance, no limit).
      </p>
      <FormError message={state?.error} />
      <Ok state={state} />
      <button type="submit" disabled={pending} className="rounded-full border border-border px-5 py-2.5 font-semibold disabled:opacity-60">
        {pending ? "Saving…" : "Save rates"}
      </button>
    </form>
  );
}
