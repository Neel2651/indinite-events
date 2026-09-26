import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

const webhookEventSchema = new Schema({
  stripeEventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  receivedAt: { type: Date, default: () => new Date() },
  processedAt: Date,
  error: String,
});

export type WebhookEventDoc = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEvent = defineModel("WebhookEvent", webhookEventSchema);
