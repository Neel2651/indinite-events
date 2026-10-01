"use client";

import { useEffect, useRef, useState } from "react";
import { createOrganizerAction } from "@/app/admin/organisers/actions";
import { DEFAULT_COMMISSION_BPS, slugify, suggestOrderPrefixes } from "@indinite/core";
import { FieldError, FormError, inputClass } from "./ui";
import { useFormAction } from "@/lib/use-form-action";

export function CreateOrganizerForm() {
  const [state, action, pending] = useFormAction(createOrganizerAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [payments, setPayments] = useState(false);
  const [name, setName] = useState("");
  // A new result: clear the name (and its preview) after a successful create, during render rather than in an effect.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state?.ok) setName("");
  }
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  // The web address and order prefix are made from the name on the server (unique, not editable).
  const likelyPrefix = name.trim().length >= 2 ? suggestOrderPrefixes(name)[0] : null;

  return (
    <form ref={formRef} onSubmit={action} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        Organiser name
        <input name="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Shree Garba Events Ltd" />
        <FieldError state={state} name="name" />
        <span className="mt-1 block text-xs text-muted-foreground">
          {likelyPrefix
            ? `Web address /org/${slugify(name) || "…"} and order references like ${likelyPrefix}-7K3F9Q (a different code is used if it's taken). Both are set from the name and can't be changed.`
            : "The web address and order reference code are made from the name."}
        </span>
      </label>
      <label className="block text-sm">
        Contact email
        <input name="contactEmail" type="email" required className={inputClass} />
        <FieldError state={state} name="contactEmail" />
      </label>
      <label className="block text-sm">
        Owner to invite (optional)
        <input name="ownerEmail" type="email" className={inputClass} placeholder="They'll get an email to set up their account" />
        <FieldError state={state} name="ownerEmail" />
      </label>
      <label className="block text-sm">
        Commission (%)
        <input name="commissionPercent" type="number" required min={0} max={100} step={0.01} defaultValue={DEFAULT_COMMISSION_BPS / 100} className={inputClass} />
        <FieldError state={state} name="commissionPercent" />
      </label>
      <fieldset className="space-y-3 rounded-md border border-border p-4 sm:col-span-2">
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" name="addPayments" checked={payments} onChange={(e) => setPayments(e.target.checked)} className="accent-[var(--brand-orange)]" />
          Add payment details now (optional)
        </label>
        <p className="text-xs text-muted-foreground">
          We use these to start their Stripe account. The owner adds bank details and ID on Stripe&apos;s secure page; if you skip this, they can set it up from their Payments page.
        </p>
        {payments && (
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              Business type
              <select name="businessType" defaultValue="company" className={inputClass}>
                <option value="company">Company or charity</option>
                <option value="individual">Individual / sole trader</option>
              </select>
            </label>
            <label className="block text-sm">
              Legal name
              <input name="legalName" maxLength={120} className={inputClass} placeholder="As registered, e.g. Shree Garba Events Ltd" />
              <FieldError state={state} name="legalName" />
            </label>
            <label className="block text-sm">
              Website (optional)
              <input name="website" type="url" className={inputClass} placeholder="https://" />
              <FieldError state={state} name="website" />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="sendSetup" defaultChecked className="accent-[var(--brand-orange)]" />
              Email the owner how to finish setting up payments
            </label>
          </div>
        )}
      </fieldset>
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
