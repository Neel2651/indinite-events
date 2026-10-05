"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient, retryTracker } from "@/lib/auth-client";
import { FormError, inputClass } from "./ui";
import { PasswordInput } from "./password-input";

interface Props {
  invitationId: string;
  email: string;
  /** Signed in as the invited email already. */
  signedInAsInvitee: boolean;
  /** Signed in as someone else. */
  signedInAsOther: string | null;
  hasAccount: boolean;
}

export function AcceptInvite({ invitationId, email, signedInAsInvitee, signedInAsOther, hasAccount }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    const { error } = await authClient.organization.acceptInvitation({ invitationId });
    if (error) throw new Error(error.message ?? "Couldn't accept the invitation.");
    router.replace("/dashboard");
    router.refresh();
  }

  async function run(fn: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPending(false);
    }
  }

  if (signedInAsOther) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">
          You&apos;re signed in as {signedInAsOther}. This invitation is for {email}. Sign out, then open the invitation link again.
        </p>
        <button
          type="button"
          className="btn-cta w-full"
          onClick={() =>
            run(async () => {
              await authClient.signOut();
              router.refresh();
              // The same component re-renders with the sign-up form, so clear the busy state.
              setPending(false);
            })
          }
        >
          Sign out
        </button>
        <FormError message={error} />
      </div>
    );
  }

  if (signedInAsInvitee) {
    return (
      <div className="space-y-4">
        <button type="button" disabled={pending} className="btn-cta w-full disabled:opacity-60" onClick={() => run(accept)}>
          {pending ? "Joining…" : "Accept invitation"}
        </button>
        <FormError message={error} />
      </div>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    await run(async () => {
      if (hasAccount) {
        const retry = retryTracker();
        const { error } = await authClient.signIn.email({ email, password, fetchOptions: retry.fetchOptions });
        if (error) throw new Error(error.status === 429 ? retry.message() : "That password isn't right.");
      } else {
        if (password !== String(form.get("confirm"))) throw new Error("The passwords don't match.");
        const { error } = await authClient.signUp.email({ email, password, name: String(form.get("name")).trim() });
        if (error) throw new Error(error.message ?? "Couldn't create your account.");
      }
      await accept();
    });
  }

  return (
    <form onSubmit={onSubmit} method="post" className="space-y-4">
      <label className="block text-sm">
        Email
        <input value={email} readOnly className={`${inputClass} bg-muted`} />
      </label>
      {!hasAccount && (
        <label className="block text-sm">
          Your full name
          <input name="name" required maxLength={120} autoComplete="name" className={inputClass} />
        </label>
      )}
      <label className="block text-sm">
        {hasAccount ? "Password" : "Choose a password"}
        <PasswordInput name="password" required minLength={hasAccount ? 1 : 10} autoComplete={hasAccount ? "current-password" : "new-password"} />
        {!hasAccount && <span className="mt-1 block text-xs text-muted-foreground">At least 10 characters.</span>}
      </label>
      {!hasAccount && (
        <label className="block text-sm">
          Confirm password
          <PasswordInput name="confirm" required minLength={10} autoComplete="new-password" />
        </label>
      )}
      <FormError message={error} />
      <button type="submit" disabled={pending} className="btn-cta w-full disabled:opacity-60">
        {pending ? "Joining…" : hasAccount ? "Sign in and accept" : "Create account and accept"}
      </button>
    </form>
  );
}
