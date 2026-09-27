"use server";

import { revalidatePath } from "next/cache";
import { createCoupon, endCoupon, SettingsError } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

export type State = { ok?: string; error?: string } | null;

export async function createCouponAction(slug: string, _: State, form: FormData): Promise<State> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("coupon.manage")) return { error: "You don't have permission to manage coupons." };
  const kind = form.get("kind") === "fixed" ? "fixed" : "percent";
  const amount = Number(String(form.get("amount") ?? "").replace(/[£%\s]/g, ""));
  const maxUses = String(form.get("maxUses") ?? "").trim();
  const date = (k: string) => (String(form.get(k) ?? "") ? new Date(String(form.get(k))) : null);
  try {
    await asStaff(
      user,
      () =>
        createCoupon(organizer.id, user.id, {
          code: String(form.get("code") ?? ""),
          eventId: String(form.get("eventId") ?? "") || null,
          kind,
          value: Math.round(amount * 100),
          maxUses: maxUses ? Number(maxUses) : null,
          validFrom: date("validFrom"),
          validTo: date("validTo"),
        }),
      organizer.id,
    );
  } catch (e) {
    if (e instanceof SettingsError) return { error: e.message };
    if (e instanceof Error && "issues" in e) return { error: (e as unknown as { issues: { message: string }[] }).issues[0]?.message ?? "Check the details." };
    return { error: "Couldn't create the coupon." };
  }
  revalidatePath(`/org/${slug}/coupons`);
  return { ok: "Coupon created." };
}

export async function endCouponAction(slug: string, couponId: string) {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("coupon.manage")) return;
  await asStaff(user, () => endCoupon(organizer.id, couponId), organizer.id);
  revalidatePath(`/org/${slug}/coupons`);
}
