import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/connection";
import "../src/models";

await connectDb();
for (const name of mongoose.modelNames()) {
  const dropped = await mongoose.model(name).syncIndexes();
  console.log(`${name}: indexes synced${dropped.length ? `, dropped ${dropped.join(", ")}` : ""}`);
}
await disconnectDb();
