import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { capiPurchasePayload, hashEmail, hashPhone, normalisePhone } from "../src/meta-capi";
import { decryptSetting, encryptSetting, isEncryptedSetting, settingsKey } from "../src/secrets";
import { eventUpsertSchema } from "../src";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

describe("Conversions API Purchase", () => {
  it("hashes email trimmed and lower-cased, and phone as digits with the country code", () => {
    expect(hashEmail("  Priya@Example.COM ")).toBe(sha("priya@example.com"));
    expect(normalisePhone("07700 900123")).toBe("447700900123");
    expect(normalisePhone("+44 7700 900123")).toBe("447700900123");
    expect(normalisePhone("0044 7700 900123")).toBe("447700900123");
    expect(normalisePhone("+91 98765 43210")).toBe("919876543210");
    expect(normalisePhone("447700900123")).toBe("447700900123");
    expect(normalisePhone("call me")).toBeNull();
    expect(hashPhone("07700 900123")).toBe(sha("447700900123"));
  });

  const base = {
    publicId: "OME-7K3F9Q",
    paidAt: new Date("2026-10-05T18:30:00Z"),
    eventSourceUrl: "https://events.indinite.co.uk/e/united-raas-2-0-by-om-events",
    customer: { email: "Priya@Example.com", phone: "07700 900123" },
    tracking: { ip: "81.2.69.160", userAgent: "Mozilla/5.0 (iPhone)", fbp: "fb.1.1790000000000.123", fbc: "fb.1.1790000000000.AbCd" },
    lines: [
      { ticketTypeId: "t1", qty: 2 },
      { ticketTypeId: "t2", qty: 1 },
    ],
    totalPence: 4400,
  };

  it("matches the brief field for field, with the browser's event ID", () => {
    expect(capiPurchasePayload(base)).toEqual({
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(base.paidAt.getTime() / 1000),
          event_id: "purchase_OME-7K3F9Q",
          action_source: "website",
          event_source_url: base.eventSourceUrl,
          user_data: {
            em: [sha("priya@example.com")],
            ph: [sha("447700900123")],
            client_ip_address: "81.2.69.160",
            client_user_agent: "Mozilla/5.0 (iPhone)",
            fbp: "fb.1.1790000000000.123",
            fbc: "fb.1.1790000000000.AbCd",
          },
          custom_data: { currency: "GBP", value: 44, content_ids: ["t1", "t2"], content_type: "product", num_items: 3 },
        },
      ],
    });
  });

  it("adds the test event code only when set, and leaves out what's missing", () => {
    const p = capiPurchasePayload({ ...base, customer: { email: "a@b.co" }, tracking: null, testEventCode: "TEST96780" });
    expect(p.test_event_code).toBe("TEST96780");
    expect(p.data[0]!.user_data).toEqual({ em: [sha("a@b.co")] });
    expect(capiPurchasePayload(base)).not.toHaveProperty("test_event_code");
    // The customer's name is never sent; email and phone never in plain text.
    expect(JSON.stringify(capiPurchasePayload(base))).not.toMatch(/priya@|07700|Priya/i);
  });
});

describe("encrypted settings", () => {
  const key = randomBytes(32);

  it("round-trips, and the same value encrypts differently each time", () => {
    const a = encryptSetting("EAAGtoken123", key);
    const b = encryptSetting("EAAGtoken123", key);
    expect(a).not.toBe(b);
    expect(isEncryptedSetting(a)).toBe(true);
    expect(a).not.toContain("EAAGtoken123");
    expect(decryptSetting(a, key)).toBe("EAAGtoken123");
  });

  it("fails with another key or a changed value", () => {
    const a = encryptSetting("EAAGtoken123", key);
    expect(() => decryptSetting(a, randomBytes(32))).toThrow();
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSetting(parts.join("."), key)).toThrow();
  });

  it("checks the key's format", () => {
    expect(() => settingsKey("")).toThrow(/isn't set/);
    expect(() => settingsKey(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
    expect(settingsKey(key.toString("base64"))).toHaveLength(32);
  });
});

describe("event Meta settings", () => {
  const ev = {
    organizerId: "64b7f0f0f0f0f0f0f0f0f0f0",
    title: "United Raas 2.0",
    slug: "united-raas",
    venue: { name: "Hall", address: "1 Road", postcode: "HA1 1AA" },
    sessions: [{ label: "Day 1", startsAt: "2026-10-09T17:00:00Z", endsAt: "2026-10-09T22:00:00Z" }],
  };

  it("accepts a token and a test code; blank means none", () => {
    const p = eventUpsertSchema.parse({ ...ev, metaCapiToken: " EAAGm0PX4ZCpsBAAbcdef123456 ", metaTestEventCode: "test96780" });
    expect(p.metaCapiToken).toBe("EAAGm0PX4ZCpsBAAbcdef123456");
    expect(p.metaTestEventCode).toBe("TEST96780");
    const blank = eventUpsertSchema.parse({ ...ev, metaCapiToken: "", metaTestEventCode: "" });
    expect(blank.metaCapiToken).toBeUndefined();
    expect(blank.metaTestEventCode).toBeUndefined();
  });

  it("refuses a token with spaces and a code that isn't TEST…", () => {
    expect(eventUpsertSchema.safeParse({ ...ev, metaCapiToken: "EAAG token with spaces 12345" }).success).toBe(false);
    expect(eventUpsertSchema.safeParse({ ...ev, metaTestEventCode: "PROD123" }).success).toBe(false);
  });
});
