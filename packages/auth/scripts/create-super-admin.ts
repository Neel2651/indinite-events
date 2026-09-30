/**
 * Production: create (or promote) an Indinite super admin. Safe to re-run: an existing account keeps its password
 * and is made a super admin; use `set-password` to change a password.
 *
 *   pnpm --filter @indinite/auth create-super-admin admin@indinite.co.uk             # asks for the password
 *   ADMIN_PASSWORD='…' pnpm --filter @indinite/auth create-super-admin admin@indinite.co.uk
 *   … --name "Indinite Admin"                                                       # optional display name
 *
 * The password is never stored in code or printed. Reads MONGODB_URI etc. from the project's .env.local.
 * Part of `pnpm setup:production` (docs/DEPLOY-AAPANEL.md).
 */
import { runWithContext, systemActor } from "@indinite/core/context";
import { audited, connectDb, disconnectDb, withTransaction } from "@indinite/db";
import { MongoClient } from "mongodb";
import { createAuth } from "../src/auth";
import { ensureAuthIndexes } from "../src/indexes";
import { askHidden } from "./prompt";

const args = process.argv.slice(2).filter((a) => a !== "--");
const nameAt = args.indexOf("--name");
const name = (nameAt >= 0 ? args[nameAt + 1] : undefined)?.trim() || "Indinite Admin";
const positional = args.filter((a, i) => !a.startsWith("--") && !(nameAt >= 0 && i === nameAt + 1));
const email = positional[0]?.trim().toLowerCase();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: create-super-admin <email> [--name \"Full name\"]");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI isn't set. Run this on the server (it reads the project's .env.local).");
  process.exit(1);
}

await connectDb();
const indexClient = new MongoClient(process.env.MONGODB_URI);
await ensureAuthIndexes(indexClient.db());
await indexClient.close();
const auth = createAuth();
const ctx = await auth.$context;

const existing = await ctx.adapter.findOne<{ id: string; isSuperAdmin?: boolean }>({ model: "user", where: [{ field: "email", value: email }] });
let userId: string;
if (existing) {
  userId = String(existing.id);
  console.log(`${email} already has an account: its password is unchanged (use set-password to change it).`);
} else {
  let password = process.env.ADMIN_PASSWORD ?? "";
  if (!password) {
    password = await askHidden(`Password for ${email}: `);
    if (password !== (await askHidden("Type it again: "))) {
      console.error("The passwords don't match. Nothing changed.");
      process.exit(1);
    }
  }
  if (password.length < 10 || password.length > 128) {
    console.error("Passwords must be 10–128 characters. Nothing changed.");
    process.exit(1);
  }
  // Server-side sign-up (no HTTP request), so the invitation-only rule for staff doesn't apply.
  const res = await auth.api.signUpEmail({ body: { email, password, name } });
  userId = res.user.id;
  console.log(`Created ${email}`);
}

if (existing?.isSuperAdmin) {
  console.log(`${email} is already a super admin.`);
} else {
  await ctx.adapter.update({ model: "user", where: [{ field: "id", value: userId }], update: { isSuperAdmin: true, emailVerified: true } });
  await runWithContext({ actor: systemActor, requestId: "create-super-admin" }, () =>
    withTransaction((session) => audited(session, { action: "user.super_admin_granted", entity: { type: "member", id: userId }, after: { isSuperAdmin: true }, reason: "create-super-admin script" })),
  );
  console.log(`${email} is now a super admin. Sign in at /sign-in.`);
}

await disconnectDb();
// Better Auth keeps its own database connection open; end the process explicitly.
process.exit(0);
