import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

const holdSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
    items: [
      {
        _id: false,
        ticketTypeId: { type: Schema.Types.ObjectId, ref: "TicketType", required: true },
        qty: { type: Number, required: true, min: 1 },
      },
    ],
    expiresAt: { type: Date, required: true },
    /** Set when released (expired) or committed (paid). Sweeper finds releasedAt=null & expiresAt<now. */
    releasedAt: { type: Date, default: null },
    outcome: { type: String, enum: ["committed", "released"] },
  },
  { timestamps: true },
);
holdSchema.index({ releasedAt: 1, expiresAt: 1 });

export type HoldDoc = InferSchemaType<typeof holdSchema>;
export const Hold = defineModel("Hold", holdSchema);
