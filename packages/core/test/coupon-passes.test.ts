import { describe, expect, it } from "vitest";
import { discountCovers, priceOrder, ticketRefundShares, type LineItem } from "../src";

/** Coupons limited to certain passes (8 Oct 2026). */
const day2: LineItem = { ticketTypeId: "day2", name: "Day pass · Sat 10 Oct", unitPricePence: 2500, qty: 2 };
const day3: LineItem = { ticketTypeId: "day3", name: "Day pass · Sun 11 Oct", unitPricePence: 2500, qty: 1 };
const season: LineItem = { ticketTypeId: "season", name: "Season pass", unitPricePence: 15000, qty: 1 };

describe("pass-limited coupons", () => {
  it("discounts only the chosen passes; the platform fee follows the discounted tickets", () => {
    const p = priceOrder({ items: [day2, day3], commissionBps: 1000, discount: { kind: "percent", value: 2000, ticketTypeIds: ["day2"], appliesToLabel: "Day pass · Sat 10 Oct" } });
    expect(p).toMatchObject({ subtotalPence: 7500, discountPence: 1000, ticketsPence: 6500, platformFeePence: 650, totalPence: 7150 });
    expect(p.discountIneligible).toBeUndefined();
  });

  it("a season-only code leaves day passes at full price", () => {
    const p = priceOrder({ items: [season, day3], commissionBps: 1000, discount: { kind: "percent", value: 1000, ticketTypeIds: ["season"], appliesToLabel: "Season pass" } });
    expect(p).toMatchObject({ discountPence: 1500, ticketsPence: 16000 });
  });

  it("caps a fixed amount at the chosen passes' total, and a % cap still applies", () => {
    expect(priceOrder({ items: [day2, season], commissionBps: 0, discount: { kind: "fixed", value: 10000, ticketTypeIds: ["day2"] } }).discountPence).toBe(5000);
    expect(priceOrder({ items: [day2, season], commissionBps: 0, discount: { kind: "percent", value: 5000, maxAmountPence: 1000, ticketTypeIds: ["day2"] } }).discountPence).toBe(1000);
  });

  it("measures the minimum spend on the chosen passes", () => {
    const rule = { kind: "percent" as const, value: 1000, minSubtotalPence: 6000, ticketTypeIds: ["day2"], appliesToLabel: "Day pass · Sat 10 Oct" };
    const p = priceOrder({ items: [day2, season], commissionBps: 0, discount: rule });
    expect(p.discountPence).toBe(0);
    expect(p.discountIneligible).toBe("Spend at least £60.00 on Day pass · Sat 10 Oct to use this code.");
    expect(priceOrder({ items: [{ ...day2, qty: 3 }], commissionBps: 0, discount: rule }).discountPence).toBe(750);
  });

  it("is refused, naming the passes, when none of them are in the basket", () => {
    const p = priceOrder({ items: [day3], commissionBps: 1000, discount: { kind: "percent", value: 2000, ticketTypeIds: ["season"], appliesToLabel: "Season pass" } });
    expect(p.discountPence).toBe(0);
    expect(p.discountIneligible).toBe("This code is only for Season pass.");
  });

  it("no list means the whole basket, as before", () => {
    expect(priceOrder({ items: [day2, day3], commissionBps: 0, discount: { kind: "percent", value: 2000 } }).discountPence).toBe(1500);
    expect(priceOrder({ items: [day2, day3], commissionBps: 0, discount: { kind: "percent", value: 2000, ticketTypeIds: [] } }).discountPence).toBe(1500);
    expect(discountCovers({ ticketTypeIds: null }, "x")).toBe(true);
    expect(discountCovers({ ticketTypeIds: ["a"] }, "x")).toBe(false);
  });

  it("refunds spread the discount over the discounted passes only", () => {
    const units = [
      { ticketId: "a", unitPricePence: 2500, ticketTypeId: "day2" },
      { ticketId: "b", unitPricePence: 2500, ticketTypeId: "day2" },
      { ticketId: "c", unitPricePence: 2500, ticketTypeId: "day3" },
    ];
    const shares = ticketRefundShares(units, 1000, false, ["day2"]);
    expect(Object.fromEntries(shares)).toEqual({ a: 2000, b: 2000, c: 2500 });
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(7500 - 1000);
    // Old orders (no list): spread over every pass, as before.
    expect([...ticketRefundShares(units, 1500).values()]).toEqual([2000, 2000, 2000]);
  });
});
