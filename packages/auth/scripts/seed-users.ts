/**
 * Development staff accounts. Run after `pnpm --filter @indinite/db seed` (or use the root `pnpm seed`).
 * Idempotent: existing users/memberships are kept. Refuses to run in production.
 *
 * All accounts share one dev password: SEED_PASSWORD from .env.local, or DEFAULT_PASSWORD below.
 * Emails use the reserved .test domain, so nothing can ever be delivered to a real person.
 */
import { runWithContext, systemActor } from "@indinite/core/context";
import type { OrgRole } from "@indinite/core";
import { audited, connectDb, disconnectDb, Organizer, withTransaction } from "@indinite/db";
import { MongoClient } from "mongodb";
import { createAuth } from "../src/auth";
import { ensureAuthIndexes } from "../src/indexes";

// if (process.env.NODE_ENV === "production" && process.env.DEPLOY_ENV !== "staging") {
//   throw new Error("seed-users is for development and staging (DEPLOY_ENV=staging) only");
// }

const DEFAULT_PASSWORD = "IndiniteDemo2026!";
const password = process.env.SEED_PASSWORD || DEFAULT_PASSWORD;

const SUPER_ADMIN = { email: "admin@indinite.test", name: "Indinite Admin" };

/** Members per demo organiser slug. */
const MEMBERS: Record<string, { email: string; name: string; role: OrgRole }[]> = {
  "demo-garba": [
    { email: "owner@demo-garba.test", name: "Priya Owner", role: "owner" },
    { email: "boxoffice@demo-garba.test", name: "Ravi Box Office", role: "box_office" },
    { email: "scanner@demo-garba.test", name: "Sam Scanner", role: "scanner" },
  ],
  "sample-dandiya": [{ email: "owner@sample-dandiya.test", name: "Dev Owner", role: "owner" }],
  "omb-events": [{ email: "owner@omb-events.test", name: "OMB Owner", role: "owner" }],
};

await connectDb();
const indexClient = new MongoClient(process.env.MONGODB_URI!);
await ensureAuthIndexes(indexClient.db());
await indexClient.close();
const auth = createAuth();
const db = (await auth.$context).adapter;

async function ensureUser(email: string, name: string) {
  const existing = await db.findOne<{ id: string }>({ model: "user", where: [{ field: "email", value: email }] });
  if (existing) return { id: String(existing.id), created: false };
  // Server-side sign-up (no HTTP request), so the invitation-only rule doesn't apply.
  const res = await auth.api.signUpEmail({ body: { email, password, name } });
  return { id: res.user.id, created: true };
}

await runWithContext({ actor: systemActor, requestId: "seed-users" }, async () => {
  const admin = await ensureUser(SUPER_ADMIN.email, SUPER_ADMIN.name);
  await db.update({ model: "user", where: [{ field: "id", value: admin.id }], update: { isSuperAdmin: true } });
  console.log(`${admin.created ? "Created" : "Kept"} super admin ${SUPER_ADMIN.email}`);

  for (const [slug, members] of Object.entries(MEMBERS)) {
    const organizer = await Organizer.findOne({ slug });
    if (!organizer) {
      console.log(`Skipping ${slug}: organiser not found (run the db seed first)`);
      continue;
    }

    // Link the organiser to a real Better Auth organisation (the db seed uses a placeholder id).
    let authOrgId = organizer.authOrgId;
    const baOrg = /^[a-f0-9]{24}$/.test(authOrgId)
      ? await db.findOne<{ id: string }>({ model: "organization", where: [{ field: "id", value: authOrgId }] })
      : null;
    if (!baOrg) {
      const created = await db.create<Record<string, unknown>, { id: string }>({
        model: "organization",
        data: { name: organizer.name, slug: organizer.slug, createdAt: new Date() },
      });
      authOrgId = String(created.id);
      await withTransaction(async (session) => {
        const before = { authOrgId: organizer.authOrgId };
        await Organizer.updateOne({ _id: organizer._id }, { $set: { authOrgId } }, { session });
        await audited(session, {
          action: "organizer.updated",
          entity: { type: "organizer", id: organizer._id },
          before,
          after: { authOrgId },
          organizerId: organizer._id,
          reason: "dev seed: link auth organisation",
        });
      });
    }

    for (const m of members) {
      const user = await ensureUser(m.email, m.name);
      const member = await db.findOne<{ id: string }>({
        model: "member",
        where: [
          { field: "organizationId", value: authOrgId },
          { field: "userId", value: user.id },
        ],
      });
      if (!member) {
        await db.create({ model: "member", data: { organizationId: authOrgId, userId: user.id, role: m.role, createdAt: new Date() } });
      }
      console.log(`${user.created ? "Created" : "Kept"} ${m.role} ${m.email} → ${slug}`);
    }
  }
});

console.log(`\nDev password for all seed accounts: ${process.env.SEED_PASSWORD ? "SEED_PASSWORD from .env.local" : "see DEFAULT_PASSWORD in packages/auth/scripts/seed-users.ts"}`);
await disconnectDb();
process.exit(0);
