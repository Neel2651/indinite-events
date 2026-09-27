import { z } from "zod";
import { assertCan } from "@indinite/core";
import { audited, Organizer, withTransaction } from "@indinite/db";
import type { Auth } from "./auth";
import { MembershipError, type StaffUser } from "./staff";

export const createOrganizerSchema = z.object({
  name: z.string().trim().min(2, "Enter the organiser's name").max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens").max(60),
  contactEmail: z.email("Enter a valid contact email").transform((e) => e.toLowerCase()),
  commissionBps: z.number().int().min(0).max(10000),
  orderPrefix: z.string().trim().regex(/^[A-Z]{2,5}$/, "Use 2–5 capital letters, e.g. NAV"),
});
export type CreateOrganizerInput = z.infer<typeof createOrganizerSchema>;

/**
 * Super admin: create an Organizer and its Better Auth organisation (members + roles live there).
 * Invite the first owner afterwards with inviteMember().
 */
export async function createOrganizer(auth: Auth, actor: StaffUser, input: CreateOrganizerInput) {
  assertCan(actor, "organizer.manage");
  const data = createOrganizerSchema.parse(input);
  if (await Organizer.exists({ slug: data.slug })) throw new MembershipError("That web address is already taken.", 409);

  const db = (await auth.$context).adapter;
  const baOrg = await db.create<Record<string, unknown>, { id: string }>({
    model: "organization",
    data: { name: data.name, slug: data.slug, createdAt: new Date() },
  });

  try {
    return await withTransaction(async (session) => {
      const [organizer] = await Organizer.create([{ ...data, authOrgId: String(baOrg.id) }], { session });
      await audited(session, {
        action: "organizer.created",
        entity: { type: "organizer", id: organizer!._id },
        after: organizer!.toObject(),
        organizerId: organizer!._id,
      });
      return { id: String(organizer!._id), slug: organizer!.slug };
    });
  } catch (e) {
    // Don't leave an orphaned auth organisation behind.
    await db.delete({ model: "organization", where: [{ field: "id", value: baOrg.id }] }).catch(() => {});
    throw e;
  }
}
