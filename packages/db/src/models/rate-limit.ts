import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

/** Fixed-window counters for rate limiting (see ../rate-limit.ts). */
const rateLimitSchema = new Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true },
  resetAt: { type: Date, required: true },
});
rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export type RateLimitDoc = InferSchemaType<typeof rateLimitSchema>;
export const RateLimit = defineModel("RateLimit", rateLimitSchema);
