import type { Db } from "mongodb";

/**
 * Better Auth doesn't create indexes on MongoDB. These enforce uniqueness (one account per email, one
 * membership per user per organisation) and keep session / membership lookups fast. Safe to re-run.
 */
export async function ensureAuthIndexes(db: Db) {
  await Promise.all([
    db.collection("user").createIndex({ email: 1 }, { unique: true }),
    db.collection("session").createIndex({ token: 1 }, { unique: true }),
    db.collection("session").createIndex({ userId: 1 }),
    db.collection("session").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("account").createIndex({ userId: 1 }),
    db.collection("verification").createIndex({ identifier: 1 }),
    db.collection("verification").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("organization").createIndex({ slug: 1 }, { unique: true }),
    db.collection("member").createIndex({ organizationId: 1, userId: 1 }, { unique: true }),
    db.collection("member").createIndex({ userId: 1 }),
    db.collection("invitation").createIndex({ organizationId: 1, status: 1 }),
    db.collection("invitation").createIndex({ email: 1, status: 1 }),
    db.collection("rateLimit").createIndex({ key: 1 }, { unique: true }),
  ]);
}
