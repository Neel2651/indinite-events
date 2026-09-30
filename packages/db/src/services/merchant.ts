import mongoose, { Types } from "mongoose";
import { cardFeeOf, cardFeePayersFor, DEFAULT_CARD_FEE, merchantStatus, type CardFeeSettings, type MerchantStatus } from "@indinite/core";
import { linkSecret, signOrderLink, verifyOrderLink } from "@indinite/core/links";
import { audited } from "../audit";
import { enqueueSendAuthEmail } from "../jobs";
import { Order } from "../models/order";
import { Organizer } from "../models/organizer";
import { requireStripe, stripeConnectConfigured, type StripeAccountSnapshot } from "../stripe";
import { withTransaction } from "../transaction";

/**
 * Organiser merchant onboarding (SPEC §4.8). Two ways: a new Stripe Express account created by Indinite, or the
 * organiser's existing Stripe account connected through OAuth (Standard, paid by direct charges). Callers check
 * `stripe.onboard` (organiser owner or super admin) or `finance.manage` (super admin settings) first.
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

/**
 * Shareable setup link for an organiser's owner: their Payments page, which asks them to sign in first and then
 * opens a fresh Stripe form (Stripe's own links are single-use and expire in minutes, so they can't be shared).
 */
export const merchantSetupUrl = (appUrl: string, slug: string) => `${paymentsPageUrl(appUrl, slug)}?setup=1`;

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
 * The owner (Payments page) or a super admin (admin organiser page, `returnPath`) can fill it in.
 */
export async function startMerchantOnboarding(organizerId: string, appUrl: string, opts: { returnPath?: string } = {}): Promise<{ url: string; created: boolean }> {
  const gw = requireStripe();
  const org = await Organizer.findById(organizerId).lean();
  if (!org) throw new MerchantError("Organiser not found.", 404);
  if (org.stripeAccountId && org.stripeAccountType === "standard") throw new MerchantError("Your own Stripe account is connected. Manage it in your Stripe dashboard.", 409);
  let accountId = org.stripeAccountId ?? null;
  let created = false;
  if (!accountId) {
    const prefill = org.merchantPrefill;
    const account = await gw.createExpressAccount({
      organizerId: String(org._id),
      attempt: org.stripeDisconnectedAt ? org.stripeDisconnectedAt.getTime() : undefined,
      email: org.contactEmail,
      businessType: (prefill?.businessType as "individual" | "company") ?? "company",
      businessName: prefill?.legalName || org.name,
      website: prefill?.website ?? undefined,
    });
    accountId = account.id;
    created = true;
    await withTransaction(async (session) => {
      // Conditional: never overwrite an account created by a concurrent request.
      const res = await Organizer.updateOne(
        { _id: org._id, $or: [{ stripeAccountId: null }, { stripeAccountId: { $exists: false } }] },
        { $set: { stripeAccountId: accountId, stripeAccountType: "express", stripeDisconnectedAt: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, stripeDisabledReason: null, stripeCurrentlyDue: [] } },
        { session },
      );
      if (res.modifiedCount === 1) {
        await audited(session, { action: "merchant.account_created", entity: { type: "organizer", id: org._id }, after: { stripeAccountId: accountId, type: "express" }, organizerId: org._id });
      }
    });
    accountId = (await Organizer.findById(org._id, { stripeAccountId: 1 }).lean())!.stripeAccountId!;
  }
  const page = opts.returnPath ? `${appUrl.replace(/\/+$/, "")}${opts.returnPath}` : paymentsPageUrl(appUrl, org.slug);
  const url = await gw.createOnboardingLink(accountId, `${page}?stripe=refresh`, `${page}?stripe=return`);
  return { url, created };
}

/** Stripe dashboard (bank details, payouts): the Express dashboard, or the organiser's own Stripe dashboard. */
export async function merchantDashboardLink(organizerId: string): Promise<string> {
  const gw = requireStripe();
  const org = await Organizer.findById(organizerId, { stripeAccountId: 1, stripeAccountType: 1, detailsSubmitted: 1 }).lean();
  if (!org?.stripeAccountId) throw new MerchantError("Payments aren't set up yet.", 409);
  if (org.stripeAccountType === "standard") return "https://dashboard.stripe.com/";
  if (!org.detailsSubmitted) throw new MerchantError("Finish Stripe setup first.", 409);
  return gw.createDashboardLink(org.stripeAccountId);
}

/** Email the owner(s) a link to the Payments page (Stripe's own links expire within minutes). */
export async function sendMerchantSetupEmail(organizerId: string, appUrl: string, recipients?: string[]) {
  const org = await Organizer.findById(organizerId).lean();
  if (!org) throw new MerchantError("Organiser not found.", 404);
  const to = recipients?.length ? recipients : await ownerEmails(org.authOrgId, org.contactEmail);
  for (const email of to) {
    await enqueueSendAuthEmail({ kind: "merchant-setup", to: email, url: merchantSetupUrl(appUrl, org.slug), organizationName: org.name });
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

/**
 * The account was disconnected from Indinite: by the organiser in Stripe (account.application.deauthorized) or
 * from Indinite (`disconnectExistingAccount`). Online sales stop straight away; passes keep working. The account
 * is cleared (orders keep their own copy) so the organiser can connect again or set up a new Express account.
 */
export async function disconnectMerchantAccount(stripeAccountId: string, reason = "Disconnected in Stripe") {
  const org = await Organizer.findOne({ stripeAccountId }, { _id: 1, stripeAccountType: 1 }).lean();
  if (!org) return;
  await withTransaction(async (session) => {
    const res = await Organizer.updateOne(
      { _id: org._id, stripeAccountId },
      {
        $set: { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, stripeDisabledReason: null, stripeCurrentlyDue: [], stripeDisconnectedAt: new Date(), merchantSyncedAt: new Date() },
        $unset: { stripeAccountId: 1 },
      },
      { session },
    );
    if (res.modifiedCount !== 1) return;
    await audited(session, {
      action: "merchant.disconnected",
      entity: { type: "organizer", id: org._id },
      before: { stripeAccountId, type: org.stripeAccountType ?? "express" },
      reason,
      organizerId: org._id,
    });
  });
}

// ─── The organiser's existing Stripe account (OAuth, Standard, direct charges) ──────────────────────────────

const CONNECT_STATE_TTL_MS = 15 * 60_000;
/** Where the person started: the organiser's Payments page or the admin organiser page (they return there). */
export type ConnectFrom = "org" | "admin";
// The state is signed like a customer link, over a "connect.<from>.<organiser>.<user>" subject (never a real order ref).
const stateSubject = (from: ConnectFrom, organizerId: string, userId: string) => `connect.${from}.${organizerId}.${userId}`;

/** Stripe's OAuth return address (Connect → Settings → OAuth → Redirects must list it). */
export const connectCallbackUrl = (appUrl: string) => `${appUrl.replace(/\/+$/, "")}/api/stripe/connect/callback`;

/** Can this organiser connect an existing account now? Returns why not, or null. */
async function connectBlocked(org: { _id: Types.ObjectId; stripeAccountId?: string | null; stripeAccountType?: string | null }): Promise<string | null> {
  if (!org.stripeAccountId) return null;
  if (org.stripeAccountType === "standard") return "A Stripe account is already connected. Disconnect it first.";
  // An Express account started by Indinite can be swapped only if it never took a payment.
  if (await Order.exists({ organizerId: org._id, "stripe.paymentIntentId": { $exists: true } })) {
    return "Card payments have already been taken with the Stripe account Indinite set up, so it can't be swapped before the event.";
  }
  return null;
}

/** Owner or super admin: Stripe's page where the organiser signs in and approves Indinite. */
export async function connectExistingAccountUrl(organizerId: string, appUrl: string, userId: string, from: ConnectFrom, now = Date.now()): Promise<string> {
  const gw = requireStripe();
  if (!stripeConnectConfigured()) throw new MerchantError("Connecting an existing Stripe account isn't switched on yet. Add STRIPE_CONNECT_CLIENT_ID to the server settings.", 503);
  const org = await Organizer.findById(organizerId, { stripeAccountId: 1, stripeAccountType: 1, contactEmail: 1 }).lean();
  if (!org) throw new MerchantError("Organiser not found.", 404);
  const blocked = await connectBlocked(org);
  if (blocked) throw new MerchantError(blocked, 409);
  const token = signOrderLink(stateSubject(from, organizerId, userId), linkSecret(), now, CONNECT_STATE_TTL_MS);
  return gw.oauthAuthorizeUrl({ state: `${from}.${organizerId}.${userId}.${token}`, redirectUri: connectCallbackUrl(appUrl), email: org.contactEmail });
}

/** Read the OAuth state back: which organiser, started by which user, from where. Throws if forged or expired. */
export function readConnectState(state: string, now = Date.now()): { organizerId: string; userId: string; from: ConnectFrom } {
  const [from, organizerId, userId, ...token] = state.split(".");
  const invalid = new MerchantError("That Stripe link isn't valid. Start again from the Payments page.");
  if ((from !== "org" && from !== "admin") || !organizerId || !userId || token.length !== 2 || !Types.ObjectId.isValid(organizerId)) throw invalid;
  const res = verifyOrderLink(stateSubject(from, organizerId, userId), token.join("."), linkSecret(), now);
  if (!res.ok) throw res.reason === "expired" ? new MerchantError("That took too long. Start again from the Payments page.") : invalid;
  return { organizerId, userId, from };
}

/**
 * Finish connecting (Stripe redirected back with a code). The account must be a UK account and not linked to
 * another organiser. The caller has checked the signed-in user matches `readConnectState(state).userId`.
 */
export async function completeExistingAccountConnect(organizerId: string, code: string, appUrl?: string): Promise<{ status: MerchantStatus }> {
  const gw = requireStripe();
  const org = await Organizer.findById(organizerId).lean();
  if (!org) throw new MerchantError("Organiser not found.", 404);
  const blocked = await connectBlocked(org);
  if (blocked) throw new MerchantError(blocked, 409);

  const { accountId } = await gw.oauthToken(code);
  const account = await gw.retrieveAccount(accountId);
  const refuse = async (message: string) => {
    // Don't leave Indinite connected to an account we won't use.
    await gw.oauthDeauthorize(accountId).catch(() => {});
    throw new MerchantError(message, 409);
  };
  if (account.country !== "GB") await refuse("That Stripe account isn't a UK account. Connect a UK Stripe account, or set up payments with Stripe instead.");
  const other = await Organizer.findOne({ stripeAccountId: accountId, _id: { $ne: org._id } }, { name: 1 }).lean();
  if (other) await refuse("That Stripe account is already connected to another organiser on Indinite.");

  const previous = org.stripeAccountId ?? null;
  // Indinite can't pay the card fee on the organiser's own account (their Stripe rate isn't known).
  const fee = cardFeeOf(org);
  const newFee: CardFeeSettings | null = cardFeePayersFor("standard").includes(fee.payer) ? null : { ...fee, payer: DEFAULT_CARD_FEE.payer };
  await withTransaction(async (session) => {
    const res = await Organizer.updateOne(
      { _id: org._id, ...(previous ? { stripeAccountId: previous } : { $or: [{ stripeAccountId: null }, { stripeAccountId: { $exists: false } }] }) },
      {
        $set: {
          stripeAccountId: accountId,
          stripeAccountType: "standard",
          stripeDisconnectedAt: null,
          chargesEnabled: account.chargesEnabled,
          payoutsEnabled: account.payoutsEnabled,
          detailsSubmitted: account.detailsSubmitted,
          stripeDisabledReason: account.disabledReason,
          stripeCurrentlyDue: account.currentlyDue,
          merchantSyncedAt: new Date(),
          ...(newFee ? { cardFee: newFee } : {}),
        },
      },
      { session },
    );
    if (res.modifiedCount !== 1) throw new MerchantError("Payments for this organiser were just changed by someone else. Refresh and try again.", 409);
    await audited(session, {
      action: "merchant.account_connected",
      entity: { type: "organizer", id: org._id },
      before: { stripeAccountId: previous, type: previous ? (org.stripeAccountType ?? "express") : null },
      after: { stripeAccountId: accountId, type: "standard", chargesEnabled: account.chargesEnabled },
      organizerId: org._id,
    });
    if (newFee) {
      await audited(session, { action: "merchant.card_fee_changed", entity: { type: "organizer", id: org._id }, before: { cardFee: fee }, after: { cardFee: newFee }, reason: "Own Stripe account connected: Indinite can't pay its card fee", organizerId: org._id });
    }
  });
  const status = merchantStatus({ ...org, stripeAccountId: accountId, stripeDisconnectedAt: null, chargesEnabled: account.chargesEnabled, detailsSubmitted: account.detailsSubmitted, stripeDisabledReason: account.disabledReason, stripeCurrentlyDue: account.currentlyDue });
  if (status === "active" && appUrl) {
    for (const email of await ownerEmails(org.authOrgId, org.contactEmail)) {
      await enqueueSendAuthEmail({ kind: "merchant-active", to: email, url: paymentsPageUrl(appUrl, org.slug), organizationName: org.name });
    }
  }
  return { status };
}

/** Owner or super admin: disconnect the organiser's own Stripe account from Indinite. */
export async function disconnectExistingAccount(organizerId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw new MerchantError("Add a reason (it's recorded in the audit log).");
  const org = await Organizer.findById(organizerId, { stripeAccountId: 1, stripeAccountType: 1 }).lean();
  if (!org?.stripeAccountId || org.stripeAccountType !== "standard") throw new MerchantError("No existing Stripe account is connected.", 409);
  const gw = requireStripe();
  // Stripe may already have been told by the organiser (then it reports the app isn't connected): carry on.
  await gw.oauthDeauthorize(org.stripeAccountId).catch((e) => console.warn("[merchant] deauthorize:", e instanceof Error ? e.message : e));
  await disconnectMerchantAccount(org.stripeAccountId, why);
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
  const current = await Organizer.findById(organizerId, { stripeAccountId: 1, stripeAccountType: 1 }).lean();
  const type = current?.stripeAccountId ? current.stripeAccountType : "express";
  if (!cardFeePayersFor(type).includes(fee.payer)) {
    throw new MerchantError(fee.payer === "platform" ? "Indinite can't pay the card fee when the organiser's own Stripe account is connected. Choose the organiser or the customer." : "Choose who pays card fees.");
  }
  if (!Number.isInteger(fee.bps) || fee.bps < 0 || fee.bps > 1000) throw new MerchantError("Card fee % must be between 0 and 10.");
  if (!Number.isInteger(fee.fixedPence) || fee.fixedPence < 0 || fee.fixedPence > 500) throw new MerchantError("Fixed card fee must be between £0 and £5.");
  return withTransaction(async (session) => {
    const org = await Organizer.findById(organizerId, { cardFee: 1 }, { session }).lean();
    if (!org) throw new MerchantError("Organiser not found.", 404);
    await Organizer.updateOne({ _id: organizerId }, { $set: { cardFee: fee } }, { session });
    await audited(session, { action: "merchant.card_fee_changed", entity: { type: "organizer", id: organizerId }, before: { cardFee: org.cardFee ?? null }, after: { cardFee: fee }, organizerId });
  });
}
