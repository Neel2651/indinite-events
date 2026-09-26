import mongoose, { type Schema } from "mongoose";

/**
 * Compile a model, replacing any stale copy from a Next.js hot reload.
 * Generic over the schema so InferSchemaType flows through to queries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineModel<TSchema extends Schema<any, any, any, any, any, any, any, any, any>>(
  name: string,
  schema: TSchema,
) {
  if (mongoose.models[name]) mongoose.deleteModel(name);
  return mongoose.model(name, schema);
}

export const penceField = {
  type: Number,
  required: true,
  min: 0,
  validate: { validator: Number.isInteger, message: "{PATH} must be integer pence" },
} as const;
