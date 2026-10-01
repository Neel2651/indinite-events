import { assertCan, ORG_ROLES, type AuthUser, type OrgRole } from "@indinite/core";
import { audited, Organizer, withTransaction, enqueueSendAuthEmail } from "@indinite/db";
import type { Auth } from "./auth";
import { appUrl } from "./auth";
import { isOrgRole, ROLE_LABELS } from "./roles";

/** The signed-in staff member, ready for `can()`. */
export interface StaffUser extends AuthUser {
  email: string;
  name: string;
  organizers: { id: string; name: string; slug: string; role: OrgRole }[];
}

interface BaUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin?: boolean | null;
}
interface BaMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}
interface BaInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  inviterId: string;
}

export class MembershipError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 = 400,
    /** The form field the message is about, so the form can highlight it. */
    readonly field?: string,
  ) {
    super(message);
  }
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function adapter(auth: Auth) {
  return (await auth.$context).adapter;
}

/** Session → StaffUser (memberships mapped from Better Auth orgs to Organizer ids). Null when signed out. */
export async function loadStaffUser(auth: Auth, headers: Headers): Promise<StaffUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const user = session.user as typeof session.user & { isSuperAdmin?: boolean | null };
  const db = await adapter(auth);
  const members = await db.findMany<BaMember>({ model: "member", where: [{ field: "userId", value: user.id }] });
  const orgIds = members.map((m) => String(m.organizationId));
  const organizers = orgIds.length
    ? await Organizer.find({ authOrgId: { $in: orgIds }, status: "active" }, { name: 1, slug: 1, authOrgId: 1 }).sort({ name: 1 }).lean()
    : [];
  const byAuthOrg = new Map(organizers.map((o) => [o.authOrgId, o]));
  const list = members
    .filter((m) => isOrgRole(m.role) && byAuthOrg.has(String(m.organizationId)))
    .map((m) => {
      const o = byAuthOrg.get(String(m.organizationId))!;
      return { id: String(o._id), name: o.name, slug: o.slug, role: m.role as OrgRole };
    });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin === true,
    memberships: list.map((o) => ({ organizerId: o.id, role: o.role })),
    organizers: list,
  };
}

async function loadOrganizer(organizerId: string) {
  const org = await Organizer.findById(organizerId).lean();
  if (!org) throw new MembershipError("Organiser not found.", 404);
  return org;
}

export interface MemberRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt: Date;
}
export interface InvitationRow {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
}

export async function listMembers(auth: Auth, actor: StaffUser, organizerId: string) {
  assertCan(actor, "org.members.manage", { organizerId });
  const org = await loadOrganizer(organizerId);
  const db = await adapter(auth);
  const members = await db.findMany<BaMember>({ model: "member", where: [{ field: "organizationId", value: org.authOrgId }] });
  const users = members.length
    ? await db.findMany<BaUser>({ model: "user", where: [{ field: "id", operator: "in", value: members.map((m) => String(m.userId)) }] })
    : [];
  const userById = new Map(users.map((u) => [String(u.id), u]));
  const invitations = await db.findMany<BaInvitation>({
    model: "invitation",
    where: [
      { field: "organizationId", value: org.authOrgId },
      { field: "status", value: "pending" },
    ],
  });
  const now = Date.now();
  return {
    members: members
      .filter((m) => isOrgRole(m.role))
      .map<MemberRow>((m) => ({
        memberId: String(m.id),
        userId: String(m.userId),
        name: userById.get(String(m.userId))?.name ?? "",
        email: userById.get(String(m.userId))?.email ?? "",
        role: m.role as OrgRole,
        joinedAt: new Date(m.createdAt),
      }))
      .sort((a, b) => ORG_ROLES.indexOf(a.role) - ORG_ROLES.indexOf(b.role) || a.name.localeCompare(b.name)),
    invitations: invitations
      .filter((i) => isOrgRole(i.role) && new Date(i.expiresAt).getTime() > now)
      .map<InvitationRow>((i) => ({ id: String(i.id), email: i.email, role: i.role as OrgRole, expiresAt: new Date(i.expiresAt) })),
  };
}

/** Invite someone to an organiser with a role. Super admins use this to invite an organiser's first owner. */
export async function inviteMember(auth: Auth, actor: StaffUser, organizerId: string, emailInput: string, role: OrgRole) {
  assertCan(actor, "org.members.manage", { organizerId });
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MembershipError("Enter a valid email address.");
  const org = await loadOrganizer(organizerId);
  const db = await adapter(auth);

  const existingUser = await db.findOne<BaUser>({ model: "user", where: [{ field: "email", value: email }] });
  if (existingUser) {
    const already = await db.findOne<BaMember>({
      model: "member",
      where: [
        { field: "organizationId", value: org.authOrgId },
        { field: "userId", value: existingUser.id },
      ],
    });
    if (already) throw new MembershipError(`${email} is already a member.`, 409);
  }

  // Replace any earlier pending invitation for this email.
  const pending = await db.findMany<BaInvitation>({
    model: "invitation",
    where: [
      { field: "organizationId", value: org.authOrgId },
      { field: "email", value: email },
      { field: "status", value: "pending" },
    ],
  });
  for (const p of pending) await db.update({ model: "invitation", where: [{ field: "id", value: p.id }], update: { status: "canceled" } });

  const invitation = await db.create<Record<string, unknown>, BaInvitation>({
    model: "invitation",
    data: {
      organizationId: org.authOrgId,
      email,
      role,
      status: "pending",
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      inviterId: actor.id,
      createdAt: new Date(),
    },
  });

  await withTransaction((session) =>
    audited(session, {
      action: "member.invited",
      entity: { type: "member", id: String(invitation.id) },
      after: { email, role },
      organizerId,
    }),
  );
  await enqueueSendAuthEmail({
    kind: "invitation",
    to: email,
    url: `${appUrl()}/invite/${invitation.id}`,
    organizationName: org.name,
    role: ROLE_LABELS[role],
    inviterName: actor.name,
  });
  return { invitationId: String(invitation.id) };
}

export async function cancelInvitation(auth: Auth, actor: StaffUser, organizerId: string, invitationId: string) {
  assertCan(actor, "org.members.manage", { organizerId });
  const org = await loadOrganizer(organizerId);
  const db = await adapter(auth);
  const inv = await db.findOne<BaInvitation>({ model: "invitation", where: [{ field: "id", value: invitationId }] });
  if (!inv || String(inv.organizationId) !== org.authOrgId || inv.status !== "pending") throw new MembershipError("Invitation not found.", 404);
  await db.update({ model: "invitation", where: [{ field: "id", value: invitationId }], update: { status: "canceled" } });
  await withTransaction((session) =>
    audited(session, { action: "member.invitation_cancelled", entity: { type: "member", id: invitationId }, before: { email: inv.email, role: inv.role }, organizerId }),
  );
}

async function loadMember(auth: Auth, authOrgId: string, memberId: string) {
  const db = await adapter(auth);
  const member = await db.findOne<BaMember>({ model: "member", where: [{ field: "id", value: memberId }] });
  if (!member || String(member.organizationId) !== authOrgId) throw new MembershipError("Member not found.", 404);
  return { db, member };
}

async function ownerCount(auth: Auth, authOrgId: string) {
  const db = await adapter(auth);
  return db.count({ model: "member", where: [{ field: "organizationId", value: authOrgId }, { field: "role", value: "owner" }] });
}

export async function changeMemberRole(auth: Auth, actor: StaffUser, organizerId: string, memberId: string, role: OrgRole) {
  assertCan(actor, "org.members.manage", { organizerId });
  const org = await loadOrganizer(organizerId);
  const { db, member } = await loadMember(auth, org.authOrgId, memberId);
  if (member.role === role) return;
  if (member.role === "owner" && (await ownerCount(auth, org.authOrgId)) <= 1) {
    throw new MembershipError("Every organiser needs at least one owner. Make someone else an owner first.", 409);
  }
  await db.update({ model: "member", where: [{ field: "id", value: memberId }], update: { role } });
  await withTransaction((session) =>
    audited(session, { action: "member.role_changed", entity: { type: "member", id: memberId }, before: { role: member.role }, after: { role }, organizerId }),
  );
}

export async function removeMember(auth: Auth, actor: StaffUser, organizerId: string, memberId: string) {
  assertCan(actor, "org.members.manage", { organizerId });
  const org = await loadOrganizer(organizerId);
  const { db, member } = await loadMember(auth, org.authOrgId, memberId);
  if (member.role === "owner" && (await ownerCount(auth, org.authOrgId)) <= 1) {
    throw new MembershipError("You can't remove the last owner.", 409);
  }
  await db.delete({ model: "member", where: [{ field: "id", value: memberId }] });
  // Sign them out of this device list: their sessions stay valid but they no longer have the membership.
  await withTransaction((session) =>
    audited(session, { action: "member.removed", entity: { type: "member", id: memberId }, before: { userId: String(member.userId), role: member.role }, organizerId }),
  );
}

/** Invitation details for the accept page (no auth needed: the id is an unguessable token). */
export async function getInvitation(auth: Auth, invitationId: string) {
  const db = await adapter(auth);
  const inv = await db.findOne<BaInvitation>({ model: "invitation", where: [{ field: "id", value: invitationId }] }).catch(() => null);
  if (!inv) return null;
  const org = await Organizer.findOne({ authOrgId: String(inv.organizationId) }, { name: 1 }).lean();
  const hasAccount = !!(await db.findOne<BaUser>({ model: "user", where: [{ field: "email", value: inv.email }] }));
  return {
    id: String(inv.id),
    email: inv.email,
    role: isOrgRole(inv.role) ? ROLE_LABELS[inv.role] : inv.role,
    organizerName: org?.name ?? "an organiser",
    status: inv.status,
    expired: new Date(inv.expiresAt).getTime() <= Date.now(),
    hasAccount,
  };
}
