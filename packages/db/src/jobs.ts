import type { ClientSession, Types } from "mongoose";
import { Job } from "./models/job";

/** Queue names and payloads shared by apps/web (enqueue) and apps/worker (process). */
export const QUEUES = {
  sendTickets: "send-tickets",
  sendAuthEmail: "send-auth-email",
  sendPaymentLink: "send-payment-link",
  sendRefundEmail: "send-refund-email",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface SendTicketsJob {
  orderId: string;
  reason: "paid" | "offline_issued" | "resend";
}

/** Account emails for staff (admins and organiser users). */
export type SendAuthEmailJob =
  | { kind: "invitation"; to: string; url: string; organizationName: string; role: string; inviterName: string }
  | { kind: "reset-password"; to: string; url: string; name: string }
  | { kind: "merchant-setup"; to: string; url: string; organizationName: string }
  | { kind: "merchant-active"; to: string; url: string; organizationName: string };

/** SPEC §4.2: email the customer their payment link. */
export interface SendPaymentLinkJob {
  orderId: string;
  url: string;
}

/** SPEC §4.6: tell the customer about a refund (owner refund, or sold out after a late payment). */
export interface SendRefundEmailJob {
  orderId: string;
  /** cancelled: staff cancelled the booking; stripe_refund: refunded in full in the Stripe dashboard. */
  kind: "refund" | "sold_out" | "cancelled" | "stripe_refund";
  /** Index into order.refunds (owner refunds). */
  refundIndex?: number;
}

export interface ClaimedJob<T> {
  _id: Types.ObjectId;
  jobId: string;
  data: T;
  attempts: number;
  maxAttempts: number;
}

const BACKOFF_BASE_MS = 5_000;
const LOCK_MS = 5 * 60_000;

/** Exponential backoff: 5s, 10s, 20s, 40s… after attempt 1, 2, 3, 4… */
export function retryDelayMs(attempt: number): number {
  return BACKOFF_BASE_MS * 2 ** (attempt - 1);
}

/**
 * Add a job unless one with the same jobId already exists (a no-op then).
 * Pass `session` to enqueue atomically with the state change that caused it.
 */
export async function enqueue<T extends object>(
  queue: QueueName,
  jobId: string,
  data: T,
  opts: { session?: ClientSession; maxAttempts?: number } = {},
): Promise<{ created: boolean }> {
  const res = await Job.updateOne(
    { jobId },
    { $setOnInsert: { jobId, queue, data, maxAttempts: opts.maxAttempts ?? 5 } },
    { upsert: true, session: opts.session },
  );
  return { created: res.upsertedCount === 1 };
}

/** jobId = orderId+reason makes enqueueing idempotent (webhook retries won't double-send). */
export function enqueueSendTickets(job: SendTicketsJob, opts: { session?: ClientSession } = {}) {
  const jobId = `${job.orderId}:${job.reason}:${job.reason === "resend" ? Date.now() : "once"}`;
  return enqueue(QUEUES.sendTickets, jobId, job, opts);
}

/** Each invitation / reset request gets its own job (and its own idempotency key). */
export function enqueueSendAuthEmail(job: SendAuthEmailJob) {
  return enqueue(QUEUES.sendAuthEmail, `${job.kind}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`, job, { maxAttempts: 4 });
}

export function enqueueSendPaymentLink(job: SendPaymentLinkJob, opts: { session?: ClientSession } = {}) {
  return enqueue(QUEUES.sendPaymentLink, `${job.orderId}:payment-link`, job, { maxAttempts: 4, session: opts.session });
}

export function enqueueSendRefundEmail(job: SendRefundEmailJob, opts: { session?: ClientSession } = {}) {
  return enqueue(QUEUES.sendRefundEmail, `${job.orderId}:refund:${job.kind}:${job.refundIndex ?? 0}`, job, { maxAttempts: 5, session: opts.session });
}

/**
 * Atomically claim the next due job: a pending one whose runAt has passed, or a running one
 * whose lock expired (its worker died). Only one caller can win each job.
 */
export async function claimJob<T>(queue: QueueName, now = new Date()): Promise<ClaimedJob<T> | null> {
  const job = await Job.findOneAndUpdate(
    {
      queue,
      $or: [
        { status: "pending", runAt: { $lte: now } },
        { status: "running", lockedUntil: { $lt: now } },
      ],
    },
    { $set: { status: "running", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true },
  ).lean();
  if (!job) return null;

  // A reclaimed job whose worker died on its final attempt has no attempts left.
  if (job.attempts > job.maxAttempts) {
    await Job.updateOne({ _id: job._id }, { $set: { status: "failed", lockedUntil: null } });
    return claimJob(queue, now);
  }
  return { _id: job._id, jobId: job.jobId, data: job.data as T, attempts: job.attempts, maxAttempts: job.maxAttempts };
}

export async function completeJob(id: Types.ObjectId) {
  await Job.updateOne(
    { _id: id, status: "running" },
    { $set: { status: "completed", completedAt: new Date(), lockedUntil: null } },
  );
}

/** Schedule a retry with backoff, or mark the job failed once attempts are used up. */
export async function failJob(job: ClaimedJob<unknown>, err: unknown, now = new Date()) {
  const lastError = err instanceof Error ? err.message : String(err);
  const exhausted = job.attempts >= job.maxAttempts;
  await Job.updateOne(
    { _id: job._id, status: "running" },
    {
      $set: exhausted
        ? { status: "failed", lastError, lockedUntil: null }
        : { status: "pending", lastError, lockedUntil: null, runAt: new Date(now.getTime() + retryDelayMs(job.attempts)) },
    },
  );
  return { exhausted };
}

/**
 * Claim one job, run it, and record the outcome.
 * Returns false when nothing was due, so the caller can wait before polling again.
 */
export async function processNextJob<T>(
  queue: QueueName,
  handler: (job: ClaimedJob<T>) => Promise<void>,
  onError?: (job: ClaimedJob<T>, err: unknown, exhausted: boolean) => void,
): Promise<boolean> {
  const job = await claimJob<T>(queue);
  if (!job) return false;
  try {
    await handler(job);
    await completeJob(job._id);
  } catch (err) {
    const { exhausted } = await failJob(job, err);
    onError?.(job, err, exhausted);
  }
  return true;
}
