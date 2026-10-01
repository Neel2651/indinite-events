"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ORG_ROLES, type OrgRole } from "@indinite/core";
import {
  cancelInvitationAction,
  changeRoleAction,
  inviteAction,
  removeMemberAction,
  type ActionState,
} from "@/app/org/[slug]/members/actions";
import { FormError, inputClass } from "./ui";
import { useFormAction } from "@/lib/use-form-action";

const LABELS: Record<OrgRole, string> = { owner: "Owner", manager: "Manager", box_office: "Box office", scanner: "Scanner", finance: "Finance" };
const HELP: Record<OrgRole, string> = {
  owner: "Everything, including team, refunds and payouts",
  manager: "Bookings, discounts, scanning and reports",
  box_office: "Bookings and payment links, no discounts",
  scanner: "Scanning passes at the gate only",
  finance: "Orders and reports, read only",
};

function Notice({ state }: { state: ActionState }) {
  if (!state) return null;
  return state.error ? (
    <FormError message={state.error} />
  ) : (
    <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
      {state.ok}
    </p>
  );
}

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useFormAction(inviteAction.bind(null, slug), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} onSubmit={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <label className="block text-sm">
          Email address
          <input name="email" type="email" required className={inputClass} />
        </label>
        <label className="block text-sm">
          Role
          <select name="role" defaultValue="box_office" className={inputClass}>
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        {ORG_ROLES.map((r) => (
          <li key={r}>
            <strong className="text-foreground">{LABELS[r]}:</strong> {HELP[r]}
          </li>
        ))}
      </ul>
      <Notice state={state} />
      <button type="submit" disabled={pending} className="btn-cta disabled:opacity-60">
        {pending ? "Sending…" : "Send invitation"}
      </button>
    </form>
  );
}

export function MemberRowActions({ slug, memberId, role, isSelf }: { slug: string; memberId: string; role: OrgRole; isSelf: boolean }) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="sr-only" htmlFor={`role-${memberId}`}>
        Role
      </label>
      <select
        id={`role-${memberId}`}
        defaultValue={role}
        disabled={pending}
        onChange={(e) => start(async () => setState(await changeRoleAction(slug, memberId, e.target.value)))}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      >
        {ORG_ROLES.map((r) => (
          <option key={r} value={r}>
            {LABELS[r]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(isSelf ? "Remove yourself from this team? You'll lose access." : "Remove this person from the team?")) {
            start(async () => setState(await removeMemberAction(slug, memberId)));
          }
        }}
        className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-60"
      >
        Remove
      </button>
      {state?.error && <span className="w-full text-right text-xs text-destructive">{state.error}</span>}
    </div>
  );
}

export function CancelInviteButton({ slug, invitationId }: { slug: string; invitationId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setError((await cancelInvitationAction(slug, invitationId))?.error ?? null))}
        className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-60"
      >
        Cancel invitation
      </button>
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </>
  );
}
