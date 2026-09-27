"use client";

import { useActionState, useRef, useEffect } from "react";
import { createOrganizerAction, type ActionState } from "@/app/admin/organisers/actions";
import { FormError, inputClass } from "./ui";

export function CreateOrganizerForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createOrganizerAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm">
        Organiser name
        <input name="name" required maxLength={120} className={inputClass} placeholder="e.g. Shree Garba Events Ltd" />
      </label>
      <label className="block text-sm">
        Short name for web addresses
        <input name="slug" required maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={inputClass} placeholder="e.g. shree-garba" />
      </label>
      <label className="block text-sm">
        Contact email
        <input name="contactEmail" type="email" required className={inputClass} />
      </label>
      <label className="block text-sm">
        Owner to invite (optional)
        <input name="ownerEmail" type="email" className={inputClass} placeholder="They'll get an email to set up their account" />
      </label>
      <label className="block text-sm">
        Commission (%)
        <input name="commissionPercent" type="number" required min={0} max={100} step={0.01} defaultValue={6} className={inputClass} />
      </label>
      <label className="block text-sm">
        Order reference prefix
        <input name="orderPrefix" required minLength={2} maxLength={5} pattern="[A-Za-z]{2,5}" defaultValue="NAV" className={`${inputClass} uppercase`} />
      </label>
      <div className="space-y-3 sm:col-span-2">
        <FormError message={state?.error} />
        {state?.ok && (
          <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {state.ok}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-cta disabled:opacity-60">
          {pending ? "Creating…" : "Create organiser"}
        </button>
      </div>
    </form>
  );
}
