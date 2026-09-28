import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

const organizerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    /** Better Auth organization id — members and roles live there. */
    authOrgId: { type: String, required: true, unique: true },
    /** Stripe Connect Express account (SPEC §4.8). Status fields are synced from Stripe (account.updated). */
    stripeAccountId: { type: String, index: { unique: true, sparse: true } },
    chargesEnabled: { type: Boolean, default: false },
    payoutsEnabled: { type: Boolean, default: false },
    detailsSubmitted: { type: Boolean, default: false },
    stripeDisabledReason: { type: String, default: null },
    stripeCurrentlyDue: { type: [String], default: [] },
    merchantSyncedAt: Date,
    /** Details the admin entered when creating the organiser, used to prefill Stripe. */
    merchantPrefill: {
      businessType: { type: String, enum: ["individual", "company"] },
      legalName: String,
      website: String,
    },
    /** Super admin switch: stop card checkout and payment links (cash/comp bookings still work). */
    onlineSalesPaused: { type: Boolean, default: false },
    /** Who bears Stripe's card fee and at what rate (super admin, SPEC §4.8). */
    cardFee: {
      payer: { type: String, enum: ["platform", "organizer", "customer"], default: "platform" },
      bps: { type: Number, min: 0, max: 1000, default: 150 },
      fixedPence: { type: Number, min: 0, max: 500, default: 20 },
    },
    /** Platform fee = Indinite commission, charged on top of ticket prices (600 = 6%). Events can override. */
    commissionBps: { type: Number, required: true, min: 0, max: 10000, default: 600 },
    maxDiscountBpsForManager: { type: Number, min: 0, max: 10000, default: 5000 },
    orderPrefix: { type: String, default: "NAV", match: /^[A-Z]{2,5}$/ },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
  },
  { timestamps: true },
);

export type OrganizerDoc = InferSchemaType<typeof organizerSchema>;
export const Organizer = defineModel("Organizer", organizerSchema);
