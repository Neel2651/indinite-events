import mongoose, { Types } from "mongoose";
import { CARD_FEE_PAYERS, merchantStatus, type CardFeeSettings, type MerchantStatus } from "@indinite/core";
import { audited } from "../audit";
import { enqueueSendAuthEmail } from "../jobs";
import { Organizer } from "../models/organizer";
import { requireStripe, type StripeAccountSnapshot } from "../stripe";
import { withTransaction } from "../transaction";

/**
 * Organiser merchant onboarding (Stripe Connect Express, SPEC §4.8). Callers check `stripe.onboard`
 * (organiser owner or super admin) or `finance.manage` (super admin settings) first.
 */

export class MerchantError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400) {
    super(message);
  }
}

export interface MerchantPrefill {
  businessType: "individual" | "company";
  legalName: string;
  website?: string;
}

const paymentsPageUrl = (appUrl: string, slug: string) => `${appUrl.replace(/\/+$/, "")}/org/${slug}/payments`;

/** Owners' emails for an organiser (Better Auth collections), falling back to the contact email. */
async function ownerEmails(authOrgId: string, fallback: string): Promise<string[]> {
  const db = mongoose.connection.db!;
  if (!Types.ObjectId.isValid(authOrgId)) return [fallback];
  const members = await db.collection("member").find({ organizationId: new Types.ObjectId(authOrgId), role: "owner" }, { projection: { userId: 1 } }).toArray();
  if (!members.length) return [fallback];
  const users = await db.collection("user").find({ _id: { $in: members.map((m) => m.userId) } }, { projection: { email: 1 } }).toArray();
  const emails = users.map((u) => String(u.email)).filter(Boolean);
  return emails.length ? emails : [fallback];
}

/** Save the admin's prefill details (optional at organiser creation). */
export async function saveMerchantPrefill(organizerId: string, prefill: MerchantPrefill) {
  return withTransaction(async (session) => {
    const org = await Organizer.findById(organizerId, null, { session }).lean();
    if (!org) throw new MerchantError("Organiser not found.", 404);
    await Organizer.updateOne({ _id: organizerId }, { $set: { merchantPrefill: prefill } }, { session });
    await audited(session, { action: "merchant.prefill_saved", entity: { type: "organizer", id: organizerId }, after: { ...prefill }, organizerId });
  });
}

/**
 * Create the organiser's Stripe Express account if it doesn't exist yet (idempotent per organiser), then
 * return a fresh onboarding link. Stripe hosts the form: bank details and ID never touch Indinite.
 */
export async function startMerchantOnboarding(organizerId: string, appUrl: string): Promise<{ url: string; created: boolean }> {
  const gw = requireStripe();
  const org = await Organizer.findById(organizerId).lean();
  if (!org) throw new MerchantError("Organiser not found.", 404);
  let accountId = org.stripeAccountId ?? null;
  let created = false;
  if (!accountId) {
    const prefill = org.merchantPrefill;
    const account = await gw.createExpressAccount({
      organizerId: String(org._id),
      email: org.contactEmail,
      businessType: (prefill?.businessType as "individual" | "company") ?? "company",
      businessName: prefill?.legalName || org.name,
      website: prefill?.website ?? undefined,
    });
    accountId = account.id;
    created = true;
    await withTransaction(async (session) => {
      // Conditional: never overwrite an account created by a concurrent request.
      const res = await Organizer.updateOne({ _id: org._id, $or: [{ stripeAccountId: null }, { stripeAccountId: { $exists: false } }] }, { $set: { stripeAccountId: accountId } }, { session });
      if (res.modifiedCount === 1) {
        await audited(session, { action: "merchant.account_created", entity: { type: "organizer", id: org._id }, after: { stripeAccountId: accountId }, organizerId: org._id });
      }
    });
    accountId = (await Organizer.findById(org._id, { stripeAccountId: 1 }).lean())!.stripeAccountId!;
  }
  const page = paymentsPageUrl(appUrl, org.slug);
  const url = await gw.createOnboardingLink(accountId, `${page}?stripe=refresh`, `${page}?stripe=return`);
  return { url, created };
}

/** Stripe Express dashboard (bank details, payouts). Only once the account exists. */
export async function merchantDashboardLink(organizerId: string): Promise<string> {
  const gw = requireStripe();
  const org = await Organizer.findById(organizerId, { stripeAccountId: 1, detailsSubmitted: 1 }).lean();
  if (!org?.stripeAccountId) throw new MerchantError("Payments aren't set up yet.", 409);
  if (!org.detailsSubmitted) throw new MerchantError("Finish Stripe setup first.", 409);
  return gw.createDashboardLink(org.stripeAccountId);
}

/** Email the owner(s) a link to the Payments page (Stripe's own links expire within minutes). */
export async function sendMerchantSetupEmail(organizerId: string, appUrl: string, recipients?: string[]) {
  const org = await Organizer.findById(organizerId).lean();
  if (!org) throw new MerchantError("Organiser not found.", 404);
  const to = recipients?.length ? recipients : await ownerEmails(org.authOrgId, org.contactEmail);
  for (const email of to) {
    await enqueueSendAuthEmail({ kind: "merchant-setup", to: email, url: paymentsPageUrl(appUrl, org.slug), organizationName: org.name });
  }
  await withTransaction((session) =>
    audited(session, { action: "merchant.setup_email_sent", entity: { type: "organizer", id: org._id }, metadata: { recipients: to.length }, organizerId: org._id }),
  );
  return { recipients: to.length };
}

/**
 * Apply Stripe's view of the account (webhook account.updated, or the return from onboarding).
 * Audits status changes and emails the owner when card payments become available.
 */
export async function syncMerchantAccount(snapshot: StripeAccountSnapshot, appUrl?: string): Promise<{ status: MerchantStatus; changed: boolean } | null> {
  const org = await Organizer.findOne({ stripeAccountId: snapshot.id }).lean();
  if (!org) return null;
  const before = merchantStatus(org);
  const fields = {
    chargesEnabled: snapshot.chargesEnabled,
    payoutsEnabled: snapshot.payoutsEnabled,
    detailsSubmitted: snapshot.detailsSubmitted,
    stripeDisabledReason: snapshot.disabledReason,
    stripeCurrentlyDue: snapshot.currentlyDue,
    merchantSyncedAt: new Date(),
  };
  const after = merchantStatus({ ...org, ...fields });
  await withTransaction(async (session) => {
    await Organizer.updateOne({ _id: org._id }, { $set: fields }, { session });
    if (before !== after) {
      await audited(session, {
        action: "merchant.status_changed",
        entity: { type: "organizer", id: org._id },
        before: { status: before },
        after: { status: after, chargesEnabled: fields.chargesEnabled, payoutsEnabled: fields.payoutsEnabled },
        organizerId: org._id,
      });
    }
  });
  if (before !== "active" && after === "active" && appUrl) {
    for (const email of await ownerEmails(org.authOrgId, org.contactEmail)) {
      await enqueueSendAuthEmail({ kind: "merchant-active", to: email, url: paymentsPageUrl(appUrl, org.slug), organizationName: org.name });
    }
  }
  return { status: after, changed: before !== after };
}

/** Refresh from Stripe now (e.g. when the owner returns from Stripe's form). */
export async function refreshMerchantAccount(organizerId: string, appUrl?: string) {
  const gw = requireStripe();
  const org = await Organizer.findById(organizerId, { stripeAccountId: 1 }).lean();
  if (!org?.stripeAccountId) return null;
  return syncMerchantAccount(await gw.retrieveAccount(org.stripeAccountId), appUrl);
}

/** The organiser disconnected Indinite in Stripe (account.application.deauthorized). */
export async function disconnectMerchantAccount(stripeAccountId: string) {
  const org = await Organizer.findOne({ stripeAccountId }, { _id: 1 }).lean();
  if (!org) return;
  await withTransaction(async (session) => {
    await Organizer.updateOne(
      { _id: org._id },
      { $set: { chargesEnabled: false, payoutsEnabled: false, stripeDisabledReason: "disconnected", merchantSyncedAt: new Date() } },
      { session },
    );
    await audited(session, { action: "merchant.disconnected", entity: { type: "organizer", id: org._id }, organizerId: org._id });
  });
}

/** Super admin: pause / resume card checkout and payment links for an organiser. */
export async function setOnlineSalesPaused(organizerId: string, paused: boolean, reason: string) {
  return withTransaction(async (session) => {
    const org = await Organizer.findById(organizerId, { onlineSalesPaused: 1 }, { session }).lean();
    if (!org) throw new MerchantError("Organiser not found.", 404);
    await Organizer.updateOne({ _id: organizerId }, { $set: { onlineSalesPaused: paused } }, { session });
    await audited(session, {
      action: paused ? "merchant.sales_paused" : "merchant.sales_resumed",
      entity: { type: "organizer", id: organizerId },
      before: { onlineSalesPaused: !!org.onlineSalesPaused },
      after: { onlineSalesPaused: paused },
      reason,
      organizerId,
    });
  });
}

/** Super admin: who bears Stripe's card fee, and the rate. Applies to new card checkouts. */
export async function setCardFeeSettings(organizerId: string, fee: CardFeeSettings) {
  if (!CARD_FEE_PAYERS.includes(fee.payer)) throw new MerchantError("Choose who pays card fees.");
  if (!Number.isInteger(fee.bps) || fee.bps < 0 || fee.bps > 1000) throw new MerchantError("Card fee % must be between 0 and 10.");
  if (!Number.isInteger(fee.fixedPence) || fee.fixedPence < 0 || fee.fixedPence > 500) throw new MerchantError("Fixed card fee must be between £0 and £5.");
  return withTransaction(async (session) => {
    const org = await Organizer.findById(organizerId, { cardFee: 1 }, { session }).lean();
    if (!org) throw new MerchantError("Organiser not found.", 404);
    await Organizer.updateOne({ _id: organizerId }, { $set: { cardFee: fee } }, { session });
    await audited(session, { action: "merchant.card_fee_changed", entity: { type: "organizer", id: organizerId }, before: { cardFee: org.cardFee ?? null }, after: { cardFee: fee }, organizerId });
  });
}
