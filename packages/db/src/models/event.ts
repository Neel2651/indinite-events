import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";
import { DEFAULT_FREE_COMPLIMENTARY_PASSES } from "@indinite/core";

const sessionSchema = new Schema({
  label: { type: String, required: true }, // "Night 1"
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
});

const venueSchema = new Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    postcode: { type: String, required: true },
    mapUrl: String,
  },
  { _id: false },
);

const mediaSchema = new Schema(
  {
    type: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true },
    alt: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const eventSchema = new Schema(
  {
    organizerId: { type: Schema.Types.ObjectId, ref: "Organizer", required: true, index: true },
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    venue: { type: venueSchema, required: true },
    media: { type: [mediaSchema], default: [] },
    sessions: { type: [sessionSchema], validate: (v: unknown[]) => v.length > 0 },
    startsAt: { type: Date, required: true },
    /** End of the last session — tickets stop displaying the QR after this. */
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    /** Overrides the organiser's commission / platform fee for this event (bps). Admin only. */
    commissionBps: { type: Number, min: 0, max: 10000, default: null },
    /** Tax on tickets + platform fee + charges (bps, 2000 = 20%). Admin only. */
    taxBps: { type: Number, min: 0, max: 10000, default: 0 },
    /** Complimentary passes free of commission for this event (admin); after that the platform fee is owed. */
    freeComplimentaryPasses: { type: Number, min: 0, max: 10000, default: DEFAULT_FREE_COMPLIMENTARY_PASSES },
    /** Complimentary passes issued so far (atomic $inc in the offline-issue transaction; never given back). */
    complimentaryIssued: { type: Number, min: 0, default: 0 },
    /** Organiser charges added per ticket (money goes to the organiser). */
    charges: {
      type: [
        new Schema(
          {
            name: { type: String, required: true, trim: true, maxlength: 60 },
            kind: { type: String, enum: ["fixed", "percent"], required: true },
            value: { type: Number, required: true, min: 0 }, // pence or bps
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Closed by hand (owner / super admin, 30 Sep 2026): no online sales or new payment links. Box office still works. */
    bookingsClosed: { closed: { type: Boolean, default: false }, reason: String, at: Date, by: String },
    closedNights: {
      type: [new Schema({ sessionId: { type: Schema.Types.ObjectId, required: true }, reason: String, at: Date, by: String }, { _id: false })],
      default: [],
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

eventSchema.pre("validate", function () {
  if (this.sessions.length) {
    this.startsAt = new Date(Math.min(...this.sessions.map((s) => s.startsAt.getTime())));
    this.endsAt = new Date(Math.max(...this.sessions.map((s) => s.endsAt.getTime())));
  }
});

eventSchema.index({ status: 1, startsAt: 1 });

export type EventDoc = InferSchemaType<typeof eventSchema>;
export const Event = defineModel("Event", eventSchema);
