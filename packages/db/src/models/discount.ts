import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

/** Reusable discount codes. Ad-hoc discounts on payment links are stored inline on the order. */
const discountSchema = new Schema(
  {
    organizerId: { type: Schema.Types.ObjectId, ref: "Organizer", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event" },
    code: { type: String, uppercase: true, trim: true },
    kind: { type: String, enum: ["percent", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 }, // bps or pence
    maxUses: { type: Number, min: 1 },
    used: { type: Number, default: 0 },
    validFrom: Date,
    validTo: Date,
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);
discountSchema.index({ organizerId: 1, code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } });

export type DiscountDoc = InferSchemaType<typeof discountSchema>;
export const Discount = defineModel("Discount", discountSchema);
