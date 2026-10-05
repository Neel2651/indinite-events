import { z } from "zod";
import { META_CAPI_TOKEN_RE, META_PIXEL_ID_RE, META_TEST_EVENT_CODE_RE } from "./meta-pixel";

const objectId = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const pence = z.number().int().nonnegative();
const bps = z.number().int().min(0).max(10000);

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter the customer's name").max(120),
  email: z.email("Enter a valid email address").transform((e) => e.toLowerCase()),
  phone: z.string().trim().max(30).optional(),
});

export const lineItemInputSchema = z.object({
  ticketTypeId: objectId,
  qty: z.number().int().min(1).max(50),
});

export const discountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), value: bps, reason: z.string().trim().max(200).optional() }),
  z.object({ kind: z.literal("fixed"), value: pence, reason: z.string().trim().max(200).optional() }),
]);

const couponCode = z.string().trim().max(40).transform((c) => c.toUpperCase()).optional();

export const publicCheckoutSchema = z.object({
  eventId: objectId,
  customer: customerSchema,
  items: z.array(lineItemInputSchema).min(1).max(10),
  couponCode,
});

export const paymentLinkBookingSchema = z.object({
  eventId: objectId,
  customer: customerSchema,
  items: z.array(lineItemInputSchema).min(1).max(10),
  discount: discountSchema.optional(),
  couponCode,
  validForHours: z.number().int().min(1).max(24).default(24),
});

export const offlineIssueSchema = z.object({
  eventId: objectId,
  customer: customerSchema,
  items: z.array(lineItemInputSchema).min(1).max(50),
  /** bank_transfer = paid into the organiser's own account. */
  method: z.enum(["cash", "bank_transfer", "complimentary"]),
  couponCode,
  note: z.string().trim().min(3, "Add a note explaining the payment").max(500),
});

export const orderLookupSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  publicId: z.string().trim().min(6).max(20),
});

export const sessionSchema = z.object({
  /** Existing night's id when editing (ticket types and passes point at it); omitted for a new night. */
  id: objectId.optional(),
  label: z.string().trim().min(1, "Give each night a name, e.g. Night 1").max(60),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});

export const venueSchema = z.object({
  name: z.string().trim().min(1, "Enter the venue name").max(120),
  address: z.string().trim().min(1, "Enter the venue address").max(300),
  postcode: z.string().trim().min(2, "Enter the postcode").max(10).transform((p) => p.toUpperCase()),
  mapUrl: z.union([z.url("Enter a full map link, starting https://"), z.literal("")]).optional().transform((u) => u || undefined),
  /** Coordinates for "Get directions" (decimal degrees, e.g. 51.5072, -0.1276). Both or neither. */
  lat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90").optional(),
  lng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180").optional(),
}).refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: "Enter both latitude and longitude, or neither", path: ["lat"] });

export const eventUpsertSchema = z
  .object({
    organizerId: objectId,
    title: z.string().trim().min(3, "Enter a title (at least 3 characters)").max(140),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens")
      .max(80),
    description: z.string().max(20000).default(""),
    venue: venueSchema,
    sessions: z.array(sessionSchema).min(1, "Add at least one night").max(15),
    status: z.enum(["draft", "published", "archived"]).default("draft"),
    /** Organiser's Meta pixel / dataset ID for this event's pages (SPEC §4.11). Digits only; empty means none. */
    metaPixelId: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined)
      .refine((v) => v === undefined || META_PIXEL_ID_RE.test(v), "Enter the pixel / dataset ID: numbers only, e.g. 1862558248490935"),
    /** New Conversions API token. Write-only: empty keeps the saved one; metaCapiTokenRemove clears it. */
    metaCapiToken: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined)
      .refine((v) => v === undefined || META_CAPI_TOKEN_RE.test(v), "Paste the whole access token from Events Manager: letters and numbers, no spaces"),
    metaCapiTokenRemove: z.boolean().optional(),
    /** Meta test event code; while set, server events go to Test events only. Empty clears it. */
    metaTestEventCode: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .transform((v) => v || undefined)
      .refine((v) => v === undefined || META_TEST_EVENT_CODE_RE.test(v), "Enter the test event code from Events Manager, e.g. TEST96780"),
  })
  .refine((e) => e.sessions.every((s) => s.endsAt > s.startsAt), {
    message: "Each night must end after it starts",
    path: ["sessions"],
  })
  .refine((e) => new Set(e.sessions.filter((s) => s.id).map((s) => s.id)).size === e.sessions.filter((s) => s.id).length, {
    message: "The same night appears twice",
    path: ["sessions"],
  });

export const ticketTypeUpsertSchema = z
  .object({
    eventId: objectId,
    name: z.string().trim().min(1, "Enter a name, e.g. Season pass – adult").max(80),
    description: z.string().trim().max(500).default(""),
    pricePence: pence,
    validSessionIds: z.array(objectId).min(1, "Choose at least one night"),
    quota: z.number().int().min(0).max(100000),
    maxPerOrder: z.number().int().min(1).max(50).default(10),
    salesStartAt: z.coerce.date().optional(),
    salesEndAt: z.coerce.date().optional(),
    sortOrder: z.number().int().default(0),
    active: z.boolean().default(true),
  })
  .refine((t) => !t.salesStartAt || !t.salesEndAt || t.salesStartAt < t.salesEndAt, {
    message: "Sales must end after they start",
    path: ["salesEndAt"],
  });

export type PublicCheckoutInput = z.infer<typeof publicCheckoutSchema>;
export type PaymentLinkBookingInput = z.infer<typeof paymentLinkBookingSchema>;
export type OfflineIssueInput = z.infer<typeof offlineIssueSchema>;
export type EventUpsertInput = z.infer<typeof eventUpsertSchema>;
export type TicketTypeUpsertInput = z.infer<typeof ticketTypeUpsertSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
/** What callers pass in (before defaults and transforms). */
export type EventUpsertRaw = z.input<typeof eventUpsertSchema>;
export type TicketTypeUpsertRaw = z.input<typeof ticketTypeUpsertSchema>;

/** Self-registration on /register (1 Oct 2026): the basic details a super admin would enter, no payment details. */
export const registerOrganizerSchema = z
  .object({
    organisationName: z.string().trim().min(2, "Enter your organisation's name").max(120),
    name: z.string().trim().min(1, "Enter your name").max(120),
    email: z.email("Enter a valid email address").transform((e) => e.toLowerCase()),
    password: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string(),
    acceptTerms: z.literal(true, { error: "Tick the box to agree to the terms" }),
  })
  .refine((v) => v.password === v.confirm, { message: "The passwords don't match", path: ["confirm"] });
export type RegisterOrganizerInput = Omit<z.input<typeof registerOrganizerSchema>, "acceptTerms"> & { acceptTerms: boolean };
