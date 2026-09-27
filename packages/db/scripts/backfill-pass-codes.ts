/** One-off: store passCode on tickets issued before it existed. Safe to re-run. */
import { normalisePassCode, passCode } from "@indinite/core";
import { connectDb, disconnectDb, Ticket } from "../src";

await connectDb();
let n = 0;
for await (const t of Ticket.find({ $or: [{ passCode: { $exists: false } }, { passCode: null }] }, { qrToken: 1 }).cursor()) {
  await Ticket.updateOne({ _id: t._id }, { $set: { passCode: normalisePassCode(passCode(t.qrToken)) } });
  n++;
}
console.log(`Backfilled pass codes on ${n} ticket(s)`);
await disconnectDb();
