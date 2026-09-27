import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only. Signed, expiring links for customers ("View tickets", SPEC §4.4):
 *   token = <expiresAtSeconds>.<base64url HMAC-SHA256("order:<publicId>:<expiresAtSeconds>")>
 * The token only proves "whoever has this may view order <publicId> until <expiry>".
 */
export const ORDER_LINK_TTL_MS = 30 * 60_000;

function mac(publicId: string, exp: number, secret: string) {
  if (!secret || secret.length < 32) throw new Error("LINK_SIGNING_SECRET must be at least 32 characters");
  return createHmac("sha256", secret).update(`order:${publicId}:${exp}`).digest("base64url");
}

export function signOrderLink(publicId: string, secret: string, now = Date.now(), ttlMs = ORDER_LINK_TTL_MS): string {
  const exp = Math.floor((now + ttlMs) / 1000);
  return `${exp}.${mac(publicId, exp, secret)}`;
}

export type OrderLinkResult = { ok: true; expiresAt: Date } | { ok: false; reason: "malformed" | "expired" | "bad_signature" };

export function verifyOrderLink(publicId: string, token: string, secret: string, now = Date.now()): OrderLinkResult {
  const [expPart, sig, ...rest] = token.split(".");
  if (!expPart || !sig || rest.length || !/^\d{1,12}$/.test(expPart)) return { ok: false, reason: "malformed" };
  const exp = Number(expPart);
  const expected = Buffer.from(mac(publicId, exp, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  if (exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt: new Date(exp * 1000) };
}

/** Reads LINK_SIGNING_SECRET, failing loudly if it's missing. */
export function linkSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.LINK_SIGNING_SECRET;
  if (!secret) throw new Error("LINK_SIGNING_SECRET is not set (generate one: openssl rand -base64 48)");
  return secret;
}
