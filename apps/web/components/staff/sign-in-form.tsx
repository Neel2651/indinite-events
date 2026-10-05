"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient, retryTracker } from "@/lib/auth-client";
import { FormError, inputClass } from "./ui";
import { PasswordInput } from "./password-input";

/** Only allow same-site relative redirects after sign-in. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");

export function SignInForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Self-registered organisers who haven't clicked the verification link yet (1 Oct 2026).
  const [unverified, setUnverified] = useState<string | null>(null);
  const [resend, setResend] = useState<{ ok?: string; error?: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    setPending(true);
    setError(null);
    setUnverified(null);
    setResend(null);
    const retry = retryTracker();
    const { error } = await authClient.signIn.email({ email, password: String(form.get("password")), fetchOptions: retry.fetchOptions });
    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") setUnverified(email);
      else setError(error.status === 429 ? retry.message() : "That email and password don't match.");
      setPending(false);
      return;
    }
    router.replace(safeNext(next));
    router.refresh();
  }

  async function resendLink() {
    if (!unverified) return;
    setResend(null);
    const retry = retryTracker();
    const { error } = await authClient.sendVerificationEmail({ email: unverified, callbackURL: "/dashboard?welcome=1", fetchOptions: retry.fetchOptions });
    setResend(error ? { error: error.status === 429 ? retry.message() : "Couldn't send the email. Please try again." } : { ok: `We've sent a new link to ${unverified}. Check your spam or junk folder if it isn't in your inbox.` });
  }

  return (
    <form onSubmit={onSubmit} method="post" className="space-y-4">
      <label className="block text-sm">
        Email
        <input name="email" type="email" required autoComplete="username" className={inputClass} />
      </label>
      <label className="block text-sm">
        Password
        <PasswordInput name="password" required autoComplete="current-password" />
      </label>
      <FormError message={error} />
      {unverified && (
        <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-3 text-sm">
          <p>
            <strong>Verify your email to sign in.</strong> Click the link we emailed to {unverified}. It can take a minute to arrive; check your spam or junk folder too.
          </p>
          <button type="button" onClick={resendLink} className="rounded-full border border-border bg-card px-4 py-2 font-semibold">
            Resend verification email
          </button>
          {resend?.ok && <p role="status" className="text-success">{resend.ok}</p>}
          {resend?.error && <p className="text-destructive">{resend.error}</p>}
        </div>
      )}
      <button type="submit" disabled={pending} className="btn-cta w-full disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="font-semibold text-brand-orange-strong hover:underline">
          Forgotten your password?
        </Link>
      </p>
      <p className="border-t border-border pt-4 text-center text-sm text-muted-foreground">
        New organiser?{" "}
        <Link href="/register" className="font-semibold text-brand-orange-strong hover:underline">
          Register your organisation
        </Link>
      </p>
    </form>
  );
}
