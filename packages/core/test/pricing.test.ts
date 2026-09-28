import { describe, expect, it } from "vitest";
import { applyBps, cardFeePence, complimentaryCommission, discountAmount, DEFAULT_FREE_COMPLIMENTARY_PASSES, discountAsBps, formatGBP, priceOrder, receiptLines, type LineItem } from "../src";

const one = (price: number, qty = 1): LineItem[] => [{ ticketTypeId: "a", name: "Night pass", unitPricePence: price, qty }];
const items: LineItem[] = [
  { ticketTypeId: "a", name: "Season adult", unitPricePence: 4500, qty: 2 },
  { ticketTypeId: "b", name: "Season child", unitPricePence: 2000, qty: 1 },
];

describe("money", () => {
  it("formats GBP", () => expect(formatGBP(11000)).toBe("£110.00"));
  it("rounds bps to nearest penny", () => expect(applyBps(999, 800)).toBe(80));
  it("rejects floats", () => expect(() => applyBps(10.5, 100)).toThrow());
});

describe("priceOrder", () => {
  it("matches the agreed example: £12 + 6% fee + £0.30 charge + 20% tax", () => {
    const p = priceOrder({ items: one(1200), commissionBps: 600, charges: [{ name: "Venue fee", kind: "fixed", value: 30 }], taxBps: 2000 });
    expect(p).toEqual({
      subtotalPence: 1200,
      discountPence: 0,
      ticketsPence: 1200,
      platformFeePence: 72,
      charges: [{ name: "Venue fee", amountPence: 30 }],
      chargesPence: 30,
      taxPence: 260, // 20% of 13.02
      cardFeePence: 0,
      totalPence: 1562,
      commissionPence: 72,
      organizerPence: 1490,
    });
  });

  it("charges fixed organiser fees per ticket and % fees on the ticket price", () => {
    const p = priceOrder({
      items,
      commissionBps: 600,
      charges: [
        { name: "Venue fee", kind: "fixed", value: 30 },
        { name: "Charity", kind: "percent", value: 100 },
      ],
    });
    expect(p.charges).toEqual([
      { name: "Venue fee", amountPence: 90 }, // 3 tickets × 30p
      { name: "Charity", amountPence: 110 }, // 1% of £110
    ]);
    expect(p).toMatchObject({ platformFeePence: 660, taxPence: 0, totalPence: 11000 + 660 + 200 });
  });

  it("applies coupons to the ticket price before fees", () => {
    const p = priceOrder({ items, commissionBps: 600, discount: { kind: "percent", value: 1000 }, taxBps: 2000 });
    expect(p).toMatchObject({ discountPence: 1100, ticketsPence: 9900, platformFeePence: 594 });
    expect(p.taxPence).toBe(applyBps(9900 + 594, 2000));
    expect(priceOrder({ items, commissionBps: 600, discount: { kind: "fixed", value: 50000 } })).toMatchObject({ ticketsPence: 0, platformFeePence: 0, totalPence: 0 });
  });

  it("complimentary: customer pays nothing, commission owed on the normal price", () => {
    const p = priceOrder({ items: one(4500), commissionBps: 600, charges: [{ name: "Venue fee", kind: "fixed", value: 30 }], taxBps: 2000, complimentary: true });
    expect(p).toMatchObject({ totalPence: 0, platformFeePence: 0, chargesPence: 0, taxPence: 0, commissionPence: 270 });
  });

  it("rejects bad input", () => {
    expect(() => priceOrder({ items: [], commissionBps: 600 })).toThrow();
    expect(() => priceOrder({ items: one(1200, 0), commissionBps: 600 })).toThrow();
    expect(() => priceOrder({ items: one(12.5), commissionBps: 600 })).toThrow();
    expect(() => priceOrder({ items: one(1200), commissionBps: 600.5 })).toThrow();
    expect(() => priceOrder({ items: one(1200), commissionBps: 600, charges: [{ name: "x", kind: "fixed", value: 0.3 }] })).toThrow();
  });

  it("expresses fixed discounts as bps for limit checks", () => {
    expect(discountAsBps(11000, { kind: "fixed", value: 1100 })).toBe(1000);
    expect(discountAsBps(11000, { kind: "percent", value: 2500 })).toBe(2500);
  });
});

describe("customer-paid card processing fee", () => {
  const example = { items: one(1200), commissionBps: 600, charges: [{ name: "Venue fee", kind: "fixed" as const, value: 30 }], taxBps: 2000 };
  const fee = { payer: "customer" as const, bps: 150, fixedPence: 20 };

  it("is added after tax, untaxed, and grossed up to cover Stripe's fee on the whole charge", () => {
    const p = priceOrder({ ...example, cardFee: fee });
    expect(p.taxPence).toBe(260);
    expect(p.cardFeePence).toBe(45); // Stripe's fee on £16.07 is 24p + 20p = 44p
    expect(p.totalPence).toBe(1562 + 45);
    expect(p.commissionPence).toBe(72);
    expect(p.organizerPence).toBe(1490);
  });

  it("always covers Stripe's fee on the final total", () => {
    for (const price of [1, 99, 500, 1200, 4500, 12345, 99999]) {
      const p = priceOrder({ items: one(price, 3), commissionBps: 600, taxBps: 2000, cardFee: fee });
      expect(p.cardFeePence).toBeGreaterThanOrEqual(cardFeePence(p.totalPence, fee));
      expect(p.cardFeePence - cardFeePence(p.totalPence, fee)).toBeLessThanOrEqual(1);
    }
  });

  it("isn't charged when Indinite or the organiser pays, on free orders or on complimentary passes", () => {
    expect(priceOrder({ ...example, cardFee: { ...fee, payer: "platform" } }).cardFeePence).toBe(0);
    expect(priceOrder({ ...example, cardFee: { ...fee, payer: "organizer" } }).cardFeePence).toBe(0);
    expect(priceOrder({ items: one(1200), commissionBps: 600, discount: { kind: "percent", value: 10000 }, cardFee: fee }).totalPence).toBe(0);
    expect(priceOrder({ ...example, complimentary: true, cardFee: fee }).cardFeePence).toBe(0);
  });

  it("shows as a receipt line", () => {
    const p = priceOrder({ ...example, cardFee: fee });
    const lines = receiptLines({ items: one(1200), ...p, taxBps: 2000, commissionBps: 600 });
    expect(lines.at(-1)).toEqual({ label: "Card processing fee", amountPence: 45 });
    expect(lines.reduce((s, l) => s + (l.negative ? -l.amountPence : l.amountPence), 0)).toBe(p.totalPence);
  });
});

describe("complimentary allowance", () => {
  const mixed: LineItem[] = [
    { ticketTypeId: "a", name: "Season adult", unitPricePence: 4500, qty: 2 },
    { ticketTypeId: "b", name: "Night pass", unitPricePence: 1200, qty: 3 },
  ];

  it("charges commission on every pass when there's no allowance left", () => {
    expect(complimentaryCommission(mixed, 600, 0)).toEqual({ commissionPence: applyBps(9000 + 3600, 600), freePasses: 0, chargedPasses: 5 });
  });

  it("covers the highest-priced passes first, then charges the rest", () => {
    // 2 free: both season passes; commission on 3 × £12.
    expect(complimentaryCommission(mixed, 600, 2)).toEqual({ commissionPence: applyBps(3600, 600), freePasses: 2, chargedPasses: 3 });
    // 4 free: one night pass left to charge.
    expect(complimentaryCommission(mixed, 600, 4)).toEqual({ commissionPence: 72, freePasses: 4, chargedPasses: 1 });
  });

  it("is completely free inside the allowance", () => {
    expect(complimentaryCommission(mixed, 600, 5).commissionPence).toBe(0);
    expect(complimentaryCommission(mixed, 600, 50)).toEqual({ commissionPence: 0, freePasses: 5, chargedPasses: 0 });
  });

  it("priceOrder uses the allowance; the customer always pays £0", () => {
    const p = priceOrder({ items: mixed, commissionBps: 600, taxBps: 2000, complimentary: true, complimentaryFreeLeft: 4 });
    expect(p.totalPence).toBe(0);
    expect(p.commissionPence).toBe(72);
    expect(priceOrder({ items: mixed, commissionBps: 600, complimentary: true }).commissionPence).toBe(applyBps(12600, 600));
  });

  it("defaults to 5 per event and rejects a negative allowance", () => {
    expect(DEFAULT_FREE_COMPLIMENTARY_PASSES).toBe(5);
    expect(() => complimentaryCommission(mixed, 600, -1)).toThrow();
  });
});

describe("coupon limits (ticket subtotal, before fees)", () => {
  it("caps a percent discount at the maximum", () => {
    expect(discountAmount(10000, { kind: "percent", value: 2000, maxAmountPence: 1000 })).toEqual({ amountPence: 1000 });
    expect(discountAmount(4000, { kind: "percent", value: 2000, maxAmountPence: 1000 })).toEqual({ amountPence: 800 });
  });
  it("needs the minimum ticket spend", () => {
    expect(discountAmount(2999, { kind: "percent", value: 1000, minSubtotalPence: 3000 })).toEqual({ ineligible: "Spend at least £30.00 on tickets to use this code." });
    expect(discountAmount(3000, { kind: "percent", value: 1000, minSubtotalPence: 3000 })).toEqual({ amountPence: 300 });
  });
  it("never takes off more than the tickets cost", () => {
    expect(discountAmount(500, { kind: "fixed", value: 2000 })).toEqual({ amountPence: 500 });
  });
  it("priceOrder applies the cap before fees, and flags an unmet minimum without discounting", () => {
    const capped = priceOrder({ items: one(4500, 3), commissionBps: 600, discount: { kind: "percent", value: 5000, maxAmountPence: 1000 } });
    expect(capped).toMatchObject({ subtotalPence: 13500, discountPence: 1000, ticketsPence: 12500, platformFeePence: 750 });
    expect(capped.discountIneligible).toBeUndefined();
    const short = priceOrder({ items: one(1000), commissionBps: 600, discount: { kind: "fixed", value: 500, minSubtotalPence: 3000 } });
    expect(short).toMatchObject({ discountPence: 0, ticketsPence: 1000, discountIneligible: "Spend at least £30.00 on tickets to use this code." });
  });
});
