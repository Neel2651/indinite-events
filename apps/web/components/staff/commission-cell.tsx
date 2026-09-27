"use client";

import { useActionState } from "react";
import { organizerCommissionAction, type ActionState } from "@/app/admin/organisers/actions";

/** Inline edit of an organiser's platform fee / commission %. */
export function CommissionCell({ organizerId, percent }: { organizerId: string; percent: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(organizerCommissionAction.bind(null, organizerId), null);
  return (
    <form action={action} className="flex items-center gap-1">
      <label className="sr-only" htmlFor={`c-${organizerId}`}>
        Commission %
      </label>
      <input id={`c-${organizerId}`} name="commissionPercent" type="number" min={0} max={100} step={0.01} defaultValue={percent} className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm" />
      <span>%</span>
      <button type="submit" disabled={pending} className="ml-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold disabled:opacity-60">
        {pending ? "…" : "Save"}
      </button>
      {state?.ok && <span className="text-xs text-success">Saved</span>}
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
