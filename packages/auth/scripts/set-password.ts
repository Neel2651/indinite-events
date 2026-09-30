/**
 * Set a staff member's password (and sign them out everywhere). Passwords are stored as one-way hashes,
 * so they can't be read back — this is how you recover access.
 *
 *   pnpm --filter @indinite/auth set-password admin@indinite.test     # asks for the new password
 *   pnpm --filter @indinite/auth set-password --seed-accounts         # all demo accounts → SEED_PASSWORD
 *
 * Reads MONGODB_URI etc. from the project's .env.local. Never prints passwords.
 */
import { connectDb, disconnectDb } from "@indinite/db";
import { createAuth } from "../src/auth";
import { askHidden } from "./prompt";

const SEED_ACCOUNTS = [
  "admin@indinite.test",
  "owner@demo-garba.test",
  "boxoffice@demo-garba.test",
  "scanner@demo-garba.test",
  "owner@sample-dandiya.test",
];

const args = process.argv.slice(2).filter((a) => a !== "--");
const seedMode = args.includes("--seed-accounts");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

if (!seedMode && !email) {
  console.error("Usage: set-password <email>   or   set-password --seed-accounts");
  process.exit(1);
}

let password: string;
if (seedMode) {
  if (process.env.NODE_ENV === "production" && process.env.DEPLOY_ENV !== "staging") {
    console.error("--seed-accounts is for development and staging (DEPLOY_ENV=staging) only");
    process.exit(1);
  }
  password = process.env.SEED_PASSWORD ?? "";
  if (!password) {
    console.error("Set SEED_PASSWORD in .env.local first (at least 10 characters).");
    process.exit(1);
  }
} else {
  password = await askHidden(`New password for ${email}: `);
  const again = await askHidden("Type it again: ");
  if (password !== again) {
    console.error("The passwords don't match. Nothing changed.");
    process.exit(1);
  }
}
if (password.length < 10 || password.length > 128) {
  console.error("Passwords must be 10–128 characters. Nothing changed.");
  process.exit(1);
}

await connectDb();
const auth = createAuth();
const ctx = await auth.$context;
const hash = await ctx.password.hash(password);

let changed = 0;
for (const target of seedMode ? SEED_ACCOUNTS : [email!]) {
  const user = await ctx.adapter.findOne<{ id: string }>({ model: "user", where: [{ field: "email", value: target }] });
  if (!user) {
    console.log(`– ${target}: no such account`);
    continue;
  }
  const account = await ctx.adapter.findOne<{ id: string }>({
    model: "account",
    where: [
      { field: "userId", value: user.id },
      { field: "providerId", value: "credential" },
    ],
  });
  if (account) {
    await ctx.adapter.update({ model: "account", where: [{ field: "id", value: account.id }], update: { password: hash, updatedAt: new Date() } });
  } else {
    await ctx.adapter.create({ model: "account", data: { userId: user.id, providerId: "credential", accountId: user.id, password: hash, createdAt: new Date(), updatedAt: new Date() } });
  }
  // Sign them out everywhere so the old password (or a stolen session) stops working.
  await ctx.adapter.deleteMany({ model: "session", where: [{ field: "userId", value: user.id }] });
  console.log(`✓ ${target}: password updated, signed out of all devices`);
  changed++;
}

console.log(`\n${changed} account(s) updated.${seedMode ? " They now use SEED_PASSWORD from .env.local." : ""}`);
await disconnectDb();
process.exit(0);
