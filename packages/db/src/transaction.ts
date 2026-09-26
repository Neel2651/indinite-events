import mongoose, { type ClientSession } from "mongoose";

/**
 * Runs fn inside a MongoDB transaction with automatic retry on transient errors.
 * Every service that changes state must use this and call audited() with the same session.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}
