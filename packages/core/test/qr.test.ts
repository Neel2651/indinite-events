import { describe, expect, it } from "vitest";
import { generateQrKeyPair, signTicket, verifyTicketToken } from "../src";

const keys = generateQrKeyPair();
const ticketId = "66f1a2b3c4d5e6f708192a3b";

describe("QR tokens", () => {
  it("round-trips a signed ticket", () => {
    const token = signTicket(ticketId, keys.privateKeyHex);
    expect(token).toMatch(/^v1\.[a-f0-9]{24}\.[A-Za-z0-9_-]{86}$/);
    expect(verifyTicketToken(token, keys.publicKeyHex)).toEqual({ ok: true, ticketId });
  });

  it("stays short enough for a sparse, fast-scanning QR", () => {
    expect(signTicket(ticketId, keys.privateKeyHex).length).toBeLessThan(120);
  });

  it("rejects a tampered ticket id", () => {
    const token = signTicket(ticketId, keys.privateKeyHex);
    const forged = token.replace(ticketId, "66f1a2b3c4d5e6f708192a3c");
    expect(verifyTicketToken(forged, keys.publicKeyHex)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token signed with another key", () => {
    const other = generateQrKeyPair();
    const token = signTicket(ticketId, other.privateKeyHex);
    expect(verifyTicketToken(token, keys.publicKeyHex).ok).toBe(false);
  });

  it("rejects garbage", () => {
    expect(verifyTicketToken("hello", keys.publicKeyHex)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyTicketToken(`v2.${ticketId}.abc`, keys.publicKeyHex)).toEqual({ ok: false, reason: "unsupported_version" });
    expect(verifyTicketToken(`v1.${ticketId}.!!`, keys.publicKeyHex)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses to sign a non-ObjectId", () => {
    expect(() => signTicket("123", keys.privateKeyHex)).toThrow();
  });
});
