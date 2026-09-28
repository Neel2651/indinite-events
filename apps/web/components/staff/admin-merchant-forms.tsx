"use client";

import { useActionState } from "react";
import { cardFeeAction, salesPausedAction, type ActionState } from "@/app/admin/organisers/actions";
import { FormError, inputClass } from "./ui";

function Ok({ state }: { state: ActionState }) {
  return state?.ok ? <p role="status" className="text-sm text-success">{state.ok}</p> : null;
}

export function SalesPausedForm({ organizerId, paused }: { organizerId: string; paused: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(salesPausedAction.bind(null, organizerId), null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="paused" value={paused ? "false" : "true"} />
      <label className="block text-sm">
        Reason (recorded in the audit log)
        <input name="reason" required minLength={3} maxLength={300} className={inputClass} placeholder={paused ? "e.g. Payout issue resolved" : "e.g. Checking a payout problem"} />
      </label>
      <FormError message={state?.error} />
      <Ok state={state} />
      <button type="submit" disabled={pending} className={paused ? "btn-cta disabled:opacity-60" : "rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-60"}>
        {pending ? "Saving…" : paused ? "Resume online sales" : "Pause online sales"}
      </button>
    </form>
  );
}

export function CardFeeForm({ organizerId, payer, percent, fixed }: { organizerId: string; payer: string; percent: number; fixed: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cardFeeAction.bind(null, organizerId), null);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Who pays Stripe&apos;s card fee?</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="payer" value="platform" defaultChecked={payer !== "organizer"} className="mt-1 accent-[var(--brand-orange)]" />
          <span>
            <strong>Indinite</strong>: comes out of the platform fee
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="payer" value="organizer" defaultChecked={payer === "organizer"} className="mt-1 accent-[var(--brand-orange)]" />
          <span>
            <strong>Organiser</strong>: deducted from their payout
          </span>
        </label>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Card fee (%)
          <input name="percent" type="number" min={0} max={10} step={0.01} defaultValue={percent} className={inputClass} />
        </label>
        <label className="block text-sm">
          Plus fixed (£)
          <input name="fixed" type="number" min={0} max={5} step={0.01} defaultValue={fixed} className={inputClass} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Stripe&apos;s standard UK card rate is 1.5% + 20p. Applies to new card payments.</p>
      <FormError message={state?.error} />
      <Ok state={state} />
      <button type="submit" disabled={pending} className="rounded-full border border-border px-5 py-2.5 font-semibold disabled:opacity-60">
        {pending ? "Saving…" : "Save card fees"}
      </button>
    </form>
  );
}
