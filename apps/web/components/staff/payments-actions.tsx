"use client";

import { useState, useTransition } from "react";
import { CopyLinkButton } from "./copy-link-button";
import { connectExistingAction, disconnectExistingAction, openDashboardAction, sendSetupEmailAction, startOnboardingAction, type State } from "@/app/org/[slug]/payments/actions";
import { inputClass } from "./ui";

interface Props {
  slug: string;
  status: string;
  /** "standard" = the organiser's own Stripe account is connected. */
  accountType: "express" | "standard" | null;
  canManage: boolean;
  setupUrl: string;
  /** Connecting an existing account is switched on (STRIPE_CONNECT_CLIENT_ID set). */
  connectAvailable: boolean;
}

export function PaymentsActions({ slug, status, accountType, canManage, setupUrl, connectAvailable }: Props) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<State>(null);
  const [reason, setReason] = useState("");
  if (!canManage) return <p className="text-sm text-muted-foreground">Only the organiser&apos;s owner can set up or change payments.</p>;
  const run = (fn: () => Promise<State>) => start(async () => setState((await fn()) ?? null));
  const own = accountType === "standard";
  const choosing = status === "not_started" || status === "disconnected";
  const primary = own ? null : choosing ? "Set up payments with Stripe" : status === "in_progress" ? "Continue setup on Stripe" : status === "restricted" ? "Give Stripe the missing details" : null;
  const offerConnect = connectAvailable && !own && (choosing || status === "in_progress");

  return (
    <div className="space-y-4">
      {choosing && connectAvailable && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Set up payments with Stripe</strong>: a new Stripe account for your ticket sales. Takes about 10 minutes; have your bank details and photo ID ready.
          </li>
          <li>
            <strong className="text-foreground">Connect your existing Stripe account</strong>: if your business already uses Stripe. Sign in to Stripe and approve Indinite. Payments go into that account and show in your usual Stripe dashboard. UK accounts only.
          </li>
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {primary && (
          <button type="button" disabled={pending} onClick={() => run(() => startOnboardingAction(slug))} className="btn-cta disabled:opacity-60">
            {pending ? "Opening Stripe…" : primary}
          </button>
        )}
        {offerConnect && (
          <button type="button" disabled={pending} onClick={() => run(() => connectExistingAction(slug))} className="rounded-full border border-border bg-card px-5 py-3 font-semibold disabled:opacity-60">
            {status === "in_progress" ? "Connect your existing Stripe account instead" : "Connect your existing Stripe account"}
          </button>
        )}
        {own && (
          <button type="button" disabled={pending} onClick={() => run(() => openDashboardAction(slug))} className="btn-cta disabled:opacity-60">
            Open your Stripe dashboard
          </button>
        )}
        {!own && (status === "active" || status === "pending_verification" || status === "restricted") && (
          <button type="button" disabled={pending} onClick={() => run(() => openDashboardAction(slug))} className="rounded-full border border-border bg-card px-5 py-3 font-semibold disabled:opacity-60">
            Update bank details
          </button>
        )}
        {status !== "active" && !own && (
          <button type="button" disabled={pending} onClick={() => run(() => sendSetupEmailAction(slug))} className="rounded-full border border-border bg-card px-5 py-3 font-semibold disabled:opacity-60">
            Email the setup link to the owner
          </button>
        )}
        {status !== "active" && !own && <CopyLinkButton url={setupUrl} />}
      </div>

      {own && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Disconnect your Stripe account</summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Online bookings and payment links stop straight away. Passes already sold keep working. Refunds for card bookings will then have to be made in your own Stripe dashboard.
            </p>
            <label className="block text-sm">
              Reason (recorded in the audit log)
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} placeholder="e.g. Moving to a new Stripe account" />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => confirm("Disconnect your Stripe account? Online bookings stop until payments are set up again.") && run(() => disconnectExistingAction(slug, reason))}
              className="rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-60"
            >
              {pending ? "Disconnecting…" : "Disconnect Stripe"}
            </button>
          </div>
        </details>
      )}
      {state?.error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{state.ok}</p>}
    </div>
  );
}
