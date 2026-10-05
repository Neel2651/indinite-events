/**
 * Send paid bookings from before the Conversions API went live (5 Oct 2026) to Meta as server Purchases
 * (SPEC §4.11). Meta accepts server events up to 7 days old. Runs on the live server; reports, then asks.
 * Safe to run again: one job per order, and Meta drops duplicates by event ID.
 *
 *   pnpm meta:backfill-purchases                        # every event with a pixel and an access token
 *   pnpm meta:backfill-purchases -- --event <slug>      # one event
 *   pnpm meta:backfill-purchases -- --yes               # no question (scripts)
 *
 * Orders sent while the event had a test event code are sent again for real once the code is cleared.
 */
import { connectDb, disconnectDb, enqueueMetaPurchase, findUnsentMetaPurchases, Job, QUEUES } from "../src";
import { ask } from "./prompt";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const eventSlug = args.includes("--event") ? args[args.indexOf("--event") + 1] : undefined;
// Meta refuses events older than 7 days; keep an hour's margin.
const since = new Date(Date.now() - 7 * 24 * 60 * 60_000 + 60 * 60_000);

await connectDb();
const { events, orders } = await findUnsentMetaPurchases({ since, eventSlug });
const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

console.log("Meta server Purchases not sent yet (paid in the last 7 days)\n");
if (!events.length) console.log(eventSlug ? `  /e/${eventSlug} has no Meta pixel and access token.` : "  No event has a Meta pixel and access token.");
for (const e of events) {
  const mine = orders.filter((o) => String(o.eventId) === String(e._id));
  console.log(`  ${e.title} (/e/${e.slug}): ${mine.length} order(s), ${gbp(mine.reduce((n, o) => n + o.totalPence, 0))}${e.metaTestEventCode ? `  ⚠ test mode (${e.metaTestEventCode}): these go to Test events only` : ""}`);
}
if (!orders.length) {
  console.log("\n✓ Nothing to send.");
  await disconnectDb();
  process.exit(0);
}
if (!yes && (await ask(`\nSend these ${orders.length} booking(s) to Meta? (y/N) `)).toLowerCase() !== "y") {
  console.log("Nothing sent.");
  await disconnectDb();
  process.exit(0);
}

let queued = 0;
for (const o of orders) {
  const jobId = `meta-purchase:${String(o._id)}`;
  // A finished job (e.g. an earlier test send) is put back on the queue; a new order gets a new job.
  const again = await Job.updateOne({ jobId, queue: QUEUES.metaPurchase, status: { $in: ["completed", "failed"] } }, { $set: { status: "pending", runAt: new Date(), attempts: 0, lockedUntil: null, completedAt: null } });
  if (again.modifiedCount || (await enqueueMetaPurchase({ orderId: String(o._id) })).created) queued++;
}
console.log(`✓ Queued ${queued} booking(s). The worker sends them within a few seconds: pm2 logs | grep meta-purchase`);
await disconnectDb();
process.exit(0);
