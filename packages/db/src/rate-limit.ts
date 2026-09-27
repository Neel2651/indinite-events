import { createHash } from "node:crypto";
import { RateLimit } from "./models/rate-limit";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/** Keys may contain emails or IPs; store a hash so the collection holds no personal data. */
const hashKey = (key: string) => createHash("sha256").update(key).digest("base64url");

const isDuplicateKey = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === 11000;

/**
 * Count one hit against `key` in a fixed window. Atomic: concurrent hits can't slip past the limit.
 * Usage: `if (!(await hitRateLimit(`lookup:ip:${ip}`, 5, HOUR)).allowed) …`
 */
export async function hitRateLimit(key: string, limit: number, windowMs: number, now = new Date()): Promise<RateLimitResult> {
  const hashed = hashKey(key);
  for (let attempt = 0; attempt < 3; attempt++) {
    // Live window: just count.
    const live = await RateLimit.findOneAndUpdate(
      { key: hashed, resetAt: { $gt: now } },
      { $inc: { count: 1 } },
      { new: true },
    ).lean();
    if (live) return { allowed: live.count <= limit, remaining: Math.max(0, limit - live.count), resetAt: live.resetAt };

    // No window, or it has expired (the TTL monitor may not have removed it yet): start a new one.
    const resetAt = new Date(now.getTime() + windowMs);
    try {
      const fresh = await RateLimit.findOneAndUpdate(
        { key: hashed, $or: [{ resetAt: { $lte: now } }, { resetAt: { $exists: false } }] },
        { $set: { count: 1, resetAt } },
        { upsert: true, new: true },
      ).lean();
      return { allowed: 1 <= limit, remaining: Math.max(0, limit - fresh!.count), resetAt: fresh!.resetAt };
    } catch (e) {
      // Another request created the window first: loop and count against it.
      if (!isDuplicateKey(e)) throw e;
    }
  }
  throw new Error("Rate limiter contention");
}
