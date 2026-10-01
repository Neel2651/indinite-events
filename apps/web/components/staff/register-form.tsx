"use client";

import Link from "next/link";
import { useState } from "react";
import { slugify, suggestOrderPrefixes } from "@indinite/core";
import { registerAction, type RegisterState } from "@/app/(public)/register/actions";
import { authClient, retryTracker } from "@/lib/auth-client";
import { useFormAction } from "@/lib/use-form-action";
import { PasswordInput } from "./password-input";
import { FieldError, FormError, inputClass } from "./ui";

/** Organiser self-registration (1 Oct 2026). */
export function RegisterForm() {
  const [state, submit, pending] = useFormAction<RegisterState>(registerAction);
  const [organisation, setOrganisation] = useState("");
  const [resend, setResend] = useState<{ ok?: string; error?: string } | null>(null);
  const prefix = organisation.trim().length >= 2 ? suggestOrderPrefixes(organisation)[0] : null;

  if (state?.done) {
    const { email, callbackURL } = state.done;
    const again = async () => {
      setResend(null);
      const retry = retryTracker();
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL, fetchOptions: retry.fetchOptions });
      setResend(error ? { error: error.status === 429 ? retry.message() : "Couldn't send the email. Please try again." } : { ok: "We've sent a new link." });
    };
    return (
      <div role="status" className="space-y-4">
        <p className="rounded-md bg-success/10 px-3 py-3 text-success">
          <strong>Check your email.</strong> We&apos;ve sent a link to <strong>{email}</strong>. Click it to verify your email and sign in.
        </p>
        <p className="text-sm text-muted-foreground">
          It can take a minute to arrive. If you can&apos;t see it, check your spam or junk folder. The link works for 24 hours.
        </p>
        <button type="button" onClick={again} className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold">
          Resend verification email
        </button>
        {resend?.ok && <p className="text-sm text-success">{resend.ok}</p>}
        {resend?.error && <p className="text-sm text-destructive">{resend.error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        Organisation name
        <input name="organisationName" required minLength={2} maxLength={120} autoComplete="organization" value={organisation} onChange={(e) => setOrganisation(e.target.value)} className={inputClass} placeholder="e.g. Shree Garba Events" />
        <FieldError state={state} name="organisationName" />
        {prefix && (
          <span className="mt-1 block text-xs text-muted-foreground">
            Your page will be at /org/{slugify(organisation) || "…"} and order references will look like {prefix}-7K3F9Q (another code is used if that one&apos;s taken).
          </span>
        )}
      </label>
      <label className="block text-sm">
        Your name
        <input name="name" required maxLength={120} autoComplete="name" className={inputClass} />
        <FieldError state={state} name="name" />
      </label>
      <label className="block text-sm">
        Email
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
        <FieldError state={state} name="email" />
        <span className="mt-1 block text-xs text-muted-foreground">You&apos;ll sign in with this, and we&apos;ll send a link to verify it.</span>
      </label>
      <label className="block text-sm">
        Password
        <PasswordInput name="password" required minLength={10} autoComplete="new-password" />
        <FieldError state={state} name="password" />
        <span className="mt-1 block text-xs text-muted-foreground">At least 10 characters.</span>
      </label>
      <label className="block text-sm">
        Confirm password
        <PasswordInput name="confirm" required minLength={10} autoComplete="new-password" />
        <FieldError state={state} name="confirm" />
      </label>
      {/* Honeypot: hidden from people (and screen readers); bots that fill it in get nowhere. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company website
          <input name="company_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-1 accent-[var(--brand-orange)]" />
        <span>
          I agree to the{" "}
          <Link href="/booking-terms" className="font-semibold text-brand-orange-strong hover:underline">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-semibold text-brand-orange-strong hover:underline">
            privacy policy
          </Link>
          . Indinite&apos;s platform fee is 10% on top of your ticket prices, paid by your customers.
        </span>
      </label>
      <FieldError state={state} name="acceptTerms" />
      <FormError message={state?.error} />
      <button type="submit" disabled={pending} className="btn-cta w-full disabled:opacity-60">
        {pending ? "Creating your account…" : "Register and send verification email"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/sign-in" className="font-semibold text-brand-orange-strong hover:underline">
          Organiser login
        </Link>
      </p>
    </form>
  );
}
