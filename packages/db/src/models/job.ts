import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

/** Background job for the MongoDB-backed queue in ../jobs.ts. */
const jobSchema = new Schema(
  {
    /** Caller-chosen key; the unique index makes enqueueing idempotent. */
    jobId: { type: String, required: true, unique: true },
    queue: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ["pending", "running", "completed", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    /** Earliest time the job may run (pushed back on retry). */
    runAt: { type: Date, default: () => new Date() },
    /** While running: a worker that dies leaves this in the past, so another worker can reclaim the job. */
    lockedUntil: { type: Date, default: null },
    lastError: String,
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
jobSchema.index({ queue: 1, status: 1, runAt: 1 });
jobSchema.index({ queue: 1, status: 1, lockedUntil: 1 });
// Keep completed jobs for 30 days so late webhook retries still hit the jobId dedupe.
jobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export type JobDoc = InferSchemaType<typeof jobSchema>;
export const Job = defineModel("Job", jobSchema);
