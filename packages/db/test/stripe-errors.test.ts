import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { stripeErrorMessage } from "../src/stripe";

describe("stripeErrorMessage", () => {
  it("shows Stripe's reason for setup problems, without any API key", () => {
    const e = new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "Please review the responsibilities of managing losses for connected accounts." });
    expect(stripeErrorMessage(e)).toBe("Stripe said: Please review the responsibilities of managing losses for connected accounts.");
    const auth = new Stripe.errors.StripeAuthenticationError({ type: "authentication_error", message: "Invalid API Key provided: sk_test_ab****cdef" });
    expect(stripeErrorMessage(auth)).toBe("Stripe said: Invalid API Key provided: [API key]");
  });

  it("keeps the generic message for anything else", () => {
    expect(stripeErrorMessage(new Error("socket hang up"))).toBe("Something went wrong talking to Stripe. Please try again.");
    expect(stripeErrorMessage(new Stripe.errors.StripeAPIError({ type: "api_error", message: "Internal" }))).toBe("Something went wrong talking to Stripe. Please try again.");
  });
});
