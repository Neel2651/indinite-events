import { setTimeout as sleep } from "node:timers/promises";
import { runWithContext, systemActor } from "@indinite/core/context";
import {
  QUEUES,
  connectDb,
  disconnectDb,
  processNextJob,
  reconcileStripe,
  sweepExpiredHolds,
  type MetaPurchaseJob,
  type QueueName,
  type SendAuthEmailJob,
  type SendPaymentLinkJob,
  type SendRefundEmailJob,
  type SendTicketsJob,
} from "@indinite/db";
import { sendAuthEmail } from "./jobs/auth-emails";
import { metaPurchase } from "./jobs/meta-purchase";
import { sendPaymentLink } from "./jobs/payment-link";
import { sendRefundEmail } from "./jobs/refund-email";
import { sendTickets } from "./jobs/tickets";

await connectDb();

// Every job runs as the system actor so audited() always knows who acted.
const asSystem = <T>(requestId: string, fn: () => Promise<T>) =>
  runWithContext({ actor: systemActor, requestId }, fn);

const POLL_MS = 1_000;
const SWEEP_EVERY_MS = 60_000;
/** Stripe reconciliation: missed webhooks and refunds made in the Stripe dashboard. */
const RECONCILE_EVERY_MS = 15 * 60_000;
const abort = new AbortController();
let stopping = false;
/** Idle wait that ends early on shutdown. */
const idle = (ms: number) => sleep(ms, undefined, { signal: abort.signal }).catch(() => {});

/** One polling loop per concurrency slot; each loop runs jobs back to back and sleeps when idle. */
function runQueue<T>(queue: QueueName, concurrency: number, handler: (data: T, jobId: string) => Promise<void>) {
  const loop = async () => {
    while (!stopping) {
      try {
        const worked = await processNextJob<T>(
          queue,
          (job) => asSystem(`job:${job.jobId}`, () => handler(job.data, job.jobId)),
          (job, err, exhausted) =>
            console.error(`[${queue}] job ${job.jobId} failed (attempt ${job.attempts}/${job.maxAttempts}${exhausted ? ", giving up" : ""}):`, err instanceof Error ? err.message : err),
        );
        if (!worked) await idle(POLL_MS);
      } catch (err) {
        console.error(`[${queue}] poll error:`, err instanceof Error ? err.message : err);
        await idle(POLL_MS);
      }
    }
  };
  return Array.from({ length: concurrency }, loop);
}

// Safe to run on several worker instances at once: releaseHold() only lets one caller win each hold.
async function sweepLoop() {
  while (!stopping) {
    try {
      const released = await asSystem("job:sweep-holds", () => sweepExpiredHolds());
      if (released) console.log(`[sweep-holds] released ${released} expired holds`);
    } catch (err) {
      console.error("[sweep-holds] failed:", err instanceof Error ? err.message : err);
    }
    await idle(SWEEP_EVERY_MS);
  }
}

// Also safe on several instances: every fix it makes is conditional and idempotent.
async function reconcileLoop() {
  await idle(60_000); // let the web app and webhooks settle after a deploy
  while (!stopping) {
    try {
      const r = await asSystem("job:reconcile-stripe", () => reconcileStripe());
      if (r && (r.confirmed || r.released || r.refundsRecorded)) console.log(`[reconcile-stripe] confirmed ${r.confirmed}, released ${r.released}, dashboard refunds recorded ${r.refundsRecorded}`);
    } catch (err) {
      console.error("[reconcile-stripe] failed:", err instanceof Error ? err.message : err);
    }
    await idle(RECONCILE_EVERY_MS);
  }
}

const loops = [
  ...runQueue<SendTicketsJob>(QUEUES.sendTickets, 3, sendTickets),
  ...runQueue<SendAuthEmailJob>(QUEUES.sendAuthEmail, 2, sendAuthEmail),
  ...runQueue<SendPaymentLinkJob>(QUEUES.sendPaymentLink, 2, sendPaymentLink),
  ...runQueue<SendRefundEmailJob>(QUEUES.sendRefundEmail, 2, sendRefundEmail),
  ...runQueue<MetaPurchaseJob>(QUEUES.metaPurchase, 2, metaPurchase),
  sweepLoop(),
  reconcileLoop(),
];
console.log("Worker running: send-tickets, send-auth-email, send-payment-link, send-refund-email, meta-purchase, sweep-holds, reconcile-stripe");

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  abort.abort();
  // Let in-flight jobs finish, but don't hang forever on a stuck one (its lock expires and it's retried).
  await Promise.race([Promise.all(loops), sleep(30_000)]);
  await disconnectDb();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
