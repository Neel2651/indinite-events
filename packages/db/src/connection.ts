import mongoose from "mongoose";

/** Cached across Next.js hot reloads and serverless invocations. */
const g = globalThis as unknown as { __mongoose?: Promise<typeof mongoose> };

export function connectDb(uri = process.env.MONGODB_URI): Promise<typeof mongoose> {
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!g.__mongoose) {
    mongoose.set("strictQuery", true);
    g.__mongoose = mongoose.connect(uri, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 8000,
      // Majority writes so a paid order is never rolled back on failover.
      writeConcern: { w: "majority" },
      readConcern: { level: "majority" },
    });
  }
  return g.__mongoose;
}

export async function disconnectDb(): Promise<void> {
  if (g.__mongoose) {
    await (await g.__mongoose).disconnect();
    g.__mongoose = undefined;
  }
}

export async function pingDb(): Promise<void> {
  const m = await connectDb();
  await m.connection.db!.admin().ping();
}
