import { describe, expect, it } from "vitest";
import {
  META_PIXEL_ID_RE,
  eventUpsertSchema,
  pixelAddToCart,
  pixelButtonName,
  pixelCheckout,
  pixelPaymentInfo,
  pixelPurchase,
  pixelRemoveFromCart,
  pixelValue,
  pixelViewContent,
} from "../src";

const PERSONAL = /name|email|phone|@/i;

describe("Meta pixel parameters", () => {
  it("sends pounds as numbers, never text", () => {
    expect(pixelValue(2500)).toBe(25);
    expect(pixelValue(1999)).toBe(19.99);
    expect(pixelValue(0)).toBe(0);
    expect(typeof pixelAddToCart({ ticketTypeId: "t1", name: "Night 1", unitPricePence: 2000 }).value).toBe("number");
  });

  it("builds every booking step with GBP and real amounts", () => {
    expect(pixelViewContent({ slug: "united-raas-2-0", title: "United Raas 2.0", fromPence: 2000 })).toEqual({
      content_ids: ["united-raas-2-0"],
      content_name: "United Raas 2.0",
      content_type: "product",
      value: 20,
      currency: "GBP",
    });
    expect(pixelViewContent({ slug: "x", title: "X", fromPence: null })).not.toHaveProperty("value");
    expect(pixelAddToCart({ ticketTypeId: "t1", name: "Day 1 – Fri 9 Oct", unitPricePence: 2000 })).toEqual({
      content_ids: ["t1"],
      content_name: "Day 1 – Fri 9 Oct",
      content_type: "product",
      value: 20,
      currency: "GBP",
      num_items: 1,
    });
    expect(pixelRemoveFromCart({ ticketTypeId: "t1", unitPricePence: 2000 })).toEqual({ content_ids: ["t1"], value: 20, currency: "GBP" });
    const lines = [
      { ticketTypeId: "t1", qty: 2 },
      { ticketTypeId: "t2", qty: 1 },
      { ticketTypeId: "t3", qty: 0 },
    ];
    expect(pixelCheckout(lines, 5730)).toEqual({ content_ids: ["t1", "t2"], value: 57.3, currency: "GBP", num_items: 3 });
    expect(pixelPaymentInfo(5730)).toEqual({ value: 57.3, currency: "GBP" });
  });

  it("Purchase carries the order reference as eventID", () => {
    const p = pixelPurchase({ publicId: "OME-7K3F9Q", lines: [{ ticketTypeId: "t1", qty: 2 }], totalPence: 4400 });
    expect(p.options).toEqual({ eventID: "OME-7K3F9Q" });
    expect(p.data).toEqual({ content_ids: ["t1"], value: 44, currency: "GBP", num_items: 2, content_type: "product" });
  });

  it("never includes personal data keys", () => {
    const all = [pixelCheckout([{ ticketTypeId: "t1", qty: 1 }], 100), pixelPaymentInfo(100), pixelRemoveFromCart({ ticketTypeId: "t1", unitPricePence: 1 })];
    for (const params of all) for (const key of Object.keys(params)) expect(key).not.toMatch(PERSONAL);
  });

  it("names buttons in snake_case", () => {
    expect(pixelButtonName("Get directions")).toBe("get_directions");
    expect(pixelButtonName("  Find my tickets! ")).toBe("find_my_tickets");
    expect(pixelButtonName("—")).toBe("button");
  });
});

describe("Meta pixel ID", () => {
  const base = {
    organizerId: "64b7f0f0f0f0f0f0f0f0f0f0",
    title: "United Raas 2.0",
    slug: "united-raas",
    venue: { name: "Hall", address: "1 Road", postcode: "HA1 1AA" },
    sessions: [{ label: "Day 1", startsAt: "2026-10-09T17:00:00Z", endsAt: "2026-10-09T22:00:00Z" }],
  };

  it("accepts a dataset ID and treats empty as none", () => {
    expect(META_PIXEL_ID_RE.test("1862558248490935")).toBe(true);
    expect(eventUpsertSchema.parse({ ...base, metaPixelId: " 1862558248490935 " }).metaPixelId).toBe("1862558248490935");
    expect(eventUpsertSchema.parse({ ...base, metaPixelId: "" }).metaPixelId).toBeUndefined();
    expect(eventUpsertSchema.parse(base).metaPixelId).toBeUndefined();
  });

  it("refuses anything but digits", () => {
    for (const bad of ["abc", "<script>alert(1)</script>", "1862558248490935'); x('", "123"]) {
      expect(eventUpsertSchema.safeParse({ ...base, metaPixelId: bad }).success).toBe(false);
    }
  });
});
