"use server";

import { revalidatePath } from "next/cache";
import { ORG_ROLES, ForbiddenError, type OrgRole } from "@indinite/core";
import { cancelInvitation, changeMemberRole, inviteMember, MembershipError, removeMember } from "@indinite/auth";
import { auth } from "@/lib/auth";
import { asStaff, requireOrg } from "@/lib/staff";

export type ActionState = { error?: string; ok?: string } | null;

const isRole = (r: unknown): r is OrgRole => typeof r === "string" && (ORG_ROLES as readonly string[]).includes(r);

/** Organiser comes from the URL slug + the signed-in user's access, never from form fields. */
async function run(slug: string, fn: (ctx: Awaited<ReturnType<typeof requireOrg>>) => Promise<string>): Promise<ActionState> {
  const ctx = await requireOrg(slug);
  try {
    const ok = await asStaff(ctx.user, () => fn(ctx), ctx.organizer.id);
    revalidatePath(`/org/${slug}/members`);
    return { ok };
  } catch (e) {
    if (e instanceof MembershipError) return { error: e.message };
    if (e instanceof ForbiddenError) return { error: "You don't have permission to manage this team." };
    console.error("[members] action failed", e instanceof Error ? e.message : e);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function inviteAction(slug: string, _: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "");
  const role = form.get("role");
  if (!isRole(role)) return { error: "Choose a role." };
  return run(slug, async ({ user, organizer }) => {
    await inviteMember(auth, user, organizer.id, email, role);
    return `Invitation sent to ${email.trim().toLowerCase()}.`;
  });
}

export async function changeRoleAction(slug: string, memberId: string, role: string): Promise<ActionState> {
  if (!isRole(role)) return { error: "Choose a role." };
  return run(slug, async ({ user, organizer }) => {
    await changeMemberRole(auth, user, organizer.id, memberId, role);
    return "Role updated.";
  });
}

export async function removeMemberAction(slug: string, memberId: string): Promise<ActionState> {
  return run(slug, async ({ user, organizer }) => {
    await removeMember(auth, user, organizer.id, memberId);
    return "Removed from the team.";
  });
}

export async function cancelInvitationAction(slug: string, invitationId: string): Promise<ActionState> {
  return run(slug, async ({ user, organizer }) => {
    await cancelInvitation(auth, user, organizer.id, invitationId);
    return "Invitation cancelled.";
  });
}
