import Stripe from "stripe";

/**
 * Every Stripe call goes through this gateway (SPEC §4.8, M4, §4.6). Production uses the real SDK; tests
 * install a fake with setStripeGateway(). Returns null when STRIPE_SECRET_KEY isn't configured, so callers
 * can show "Stripe isn't set up yet" instead of failing.
 */
export interface StripeGateway {
  createExpressAccount(input: {
    organizerId: string;
    email: string;
    businessType: "individual" | "company";
    businessName: string;
    website?: string;
  }): Promise<{ id: string }>;
  createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string>;
  createDashboardLink(accountId: string): Promise<string>;
  retrieveAccount(accountId: string): Promise<StripeAccountSnapshot>;
  createCheckoutSession(input: {
    orderId: string;
    publicId: string;
    description: string;
    customerEmail: string;
    totalPence: number;
    applicationFeePence: number;
    destinationAccountId: string;
    expiresAt: Date;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }>;
  expireCheckoutSession(sessionId: string): Promise<void>;
  /** Current state of a Checkout Session (cancel and reconciliation). */
  retrieveCheckoutSession(sessionId: string): Promise<{ id: string; status: "open" | "complete" | "expired"; paymentStatus: string; paymentIntentId: string | null }>;
  /** Every refund on a payment, ours (metadata.source = "indinite") and any made in the Stripe dashboard. */
  listRefunds(paymentIntentId: string): Promise<{ id: string; amountPence: number; status: string; metadata: Record<string, string> }[]>;
  createRefund(input: {
    paymentIntentId: string;
    amountPence: number;
    /** Take the refunded amount back from the organiser's balance (destination charge). */
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
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  currentlyDue: string[];
}

export function snapshotAccount(a: Stripe.Account): StripeAccountSnapshot {
  return {
    id: a.id,
    chargesEnabled: !!a.charges_enabled,
    payoutsEnabled: !!a.payouts_enabled,
    detailsSubmitted: !!a.details_submitted,
    disabledReason: a.requirements?.disabled_reason ?? null,
    currentlyDue: a.requirements?.currently_due ?? [],
  };
}

class LiveStripeGateway implements StripeGateway {
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string | undefined) {
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
      { idempotencyKey: `acct-create-${input.organizerId}` },
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

  async createCheckoutSession(input: Parameters<StripeGateway["createCheckoutSession"]>[0]) {
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
          transfer_data: { destination: input.destinationAccountId },
          metadata: { orderId: input.orderId, publicId: input.publicId },
          description: `Indinite Events ${input.publicId}`,
        },
        metadata: { orderId: input.orderId, publicId: input.publicId },
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: `checkout-${input.orderId}-${Math.floor(input.expiresAt.getTime() / 1000)}` },
    );
    if (!session.url) throw new Error("Stripe didn't return a checkout URL");
    return { id: session.id, url: session.url };
  }

  async expireCheckoutSession(sessionId: string) {
    await this.stripe.checkout.sessions.expire(sessionId).catch(() => {});
  }

  async retrieveCheckoutSession(sessionId: string) {
    const s = await this.stripe.checkout.sessions.retrieve(sessionId);
    const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
    return { id: s.id, status: (s.status ?? "open") as "open" | "complete" | "expired", paymentStatus: s.payment_status, paymentIntentId: pi };
  }

  async listRefunds(paymentIntentId: string) {
    const out: { id: string; amountPence: number; status: string; metadata: Record<string, string> }[] = [];
    for await (const r of this.stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })) {
      out.push({ id: r.id, amountPence: r.amount, status: r.status ?? "pending", metadata: (r.metadata ?? {}) as Record<string, string> });
    }
    return out;
  }

  async createRefund(input: Parameters<StripeGateway["createRefund"]>[0]) {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountPence,
        reverse_transfer: input.reverseTransfer,
        refund_application_fee: input.refundApplicationFee,
        // Marks refunds made by Indinite, so charge.refunded can tell them from Stripe dashboard refunds.
        metadata: { ...input.metadata, source: "indinite" },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: refund.id, status: refund.status ?? "pending" };
  }

  verifyWebhook(payload: string, signature: string) {
    if (!this.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
  }
}

const g = globalThis as unknown as { __stripeGateway?: StripeGateway | null };

/** True when a usable (non-placeholder) Stripe secret key is configured. */
export function stripeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const key = env.STRIPE_SECRET_KEY ?? "";
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}/.test(key);
}

export function stripeGateway(): StripeGateway | null {
  if (g.__stripeGateway !== undefined) return g.__stripeGateway;
  g.__stripeGateway = stripeConfigured() ? new LiveStripeGateway(process.env.STRIPE_SECRET_KEY!, process.env.STRIPE_WEBHOOK_SECRET) : null;
  return g.__stripeGateway;
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

export function requireStripe(): StripeGateway {
  const gw = stripeGateway();
  if (!gw) throw new StripeNotConfiguredError();
  return gw;
}

export type { Stripe };
