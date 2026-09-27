import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, penceField } from "./_util";

/** Commission owed on offline sales (Stripe never sees that money) and its settlement. */
const commissionLedgerSchema = new Schema(
  {
    organizerId: { type: Schema.Types.ObjectId, ref: "Organizer", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    amountPence: penceField,
    kind: { type: String, enum: ["offline_sale_owed", "settled"], required: true },
    note: String,
    /** Who recorded a settlement. */
    recordedBy: String,
  },
  { timestamps: true },
);

export type CommissionLedgerDoc = InferSchemaType<typeof commissionLedgerSchema>;
export const CommissionLedger = defineModel("CommissionLedger", commissionLedgerSchema);
