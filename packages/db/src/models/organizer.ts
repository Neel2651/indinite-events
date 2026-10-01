import { Schema, type InferSchemaType } from "mongoose";
import { DEFAULT_COMMISSION_BPS, randomOrderPrefix } from "@indinite/core";
import { defineModel } from "./_util";

const organizerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    /** Better Auth organization id — members and roles live there. */
    authOrgId: { type: String, required: true, unique: true },
    /**
     * Stripe connected account (SPEC §4.8): an Express account created by Indinite, or the organiser's existing
     * account connected through OAuth ("standard", paid by direct charges). Status fields are synced from Stripe
     * (account.updated). Cleared on disconnect; orders keep the account they were paid on.
     */
    stripeAccountId: { type: String, index: { unique: true, sparse: true } },
    stripeAccountType: { type: String, enum: ["express", "standard"], default: "express" },
    /** When the account was last disconnected (status "disconnected" until another account is connected). */
    stripeDisconnectedAt: { type: Date, default: null },
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
    /** Who bears Stripe's card fee and at what rate (super admin, SPEC §4.8). Default: the organiser. */
    cardFee: {
      payer: { type: String, enum: ["platform", "organizer", "customer"], default: "organizer" },
      bps: { type: Number, min: 0, max: 1000, default: 150 },
      fixedPence: { type: Number, min: 0, max: 500, default: 20 },
    },
    /** Platform fee = Indinite commission, charged on top of ticket prices (1000 = 10%). Events can override. */
    commissionBps: { type: Number, required: true, min: 0, max: 10000, default: DEFAULT_COMMISSION_BPS },
    maxDiscountBpsForManager: { type: Number, min: 0, max: 10000, default: 5000 },
    /**
     * Order reference prefix ("OMB" in OMB-7K3F9Q). Generated from the name and unique across organisers (1 Oct 2026);
     * not editable. The random default only applies to records created without one (tests, old data).
     */
    orderPrefix: { type: String, default: () => randomOrderPrefix(), match: /^[A-Z]{2,5}$/, unique: true },
    /** Registered themselves on /register (not created by a super admin). */
    selfRegistered: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
  },
  { timestamps: true },
);

export type OrganizerDoc = InferSchemaType<typeof organizerSchema>;
export const Organizer = defineModel("Organizer", organizerSchema);
