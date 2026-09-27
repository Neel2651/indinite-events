import { describe, expect, it } from "vitest";
import { resolvePaymentsMode } from "../src/payments-mode";

describe("resolvePaymentsMode", () => {
  it("defaults to stripe", () => {
    expect(resolvePaymentsMode({})).toBe("stripe");
    expect(resolvePaymentsMode({ NODE_ENV: "production" })).toBe("stripe");
  });

  it("allows demo outside production", () => {
    expect(resolvePaymentsMode({ PAYMENTS_MODE: "demo", NODE_ENV: "development" })).toBe("demo");
    expect(resolvePaymentsMode({ PAYMENTS_MODE: " Demo ", NODE_ENV: "test" })).toBe("demo");
  });

  it("refuses demo in production", () => {
    expect(() => resolvePaymentsMode({ PAYMENTS_MODE: "demo", NODE_ENV: "production" })).toThrow(/not allowed/);
    expect(() => resolvePaymentsMode({ PAYMENTS_MODE: "demo", NODE_ENV: "production", DEPLOY_ENV: "live" })).toThrow(/not allowed/);
  });

  it("allows demo on a production build only for a staging server", () => {
    expect(resolvePaymentsMode({ PAYMENTS_MODE: "demo", NODE_ENV: "production", DEPLOY_ENV: "staging" })).toBe("demo");
  });

  it("rejects unknown modes rather than silently falling back", () => {
    expect(() => resolvePaymentsMode({ PAYMENTS_MODE: "free" })).toThrow(/must be "stripe" or "demo"/);
  });
});
