"use client";

import { useActionState, useState, useTransition } from "react";
import {
  adminConnectExistingAction,
  adminDisconnectExistingAction,
  adminOpenDashboardAction,
  adminSendSetupEmailAction,
  adminStartOnboardingAction,
  cardFeeAction,
  salesPausedAction,
  updateOrganizerAction,
  type ActionState,
} from "@/app/admin/organisers/actions";
import { CopyLinkButton } from "./copy-link-button";
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

export function CardFeeForm({ organizerId, payer, percent, fixed, ownAccount = false }: { organizerId: string; payer: string; percent: number; fixed: number; ownAccount?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cardFeeAction.bind(null, organizerId), null);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Who pays Stripe&apos;s card fee?</legend>
        {ownAccount ? (
          <p className="text-xs text-muted-foreground">
            The organiser&apos;s own Stripe account is connected, so Stripe takes its fee from that account at their own rate. Indinite can&apos;t pay it; the rate below is only used for a customer card processing fee.
          </p>
        ) : (
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="payer" value="platform" defaultChecked={payer === "platform"} className="mt-1 accent-[var(--brand-orange)]" />
            <span>
              <strong>Indinite</strong>: comes out of the platform fee
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="payer" value="organizer" defaultChecked={payer !== "platform" && payer !== "customer"} className="mt-1 accent-[var(--brand-orange)]" />
          <span>
            <strong>Organiser</strong> (default): {ownAccount ? "Stripe takes it from their account" : "deducted from their payout"}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="payer" value="customer" defaultChecked={payer === "customer"} className="mt-1 accent-[var(--brand-orange)]" />
          <span>
            <strong>Customer</strong>: added to card bookings as a &ldquo;Card processing fee&rdquo;
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

/**
 * Super admin: fill in the organiser's bank and business details on Stripe's form, open their Stripe dashboard,
 * or email the owner to finish it themselves.
 */
export function AdminOnboardingActions({
  organizerId,
  status,
  stripeReady,
  setupUrl,
  accountType,
  connectAvailable,
}: {
  organizerId: string;
  status: string;
  stripeReady: boolean;
  setupUrl: string;
  /** "standard" = the organiser's own Stripe account is connected. */
  accountType: "express" | "standard" | null;
  connectAvailable: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const [reason, setReason] = useState("");
  if (!stripeReady) return <p className="text-sm text-muted-foreground">Stripe isn&apos;t configured on this server yet (STRIPE_SECRET_KEY).</p>;
  const run = (fn: () => Promise<ActionState>) => start(async () => setState((await fn()) ?? null));
  const own = accountType === "standard";
  const choosing = status === "not_started" || status === "disconnected";
  const primary = own
    ? null
    : choosing
      ? "Fill in bank and business details"
      : status === "in_progress"
        ? "Continue bank and business details"
        : status === "restricted"
          ? "Give Stripe the missing details"
          : null;
  if (own) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">The organiser&apos;s own Stripe account is connected. Card payments are made on it (direct charges); Indinite takes its platform fee from each one.</p>
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Disconnect their Stripe account</summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">Online bookings and payment links stop straight away; passes already sold keep working. Card refunds then have to be made in their Stripe dashboard.</p>
            <label className="block text-sm">
              Reason (recorded in the audit log)
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} placeholder="e.g. Organiser asked to switch accounts" />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => confirm("Disconnect this organiser's Stripe account? Their online bookings stop.") && run(() => adminDisconnectExistingAction(organizerId, reason))}
              className="rounded-full border border-destructive px-5 py-2.5 font-semibold text-destructive disabled:opacity-60"
            >
              {pending ? "Disconnecting…" : "Disconnect Stripe"}
            </button>
          </div>
        </details>
        <FormError message={state?.error} />
        <Ok state={state} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {primary && (
          <button type="button" disabled={pending} onClick={() => run(() => adminStartOnboardingAction(organizerId))} className="btn-cta disabled:opacity-60">
            {pending ? "Opening Stripe…" : primary}
          </button>
        )}
        {connectAvailable && (choosing || status === "in_progress") && (
          <button type="button" disabled={pending} onClick={() => run(() => adminConnectExistingAction(organizerId))} className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold disabled:opacity-60">
            Connect their existing Stripe account
          </button>
        )}
        {!choosing && status !== "in_progress" && (
          <button type="button" disabled={pending} onClick={() => run(() => adminOpenDashboardAction(organizerId))} className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold disabled:opacity-60">
            Update bank details
          </button>
        )}
        {status !== "active" && (
          <button type="button" disabled={pending} onClick={() => run(() => adminSendSetupEmailAction(organizerId))} className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold disabled:opacity-60">
            Email the setup link to the owner
          </button>
        )}
        {status !== "active" && <CopyLinkButton url={setupUrl} label="Copy setup link for the owner" className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold" />}
      </div>
      {status !== "active" && <p className="text-xs text-muted-foreground">The copied link opens the organiser&apos;s Payments page. The owner signs in, then continues on Stripe; nobody else can use it.</p>}
      <p className="text-xs text-muted-foreground">
        Bank details are entered on Stripe&apos;s secure form, never stored by Indinite. Stripe may text a code to the organiser&apos;s phone and ask for their photo ID, so have them on hand, or let the owner finish it later.
      </p>
      <FormError message={state?.error} />
      <Ok state={state} />
    </div>
  );
}

export function OrganizerDetailsForm({ organizerId, name, contactEmail, orderPrefix, status, maxDiscountPercent }: { organizerId: string; name: string; contactEmail: string; orderPrefix: string; status: string; maxDiscountPercent: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateOrganizerAction.bind(null, organizerId), null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm">
        Name
        <input name="name" required maxLength={120} defaultValue={name} className={inputClass} />
      </label>
      <label className="block text-sm">
        Contact email
        <input name="contactEmail" type="email" required defaultValue={contactEmail} className={inputClass} />
      </label>
      <label className="block text-sm">
        Order reference prefix
        <input name="orderPrefix" required minLength={2} maxLength={5} pattern="[A-Za-z]{2,5}" defaultValue={orderPrefix} className={`${inputClass} uppercase`} aria-describedby="prefix-help" />
        <span id="prefix-help" className="mt-1 block text-xs text-muted-foreground">New bookings only; existing references don&apos;t change.</span>
      </label>
      <label className="block text-sm">
        Managers can give up to (% off)
        <input name="maxDiscountPercent" type="number" required min={0} max={100} step={0.5} defaultValue={maxDiscountPercent} className={inputClass} aria-describedby="discount-help" />
        <span id="discount-help" className="mt-1 block text-xs text-muted-foreground">Discounts on payment links. Owners have no limit; box office can&apos;t give discounts.</span>
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm">Status</legend>
        <div className="mt-1 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="status" value="active" defaultChecked={status !== "suspended"} className="accent-[var(--brand-orange)]" />
            Active
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="status" value="suspended" defaultChecked={status === "suspended"} className="accent-[var(--brand-orange)]" />
            Suspended: no online sales, payment links or new bookings (existing passes still work)
          </label>
        </div>
      </fieldset>
      <div className="space-y-3 sm:col-span-2">
        <FormError message={state?.error} />
        <Ok state={state} />
        <button type="submit" disabled={pending} className="btn-cta disabled:opacity-60">
          {pending ? "Saving…" : "Save organiser"}
        </button>
      </div>
    </form>
  );
}
