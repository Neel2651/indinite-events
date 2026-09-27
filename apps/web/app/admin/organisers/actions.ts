"use server";

import { revalidatePath } from "next/cache";
import { createOrganizer, createOrganizerSchema, inviteMember, MembershipError } from "@indinite/auth";
import { setOrganizerCommission, SettingsError } from "@indinite/db";
import { auth } from "@/lib/auth";
import { asStaff, requireSuperAdmin } from "@/lib/staff";

export type ActionState = { error?: string; ok?: string } | null;

export async function createOrganizerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const commissionPercent = Number(form.get("commissionPercent"));
  const parsed = createOrganizerSchema.safeParse({
    name: form.get("name"),
    slug: String(form.get("slug") ?? "").toLowerCase(),
    contactEmail: form.get("contactEmail"),
    commissionBps: Number.isFinite(commissionPercent) ? Math.round(commissionPercent * 100) : NaN,
    orderPrefix: String(form.get("orderPrefix") ?? "").toUpperCase(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };

  const ownerEmail = String(form.get("ownerEmail") ?? "").trim();
  try {
    const org = await asStaff(user, () => createOrganizer(auth, user, parsed.data));
    if (ownerEmail) await asStaff(user, () => inviteMember(auth, user, org.id, ownerEmail, "owner"), org.id);
    revalidatePath("/admin/organisers");
    return { ok: ownerEmail ? `Created ${parsed.data.name} and invited ${ownerEmail} as owner.` : `Created ${parsed.data.name}.` };
  } catch (e) {
    if (e instanceof MembershipError) return { error: e.message };
    console.error("[admin] create organiser failed", e instanceof Error ? e.message : e);
    return { error: "Couldn't create the organiser. Please try again." };
  }
}

export async function organizerCommissionAction(organizerId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const bps = Math.round(Number(form.get("commissionPercent")) * 100);
  if (!(bps >= 0 && bps <= 10000)) return { error: "Enter a percentage between 0 and 100." };
  try {
    await asStaff(user, () => setOrganizerCommission(organizerId, bps), organizerId);
  } catch (e) {
    return { error: e instanceof SettingsError ? e.message : "Couldn't save." };
  }
  revalidatePath("/admin/organisers");
  return { ok: "Saved" };
}
