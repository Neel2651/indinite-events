import { ed25519 } from "@noble/curves/ed25519";
import { base64urlToBytes, bytesToBase64url, bytesToHex, hexToBytes } from "./base64url";

/**
 * QR payload format: `v1.<ticketId>.<signature>`
 * - ticketId: 24-char Mongo ObjectId hex
 * - signature: Ed25519 over the UTF-8 bytes of `v1.<ticketId>`, base64url
 * No personal data is ever encoded. The scanner verifies offline with the public key.
 */
const VERSION = "v1";
const TICKET_ID_RE = /^[a-f0-9]{24}$/;
const encoder = new TextEncoder();

export function generateQrKeyPair(): { privateKeyHex: string; publicKeyHex: string } {
  const priv = ed25519.utils.randomPrivateKey();
  return { privateKeyHex: bytesToHex(priv), publicKeyHex: bytesToHex(ed25519.getPublicKey(priv)) };
}

export function signTicket(ticketId: string, privateKeyHex: string): string {
  if (!TICKET_ID_RE.test(ticketId)) throw new Error("ticketId must be a 24-char lowercase ObjectId hex");
  const message = `${VERSION}.${ticketId}`;
  const sig = ed25519.sign(encoder.encode(message), hexToBytes(privateKeyHex));
  return `${message}.${bytesToBase64url(sig)}`;
}

export type QrVerifyResult =
  | { ok: true; ticketId: string }
  | { ok: false; reason: "malformed" | "unsupported_version" | "bad_signature" };

export function verifyTicketToken(token: string, publicKeyHex: string): QrVerifyResult {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [version, ticketId, sigPart] = parts as [string, string, string];
  if (version !== VERSION) return { ok: false, reason: "unsupported_version" };
  if (!TICKET_ID_RE.test(ticketId)) return { ok: false, reason: "malformed" };

  let sig: Uint8Array;
  try {
    sig = base64urlToBytes(sigPart);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (sig.length !== 64) return { ok: false, reason: "malformed" };

  try {
    const valid = ed25519.verify(sig, encoder.encode(`${version}.${ticketId}`), hexToBytes(publicKeyHex));
    return valid ? { ok: true, ticketId } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}
