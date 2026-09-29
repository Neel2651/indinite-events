/**
 * Real-MongoDB tests for merchant onboarding (SPEC §4.8), card checkout + webhooks (M4) and refunds (§4.6),
 * against a fake Stripe that records every call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { ForbiddenError, generateQrKeyPair, type AuthUser } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import {
  AuditLog,
  CheckoutError,
  Event,
  Hold,
  Job,
  Order,
  Organizer,
  Scan,
  StripeNotConfiguredError,
  Ticket,
  TicketType,
  createCheckoutOrder,
  handleStripeEvent,
  issueOfflineOrder,
  quoteRefund,
  refundTickets,
  setCardFeeSettings,
  setOnlineSalesPaused,
  setStripeGateway,
  startCardCheckout,
  startMerchantOnboarding,
  syncMerchantAccount,
  cancelOrder,
  merchantSetupUrl,
  sendMerchantSetupEmail,
  CommissionLedger,
  eventFinance,
  reconcileStripe,
  syncExternalRefunds,
  type Stripe,
  type StripeGateway,
} from "../src";

class FakeStripe implements StripeGateway {
  calls: { method: string; args: unknown }[] = [];
  private n = 0;
  private record(method: string, args: unknown) {
    this.calls.push({ method, args });
  }
  last(method: string) {
    return [...this.calls].reverse().find((c) => c.method === method)?.args as Record<string, unknown> | undefined;
  }
  count(method: string) {
    return this.calls.filter((c) => c.method === method).length;
  }
  async createExpressAccount(input: unknown) {
    this.record("createExpressAccount", input);
    return { id: `acct_test_${++this.n}` };
  }
  async createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string) {
    this.record("createOnboardingLink", { accountId, refreshUrl, returnUrl });
    return `https://connect.stripe.test/setup/${accountId}`;
  }
  async createDashboardLink(accountId: string) {
    return `https://connect.stripe.test/express/${accountId}`;
  }
  async retrieveAccount(id: string) {
    return { id, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, disabledReason: null, currentlyDue: [] };
  }
  sessions = new Map<string, { status: "open" | "complete" | "expired"; paymentStatus: string; paymentIntentId: string | null }>();
  refunds = new Map<string, { id: string; amountPence: number; status: string; metadata: Record<string, string> }[]>();
  async createCheckoutSession(input: { orderId: string }) {
    this.record("createCheckoutSession", input);
    const id = `cs_test_${++this.n}`;
    this.sessions.set(id, { status: "open", paymentStatus: "unpaid", paymentIntentId: null });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }
  async expireCheckoutSession(id: string) {
    this.record("expireCheckoutSession", id);
    const s = this.sessions.get(id);
    if (s?.status === "open") s.status = "expired";
  }
  async retrieveCheckoutSession(id: string) {
    const s = this.sessions.get(id) ?? { status: "expired" as const, paymentStatus: "unpaid", paymentIntentId: null };
    return { id, ...s };
  }
  /** Test helper: the customer paid on Stripe's page. */
  completeSession(id: string, paymentIntentId: string) {
    this.sessions.set(id, { status: "complete", paymentStatus: "paid", paymentIntentId });
  }
  async createRefund(input: { paymentIntentId: string; amountPence: number; metadata: Record<string, string> }) {
    this.record("createRefund", input);
    const r = { id: `re_test_${++this.n}`, amountPence: input.amountPence, status: "succeeded", metadata: { ...input.metadata, source: "indinite" } };
    this.refunds.set(input.paymentIntentId, [...(this.refunds.get(input.paymentIntentId) ?? []), r]);
    return { id: r.id, status: r.status };
  }
  async listRefunds(paymentIntentId: string) {
    return this.refunds.get(paymentIntentId) ?? [];
  }
  /** Test helper: someone refunded in the Stripe dashboard (no Indinite metadata). */
  dashboardRefund(paymentIntentId: string, amountPence: number) {
    const r = { id: `re_dash_${++this.n}`, amountPence, status: "succeeded", metadata: {} };
    this.refunds.set(paymentIntentId, [...(this.refunds.get(paymentIntentId) ?? []), r]);
    return r;
  }
  verifyWebhook(): Stripe.Event {
    throw new Error("not used");
  }
}

let replSet: MongoMemoryReplSet;
let stripe: FakeStripe;
let orgId: string;
let eventId: string;
let passId: string;
const APP = "https://events.test";
const owner = (): AuthUser => ({ id: "owner-1", isSuperAdmin: false, memberships: [{ organizerId: orgId, role: "owner" }] });
const manager = (): AuthUser => ({ id: "mgr-1", isSuperAdmin: false, memberships: [{ organizerId: orgId, role: "manager" }] });
const superAdmin: AuthUser = { id: "admin-1", isSuperAdmin: true, memberships: [] };
const asUser = <T>(id: string, fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id } }, fn);
const asCustomer = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "customer" } }, fn);
const customer = { name: "Asha", email: "asha@example.com" };
const urls = { successUrl: `${APP}/checkout/success`, cancelUrl: `${APP}/e/x` };

function stripeEvent(type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}): Stripe.Event {
  return { id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object }, ...extra } as unknown as Stripe.Event;
}

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
}, 120_000);

afterAll(async () => {
  setStripeGateway(undefined);
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  stripe = new FakeStripe();
  setStripeGateway(stripe);
  await Promise.all(["organizers", "events", "tickettypes", "orders", "holds", "tickets", "jobs", "scans", "webhookevents"].map((c) => mongoose.connection.db!.collection(c).deleteMany({})));
  const org = await Organizer.create({ name: "Demo Garba", slug: "demo", contactEmail: "owner@example.com", authOrgId: "a1", merchantPrefill: { businessType: "company", legalName: "Demo Garba Ltd", website: "https://demo.example" } });
  orgId = String(org._id);
  const event = await Event.create({
    organizerId: org._id,
    slug: "e",
    title: "Navratri",
    venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
    sessions: [{ label: "Night 1", startsAt: new Date(Date.now() + 7 * 86_400_000), endsAt: new Date(Date.now() + 7 * 86_400_000 + 14_400_000) }],
    status: "published",
    taxBps: 2000,
    charges: [{ name: "Venue fee", kind: "fixed", value: 30 }],
  });
  eventId = String(event._id);
  passId = String((await TicketType.create({ eventId: event._id, name: "Night pass", pricePence: 1200, quota: 3, validSessionIds: [event.sessions[0]!._id] }))._id);
});

async function activateMerchant() {
  await asUser("admin-1", () => startMerchantOnboarding(orgId, APP));
  const org = await Organizer.findById(orgId).lean();
  await asUser("admin-1", () => syncMerchantAccount({ id: org!.stripeAccountId!, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, disabledReason: null, currentlyDue: [] }, APP));
}

async function paidCardOrder(qty = 2) {
  await activateMerchant();
  const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty }] }, new Date(), { requireCardPayments: true }));
  const { url } = await asCustomer(() => startCardCheckout(String(order._id), urls));
  const sessionId = url.split("/").pop()!;
  await handleStripeEvent(stripeEvent("checkout.session.completed", { id: sessionId, payment_status: "paid", payment_intent: "pi_test_1", metadata: { orderId: String(order._id) } }), APP);
  return (await Order.findById(order._id).lean())!;
}

describe("merchant onboarding", () => {
  it("creates one Stripe account per organiser from the admin's details, then links to Stripe's form", async () => {
    const first = await asUser("admin-1", () => startMerchantOnboarding(orgId, APP));
    const second = await asUser("admin-1", () => startMerchantOnboarding(orgId, APP));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(stripe.count("createExpressAccount")).toBe(1);
    expect(stripe.last("createExpressAccount")).toMatchObject({ organizerId: orgId, email: "owner@example.com", businessType: "company", businessName: "Demo Garba Ltd", website: "https://demo.example" });
    expect(stripe.last("createOnboardingLink")).toMatchObject({ returnUrl: `${APP}/org/demo/payments?stripe=return`, refreshUrl: `${APP}/org/demo/payments?stripe=refresh` });
    expect(await AuditLog.countDocuments({ action: "merchant.account_created" })).toBe(1);
  });

  it("setup email and copied link both open the owner's Payments page (sign-in required), never a Stripe link", async () => {
    expect(merchantSetupUrl(APP, "demo")).toBe(`${APP}/org/demo/payments?setup=1`);
    await asUser("admin-1", () => sendMerchantSetupEmail(orgId, APP, ["owner@example.com"]));
    expect(await Job.findOne({ queue: "send-auth-email", "data.kind": "merchant-setup" }).lean()).toMatchObject({ data: { url: `${APP}/org/demo/payments?setup=1` } });
  });

  it("lets a super admin fill in the same account's details and come back to the admin page", async () => {
    await asUser("admin-1", () => startMerchantOnboarding(orgId, APP, { returnPath: `/admin/organisers/${orgId}` }));
    expect(stripe.count("createExpressAccount")).toBe(1);
    expect(stripe.last("createOnboardingLink")).toMatchObject({ returnUrl: `${APP}/admin/organisers/${orgId}?stripe=return`, refreshUrl: `${APP}/admin/organisers/${orgId}?stripe=refresh` });
  });

  it("becomes active automatically when Stripe approves, and emails the owner", async () => {
    await activateMerchant();
    expect(await Organizer.findById(orgId).lean()).toMatchObject({ chargesEnabled: true, payoutsEnabled: true });
    expect(await AuditLog.findOne({ action: "merchant.status_changed" }).sort({ createdAt: -1 }).lean()).toMatchObject({ changes: expect.arrayContaining([expect.objectContaining({ path: "status", after: "active" })]) });
    expect(await Job.countDocuments({ queue: "send-auth-email", "data.kind": "merchant-active" })).toBe(1);
  });

  it("says Stripe isn't set up when there's no key", async () => {
    setStripeGateway(null);
    await expect(asUser("admin-1", () => startMerchantOnboarding(orgId, APP))).rejects.toBeInstanceOf(StripeNotConfiguredError);
  });
});

describe("card checkout (M4)", () => {
  it("refuses card checkout until the organiser is active, and while sales are paused", async () => {
    await expect(asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }))).rejects.toThrow(/aren't available/);
    await activateMerchant();
    await asUser("admin-1", () => setOnlineSalesPaused(orgId, true, "Checking payouts"));
    await expect(asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }))).rejects.toBeInstanceOf(CheckoutError);
  });

  it("sends a destination charge with Indinite's fee plus the card fee (organiser pays it by default), holds seats ≥ 30 min, and reuses an open session", async () => {
    await activateMerchant();
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }));
    const a = await asCustomer(() => startCardCheckout(String(order._id), urls));
    const b = await asCustomer(() => startCardCheckout(String(order._id), urls));
    expect(a.url).toBe(b.url);
    const s = stripe.last("createCheckoutSession")!;
    // Platform fee 72p + Stripe's card fee on £15.62 (1.5% + 20p = 43p), deducted from the organiser's payout.
    expect(s).toMatchObject({ totalPence: 1562, applicationFeePence: 72 + 23 + 20, customerEmail: "asha@example.com" });
    expect((s.destinationAccountId as string).startsWith("acct_test_")).toBe(true);
    expect((s.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(Date.now() + 30 * 60_000);
    const hold = await Hold.findOne({ orderId: order._id }).lean();
    expect(hold!.expiresAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 30 * 60_000);
  });

  it("takes only the platform fee when Indinite bears Stripe's card fee", async () => {
    await activateMerchant();
    await asUser("admin-1", () => setCardFeeSettings(orgId, { payer: "platform", bps: 150, fixedPence: 20 }));
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }));
    await asCustomer(() => startCardCheckout(String(order._id), urls));
    expect(stripe.last("createCheckoutSession")).toMatchObject({ applicationFeePence: 72 });
  });

  it("adds a card processing fee to the customer's total when the customer bears it", async () => {
    await activateMerchant();
    await asUser("admin-1", () => setCardFeeSettings(orgId, { payer: "customer", bps: 150, fixedPence: 20 }));
    try {
      const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }));
      // £15.62 + 45p, grossed up so Stripe's fee on £16.07 (44p) is covered.
      expect(order).toMatchObject({ cardFeePence: 45, totalPence: 1562 + 45, applicationFeePence: 72 });
      await asCustomer(() => startCardCheckout(String(order._id), urls));
      expect(stripe.last("createCheckoutSession")).toMatchObject({ totalPence: 1607, applicationFeePence: 72 + 45 });
    } finally {
      await asUser("admin-1", () => setCardFeeSettings(orgId, { payer: "platform", bps: 150, fixedPence: 20 }));
    }
  });

  it("issues passes on checkout.session.completed, once, however many times Stripe sends it", async () => {
    const order = await paidCardOrder(2);
    expect(order).toMatchObject({ status: "paid", stripe: { paymentIntentId: "pi_test_1" } });
    expect(await Ticket.countDocuments({ orderId: order._id })).toBe(2);
    const evt = stripeEvent("checkout.session.completed", { id: order.stripe!.checkoutSessionId, payment_status: "paid", payment_intent: "pi_test_1", metadata: { orderId: String(order._id) } });
    expect(await handleStripeEvent(evt, APP)).toEqual({ duplicate: false });
    expect(await handleStripeEvent(evt, APP)).toEqual({ duplicate: true });
    expect(await Ticket.countDocuments({ orderId: order._id })).toBe(2);
  });

  it("releases seats when Stripe says the checkout expired", async () => {
    await activateMerchant();
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 2 }] }, new Date(), { requireCardPayments: true }));
    const { url } = await asCustomer(() => startCardCheckout(String(order._id), urls));
    await handleStripeEvent(stripeEvent("checkout.session.expired", { id: url.split("/").pop(), metadata: { orderId: String(order._id) } }), APP);
    expect((await Order.findById(order._id).lean())!.status).toBe("expired");
    expect(await TicketType.findById(passId).lean()).toMatchObject({ held: 0, sold: 0 });
  });

  it("late payment: sells seats if still available, otherwise refunds in full (fees too) and says sorry", async () => {
    await activateMerchant();
    const late = async (qty: number) => {
      const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty }] }, new Date(), { requireCardPayments: true }));
      const { url } = await asCustomer(() => startCardCheckout(String(order._id), urls));
      const hold = await Hold.findOne({ orderId: order._id }).lean();
      await runWithContext({ actor: systemActor }, () => import("../src").then((m) => m.releaseHold(hold!._id, "expired")));
      return { order, sessionId: url.split("/").pop()! };
    };
    // Both customers are still on Stripe's page when their holds expire (quota 3, 2 + 2 requested).
    const a = await late(2);
    const b = await late(2);
    await handleStripeEvent(stripeEvent("checkout.session.completed", { id: a.sessionId, payment_status: "paid", payment_intent: "pi_late_a", metadata: { orderId: String(a.order._id) } }), APP);
    expect((await Order.findById(a.order._id).lean())!.status).toBe("paid");

    // Now only 1 seat is left, so b's late payment can't be honoured.
    await handleStripeEvent(stripeEvent("checkout.session.completed", { id: b.sessionId, payment_status: "paid", payment_intent: "pi_late_b", metadata: { orderId: String(b.order._id) } }), APP);
    const refunded = (await Order.findById(b.order._id).lean())!;
    expect(refunded).toMatchObject({ status: "refunded", refundedPence: refunded.totalPence });
    expect(stripe.last("createRefund")).toMatchObject({ paymentIntentId: "pi_late_b", amountPence: refunded.totalPence, refundApplicationFee: true, reverseTransfer: true });
    expect(await Job.countDocuments({ queue: "send-refund-email", "data.kind": "sold_out" })).toBe(1);
  });
});

describe("refunds (owner only, before the event, ticket price only)", () => {
  it("only the organiser owner or a super admin can refund", async () => {
    const order = await paidCardOrder(2);
    const tickets = (await Ticket.find({ orderId: order._id }).sort({ _id: 1 }).lean()).map((t) => String(t._id));
    const user = manager();
    await expect(asUser(user.id, () => refundTickets({ user, organizerId: orgId, publicId: order.publicId, ticketIds: tickets, reason: "Can't come" }))).rejects.toBeInstanceOf(ForbiddenError);
    const sold = (await TicketType.findById(passId).lean())!.sold;
    const r = await asUser(superAdmin.id, () => refundTickets({ user: superAdmin, organizerId: orgId, publicId: order.publicId, ticketIds: tickets, reason: "Event page error" }));
    expect(r).toMatchObject({ amountPence: 2400, status: "refunded" });
    expect(await TicketType.findById(passId).lean()).toMatchObject({ sold: sold - 2 });
  });

  it("refunds only the ticket price through Stripe (Indinite keeps its fee), returns seats, and emails the customer", async () => {
    const order = await paidCardOrder(2); // 2 × £12 + fees + tax
    const [t1, t2] = (await Ticket.find({ orderId: order._id }).sort({ _id: 1 }).lean()).map((t) => String(t._id));
    const quote = await quoteRefund(orgId, order.publicId);
    expect(quote).toMatchObject({ eligible: true, method: "stripe" });
    expect(quote.tickets.map((t) => t.refundablePence)).toEqual([1200, 1200]);

    const r1 = await asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: order.publicId, ticketIds: [t1!], reason: "Can't come" }));
    expect(r1).toMatchObject({ amountPence: 1200, status: "partially_refunded", method: "stripe" });
    expect(stripe.last("createRefund")).toMatchObject({ paymentIntentId: "pi_test_1", amountPence: 1200, reverseTransfer: true, refundApplicationFee: false });
    expect((await Ticket.findById(t1).lean())!.status).toBe("refunded");
    expect(await TicketType.findById(passId).lean()).toMatchObject({ sold: 1 });

    const r2 = await asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: order.publicId, ticketIds: [t2!], reason: "Can't come" }));
    expect(r2.status).toBe("refunded");
    const final = (await Order.findById(order._id).lean())!;
    expect(final.refundedPence).toBe(2400); // never the fee (144), venue fee (60) or tax
    expect(final.refundedPence).toBeLessThan(final.totalPence);
    expect(await Job.countDocuments({ queue: "send-refund-email", "data.kind": "refund", "data.orderId": String(order._id) })).toBe(2);
    expect(await AuditLog.countDocuments({ action: "ticket.refunded", "entity.id": { $in: [t1, t2] } })).toBe(2);
  });

  it("won't refund twice, after the event has started, or a pass already used at the gate", async () => {
    const order = await paidCardOrder(2);
    const [t1, t2] = (await Ticket.find({ orderId: order._id }).sort({ _id: 1 }).lean()).map((t) => String(t._id));
    await asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: order.publicId, ticketIds: [t1!], reason: "Can't come" }));
    await expect(asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: order.publicId, ticketIds: [t1!], reason: "Again" }))).rejects.toThrow(/already been refunded/);

    const event = await Event.findById(eventId).lean();
    await Scan.create({ clientScanId: "s1", ticketId: t2, eventId, sessionId: event!.sessions[0]!._id, gate: "A", deviceId: "d", scannerUserId: "u", result: "admitted", scannedAt: new Date() });
    await expect(asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: order.publicId, ticketIds: [t2!], reason: "x y z" }))).rejects.toThrow(/used at the gate/);

    const afterStart = new Date(event!.startsAt.getTime() + 60_000);
    await expect(asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: order.publicId, ticketIds: [t2!], reason: "Late", now: afterStart }))).rejects.toThrow(/event starts/);
    expect((await quoteRefund(orgId, order.publicId, afterStart)).eligible).toBe(false);
  });

  it("cash bookings are recorded (organiser repays), coupons reduce the refund, comps are just cancelled", async () => {
    const cash = await asUser("owner-1", () => issueOfflineOrder(orgId, "owner-1", { eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], method: "cash", note: "Door" }));
    const [ct] = (await Ticket.find({ orderId: cash.order._id }).lean()).map((t) => String(t._id));
    const r = await asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: cash.order.publicId, ticketIds: [ct!], reason: "Changed plans" }));
    expect(r).toMatchObject({ method: "outside_indinite", amountPence: 1200 });
    expect(stripe.count("createRefund")).toBe(0);

    const comp = await asUser("owner-1", () => issueOfflineOrder(orgId, "owner-1", { eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], method: "complimentary", note: "Guest" }));
    const [compT] = (await Ticket.find({ orderId: comp.order._id }).lean()).map((t) => String(t._id));
    const rc = await asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: comp.order.publicId, ticketIds: [compT!], reason: "Guest cancelled" }));
    expect(rc).toMatchObject({ amountPence: 0, status: "refunded" });
    expect(await Order.findById(comp.order._id).lean()).toMatchObject({ refunds: [expect.objectContaining({ method: "none" })] });
  });
});

describe("cancel (agreed 28 Sep 2026)", () => {
  const boxOffice = (): AuthUser => ({ id: "box-1", isSuperAdmin: false, memberships: [{ organizerId: orgId, role: "box_office" }] });

  it("box office cancels an unpaid card booking: Stripe page closed, seats back, audited", async () => {
    await activateMerchant();
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 2 }] }, new Date(), { requireCardPayments: true }));
    await asCustomer(() => startCardCheckout(String(order._id), urls));
    expect(await TicketType.findById(passId).lean()).toMatchObject({ held: 2 });
    const r = await asUser("box-1", () => cancelOrder({ user: boxOffice(), organizerId: orgId, publicId: order.publicId, reason: "Customer changed their mind" }));
    expect(r).toEqual({ status: "cancelled", passes: 0 });
    expect(stripe.count("expireCheckoutSession")).toBe(1);
    expect(await TicketType.findById(passId).lean()).toMatchObject({ held: 0, sold: 0 });
    expect(await Order.findById(order._id).lean()).toMatchObject({ status: "cancelled", cancellation: { reason: "Customer changed their mind", by: "box-1" } });
    expect(await AuditLog.findOne({ action: "order.cancelled", "entity.id": String(order._id) }).lean()).toMatchObject({ actor: { id: "box-1" } });
  });

  it("won't cancel an unpaid booking the customer has just paid for", async () => {
    await activateMerchant();
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }));
    const { url } = await asCustomer(() => startCardCheckout(String(order._id), urls));
    stripe.completeSession(url.split("/").pop()!, "pi_just_paid");
    await expect(asUser("box-1", () => cancelOrder({ user: boxOffice(), organizerId: orgId, publicId: order.publicId, reason: "Too late" }))).rejects.toThrow(/has just paid/);
    expect((await Order.findById(order._id).lean())!.status).toBe("pending");
  });

  it("refunds a card payment that completes after the booking was cancelled", async () => {
    await activateMerchant();
    const order = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }));
    const { url } = await asCustomer(() => startCardCheckout(String(order._id), urls));
    await asUser("box-1", () => cancelOrder({ user: boxOffice(), organizerId: orgId, publicId: order.publicId, reason: "Wrong event" }));
    await handleStripeEvent(stripeEvent("checkout.session.completed", { id: url.split("/").pop(), payment_status: "paid", payment_intent: "pi_after_cancel", metadata: { orderId: String(order._id) } }), APP);
    const after = (await Order.findById(order._id).lean())!;
    expect(after.status).toBe("cancelled");
    expect(after.refundedPence).toBe(order.totalPence);
    expect(stripe.last("createRefund")).toMatchObject({ paymentIntentId: "pi_after_cancel", amountPence: order.totalPence, refundApplicationFee: true });
    expect(await Ticket.countDocuments({ orderId: order._id })).toBe(0);
  });

  it("owner cancels a paid cash booking: passes stop, seats back, commission reversed, customer emailed", async () => {
    const { order } = await asUser("box-1", () => issueOfflineOrder(orgId, "box-1", { eventId, customer, items: [{ ticketTypeId: passId, qty: 2 }], method: "cash", note: "Paid at the door" }));
    await expect(asUser("box-1", () => cancelOrder({ user: boxOffice(), organizerId: orgId, publicId: order.publicId, reason: "Mistake" }))).rejects.toThrow(/Only the organiser's owner/);
    const owedBefore = (await eventFinance(eventId))!.direct.commissionOwedPence;
    expect(owedBefore).toBeGreaterThan(0);
    const r = await asUser("owner-1", () => cancelOrder({ user: owner(), organizerId: orgId, publicId: order.publicId, reason: "Entered twice" }));
    expect(r).toEqual({ status: "cancelled", passes: 2 });
    expect(await Ticket.countDocuments({ orderId: order._id, status: "cancelled" })).toBe(2);
    expect(await TicketType.findById(passId).lean()).toMatchObject({ sold: 0 });
    expect((await eventFinance(eventId))!.direct.commissionOwedPence).toBe(owedBefore - order.applicationFeePence);
    expect(await CommissionLedger.findOne({ orderId: order._id, kind: "offline_sale_reversed" }).lean()).toMatchObject({ amountPence: order.applicationFeePence });
    expect(await Job.countDocuments({ queue: "send-refund-email", "data.kind": "cancelled", "data.orderId": String(order._id) })).toBe(1);
  });

  it("won't cancel a paid card booking (refund it) or one with a pass used at the gate", async () => {
    const card = await paidCardOrder(1);
    await expect(asUser("owner-1", () => cancelOrder({ user: owner(), organizerId: orgId, publicId: card.publicId, reason: "Not coming" }))).rejects.toThrow(/Use Refund/);
    const { order } = await asUser("box-1", () => issueOfflineOrder(orgId, "box-1", { eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }], method: "cash", note: "Paid" }));
    const t = (await Ticket.findOne({ orderId: order._id }).lean())!;
    const ev = (await Event.findById(eventId).lean())!;
    await Scan.create({ clientScanId: "c1", ticketId: t._id, eventId: ev._id, sessionId: ev.sessions[0]!._id, gate: "A", deviceId: "d", scannerUserId: "s", result: "admitted", scannedAt: new Date() });
    await expect(asUser("owner-1", () => cancelOrder({ user: owner(), organizerId: orgId, publicId: order.publicId, reason: "Not coming" }))).rejects.toThrow(/used at the gate/);
  });
});

describe("refunds made in the Stripe dashboard", () => {
  it("full refund: unscanned passes refunded, seats back, order refunded, customer emailed", async () => {
    const order = await paidCardOrder(2);
    stripe.dashboardRefund("pi_test_1", order.totalPence);
    await handleStripeEvent(stripeEvent("charge.refunded", { id: "ch_1", payment_intent: "pi_test_1" }), APP);
    const after = (await Order.findById(order._id).lean())!;
    expect(after).toMatchObject({ status: "refunded", refundedPence: order.totalPence, needsReview: false });
    expect(after.refunds.at(-1)).toMatchObject({ method: "stripe_dashboard", refundedBy: "stripe" });
    expect(await Ticket.countDocuments({ orderId: order._id, status: "refunded" })).toBe(2);
    expect(await TicketType.findById(passId).lean()).toMatchObject({ sold: 0 });
    expect(await Job.countDocuments({ queue: "send-refund-email", "data.kind": "stripe_refund" })).toBe(1);
    // Replaying the event (or reconciliation) records nothing twice.
    expect(await asUser("sys", () => syncExternalRefunds("pi_test_1"))).toEqual({ recorded: 0, full: false });
  });

  it("part refund: amount recorded, passes kept, order flagged for review", async () => {
    const order = await paidCardOrder(2);
    stripe.dashboardRefund("pi_test_1", 500);
    await handleStripeEvent(stripeEvent("charge.refunded", { id: "ch_1", payment_intent: "pi_test_1" }), APP);
    const after = (await Order.findById(order._id).lean())!;
    expect(after).toMatchObject({ status: "partially_refunded", refundedPence: 500, needsReview: true });
    expect(after.reviewNote).toMatch(/£5.00 refunded in Stripe outside Indinite/);
    expect(await Ticket.countDocuments({ orderId: order._id, status: "valid" })).toBe(2);
    expect(await AuditLog.findOne({ action: "order.refunded_in_stripe", "entity.id": String(order._id) }).lean()).toMatchObject({ actor: { type: "stripe" } });
  });

  it("doesn't count Indinite's own refunds as dashboard refunds", async () => {
    const order = await paidCardOrder(2);
    const [t1] = (await Ticket.find({ orderId: order._id }).sort({ _id: 1 }).lean()).map((t) => String(t._id));
    await asUser("owner-1", () => refundTickets({ user: owner(), organizerId: orgId, publicId: order.publicId, ticketIds: [t1!], reason: "Can't come" }));
    await handleStripeEvent(stripeEvent("charge.refunded", { id: "ch_1", payment_intent: "pi_test_1" }), APP);
    const after = (await Order.findById(order._id).lean())!;
    expect(after.refunds).toHaveLength(1);
    expect(after.needsReview).toBe(false);
  });
});

describe("Stripe reconciliation", () => {
  it("confirms a paid checkout whose webhook never arrived, and releases expired ones", async () => {
    await activateMerchant();
    const paid = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }));
    const { url } = await asCustomer(() => startCardCheckout(String(paid._id), urls));
    stripe.completeSession(url.split("/").pop()!, "pi_missed");
    const lost = await asCustomer(() => createCheckoutOrder({ eventId, customer, items: [{ ticketTypeId: passId, qty: 1 }] }, new Date(), { requireCardPayments: true }));
    const lostUrl = (await asCustomer(() => startCardCheckout(String(lost._id), urls))).url;
    await stripe.expireCheckoutSession(lostUrl.split("/").pop()!);

    const later = new Date(Date.now() + 5 * 60_000);
    const r = await runWithContext({ actor: systemActor }, () => reconcileStripe(later));
    expect(r).toMatchObject({ confirmed: 1, released: 1 });
    expect(await Order.findById(paid._id).lean()).toMatchObject({ status: "paid", stripe: { paymentIntentId: "pi_missed" } });
    expect(await Ticket.countDocuments({ orderId: paid._id })).toBe(1);
    expect((await Order.findById(lost._id).lean())!.status).toBe("expired");
  });

  it("records dashboard refunds it finds on recent card orders", async () => {
    const order = await paidCardOrder(1);
    stripe.dashboardRefund("pi_test_1", order.totalPence);
    const r = await runWithContext({ actor: systemActor }, () => reconcileStripe());
    expect(r?.refundsRecorded).toBe(1);
    expect((await Order.findById(order._id).lean())!.status).toBe("refunded");
  });
});
