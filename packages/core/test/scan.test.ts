import { describe, expect, it } from "vitest";
import { decideForTicket, decideScan, generateQrKeyPair, normalisePassCode, passCode, signTicket, type ManifestTicket, type PriorAdmission } from "../src";

const keys = generateQrKeyPair();
const night1 = "a".repeat(24);
const night2 = "b".repeat(24);
const ticketId = "6ab82c8e2c4fba4aa337fbc5";

const ticket = (over: Partial<ManifestTicket> = {}): ManifestTicket => ({
  id: ticketId,
  code: "ABCDEFGH",
  status: "valid",
  validSessionIds: [night1],
  ticketTypeName: "Single night",
  orderRef: "NAV-7K3F9Q",
  position: 1,
  count: 1,
  ...over,
});

function run(opts: { token?: string; t?: ManifestTicket | undefined; prior?: PriorAdmission; sessionId?: string } = {}) {
  return decideScan({
    token: opts.token ?? signTicket(ticketId, keys.privateKeyHex),
    publicKeyHex: keys.publicKeyHex,
    sessionId: opts.sessionId ?? night1,
    findTicket: (id) => (id === ticketId ? ("t" in opts ? opts.t : ticket()) : undefined),
    findAdmission: () => opts.prior,
  });
}

describe("decideScan", () => {
  it("admits a valid pass for tonight", () => {
    expect(run().result).toBe("admitted");
  });

  it("flags a second scan tonight with the earlier time and gate", () => {
    const prior = { scannedAt: "2026-10-11T18:42:00Z", gate: "Gate A" };
    expect(run({ prior })).toMatchObject({ result: "already_used", prior });
  });

  it("rejects passes for another night", () => {
    expect(run({ sessionId: night2 }).result).toBe("wrong_session");
  });

  it("rejects cancelled and refunded passes", () => {
    expect(run({ t: ticket({ status: "refunded" }) }).result).toBe("cancelled");
    expect(run({ t: ticket({ status: "cancelled" }) }).result).toBe("cancelled");
  });

  it("rejects forged, tampered and unreadable codes", () => {
    const other = generateQrKeyPair();
    expect(run({ token: signTicket(ticketId, other.privateKeyHex) })).toEqual({ result: "invalid", reason: "bad_signature" });
    const [v, id, sig] = signTicket(ticketId, keys.privateKeyHex).split(".");
    expect(run({ token: `${v}.${id!.replace(/.$/, "0")}.${sig}` }).result).toBe("invalid");
    expect(run({ token: "https://example.com" })).toEqual({ result: "invalid", reason: "unreadable" });
  });

  it("rejects genuine signatures for tickets not in this event's manifest", () => {
    expect(run({ t: undefined })).toEqual({ result: "invalid", reason: "unknown_ticket", ticketId });
  });

  it("pass codes come from the signature, so neighbouring passes can't be guessed", () => {
    const a = passCode(signTicket("6ab82c8e2c4fba4aa337fbc5", keys.privateKeyHex));
    const b = passCode(signTicket("6ab82c8e2c4fba4aa337fbc6", keys.privateKeyHex));
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(a).not.toBe(b);
    // Hamming distance between sequential passes' codes is large (unrelated), not ±1.
    const diff = [...a].filter((c, i) => c !== b[i]).length;
    expect(diff).toBeGreaterThan(3);
    expect(passCode("junk")).toBe("");
    expect(normalisePassCode(" " + a.toLowerCase().replace("-", " ") + " ")).toBe(a.replace("-", ""));
    expect(normalisePassCode("O1IL-0000")).toBe("0111" + "0000");
    expect(normalisePassCode("short")).toBe("");
  });

  it("handles manual lookups the same way", () => {
    const r = decideForTicket(ticketId, { sessionId: night1, findTicket: () => ticket(), findAdmission: () => undefined });
    expect(r.result).toBe("admitted");
  });
});

describe("offline limit", () => {
  it("allows 5 offline scans, then none until they sync", async () => {
    const { OFFLINE_SCAN_LIMIT, offlineScansLeft } = await import("../src");
    expect(OFFLINE_SCAN_LIMIT).toBe(5);
    expect([0, 1, 4, 5, 6].map((n) => offlineScansLeft(n))).toEqual([5, 4, 1, 0, 0]);
  });
});
