import { describe, expect, it } from "vitest";
import { applyBps, calculateOrder, discountAsBps, formatGBP } from "../src";

const items = [
  { ticketTypeId: "a", name: "Season adult", unitPricePence: 4500, qty: 2 },
  { ticketTypeId: "b", name: "Season child", unitPricePence: 2000, qty: 1 },
];

describe("money", () => {
  it("formats GBP", () => expect(formatGBP(11000)).toBe("£110.00"));
  it("rounds bps to nearest penny", () => expect(applyBps(999, 800)).toBe(80));
  it("rejects floats", () => expect(() => applyBps(10.5, 100)).toThrow());
});

describe("calculateOrder", () => {
  it("computes subtotal and 8% commission", () => {
    expect(calculateOrder(items, 800)).toEqual({
      subtotalPence: 11000,
      discountPence: 0,
      totalPence: 11000,
      applicationFeePence: 880,
    });
  });

  it("applies percent discount before commission", () => {
    const t = calculateOrder(items, 800, { kind: "percent", value: 1000 });
    expect(t).toMatchObject({ discountPence: 1100, totalPence: 9900, applicationFeePence: 792 });
  });

  it("caps fixed discount at subtotal (complimentary via 100%)", () => {
    expect(calculateOrder(items, 800, { kind: "fixed", value: 50000 })).toMatchObject({
      totalPence: 0,
      applicationFeePence: 0,
    });
  });

  it("rejects empty orders and bad quantities", () => {
    expect(() => calculateOrder([], 800)).toThrow();
    expect(() => calculateOrder([{ ...items[0]!, qty: 0 }], 800)).toThrow();
    expect(() => calculateOrder([{ ...items[0]!, unitPricePence: 45.5 }], 800)).toThrow();
  });

  it("expresses fixed discounts as bps for limit checks", () => {
    expect(discountAsBps(11000, { kind: "fixed", value: 1100 })).toBe(1000);
    expect(discountAsBps(11000, { kind: "percent", value: 2500 })).toBe(2500);
  });
});
