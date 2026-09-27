import { describe, expect, it } from "vitest";
import { applyBps, discountAsBps, formatGBP, priceOrder, type LineItem } from "../src";

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
