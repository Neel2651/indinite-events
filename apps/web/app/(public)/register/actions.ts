"use server";

import { headers } from "next/headers";
import { ZodError } from "zod";
import { registerOrganizer, MembershipError } from "@indinite/auth";
import { retryAfterText } from "@indinite/core";
import { connectDb, hitRateLimit } from "@indinite/db";
import { auth } from "@/lib/auth";
import { fieldFailure, zodFailure } from "@/lib/form-state";

export type RegisterState = { ok?: string; error?: string; fields?: Record<string, string>; done?: { email: string; callbackURL: string } } | null;

/**
 * Organiser self-registration (1 Oct 2026). Creates the organiser (10% platform fee, no payment details) and its owner,
 * then emails a verification link; they can sign in once they've clicked it.
 */
export async function registerAction(_: RegisterState, form: FormData): Promise<RegisterState> {
  // Honeypot: a hidden field people never fill in. Bots get the normal "check your email" answer, nothing is created.
  if (String(form.get("company_website") ?? "").trim()) return { done: { email: String(form.get("email") ?? ""), callbackURL: "/dashboard" } };

  const input = {
    organisationName: String(form.get("organisationName") ?? ""),
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
    confirm: String(form.get("confirm") ?? ""),
    acceptTerms: form.get("acceptTerms") === "on",
  };
  await connectDb();
  const h = await headers();
  const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const [byIp, byEmail] = await Promise.all([
    hitRateLimit(`register:ip:${ip}`, 5, 60_000),
    hitRateLimit(`register:email:${input.email.trim().toLowerCase()}`, 3, 60_000),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    const resetAt = new Date(Math.max(byIp.allowed ? 0 : byIp.resetAt.getTime(), byEmail.allowed ? 0 : byEmail.resetAt.getTime()));
    return { error: `Too many registrations from here in a short time. ${retryAfterText(resetAt)}` };
  }

  let created: Awaited<ReturnType<typeof registerOrganizer>>;
  try {
    created = await registerOrganizer(auth, input, `register:${Date.now().toString(36)}`);
  } catch (e) {
    if (e instanceof ZodError) return zodFailure(e);
    if (e instanceof MembershipError) return e.field ? fieldFailure(e.field, e.message) : { error: e.message };
    console.error("[register] failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't create your account. Please try again." };
  }

  const callbackURL = `/org/${created.slug}?welcome=1`;
  try {
    await auth.api.sendVerificationEmail({ body: { email: created.email, callbackURL } });
  } catch (e) {
    // The account exists; they can ask for a new link from the sign-in page.
    console.error("[register] verification email failed", e instanceof Error ? e.message : e);
  }
  return { done: { email: created.email, callbackURL } };
}
