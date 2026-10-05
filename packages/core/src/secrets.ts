import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Server-only. Encrypts settings stored in the database that must never be readable from it alone, such as an
 * event's Meta Conversions API token (SPEC §4.11). AES-256-GCM with SETTINGS_ENCRYPTION_KEY (32 bytes, base64).
 *   stored value = "v1.<iv>.<tag>.<ciphertext>" (base64url parts)
 */
const VERSION = "v1";

export class SettingsKeyError extends Error {}

export function settingsKey(raw = process.env.SETTINGS_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new SettingsKeyError("SETTINGS_ENCRYPTION_KEY isn't set. Generate one with pnpm --filter @indinite/core gen:settings-key.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new SettingsKeyError("SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return key;
}

export function encryptSetting(plain: string, key = settingsKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Throws if the value was encrypted with another key or has been changed. */
export function decryptSetting(stored: string, key = settingsKey()): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Not an encrypted setting.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export const isEncryptedSetting = (v: unknown): v is string => typeof v === "string" && v.startsWith(`${VERSION}.`) && v.split(".").length === 4;
