import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

const webhookEventSchema = new Schema({
  stripeEventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  /** Connected account the event came from (direct charges, account.updated), so it can be fetched again. */
  account: String,
  receivedAt: { type: Date, default: () => new Date() },
  processedAt: Date,
  error: String,
});

export type WebhookEventDoc = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEvent = defineModel("WebhookEvent", webhookEventSchema);
