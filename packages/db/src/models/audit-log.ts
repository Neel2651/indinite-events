import { Schema, type InferSchemaType } from "mongoose";
import { defineModel } from "./_util";

/**
 * Append-only. In Atlas, the app user gets a custom role with only find + insert on this collection.
 * Never add update/delete code paths for this model.
 */
const auditLogSchema = new Schema(
  {
    actor: {
      type: { type: String, enum: ["user", "customer", "system", "stripe"], required: true },
      id: String,
      email: String,
      role: String,
    },
    organizerId: { type: Schema.Types.ObjectId, ref: "Organizer" },
    action: { type: String, required: true },
    entity: {
      type: { type: String, required: true },
      id: { type: String, required: true },
    },
    changes: [{ _id: false, path: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed }],
    reason: String,
    metadata: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
    requestId: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ organizerId: 1, createdAt: -1 });
auditLogSchema.index({ "entity.type": 1, "entity.id": 1, createdAt: -1 });
auditLogSchema.index({ "actor.id": 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const block = () => {
  throw new Error("auditLogs is append-only");
};
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne"] as const) {
  auditLogSchema.pre(op, block);
}

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = defineModel("AuditLog", auditLogSchema);
