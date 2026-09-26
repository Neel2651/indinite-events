/**
 * Real-MongoDB concurrency test (needs a replica set for transactions).
 * Run locally: pnpm --filter @indinite/db test:db  (downloads a MongoDB binary on first run)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { SoldOutError, TicketType, quota } from "../src";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await TicketType.init();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

describe("quota under concurrency", () => {
  it("never oversells: 200 parallel reservations against quota 50", async () => {
    const tt = await TicketType.create({
      eventId: new mongoose.Types.ObjectId(),
      name: "Season pass",
      pricePence: 4500,
      validSessionIds: [new mongoose.Types.ObjectId()],
      quota: 50,
    });

    const results = await Promise.allSettled(Array.from({ length: 200 }, () => quota.reserve(tt._id, 1)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const soldOut = results.filter((r) => r.status === "rejected" && r.reason instanceof SoldOutError).length;

    expect(ok).toBe(50);
    expect(soldOut).toBe(150);
    const fresh = await TicketType.findById(tt._id).lean();
    expect(fresh!.held).toBe(50);
  });

  it("commits and releases holds without going negative", async () => {
    const tt = await TicketType.create({
      eventId: new mongoose.Types.ObjectId(),
      name: "Night pass",
      pricePence: 1000,
      validSessionIds: [new mongoose.Types.ObjectId()],
      quota: 5,
    });
    await quota.reserve(tt._id, 3);
    await quota.commitHold(tt._id, 2);
    await quota.releaseHold(tt._id, 1);
    await expect(quota.releaseHold(tt._id, 1)).rejects.toThrow(/invariant/);
    const fresh = await TicketType.findById(tt._id).lean();
    expect(fresh).toMatchObject({ sold: 2, held: 0 });
  });
});
