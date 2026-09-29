import { describe, expect, it } from "vitest";
import { applicationFeeFor, canTakeCardPayments, cardFeePence, customerCardFeePence, DEFAULT_CARD_FEE, merchantStatus, ticketRefundShares } from "../src";

describe("merchant status", () => {
  it("walks through onboarding states", () => {
    expect(merchantStatus({})).toBe("not_started");
    expect(merchantStatus({ stripeAccountId: "acct_1" })).toBe("in_progress");
    expect(merchantStatus({ stripeAccountId: "acct_1", detailsSubmitted: true })).toBe("pending_verification");
    expect(merchantStatus({ stripeAccountId: "acct_1", detailsSubmitted: true, stripeDisabledReason: "requirements.pending_verification" })).toBe("pending_verification");
    expect(merchantStatus({ stripeAccountId: "acct_1", detailsSubmitted: true, stripeDisabledReason: "requirements.past_due", stripeCurrentlyDue: ["individual.verification.document"] })).toBe("restricted");
    expect(merchantStatus({ stripeAccountId: "acct_1", detailsSubmitted: true, chargesEnabled: true })).toBe("active");
  });

  it("only active, un-paused organisers take card payments", () => {
    const active = { stripeAccountId: "acct_1", detailsSubmitted: true, chargesEnabled: true };
    expect(canTakeCardPayments(active)).toBe(true);
    expect(canTakeCardPayments({ ...active, onlineSalesPaused: true })).toBe(false);
    expect(canTakeCardPayments({ stripeAccountId: "acct_1" })).toBe(false);
  });
});

describe("card fees", () => {
  it("defaults to 1.5% + 20p, borne by the organiser", () => {
    expect(DEFAULT_CARD_FEE).toEqual({ payer: "organizer", bps: 150, fixedPence: 20 });
    expect(cardFeePence(1562, DEFAULT_CARD_FEE)).toBe(23 + 20);
    expect(cardFeePence(0, DEFAULT_CARD_FEE)).toBe(0);
  });

  it("application fee is the platform fee, plus the card fee when the organiser pays it", () => {
    const order = { totalPence: 1562, platformFeePence: 72 };
    expect(applicationFeeFor(order, { ...DEFAULT_CARD_FEE, payer: "platform" })).toBe(72);
    expect(applicationFeeFor(order, DEFAULT_CARD_FEE)).toBe(72 + 43);
    expect(applicationFeeFor({ totalPence: 10, platformFeePence: 5 }, { payer: "organizer", bps: 150, fixedPence: 20 })).toBe(10);
  });

  it("customer-paid fee: the card fee fixed on the order goes to Indinite to cover Stripe", () => {
    const fee = { ...DEFAULT_CARD_FEE, payer: "customer" as const };
    expect(customerCardFeePence(1562, fee)).toBe(45);
    expect(customerCardFeePence(0, fee)).toBe(0);
    expect(applicationFeeFor({ totalPence: 1607, platformFeePence: 72, cardFeePence: 45 }, fee)).toBe(72 + 45);
    // Priced while the customer paid; the setting changed later: the order's fee still applies.
    expect(applicationFeeFor({ totalPence: 1607, platformFeePence: 72, cardFeePence: 45 }, { ...DEFAULT_CARD_FEE, payer: "platform" })).toBe(72 + 45);
    // Priced before the customer paid; no fee on the order, so nothing extra.
    expect(applicationFeeFor({ totalPence: 1562, platformFeePence: 72, cardFeePence: 0 }, fee)).toBe(72);
  });
});

describe("ticket refund shares", () => {
  const units = [
    { ticketId: "a", unitPricePence: 4500 },
    { ticketId: "b", unitPricePence: 4500 },
    { ticketId: "c", unitPricePence: 2000 },
  ];

  it("refunds the full ticket price when there was no coupon", () => {
    expect([...ticketRefundShares(units, 0).values()]).toEqual([4500, 4500, 2000]);
  });

  it("spreads a coupon across passes and never exceeds what was paid for tickets", () => {
    const shares = ticketRefundShares(units, 1100); // 10% off £110
    const values = [...shares.values()];
    expect(values.reduce((s, v) => s + v, 0)).toBe(11000 - 1100);
    expect(values).toEqual([4050, 4050, 1800]);
    const odd = [...ticketRefundShares([{ ticketId: "x", unitPricePence: 1000 }, { ticketId: "y", unitPricePence: 1000 }, { ticketId: "z", unitPricePence: 1000 }], 100).values()];
    expect(odd.reduce((s, v) => s + v, 0)).toBe(2900);
  });

  it("complimentary passes refund nothing", () => {
    expect([...ticketRefundShares(units, 0, true).values()]).toEqual([0, 0, 0]);
  });
});
