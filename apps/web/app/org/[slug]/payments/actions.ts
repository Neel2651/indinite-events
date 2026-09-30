"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appUrl } from "@indinite/auth";
import { connectExistingAccountUrl, disconnectExistingAccount, MerchantError, merchantDashboardLink, sendMerchantSetupEmail, startMerchantOnboarding, StripeNotConfiguredError } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

export type State = { ok?: string; error?: string } | null;

const message = (e: unknown) =>
  e instanceof MerchantError || e instanceof StripeNotConfiguredError ? e.message : "Something went wrong talking to Stripe. Please try again.";

/** Owner or super admin: create the Stripe account if needed and go to Stripe's setup form. */
export async function startOnboardingAction(slug: string): Promise<State> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("stripe.onboard")) return { error: "Only the organiser's owner can set up payments." };
  let url: string;
  try {
    url = (await asStaff(user, () => startMerchantOnboarding(organizer.id, appUrl()), organizer.id)).url;
  } catch (e) {
    console.error("[payments] onboarding failed", e instanceof Error ? e.message : e);
    return { error: message(e) };
  }
  redirect(url);
}

/** Owner or super admin: connect the organiser's existing Stripe account (Stripe asks them to sign in and approve). */
export async function connectExistingAction(slug: string): Promise<State> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("stripe.onboard")) return { error: "Only the organiser's owner can set up payments." };
  let url: string;
  try {
    url = await connectExistingAccountUrl(organizer.id, appUrl(), user.id, "org");
  } catch (e) {
    return { error: message(e) };
  }
  redirect(url);
}

/** Owner or super admin: disconnect their own Stripe account from Indinite (online sales stop). */
export async function disconnectExistingAction(slug: string, reason: string): Promise<State> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("stripe.onboard")) return { error: "Only the organiser's owner can change payments." };
  try {
    await asStaff(user, () => disconnectExistingAccount(organizer.id, reason), organizer.id);
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath(`/org/${slug}/payments`);
  return { ok: "Your Stripe account is disconnected. Online sales are off until you set up payments again." };
}

/** Stripe dashboard: bank details, payouts. */
export async function openDashboardAction(slug: string): Promise<State> {
  const { organizer, can } = await requireOrg(slug);
  if (!can("stripe.onboard")) return { error: "Only the organiser's owner can change bank details." };
  let url: string;
  try {
    url = await merchantDashboardLink(organizer.id);
  } catch (e) {
    return { error: message(e) };
  }
  redirect(url);
}

export async function sendSetupEmailAction(slug: string): Promise<State> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("stripe.onboard")) return { error: "You don't have permission to do that." };
  try {
    const { recipients } = await asStaff(user, () => sendMerchantSetupEmail(organizer.id, appUrl()), organizer.id);
    return { ok: `Setup email sent to ${recipients} ${recipients === 1 ? "person" : "people"}.` };
  } catch (e) {
    return { error: message(e) };
  }
}
