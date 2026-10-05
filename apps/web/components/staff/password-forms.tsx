"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient, retryTracker } from "@/lib/auth-client";
import { FormError, inputClass } from "./ui";
import { PasswordInput } from "./password-input";

export function ForgotPasswordForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const retry = retryTracker();
    const { error } = await authClient.requestPasswordReset({
      email: String(new FormData(e.currentTarget).get("email")),
      redirectTo: "/reset-password",
      fetchOptions: retry.fetchOptions,
    });
    if (error?.status === 429) {
      setError(retry.message());
      setState("idle");
      return;
    }
    // Same message whether or not the account exists.
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div role="status" className="space-y-3">
        <p>If there&apos;s an account for that email, we&apos;ve sent a link to reset the password. It works for 1 hour.</p>
        <Link href="/sign-in" className="font-semibold text-brand-orange-strong hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} method="post" className="space-y-4">
      <label className="block text-sm">
        Email
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={state === "sending"} className="btn-cta w-full disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Email me a reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) return setError("The passwords don't match.");
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setError(error.code === "INVALID_TOKEN" ? "This reset link has expired. Ask for a new one." : (error.message ?? "Couldn't reset your password."));
      setPending(false);
      return;
    }
    router.replace("/sign-in?reset=1");
  }

  return (
    <form onSubmit={onSubmit} method="post" className="space-y-4">
      <label className="block text-sm">
        New password
        <PasswordInput name="password" required minLength={10} autoComplete="new-password" />
        <span className="mt-1 block text-xs text-muted-foreground">At least 10 characters.</span>
      </label>
      <label className="block text-sm">
        Confirm new password
        <PasswordInput name="confirm" required minLength={10} autoComplete="new-password" />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={pending} className="btn-cta w-full disabled:opacity-60">
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
