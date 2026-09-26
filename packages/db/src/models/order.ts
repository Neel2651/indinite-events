import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, penceField } from "./_util";

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "expired",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

const orderSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    organizerId: { type: Schema.Types.ObjectId, ref: "Organizer", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: String,
    },
    source: { type: String, enum: ["online", "payment_link", "offline"], required: true },
    status: { type: String, enum: ORDER_STATUSES, default: "pending" },
    items: [
      {
        _id: false,
        ticketTypeId: { type: Schema.Types.ObjectId, ref: "TicketType", required: true },
        name: { type: String, required: true },
        unitPricePence: penceField,
        qty: { type: Number, required: true, min: 1 },
      },
    ],
    subtotalPence: penceField,
    discount: {
      kind: { type: String, enum: ["percent", "fixed"] },
      value: Number,
      amountPence: Number,
      reason: String,
      appliedBy: String,
    },
    totalPence: penceField,
    applicationFeePence: penceField,
    refundedPence: { type: Number, default: 0, min: 0 },
    stripe: {
      checkoutSessionId: { type: String },
      paymentIntentId: String,
      url: String,
    },
    offline: {
      method: { type: String, enum: ["cash", "bank_transfer", "complimentary"] },
      note: String,
      issuedBy: String,
    },
    createdBy: String, // user id for organizer-created orders
    expiresAt: Date,
    paidAt: Date,
  },
  { timestamps: true },
);

orderSchema.index({ organizerId: 1, createdAt: -1 });
orderSchema.index({ eventId: 1, status: 1 });
orderSchema.index({ "customer.email": 1, publicId: 1 });
orderSchema.index({ "stripe.checkoutSessionId": 1 }, { unique: true, sparse: true });

export type OrderDoc = InferSchemaType<typeof orderSchema>;
export const Order = defineModel("Order", orderSchema);
