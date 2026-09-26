import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, penceField } from "./_util";

const ticketTypeSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    pricePence: penceField,
    validSessionIds: { type: [Schema.Types.ObjectId], required: true },
    quota: { type: Number, required: true, min: 0 },
    /** Only changed via quota.* atomic ops in src/quota.ts. */
    sold: { type: Number, default: 0, min: 0 },
    held: { type: Number, default: 0, min: 0 },
    maxPerOrder: { type: Number, default: 10, min: 1 },
    salesStartAt: Date,
    salesEndAt: Date,
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type TicketTypeDoc = InferSchemaType<typeof ticketTypeSchema>;
export const TicketType = defineModel("TicketType", ticketTypeSchema);
