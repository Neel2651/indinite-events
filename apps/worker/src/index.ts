import { Worker } from "bullmq";
import { runWithContext, systemActor } from "@indinite/core/context";
import {
  QUEUES,
  connectDb,
  redisConnection,
  sweepExpiredHolds,
  sweepHoldsQueue,
  type SendTicketsJob,
} from "@indinite/db";

await connectDb();
const connection = redisConnection();

// Every job runs as the system actor so audited() always knows who acted.
const asSystem = <T>(jobId: string | undefined, fn: () => Promise<T>) =>
  runWithContext({ actor: systemActor, requestId: `job:${jobId ?? "unknown"}` }, fn);

const sweeper = new Worker(
  QUEUES.sweepHolds,
  (job) => asSystem(job.id, async () => {
    const released = await sweepExpiredHolds();
    if (released) console.log(`[sweep-holds] released ${released} expired holds`);
    return { released };
  }),
  { connection, concurrency: 1 },
);

const sendTickets = new Worker<SendTicketsJob>(
  QUEUES.sendTickets,
  (job) => asSystem(job.id, async () => {
    // M5: render PDF passes + QR, send via Resend, audit "order.tickets_sent".
    console.log(`[send-tickets] TODO(M5) order=${job.data.orderId} reason=${job.data.reason}`);
  }),
  { connection, concurrency: 5 },
);

await sweepHoldsQueue().upsertJobScheduler("sweep-every-minute", { every: 60_000 }, { name: "sweep" });

for (const w of [sweeper, sendTickets]) {
  w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
}
console.log("Worker running: send-tickets, sweep-holds");

const shutdown = async () => {
  await Promise.all([sweeper.close(), sendTickets.close()]);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
