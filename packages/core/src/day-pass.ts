import { z } from "zod";

/**
 * Day passes (agreed 30 Sep 2026): one pass type per night, grouped. Each member is an ordinary one-night pass
 * type named after its night, so orders, passes, receipts, the scanner and exports all show the date.
 */
const nightFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/** "Day pass — adult · Sun 11 Oct" (UK date). */
export function dayPassMemberName(groupName: string, nightStartsAt: Date | string): string {
  return `${groupName.trim()} · ${nightFmt.format(new Date(nightStartsAt))}`;
}

const objectId = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");

export const dayPassUpsertSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name, e.g. Day pass – adult").max(70),
    description: z.string().trim().max(500).default(""),
    maxPerOrder: z.number().int().min(1).max(50).default(10),
    salesStartAt: z.coerce.date().optional(),
    salesEndAt: z.coerce.date().optional(),
    sortOrder: z.number().int().default(0),
    nights: z
      .array(
        z.object({
          sessionId: objectId,
          pricePence: z.number().int().nonnegative(),
          quota: z.number().int().min(0).max(100000),
          active: z.boolean().default(true),
        }),
      )
      .min(1, "Choose at least one night"),
  })
  .refine((d) => new Set(d.nights.map((n) => n.sessionId)).size === d.nights.length, { message: "A night appears twice", path: ["nights"] })
  .refine((d) => !d.salesStartAt || !d.salesEndAt || d.salesStartAt < d.salesEndAt, { message: "Sales must end after they start", path: ["salesEndAt"] });

export type DayPassRaw = z.input<typeof dayPassUpsertSchema>;
export type DayPassInput = z.infer<typeof dayPassUpsertSchema>;
