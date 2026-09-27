/**
 * Put failed jobs back on the queue (e.g. after fixing email config). Emails are idempotent per job, so
 * a job that did send won't send twice within Resend's 24 h idempotency window.
 *
 *   pnpm --filter @indinite/db requeue-failed-jobs              # all queues
 *   pnpm --filter @indinite/db requeue-failed-jobs send-tickets # one queue
 */
import { connectDb, disconnectDb, Job } from "../src";

const queue = process.argv.slice(2).find((a) => !a.startsWith("-"));
await connectDb();
const res = await Job.updateMany(
  { status: "failed", ...(queue ? { queue } : {}), lastError: { $not: /^skipped:/ } },
  { $set: { status: "pending", runAt: new Date(), attempts: 0, lockedUntil: null } },
);
console.log(`Requeued ${res.modifiedCount} failed job(s)${queue ? ` on ${queue}` : ""}`);
await disconnectDb();
