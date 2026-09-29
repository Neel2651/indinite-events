import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

export const SCAN_RESULTS = [
  "admitted",
  "already_used",
  "invalid",
  "wrong_session",
  /** Scanned before gates opened (1 hour before the night starts). */
  "too_early",
  "cancelled",
  "manual_admit",
] as const;

const scanSchema = new Schema({
  /** Client-generated UUID so re-synced offline scans are idempotent. */
  clientScanId: { type: String, required: true, unique: true },
  ticketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
  eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
  sessionId: { type: Schema.Types.ObjectId, required: true },
  gate: { type: String, required: true },
  deviceId: { type: String, required: true },
  scannerUserId: { type: String, required: true },
  result: { type: String, enum: SCAN_RESULTS, required: true },
  reason: String,
  scannedAt: { type: Date, required: true },
  syncedAt: { type: Date, default: () => new Date() },
});
// First admission per ticket per night wins; later ones are stored as already_used.
scanSchema.index(
  { ticketId: 1, sessionId: 1 },
  { unique: true, partialFilterExpression: { result: { $in: ["admitted", "manual_admit"] } } },
);
scanSchema.index({ eventId: 1, sessionId: 1, scannedAt: -1 });

export type ScanDoc = InferSchemaType<typeof scanSchema>;
export const Scan = defineModel("Scan", scanSchema);
