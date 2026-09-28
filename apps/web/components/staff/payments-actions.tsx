"use client";

import { useState, useTransition } from "react";
import { openDashboardAction, sendSetupEmailAction, startOnboardingAction, type State } from "@/app/org/[slug]/payments/actions";

export function PaymentsActions({ slug, status, canManage }: { slug: string; status: string; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<State>(null);
  if (!canManage) return <p className="text-sm text-muted-foreground">Only the organiser&apos;s owner can set up or change payments.</p>;
  const run = (fn: () => Promise<State>) => start(async () => setState((await fn()) ?? null));
  const primary =
    status === "not_started" ? "Set up payments with Stripe" : status === "in_progress" ? "Continue setup on Stripe" : status === "restricted" ? "Give Stripe the missing details" : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {primary && (
          <button type="button" disabled={pending} onClick={() => run(() => startOnboardingAction(slug))} className="btn-cta disabled:opacity-60">
            {pending ? "Opening Stripe…" : primary}
          </button>
        )}
        {(status === "active" || status === "pending_verification" || status === "restricted") && (
          <button type="button" disabled={pending} onClick={() => run(() => openDashboardAction(slug))} className="rounded-full border border-border bg-card px-5 py-3 font-semibold disabled:opacity-60">
            Update bank details
          </button>
        )}
        {status !== "active" && (
          <button type="button" disabled={pending} onClick={() => run(() => sendSetupEmailAction(slug))} className="rounded-full border border-border bg-card px-5 py-3 font-semibold disabled:opacity-60">
            Email the setup link to the owner
          </button>
        )}
      </div>
      {state?.error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{state.ok}</p>}
    </div>
  );
}
