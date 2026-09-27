/** Real-MongoDB tests for the fixed-window rate limiter. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { RateLimit, hitRateLimit } from "../src";

let replSet: MongoMemoryReplSet;
const HOUR = 3_600_000;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await RateLimit.init();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

describe("hitRateLimit", () => {
  it("allows up to the limit, then blocks", async () => {
    const results = [];
    for (let i = 0; i < 7; i++) results.push((await hitRateLimit("seq", 5, HOUR)).allowed);
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });

  it("holds under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => hitRateLimit("burst", 5, HOUR)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("starts a new window once the old one has expired", async () => {
    const t0 = new Date();
    for (let i = 0; i < 5; i++) await hitRateLimit("window", 5, HOUR, t0);
    expect((await hitRateLimit("window", 5, HOUR, t0)).allowed).toBe(false);
    expect((await hitRateLimit("window", 5, HOUR, new Date(t0.getTime() + HOUR + 1))).allowed).toBe(true);
  });

  it("stores hashed keys, not emails", async () => {
    await hitRateLimit("lookup:email:asha@example.com", 5, HOUR);
    expect(JSON.stringify(await RateLimit.find().lean())).not.toContain("asha@example.com");
  });
});
