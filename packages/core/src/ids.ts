import { customAlphabet } from "nanoid";

/** Crockford base32: no I, L, O, U — easy to read aloud at a gate or over the phone. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const nano = customAlphabet(CROCKFORD, 6);

/** Customer-facing order reference, e.g. NAV-7K3F9Q. Unique index on orders.publicId; retry on collision. */
export function generatePublicId(prefix = "NAV"): string {
  if (!/^[A-Z]{2,5}$/.test(prefix)) throw new Error("Prefix must be 2-5 uppercase letters");
  return `${prefix}-${nano()}`;
}

/** Accepts what customers type ("nav-7k3f9q", "NAV 7K3F9Q", O/0 or I/1 mix-ups in the code part). */
export function normalisePublicId(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  const dash = cleaned.indexOf("-");
  if (dash === -1) return cleaned;
  const prefix = cleaned.slice(0, dash);
  const code = cleaned
    .slice(dash + 1)
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return `${prefix}-${code}`;
}

export const PUBLIC_ID_RE = /^[A-Z]{2,5}-[0-9A-HJKMNP-TV-Z]{6}$/;
