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
    /** Pricing snapshot (SPEC §4.7): tickets − discount + platform fee + charges + tax = total. */
    ticketsPence: { type: Number, min: 0, default: 0 },
    platformFeePence: { type: Number, min: 0, default: 0 },
    charges: { type: [{ _id: false, name: String, amountPence: Number }], default: [] },
    chargesPence: { type: Number, min: 0, default: 0 },
    taxBps: { type: Number, min: 0, default: 0 },
    taxPence: { type: Number, min: 0, default: 0 },
    /** Card processing fee paid by the customer (organiser's card fee payer = customer); goes to cover Stripe. */
    cardFeePence: { type: Number, min: 0, default: 0 },
    commissionBps: { type: Number, min: 0, default: 0 },
    couponCode: String,
    couponId: { type: Schema.Types.ObjectId, ref: "Discount" },
    totalPence: penceField,
    /** Indinite's commission on this order (= platform fee; for comps, % of the normal price). */
    applicationFeePence: penceField,
    refundedPence: { type: Number, default: 0, min: 0 },
    /** Refunds (SPEC §4.6): ticket price only; fees, charges and tax are never refunded. */
    refunds: {
      type: [
        {
          ticketIds: [{ type: Schema.Types.ObjectId, ref: "Ticket" }],
          amountPence: { type: Number, required: true, min: 0 },
          method: { type: String, enum: ["stripe", "outside_indinite", "none"], required: true },
          stripeRefundId: String,
          reason: { type: String, required: true },
          refundedBy: { type: String, required: true },
          createdAt: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    stripe: {
      checkoutSessionId: { type: String },
      paymentIntentId: String,
      url: String,
      sessionExpiresAt: Date,
      /** Application fee sent to Stripe (platform fee, plus card fee when the organiser bears it). */
      applicationFeePence: Number,
    },
    offline: {
      /** bank_transfer = paid into the organiser's own account. */
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
