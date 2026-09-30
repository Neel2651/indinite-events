"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOrganizer, createOrganizerSchema, inviteMember, MembershipError } from "@indinite/auth";
import { appUrl } from "@indinite/auth";
import { CARD_FEE_PAYERS } from "@indinite/core";
import { connectExistingAccountUrl, disconnectExistingAccount, MerchantError, merchantDashboardLink, saveMerchantPrefill, sendMerchantSetupEmail, setCardFeeSettings, startMerchantOnboarding, stripeErrorMessage, StripeNotConfiguredError, setOnlineSalesPaused, setOrganizerCommission, SettingsError, updateOrganizer } from "@indinite/db";
import { auth } from "@/lib/auth";
import { asStaff, requireSuperAdmin } from "@/lib/staff";

export type ActionState = { error?: string; ok?: string } | null;

export async function createOrganizerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const commissionPercent = Number(form.get("commissionPercent"));
  const parsed = createOrganizerSchema.safeParse({
    name: form.get("name"),
    slug: String(form.get("slug") ?? "").toLowerCase(),
    contactEmail: form.get("contactEmail"),
    commissionBps: Number.isFinite(commissionPercent) ? Math.round(commissionPercent * 100) : NaN,
    orderPrefix: String(form.get("orderPrefix") ?? "").toUpperCase(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };

  const ownerEmail = String(form.get("ownerEmail") ?? "").trim();
  // Optional payment details (SPEC §4.8): prefill Stripe; bank details + ID are entered by the owner on Stripe.
  const addPayments = form.get("addPayments") === "on";
  const businessType = form.get("businessType") === "individual" ? "individual" : "company";
  const legalName = String(form.get("legalName") ?? "").trim();
  const website = String(form.get("website") ?? "").trim();
  if (addPayments && legalName.length < 2) return { error: "Enter the business's legal name for payments, or untick payment details." };
  if (addPayments && website && !/^https?:\/\/\S+\.\S+/.test(website)) return { error: "Enter the website as a full address, e.g. https://example.com" };
  try {
    const org = await asStaff(user, () => createOrganizer(auth, user, parsed.data));
    if (ownerEmail) await asStaff(user, () => inviteMember(auth, user, org.id, ownerEmail, "owner"), org.id);
    let paymentsNote = "";
    if (addPayments) {
      await asStaff(user, () => saveMerchantPrefill(org.id, { businessType, legalName, website: website || undefined }), org.id);
      if (ownerEmail && form.get("sendSetup") === "on") {
        await asStaff(user, () => sendMerchantSetupEmail(org.id, appUrl(), [ownerEmail]), org.id);
        paymentsNote = " We've emailed them how to set up payments.";
      } else paymentsNote = " Payment details saved.";
    }
    revalidatePath("/admin/organisers");
    return { ok: (ownerEmail ? `Created ${parsed.data.name} and invited ${ownerEmail} as owner.` : `Created ${parsed.data.name}.`) + paymentsNote };
  } catch (e) {
    if (e instanceof MembershipError) return { error: e.message };
    console.error("[admin] create organiser failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't create the organiser. Please try again." };
  }
}

export async function organizerCommissionAction(organizerId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const bps = Math.round(Number(form.get("commissionPercent")) * 100);
  if (!(bps >= 0 && bps <= 10000)) return { error: "Enter a percentage between 0 and 100." };
  try {
    await asStaff(user, () => setOrganizerCommission(organizerId, bps), organizerId);
  } catch (e) {
    return { error: e instanceof SettingsError ? e.message : "Couldn't save." };
  }
  revalidatePath("/admin/organisers");
  return { ok: "Saved" };
}

export async function salesPausedAction(organizerId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const paused = form.get("paused") === "true";
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Add a reason (it's recorded in the audit log)." };
  try {
    await asStaff(user, () => setOnlineSalesPaused(organizerId, paused, reason), organizerId);
  } catch (e) {
    return { error: e instanceof MerchantError ? e.message : "Couldn't save." };
  }
  revalidatePath(`/admin/organisers/${organizerId}`);
  return { ok: paused ? "Online sales paused." : "Online sales resumed." };
}

export async function cardFeeAction(organizerId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const raw = form.get("payer");
  const payer = CARD_FEE_PAYERS.find((p) => p === raw) ?? "platform";
  const bps = Math.round(Number(form.get("percent")) * 100);
  const fixedPence = Math.round(Number(form.get("fixed")) * 100);
  try {
    await asStaff(user, () => setCardFeeSettings(organizerId, { payer, bps, fixedPence }), organizerId);
  } catch (e) {
    return { error: e instanceof MerchantError ? e.message : "Couldn't save." };
  }
  revalidatePath(`/admin/organisers/${organizerId}`);
  return { ok: "Card fee settings saved. They apply to new card payments." };
}

const stripeMessage = (e: unknown) => (e instanceof MerchantError || e instanceof StripeNotConfiguredError ? e.message : stripeErrorMessage(e));

/** Super admin: create the Stripe account if needed and fill in the organiser's bank and business details on Stripe. */
export async function adminStartOnboardingAction(organizerId: string): Promise<ActionState> {
  const user = await requireSuperAdmin();
  let url: string;
  try {
    url = (await asStaff(user, () => startMerchantOnboarding(organizerId, appUrl(), { returnPath: `/admin/organisers/${organizerId}` }), organizerId)).url;
  } catch (e) {
    console.error("[admin payments] onboarding failed", e instanceof Error ? e.message : e);
    return { error: stripeMessage(e) };
  }
  redirect(url);
}

/** Super admin: open the organiser's Stripe Express dashboard (bank details, payouts). */
export async function adminOpenDashboardAction(organizerId: string): Promise<ActionState> {
  await requireSuperAdmin();
  let url: string;
  try {
    url = await merchantDashboardLink(organizerId);
  } catch (e) {
    return { error: stripeMessage(e) };
  }
  redirect(url);
}

/** Super admin: connect the organiser's existing Stripe account (they approve Indinite on Stripe's page). */
export async function adminConnectExistingAction(organizerId: string): Promise<ActionState> {
  const user = await requireSuperAdmin();
  let url: string;
  try {
    url = await connectExistingAccountUrl(organizerId, appUrl(), user.id, "admin");
  } catch (e) {
    return { error: stripeMessage(e) };
  }
  redirect(url);
}

/** Super admin: disconnect the organiser's own Stripe account. Online sales stop until payments are set up again. */
export async function adminDisconnectExistingAction(organizerId: string, reason: string): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => disconnectExistingAccount(organizerId, reason), organizerId);
  } catch (e) {
    return { error: stripeMessage(e) };
  }
  revalidatePath(`/admin/organisers/${organizerId}`);
  return { ok: "Stripe account disconnected. Online sales are off until payments are set up again." };
}

/** Super admin: email the owner(s) a link to finish Stripe setup themselves. */
export async function adminSendSetupEmailAction(organizerId: string): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    const { recipients } = await asStaff(user, () => sendMerchantSetupEmail(organizerId, appUrl()), organizerId);
    return { ok: `Setup email sent to ${recipients} ${recipients === 1 ? "person" : "people"}.` };
  } catch (e) {
    return { error: stripeMessage(e) };
  }
}

/** Super admin: organiser name, contact, order prefix, status (suspend / reactivate) and manager discount limit. */
export async function updateOrganizerAction(organizerId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const maxPercent = Number(String(form.get("maxDiscountPercent") ?? "").trim());
  if (!Number.isFinite(maxPercent) || maxPercent < 0 || maxPercent > 100) return { error: "Enter the managers' discount limit as a percentage between 0 and 100." };
  const status = form.get("status") === "suspended" ? "suspended" : "active";
  try {
    await asStaff(
      user,
      () =>
        updateOrganizer(organizerId, {
          name: String(form.get("name") ?? ""),
          contactEmail: String(form.get("contactEmail") ?? ""),
          orderPrefix: String(form.get("orderPrefix") ?? ""),
          status,
          maxDiscountBpsForManager: Math.round(maxPercent * 100),
        }),
      organizerId,
    );
  } catch (e) {
    if (e instanceof SettingsError) return { error: e.message };
    if (e instanceof Error && "issues" in e) return { error: (e as unknown as { issues: { message: string }[] }).issues[0]?.message ?? "Check the details." };
    return { error: "Couldn't save." };
  }
  revalidatePath(`/admin/organisers/${organizerId}`);
  revalidatePath("/admin/organisers");
  return { ok: status === "suspended" ? "Saved. The organiser is suspended: online sales, payment links and new bookings are stopped." : "Saved." };
}
