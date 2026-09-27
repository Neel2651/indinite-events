import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { can, type Permission } from "@indinite/core";
import { loadStaffUser, type StaffUser } from "@indinite/auth";
import { connectDb, Organizer } from "@indinite/db";
import { auth } from "./auth";
import { withRequestContext } from "./request-context";

/** The signed-in staff member for this request (cached per request), or null. */
export const getStaffUser = cache(async (): Promise<StaffUser | null> => {
  await connectDb();
  return loadStaffUser(auth, await headers());
});

export async function requireStaff(next?: string): Promise<StaffUser> {
  const user = await getStaffUser();
  if (!user) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return user;
}

export async function requireSuperAdmin(): Promise<StaffUser> {
  const user = await requireStaff("/admin");
  if (!user.isSuperAdmin) notFound();
  return user;
}

/** Organiser by slug, if the user can see it (a member, or a super admin). 404 otherwise, so orgs can't be probed. */
export const requireOrg = cache(async (slug: string) => {
  const user = await requireStaff(`/org/${slug}`);
  const organizer = await Organizer.findOne({ slug }).lean();
  if (!organizer || !can(user, "event.read", { organizerId: String(organizer._id) })) notFound();
  const organizerId = String(organizer._id);
  return {
    user,
    organizer: { id: organizerId, name: organizer.name, slug: organizer.slug, maxDiscountBpsForManager: organizer.maxDiscountBpsForManager ?? 5000 },
    role: user.organizers.find((o) => o.id === organizerId)?.role ?? null,
    can: (permission: Permission) => can(user, permission, { organizerId }),
  };
});

/** Where a user lands after signing in. */
export function homeFor(user: StaffUser): string {
  if (user.isSuperAdmin) return "/admin";
  // Gate staff only need the scanner.
  if (user.organizers.length > 0 && user.organizers.every((o) => o.role === "scanner")) return "/scan";
  if (user.organizers.length === 1) return `/org/${user.organizers[0]!.slug}`;
  return "/org";
}

/** Run a staff mutation with the audit context (actor = this user). */
export function asStaff<T>(user: StaffUser, fn: () => Promise<T>, organizerId?: string) {
  return withRequestContext({ type: "user", id: user.id, role: user.isSuperAdmin ? "super_admin" : undefined }, fn, organizerId);
}
