import { describe, expect, it } from "vitest";
import { offlineIssueSchema, paymentLinkBookingSchema } from "../src";

const base = {
  eventId: "66f1a2b3c4d5e6f708192a3b",
  customer: { name: "Priya Patel", email: "Priya@Example.co.uk" },
  items: [{ ticketTypeId: "66f1a2b3c4d5e6f708192a3c", qty: 2 }],
};

describe("schemas", () => {
  it("lowercases emails and defaults link validity to 24h", () => {
    const parsed = paymentLinkBookingSchema.parse(base);
    expect(parsed.customer.email).toBe("priya@example.co.uk");
    expect(parsed.validForHours).toBe(24);
  });

  it("requires a note for offline issue", () => {
    expect(offlineIssueSchema.safeParse({ ...base, method: "cash", note: "" }).success).toBe(false);
    expect(offlineIssueSchema.safeParse({ ...base, method: "cash", note: "Paid at box office" }).success).toBe(true);
  });

  it("caps payment link validity at Stripe's 24h maximum", () => {
    expect(paymentLinkBookingSchema.safeParse({ ...base, validForHours: 48 }).success).toBe(false);
  });
});
