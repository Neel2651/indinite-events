import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

const organizerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    /** Better Auth organization id — members and roles live there. */
    authOrgId: { type: String, required: true, unique: true },
    stripeAccountId: { type: String, index: { unique: true, sparse: true } },
    chargesEnabled: { type: Boolean, default: false },
    payoutsEnabled: { type: Boolean, default: false },
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
