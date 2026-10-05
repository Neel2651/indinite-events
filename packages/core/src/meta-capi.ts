import { createHash } from "node:crypto";
import { metaPurchaseEventId, pixelCheckout, type PixelLine } from "./meta-pixel";

/**
 * Server-only. Meta Conversions API Purchase (SPEC §4.11, OM Events brief 5 Oct 2026). Sent by the worker after the
 * payment-confirmed webhook, with the same event_id as the browser Purchase so Meta de-duplicates them.
 * Email and phone are SHA-256 hashed; IP, user agent, fbp and fbc are sent as they are (Meta's rules).
 */

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export const hashEmail = (email: string) => sha256(email.trim().toLowerCase());

/** Digits with the country code, as Meta wants: "07700 900123" → "447700900123", "+91 98…" → "9198…". */
export function normalisePhone(phone: string): string | null {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2) || null;
  if (digits.startsWith("0")) digits = `44${digits.slice(1)}`; // UK national number
  return digits.length >= 8 ? digits : null;
}

export const hashPhone = (phone: string) => {
  const n = normalisePhone(phone);
  return n ? sha256(n) : null;
};

export interface CapiPurchaseInput {
  publicId: string;
  paidAt: Date;
  /** Public event page, e.g. https://events.indinite.co.uk/e/united-raas-2-0-by-om-events */
  eventSourceUrl: string;
  customer: { email: string; phone?: string | null };
  tracking?: { ip?: string | null; userAgent?: string | null; fbp?: string | null; fbc?: string | null } | null;
  lines: PixelLine[];
  totalPence: number;
  testEventCode?: string | null;
}

/** The request body for POST /{pixel_id}/events, without the access token (the worker adds it). */
export function capiPurchasePayload(i: CapiPurchaseInput) {
  const ph = i.customer.phone ? hashPhone(i.customer.phone) : null;
  const t = i.tracking ?? {};
  const { content_ids, value, currency, num_items } = pixelCheckout(i.lines, i.totalPence);
  return {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(i.paidAt.getTime() / 1000),
        event_id: metaPurchaseEventId(i.publicId),
        action_source: "website",
        event_source_url: i.eventSourceUrl,
        user_data: {
          em: [hashEmail(i.customer.email)],
          ...(ph ? { ph: [ph] } : {}),
          ...(t.ip ? { client_ip_address: t.ip } : {}),
          ...(t.userAgent ? { client_user_agent: t.userAgent } : {}),
          ...(t.fbp ? { fbp: t.fbp } : {}),
          ...(t.fbc ? { fbc: t.fbc } : {}),
        },
        custom_data: { currency, value, content_ids, content_type: "product", num_items },
      },
    ],
    ...(i.testEventCode ? { test_event_code: i.testEventCode } : {}),
  };
}
