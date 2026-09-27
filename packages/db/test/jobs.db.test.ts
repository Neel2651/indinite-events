/**
 * Real-MongoDB tests for the jobs queue (replica set so enqueue-in-transaction works).
 * Run locally: pnpm --filter @indinite/db test:db
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { Job, QUEUES, claimJob, enqueue, enqueueSendTickets, failJob, processNextJob, retryDelayMs, withTransaction } from "../src";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Job.init();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  await Job.deleteMany({});
});

const q = QUEUES.sendTickets;

describe("jobs queue", () => {
  it("dedupes by jobId, even under concurrent enqueues", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => enqueueSendTickets({ orderId: "o1", reason: "paid" })),
    );
    // A concurrent upsert can lose the race on the unique index; either way only one job exists.
    const created = results.filter((r) => r.status === "fulfilled" && r.value.created).length;
    expect(created).toBe(1);
    expect(await Job.countDocuments({ jobId: "o1:paid:once" })).toBe(1);
  });

  it("enqueues atomically with a transaction", async () => {
    await expect(
      withTransaction(async (session) => {
        await enqueue(q, "rolled-back", { orderId: "o2" }, { session });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await Job.countDocuments({ jobId: "rolled-back" })).toBe(0);
  });

  it("gives each job to exactly one of many concurrent claimers", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => enqueue(q, `j${i}`, { i })));
    const claims = await Promise.all(Array.from({ length: 30 }, () => claimJob(q)));
    const ids = claims.filter((c) => c !== null).map((c) => c!.jobId);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("retries with backoff, then fails after maxAttempts", async () => {
    await enqueue(q, "flaky", {}, { maxAttempts: 2 });

    const first = await claimJob(q);
    expect(first!.attempts).toBe(1);
    const t0 = new Date();
    expect(await failJob(first!, new Error("boom"), t0)).toEqual({ exhausted: false });

    const afterFirst = await Job.findOne({ jobId: "flaky" }).lean();
    expect(afterFirst).toMatchObject({ status: "pending", lastError: "boom" });
    expect(afterFirst!.runAt.getTime()).toBe(t0.getTime() + retryDelayMs(1));
    expect(await claimJob(q, t0)).toBeNull(); // not due yet

    const second = await claimJob(q, new Date(t0.getTime() + retryDelayMs(1)));
    expect(second!.attempts).toBe(2);
    expect(await failJob(second!, new Error("boom again"))).toEqual({ exhausted: true });
    expect(await Job.findOne({ jobId: "flaky" }).lean()).toMatchObject({ status: "failed", lastError: "boom again" });
    expect(await claimJob(q, new Date(Date.now() + 3_600_000))).toBeNull();
  });

  it("reclaims a job whose worker died, and gives up once attempts are used", async () => {
    await enqueue(q, "orphan", {}, { maxAttempts: 1 });
    expect(await claimJob(q)).not.toBeNull(); // worker "dies" here

    const later = new Date(Date.now() + 10 * 60_000); // past the lock
    expect(await claimJob(q, later)).toBeNull();
    expect(await Job.findOne({ jobId: "orphan" }).lean()).toMatchObject({ status: "failed" });
  });

  it("processNextJob completes on success and records errors", async () => {
    await enqueue(q, "ok", { n: 1 });
    await enqueue(q, "bad", { n: 2 });
    const seen: number[] = [];
    const errors: string[] = [];
    const handler = async (job: { data: { n: number } }) => {
      seen.push(job.data.n);
      if (job.data.n === 2) throw new Error("nope");
    };
    while (await processNextJob<{ n: number }>(q, handler, (j) => errors.push(j.jobId)));

    expect(seen.sort()).toEqual([1, 2]);
    expect(errors).toEqual(["bad"]);
    const ok = await Job.findOne({ jobId: "ok" }).lean();
    expect(ok).toMatchObject({ status: "completed" });
    expect(ok!.completedAt).toBeInstanceOf(Date);
    expect(await Job.findOne({ jobId: "bad" }).lean()).toMatchObject({ status: "pending", lastError: "nope" });
  });
});
