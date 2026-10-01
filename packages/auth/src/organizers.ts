import { z } from "zod";
import { assertCan, DEFAULT_COMMISSION_BPS, randomOrderPrefix, registerOrganizerSchema, slugCandidates, suggestOrderPrefixes, type RegisterOrganizerInput } from "@indinite/core";
import { runWithContext } from "@indinite/core/context";
import { audited, Organizer, withTransaction } from "@indinite/db";
import type { ClientSession } from "mongoose";
import type { Auth } from "./auth";
import { MembershipError, type StaffUser } from "./staff";

/**
 * Super admin: create an organiser. The web address and order reference prefix are made from the name (1 Oct 2026),
 * not typed.
 */
export const createOrganizerSchema = z.object({
  name: z.string().trim().min(2, "Enter the organiser's name").max(120),
  contactEmail: z.email("Enter a valid contact email").transform((e) => e.toLowerCase()),
  commissionBps: z.number().int().min(0).max(10000),
});
export type CreateOrganizerInput = z.input<typeof createOrganizerSchema>;

const isDuplicateKey = (e: unknown, field?: string) =>
  typeof e === "object" && e !== null && "code" in e && e.code === 11000 && (!field || JSON.stringify((e as { keyPattern?: unknown }).keyPattern ?? {}).includes(field));

type AuthDb = Awaited<Auth["$context"]>["adapter"];

/** First free web address for this name (checked against organisers and their Better Auth organisations). */
export async function uniqueOrganizerSlug(auth: Auth, name: string): Promise<string> {
  const db = (await auth.$context).adapter;
  for (const slug of slugCandidates(name)) {
    const taken = (await Organizer.exists({ slug })) || (await db.findOne({ model: "organization", where: [{ field: "slug", value: slug }] }));
    if (!taken) return slug;
  }
  throw new MembershipError("Couldn't make a web address for that name. Try a slightly different name.", 409, "name");
}

/** Order prefix candidates for a name, in order: initials, start of the name, variations, then random letters. */
export function orderPrefixCandidates(name: string): string[] {
  const random = Array.from({ length: 20 }, () => randomOrderPrefix());
  return [...new Set([...suggestOrderPrefixes(name), ...random])];
}

/** Create the Organizer with the first order prefix not in use. */
async function insertOrganizer(session: ClientSession, data: Record<string, unknown> & { name: string }) {
  const taken = new Set((await Organizer.find({}, { orderPrefix: 1 }, { session }).lean()).map((o) => o.orderPrefix));
  const orderPrefix = orderPrefixCandidates(data.name).find((p) => !taken.has(p));
  if (!orderPrefix) throw new MembershipError("Couldn't pick an order reference prefix. Please try again.", 409);
  const [organizer] = await Organizer.create([{ ...data, orderPrefix }], { session });
  return organizer!;
}

/**
 * Run a transaction that inserts an organiser. The unique index on orderPrefix decides races: if another organiser
 * took the same prefix at the same moment, the transaction is aborted by Mongo, so run it again (it re-reads which
 * prefixes are taken and picks the next one).
 */
async function withUniquePrefix<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTransaction(fn);
    } catch (e) {
      if (!isDuplicateKey(e, "orderPrefix") || attempt >= 5) throw e;
    }
  }
}

async function createAuthOrg(db: AuthDb, name: string, slug: string) {
  return db.create<Record<string, unknown>, { id: string }>({ model: "organization", data: { name, slug, createdAt: new Date() } });
}

/** Super admin: create an Organizer and its Better Auth organisation. Invite the first owner with inviteMember(). */
export async function createOrganizer(auth: Auth, actor: StaffUser, input: CreateOrganizerInput) {
  assertCan(actor, "organizer.manage");
  const data = createOrganizerSchema.parse(input);
  const slug = await uniqueOrganizerSlug(auth, data.name);
  const db = (await auth.$context).adapter;
  const baOrg = await createAuthOrg(db, data.name, slug);
  try {
    return await withUniquePrefix(async (session) => {
      const organizer = await insertOrganizer(session, { ...data, slug, authOrgId: String(baOrg.id) });
      await audited(session, { action: "organizer.created", entity: { type: "organizer", id: organizer._id }, after: organizer.toObject(), organizerId: organizer._id });
      return { id: String(organizer._id), slug: organizer.slug, orderPrefix: organizer.orderPrefix };
    });
  } catch (e) {
    // Don't leave an orphaned auth organisation behind.
    await db.delete({ model: "organization", where: [{ field: "id", value: baOrg.id }] }).catch(() => {});
    throw e;
  }
}

/**
 * Self-registration (1 Oct 2026): a new organiser and its owner, from /register.
 * - Platform fee: Indinite's default (10%). No payment details are taken.
 * - The owner can't sign in until they've clicked the link in the verification email (mustVerifyEmail).
 * Everything is undone if a step fails, so no orphan account or organisation is left. Returns the web address so
 * the caller can send the verification email with the right return page.
 */
export async function registerOrganizer(auth: Auth, input: RegisterOrganizerInput, requestId: string) {
  const data = registerOrganizerSchema.parse(input);
  const ctx = await auth.$context;
  const db = ctx.adapter;
  if (await db.findOne({ model: "user", where: [{ field: "email", value: data.email }] })) {
    throw new MembershipError("There's already an account with this email. Sign in, or reset your password if you've forgotten it.", 409, "email");
  }

  // Server-side sign-up: the invitation-only rule only applies to sign-ups over HTTP.
  const created = await auth.api.signUpEmail({ body: { email: data.email, password: data.password, name: data.name } });
  const userId = created.user.id;
  let authOrgId: string | null = null;
  try {
    await db.update({ model: "user", where: [{ field: "id", value: userId }], update: { mustVerifyEmail: true } });
    // Better Auth may have started a session for the new account; it must sign in only after verifying.
    await db.deleteMany({ model: "session", where: [{ field: "userId", value: userId }] });

    const slug = await uniqueOrganizerSlug(auth, data.organisationName);
    authOrgId = String((await createAuthOrg(db, data.organisationName, slug)).id);
    await db.create({ model: "member", data: { organizationId: authOrgId, userId, role: "owner", createdAt: new Date() } });

    const organizer = await runWithContext({ actor: { type: "user", id: userId }, requestId }, () =>
      withUniquePrefix(async (session) => {
        const o = await insertOrganizer(session, {
          name: data.organisationName,
          slug,
          contactEmail: data.email,
          commissionBps: DEFAULT_COMMISSION_BPS,
          authOrgId,
          selfRegistered: true,
        });
        await audited(session, { action: "organizer.self_registered", entity: { type: "organizer", id: o._id }, after: o.toObject(), organizerId: o._id });
        return o;
      }),
    );
    return { userId, organizerId: String(organizer._id), slug: organizer.slug, orderPrefix: organizer.orderPrefix, email: data.email };
  } catch (e) {
    // Undo: membership, organisation, the account and its password.
    if (authOrgId) {
      await db.deleteMany({ model: "member", where: [{ field: "organizationId", value: authOrgId }] }).catch(() => {});
      await db.delete({ model: "organization", where: [{ field: "id", value: authOrgId }] }).catch(() => {});
    }
    await db.deleteMany({ model: "session", where: [{ field: "userId", value: userId }] }).catch(() => {});
    await db.deleteMany({ model: "account", where: [{ field: "userId", value: userId }] }).catch(() => {});
    await db.delete({ model: "user", where: [{ field: "id", value: userId }] }).catch(() => {});
    throw e;
  }
}
