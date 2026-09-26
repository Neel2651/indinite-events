import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

/** Queue names and payloads shared by apps/web (enqueue) and apps/worker (process). */
export const QUEUES = {
  sendTickets: "send-tickets",
  sweepHolds: "sweep-holds",
} as const;

export interface SendTicketsJob {
  orderId: string;
  reason: "paid" | "offline_issued" | "resend";
}

const g = globalThis as unknown as { __redis?: IORedis; __queues?: Map<string, Queue> };

export function redisConnection(url = process.env.REDIS_URL): ConnectionOptions {
  if (!url) throw new Error("REDIS_URL is not set");
  // BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
  g.__redis ??= new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  return g.__redis as unknown as ConnectionOptions;
}

function queue(name: string): Queue {
  g.__queues ??= new Map();
  let q = g.__queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000 },
    });
    g.__queues.set(name, q);
  }
  return q;
}

/** jobId = orderId+reason makes enqueueing idempotent (webhook retries won't double-send). */
export function enqueueSendTickets(job: SendTicketsJob) {
  return queue(QUEUES.sendTickets).add("send", job, { jobId: `${job.orderId}:${job.reason}:${job.reason === "resend" ? Date.now() : "once"}` });
}

export function sweepHoldsQueue() {
  return queue(QUEUES.sweepHolds);
}
