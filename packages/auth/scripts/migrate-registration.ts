/**
 * Live database update for organiser self-registration (1 Oct 2026). Run once on each server after pulling the code
 * and before restarting the app (docs/DEPLOY-AAPANEL.md). Safe to run again: it only changes what still needs it.
 *
 *   pnpm migrate:registration            # reports, then asks before changing anything
 *   pnpm migrate:registration -- --yes   # no question (scripts)
 *
 * 1. Every existing account gets mustVerifyEmail: false. Existing staff were invited, so they're never asked to verify.
 * 2. Every existing organiser gets selfRegistered: false.
 * 3. Order prefixes must be unique: where organisers share one, the oldest keeps it and each later one gets a new
 *    prefix made from its name (audited). Existing order references don't change; only new bookings use it.
 * 4. Creates the new unique index on order prefixes.
 */
import mongoose from "mongoose";
import { runWithContext, systemActor } from "@indinite/core/context";
import { audited, connectDb, disconnectDb, Organizer, withTransaction } from "@indinite/db";
import { orderPrefixCandidates } from "../src/organizers";
import { ask } from "./prompt";

const yes = process.argv.includes("--yes");
await connectDb();
const db = mongoose.connection.db!;

const usersToFlag = await db.collection("user").countDocuments({ mustVerifyEmail: { $exists: false } });
const orgsToFlag = await Organizer.countDocuments({ selfRegistered: { $exists: false } });
const all = await Organizer.find({}, { name: 1, orderPrefix: 1, createdAt: 1 }).sort({ createdAt: 1, _id: 1 }).lean();
const byPrefix = new Map<string, typeof all>();
for (const o of all) byPrefix.set(o.orderPrefix, [...(byPrefix.get(o.orderPrefix) ?? []), o]);
const duplicates = [...byPrefix.values()].filter((g) => g.length > 1);
const indexes = await db.collection("organizers").indexes();
const indexMissing = !indexes.some((i) => i.unique && Object.keys(i.key).join() === "orderPrefix");

console.log("Organiser self-registration: database update\n");
console.log(`  Accounts without the email-verification flag: ${usersToFlag}`);
console.log(`  Organisers without the self-registered flag: ${orgsToFlag}`);
if (duplicates.length) {
  console.log("  Order prefixes shared by several organisers (the oldest keeps it):");
  for (const g of duplicates) console.log(`    ${g[0]!.orderPrefix}: ${g.map((o) => o.name).join(", ")}`);
} else console.log("  Order prefixes: all unique");
console.log(`  Unique index on order prefixes: ${indexMissing ? "to create" : "already there"}`);

if (!usersToFlag && !orgsToFlag && !duplicates.length && !indexMissing) {
  console.log("\n✓ Nothing to do.");
  await disconnectDb();
  process.exit(0);
}
if (!yes && (await ask("\nApply these changes? (y/N) ")).toLowerCase() !== "y") {
  console.log("Nothing changed.");
  await disconnectDb();
  process.exit(0);
}

if (usersToFlag) {
  const r = await db.collection("user").updateMany({ mustVerifyEmail: { $exists: false } }, { $set: { mustVerifyEmail: false } });
  console.log(`✓ ${r.modifiedCount} account(s) flagged (they sign in as before)`);
}
if (orgsToFlag) {
  const r = await Organizer.updateMany({ selfRegistered: { $exists: false } }, { $set: { selfRegistered: false } });
  console.log(`✓ ${r.modifiedCount} organiser(s) flagged`);
}

const taken = new Set(all.map((o) => o.orderPrefix));
await runWithContext({ actor: systemActor, requestId: "migrate-registration" }, async () => {
  for (const group of duplicates) {
    for (const o of group.slice(1)) {
      const next = orderPrefixCandidates(o.name).find((p) => !taken.has(p));
      if (!next) throw new Error(`No free prefix for ${o.name}`);
      taken.add(next);
      await withTransaction(async (session) => {
        await Organizer.updateOne({ _id: o._id }, { $set: { orderPrefix: next } }, { session });
        await audited(session, {
          action: "organizer.order_prefix_changed",
          entity: { type: "organizer", id: o._id },
          before: { orderPrefix: o.orderPrefix },
          after: { orderPrefix: next },
          reason: "Order prefixes must be unique (migrate:registration); existing order references are unchanged",
          organizerId: o._id,
        });
      });
      console.log(`✓ ${o.name}: order prefix ${o.orderPrefix} → ${next} (new bookings only)`);
    }
  }
});

await Organizer.syncIndexes();
console.log("✓ Indexes up to date (order prefixes are now unique)");
await disconnectDb();
process.exit(0);
