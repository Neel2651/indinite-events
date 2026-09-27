"use server";

import { revalidatePath } from "next/cache";
import { setEventCharges, SettingsError } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

export type ChargeInput = { name: string; kind: "fixed" | "percent"; amount: string };

/** Charges in the form are entered as £ (fixed) or % (percent); stored as pence / bps. */
export async function saveChargesAction(slug: string, eventId: string, charges: ChargeInput[]): Promise<{ ok?: string; error?: string }> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("event.manageCharges")) return { error: "Only owners can change charges." };
  const parsed = charges
    .filter((c) => c.name.trim() || c.amount.trim())
    .map((c) => ({ name: c.name.trim(), kind: c.kind, value: Math.round(Number(c.amount.replace(/[£%\s]/g, "")) * 100) }));
  if (parsed.some((c) => !c.name || !Number.isFinite(c.value) || c.value < 0)) return { error: "Each charge needs a name and an amount." };
  try {
    await asStaff(user, () => setEventCharges(organizer.id, eventId, parsed), organizer.id);
  } catch (e) {
    return { error: e instanceof SettingsError ? e.message : "Couldn't save the charges." };
  }
  revalidatePath(`/org/${slug}/pricing`);
  return { ok: "Saved. New bookings include these charges." };
}
