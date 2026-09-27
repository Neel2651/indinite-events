import { describe, expect, it } from "vitest";
import { ORDER_LINK_TTL_MS, signOrderLink, verifyOrderLink } from "../src/links";

const secret = "x".repeat(48);
const now = Date.UTC(2026, 9, 11, 18, 0);

describe("order links", () => {
  it("verifies a fresh link and reports its expiry", () => {
    const token = signOrderLink("NAV-7K3F9Q", secret, now);
    const res = verifyOrderLink("NAV-7K3F9Q", token, secret, now + 60_000);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.expiresAt.getTime()).toBe(Math.floor((now + ORDER_LINK_TTL_MS) / 1000) * 1000);
  });

  it("expires after 30 minutes", () => {
    const token = signOrderLink("NAV-7K3F9Q", secret, now);
    expect(verifyOrderLink("NAV-7K3F9Q", token, secret, now + ORDER_LINK_TTL_MS)).toEqual({ ok: false, reason: "expired" });
  });

  it("is bound to the order and the secret", () => {
    const token = signOrderLink("NAV-7K3F9Q", secret, now);
    expect(verifyOrderLink("NAV-AAAAAA", token, secret, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyOrderLink("NAV-7K3F9Q", token, "y".repeat(48), now)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects tampered expiry and junk", () => {
    const [exp, sig] = signOrderLink("NAV-7K3F9Q", secret, now).split(".");
    expect(verifyOrderLink("NAV-7K3F9Q", `${Number(exp) + 3600}.${sig}`, secret, now)).toEqual({ ok: false, reason: "bad_signature" });
    for (const junk of ["", "abc", "1.2.3", "x.y", `${exp}.`]) {
      expect(verifyOrderLink("NAV-7K3F9Q", junk, secret, now).ok).toBe(false);
    }
  });

  it("refuses short secrets", () => {
    expect(() => signOrderLink("NAV-7K3F9Q", "short", now)).toThrow(/at least 32/);
  });
});
