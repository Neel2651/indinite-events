import { z } from "zod";

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

export const publicCheckoutSchema = z.object({
  eventId: objectId,
  customer: customerSchema,
  items: z.array(lineItemInputSchema).min(1).max(10),
});

export const paymentLinkBookingSchema = z.object({
  eventId: objectId,
  customer: customerSchema,
  items: z.array(lineItemInputSchema).min(1).max(10),
  discount: discountSchema.optional(),
  validForHours: z.number().int().min(1).max(24).default(24),
});

export const offlineIssueSchema = z.object({
  eventId: objectId,
  customer: customerSchema,
  items: z.array(lineItemInputSchema).min(1).max(50),
  method: z.enum(["cash", "bank_transfer", "complimentary"]),
  note: z.string().trim().min(3, "Add a note explaining the payment").max(500),
});

export const orderLookupSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  publicId: z.string().trim().min(6).max(20),
});

export const sessionSchema = z.object({
  label: z.string().trim().min(1).max(60),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});

export const eventUpsertSchema = z
  .object({
    organizerId: objectId,
    title: z.string().trim().min(3).max(140),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens"),
    description: z.string().max(20000).default(""),
    venue: z.object({
      name: z.string().trim().min(1).max(120),
      address: z.string().trim().min(1).max(300),
      postcode: z.string().trim().min(2).max(10),
      mapUrl: z.url().optional(),
    }),
    sessions: z.array(sessionSchema).min(1).max(15),
    status: z.enum(["draft", "published", "archived"]).default("draft"),
  })
  .refine((e) => e.sessions.every((s) => s.endsAt > s.startsAt), {
    message: "Each night must end after it starts",
    path: ["sessions"],
  });

export const ticketTypeUpsertSchema = z.object({
  eventId: objectId,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  pricePence: pence,
  validSessionIds: z.array(objectId).min(1),
  quota: z.number().int().min(0).max(100000),
  maxPerOrder: z.number().int().min(1).max(50).default(10),
  salesStartAt: z.coerce.date().optional(),
  salesEndAt: z.coerce.date().optional(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export type PublicCheckoutInput = z.infer<typeof publicCheckoutSchema>;
export type PaymentLinkBookingInput = z.infer<typeof paymentLinkBookingSchema>;
export type OfflineIssueInput = z.infer<typeof offlineIssueSchema>;
export type EventUpsertInput = z.infer<typeof eventUpsertSchema>;
export type TicketTypeUpsertInput = z.infer<typeof ticketTypeUpsertSchema>;
