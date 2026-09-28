"use server";

import { revalidatePath } from "next/cache";
import { recordCommissionPayment, setEventPricing, SettingsError } from "@indinite/db";
import { asStaff, requireSuperAdmin } from "@/lib/staff";

export type State = { ok?: string; error?: string } | null;

const pence = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/[£,\s]/g, "")) * 100);
const bps = (v: FormDataEntryValue | null) => Math.round(Number(v) * 100);

export async function recordPaymentAction(eventId: string, _: State, form: FormData): Promise<State> {
  const user = await requireSuperAdmin();
  const amount = pence(form.get("amount"));
  if (!Number.isInteger(amount) || amount <= 0) return { error: "Enter the amount received, e.g. 125.50" };
  try {
    await asStaff(user, () => recordCommissionPayment(eventId, user.id, amount, String(form.get("note") ?? "")));
  } catch (e) {
    return { error: e instanceof SettingsError ? e.message : e instanceof Error && "issues" in e ? "Add a note, e.g. the bank reference." : "Couldn't record the payment." };
  }
  revalidatePath(`/admin/finance/${eventId}`);
  revalidatePath("/admin/finance");
  return { ok: "Payment recorded." };
}

export async function eventPricingAction(eventId: string, _: State, form: FormData): Promise<State> {
  const user = await requireSuperAdmin();
  const override = String(form.get("commission") ?? "").trim();
  const commissionBps = override === "" ? null : bps(override);
  const taxBps = bps(form.get("tax") || "0");
  const freeComplimentaryPasses = Number(form.get("freeComps") ?? "");
  if (!Number.isInteger(freeComplimentaryPasses) || freeComplimentaryPasses < 0 || freeComplimentaryPasses > 10000) return { error: "Free complimentary passes must be a whole number, 0 or more." };
  if ((commissionBps !== null && !(commissionBps >= 0 && commissionBps <= 10000)) || !(taxBps >= 0 && taxBps <= 10000)) return { error: "Percentages must be between 0 and 100." };
  try {
    await asStaff(user, () => setEventPricing(eventId, { commissionBps, taxBps, freeComplimentaryPasses }));
  } catch (e) {
    return { error: e instanceof SettingsError ? e.message : "Couldn't save." };
  }
  revalidatePath(`/admin/finance/${eventId}`);
  return { ok: "Saved. New bookings use these rates; existing orders keep theirs." };
}
