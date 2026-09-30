import Stripe from "stripe";
import type { ChargeType } from "@indinite/core";

/**
 * Every Stripe call goes through this gateway (SPEC §4.8, M4, §4.6). Production uses the real SDK; tests
 * install a fake with setStripeGateway(). Returns null when STRIPE_SECRET_KEY isn't configured, so callers
 * can show "Stripe isn't set up yet" instead of failing.
 */
export interface StripeGateway {
  createExpressAccount(input: {
    organizerId: string;
    /** Changes after a disconnect, so a new account is made rather than Stripe replaying the old one. */
    attempt?: number;
    email: string;
    businessType: "individual" | "company";
    businessName: string;
    website?: string;
  }): Promise<{ id: string }>;
  createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string>;
  createDashboardLink(accountId: string): Promise<string>;
  retrieveAccount(accountId: string): Promise<StripeAccountSnapshot>;
  /** Connect an existing Stripe account (OAuth, Standard): Stripe's page where the organiser signs in and approves Indinite. */
  oauthAuthorizeUrl(input: { state: string; redirectUri: string }): string;
  /** Finish OAuth: the connected account's id. */
  oauthToken(code: string): Promise<{ accountId: string }>;
  /** Disconnect an existing account from Indinite's platform. */
  oauthDeauthorize(accountId: string): Promise<void>;
  createCheckoutSession(input: {
    orderId: string;
    publicId: string;
    description: string;
    customerEmail: string;
    totalPence: number;
    applicationFeePence: number;
    /** The organiser's connected account. */
    accountId: string;
    /** destination: charged on Indinite's account and passed on (Express). direct: charged on the organiser's own account. */
    chargeType: ChargeType;
    expiresAt: Date;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }>;
  // `stripeAccount`: the organiser's account, for payments made directly on it (direct charges); omit otherwise.
  expireCheckoutSession(sessionId: string, stripeAccount?: string): Promise<void>;
  /** Current state of a Checkout Session (cancel and reconciliation). */
  retrieveCheckoutSession(sessionId: string, stripeAccount?: string): Promise<{ id: string; status: "open" | "complete" | "expired"; paymentStatus: string; paymentIntentId: string | null }>;
  /** Every refund on a payment, ours (metadata.source = "indinite") and any made in the Stripe dashboard. */
  listRefunds(paymentIntentId: string, stripeAccount?: string): Promise<{ id: string; amountPence: number; status: string; metadata: Record<string, string> }[]>;
  createRefund(input: {
    paymentIntentId: string;
    amountPence: number;
    /** Direct charge: refund on the organiser's own account (no transfer to reverse). */
    stripeAccount?: string;
    /** Take the refunded amount back from the organiser's balance (destination charge; ignored for direct charges). */
    reverseTransfer: boolean;
    /** Give back Indinite's application fee too (only when the whole booking failed on our side). */
    refundApplicationFee: boolean;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; status: string }>;
  verifyWebhook(payload: string, signature: string): Stripe.Event;
}

/** The fields we keep from a Stripe account. */
export interface StripeAccountSnapshot {
  id: string;
  /** Two-letter country, e.g. "GB". */
  country: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  currentlyDue: string[];
}

export function snapshotAccount(a: Stripe.Account): StripeAccountSnapshot {
  return {
    id: a.id,
    country: a.country ?? null,
    chargesEnabled: !!a.charges_enabled,
    payoutsEnabled: !!a.payouts_enabled,
    detailsSubmitted: !!a.details_submitted,
    disabledReason: a.requirements?.disabled_reason ?? null,
    currentlyDue: a.requirements?.currently_due ?? [],
  };
}

class LiveStripeGateway implements StripeGateway {
  private readonly stripe: Stripe;
  constructor(
    secretKey: string,
    /** Events on Indinite's own account, and (Connect endpoint) events on organisers' connected accounts. */
    private readonly webhookSecrets: string[],
    private readonly connectClientId: string | undefined,
  ) {
    this.stripe = new Stripe(secretKey, { appInfo: { name: "Indinite Events" }, maxNetworkRetries: 2 });
  }

  async createExpressAccount(input: Parameters<StripeGateway["createExpressAccount"]>[0]) {
    const account = await this.stripe.accounts.create(
      {
        type: "express",
        country: "GB",
        default_currency: "gbp",
        email: input.email,
        business_type: input.businessType,
        business_profile: {
          name: input.businessName,
          url: input.website || undefined,
          mcc: "7922", // Theatrical producers and ticket agencies
          product_description: "Event tickets sold through Indinite Events",
        },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { organizerId: input.organizerId },
      },
      // One Stripe account per organiser, even if the request is retried.
      { idempotencyKey: `acct-create-${input.organizerId}${input.attempt ? `-${input.attempt}` : ""}` },
    );
    return { id: account.id };
  }

  async createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string) {
    const link = await this.stripe.accountLinks.create({ account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" });
    return link.url;
  }

  async createDashboardLink(accountId: string) {
    return (await this.stripe.accounts.createLoginLink(accountId)).url;
  }

  async retrieveAccount(accountId: string) {
    return snapshotAccount(await this.stripe.accounts.retrieve(accountId));
  }

  oauthAuthorizeUrl(input: { state: string; redirectUri: string }) {
    return this.stripe.oauth.authorizeUrl({
      response_type: "code",
      client_id: this.clientId(),
      scope: "read_write",
      state: input.state,
      redirect_uri: input.redirectUri,
      // This is for organisers who already have Stripe: open on "Sign in", not Stripe's sign-up form (the default
      // for read_write), and always ask which account, so someone with several accounts can pick the right one.
      stripe_landing: "login",
      always_prompt: true,
    });
  }

  async oauthToken(code: string) {
    const res = await this.stripe.oauth.token({ grant_type: "authorization_code", code });
    if (!res.stripe_user_id) throw new Error("Stripe didn't return a connected account");
    return { accountId: res.stripe_user_id };
  }

  async oauthDeauthorize(accountId: string) {
    await this.stripe.oauth.deauthorize({ client_id: this.clientId(), stripe_user_id: accountId });
  }

  private clientId() {
    if (!this.connectClientId) throw new Error("STRIPE_CONNECT_CLIENT_ID is not set");
    return this.connectClientId;
  }

  async createCheckoutSession(input: Parameters<StripeGateway["createCheckoutSession"]>[0]) {
    const direct = input.chargeType === "direct";
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: input.customerEmail,
        client_reference_id: input.orderId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: input.totalPence,
              product_data: { name: `Booking ${input.publicId}`, description: input.description.slice(0, 500) },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: input.applicationFeePence,
          // Direct: the payment is made on the organiser's own account (Stripe-Account header below).
          ...(direct ? {} : { transfer_data: { destination: input.accountId } }),
          metadata: { orderId: input.orderId, publicId: input.publicId },
          description: `Indinite Events ${input.publicId}`,
        },
        metadata: { orderId: input.orderId, publicId: input.publicId },
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: `checkout-${input.orderId}-${Math.floor(input.expiresAt.getTime() / 1000)}`, ...(direct ? { stripeAccount: input.accountId } : {}) },
    );
    if (!session.url) throw new Error("Stripe didn't return a checkout URL");
    return { id: session.id, url: session.url };
  }

  async expireCheckoutSession(sessionId: string, stripeAccount?: string) {
    await this.stripe.checkout.sessions.expire(sessionId, {}, on(stripeAccount)).catch(() => {});
  }

  async retrieveCheckoutSession(sessionId: string, stripeAccount?: string) {
    const s = await this.stripe.checkout.sessions.retrieve(sessionId, {}, on(stripeAccount));
    const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
    return { id: s.id, status: (s.status ?? "open") as "open" | "complete" | "expired", paymentStatus: s.payment_status, paymentIntentId: pi };
  }

  async listRefunds(paymentIntentId: string, stripeAccount?: string) {
    const out: { id: string; amountPence: number; status: string; metadata: Record<string, string> }[] = [];
    for await (const r of this.stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 }, on(stripeAccount))) {
      out.push({ id: r.id, amountPence: r.amount, status: r.status ?? "pending", metadata: (r.metadata ?? {}) as Record<string, string> });
    }
    return out;
  }

  async createRefund(input: Parameters<StripeGateway["createRefund"]>[0]) {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountPence,
        // There's no transfer to reverse when the payment was made on the organiser's own account.
        ...(input.stripeAccount ? {} : { reverse_transfer: input.reverseTransfer }),
        refund_application_fee: input.refundApplicationFee,
        // Marks refunds made by Indinite, so charge.refunded can tell them from Stripe dashboard refunds.
        metadata: { ...input.metadata, source: "indinite" },
      },
      { idempotencyKey: input.idempotencyKey, ...on(input.stripeAccount) },
    );
    return { id: refund.id, status: refund.status ?? "pending" };
  }

  /** Tries each endpoint's signing secret: the platform endpoint, then the Connect endpoint. */
  verifyWebhook(payload: string, signature: string) {
    if (!this.webhookSecrets.length) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    let error: unknown;
    for (const secret of this.webhookSecrets) {
      try {
        return this.stripe.webhooks.constructEvent(payload, signature, secret);
      } catch (e) {
        error = e;
      }
    }
    throw error;
  }
}

/** Request options for a call on an organiser's own account (direct charges). */
const on = (stripeAccount?: string) => (stripeAccount ? { stripeAccount } : {});

const g = globalThis as unknown as { __stripeGateway?: StripeGateway | null };

/** True when a usable (non-placeholder) Stripe secret key is configured. */
export function stripeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const key = env.STRIPE_SECRET_KEY ?? "";
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}/.test(key);
}

export function stripeGateway(): StripeGateway | null {
  if (g.__stripeGateway !== undefined) return g.__stripeGateway;
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].map((v) => v?.trim()).filter((v): v is string => !!v);
  g.__stripeGateway = stripeConfigured() ? new LiveStripeGateway(process.env.STRIPE_SECRET_KEY!, secrets, process.env.STRIPE_CONNECT_CLIENT_ID?.trim() || undefined) : null;
  return g.__stripeGateway;
}

/** "Connect your existing Stripe account" needs the platform's Connect client id (Stripe → Connect → Settings → OAuth). */
export function stripeConnectConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return stripeConfigured(env) && /^ca_[A-Za-z0-9]{10,}/.test(env.STRIPE_CONNECT_CLIENT_ID?.trim() ?? "");
}

/** Tests only: install a fake gateway (or null to simulate "not configured"). */
export function setStripeGateway(gateway: StripeGateway | null | undefined) {
  g.__stripeGateway = gateway;
}

export class StripeNotConfiguredError extends Error {
  readonly status = 503;
  constructor() {
    super("Stripe isn't set up yet. Add STRIPE_SECRET_KEY to the server settings.");
  }
}

/**
 * What to tell staff when a Stripe call fails. Stripe's own explanation for setup problems (e.g. "complete your
 * platform profile", "sign up for Connect", a bad key) instead of a generic message; keys are never shown.
 */
export function stripeErrorMessage(e: unknown, fallback = "Something went wrong talking to Stripe. Please try again."): string {
  if (e instanceof Stripe.errors.StripeError && ["invalid_request_error", "authentication_error", "permission_error", "StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError"].includes(e.type)) {
    return `Stripe said: ${e.message.replace(/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9*]+/g, "[API key]")}`;
  }
  return fallback;
}

export function requireStripe(): StripeGateway {
  const gw = stripeGateway();
  if (!gw) throw new StripeNotConfiguredError();
  return gw;
}

export type { Stripe };
