import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

const ticketSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    organizerId: { type: Schema.Types.ObjectId, ref: "Organizer", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    ticketTypeId: { type: Schema.Types.ObjectId, ref: "TicketType", required: true },
    ticketTypeName: { type: String, required: true },
    attendeeName: String,
    qrToken: { type: String, required: true, unique: true },
    validSessionIds: { type: [Schema.Types.ObjectId], required: true },
    status: { type: String, enum: ["valid", "cancelled", "refunded"], default: "valid" },
  },
  { timestamps: true },
);
ticketSchema.index({ eventId: 1, status: 1 }); // scanner manifest

export type TicketDoc = InferSchemaType<typeof ticketSchema>;
export const Ticket = defineModel("Ticket", ticketSchema);
