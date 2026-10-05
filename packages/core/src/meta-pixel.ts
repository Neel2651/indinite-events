/**
 * Meta pixel event parameters (SPEC §4.11, OM Events brief 3 Oct 2026). Pure builders shared by the booking form and
 * the confirmation page. Meta wants pounds as numbers ("25", not "£25"): `pixelValue` is the only place pence become
 * pounds, at Meta's boundary. No names, emails or phone numbers ever go in these.
 */

/** Pixel / dataset IDs are numbers only, so nothing but digits can reach the script tag. */
export const META_PIXEL_ID_RE = /^\d{10,20}$/;

export const pixelValue = (pence: number): number => Math.round(pence) / 100;

const CURRENCY = "GBP" as const;

export interface PixelLine {
  ticketTypeId: string;
  qty: number;
}

const ids = (lines: PixelLine[]) => [...new Set(lines.filter((l) => l.qty > 0).map((l) => l.ticketTypeId))];
const count = (lines: PixelLine[]) => lines.reduce((n, l) => n + Math.max(0, l.qty), 0);

export const pixelViewContent = (e: { slug: string; title: string; fromPence: number | null }) => ({
  content_ids: [e.slug],
  content_name: e.title,
  content_type: "product",
  ...(e.fromPence != null ? { value: pixelValue(e.fromPence) } : {}),
  currency: CURRENCY,
});

export const pixelAddToCart = (t: { ticketTypeId: string; name: string; unitPricePence: number }) => ({
  content_ids: [t.ticketTypeId],
  content_name: t.name,
  content_type: "product",
  value: pixelValue(t.unitPricePence),
  currency: CURRENCY,
  num_items: 1,
});

export const pixelRemoveFromCart = (t: { ticketTypeId: string; unitPricePence: number }) => ({
  content_ids: [t.ticketTypeId],
  value: pixelValue(t.unitPricePence),
  currency: CURRENCY,
});

/** InitiateCheckout and Purchase: every pass in the basket or order, at the real total after any discount. */
export const pixelCheckout = (lines: PixelLine[], totalPence: number) => ({
  content_ids: ids(lines),
  value: pixelValue(totalPence),
  currency: CURRENCY,
  num_items: count(lines),
});

export const pixelPaymentInfo = (totalPence: number) => ({ value: pixelValue(totalPence), currency: CURRENCY });

/** Purchase event ID shared by the browser pixel and the Conversions API, so Meta keeps one of the two (brief 5 Oct). */
export const metaPurchaseEventId = (publicId: string) => `purchase_${publicId}`;

/** Purchase: same shape as checkout, plus the shared event ID so a repeat or the server copy is de-duplicated. */
export const pixelPurchase = (o: { publicId: string; lines: PixelLine[]; totalPence: number }) => ({
  data: { ...pixelCheckout(o.lines, o.totalPence), content_type: "product" },
  options: { eventID: metaPurchaseEventId(o.publicId) },
});

/** Conversions API access token: letters and digits only (no spaces), as Events Manager generates. */
export const META_CAPI_TOKEN_RE = /^[A-Za-z0-9]{20,500}$/;
/** Test event code from Events Manager → Test events, e.g. TEST96780. */
export const META_TEST_EVENT_CODE_RE = /^TEST[A-Z0-9]{1,16}$/;

/** "Get directions" → "get_directions". */
export const pixelButtonName = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "button";
