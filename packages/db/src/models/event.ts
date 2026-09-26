import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

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
