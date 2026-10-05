import { sendMetaPurchase, type MetaPurchaseJob } from "@indinite/db";

/** meta-purchase: server Purchase to the event's Meta dataset (SPEC §4.11). Failed requests are retried by the queue. */
export async function metaPurchase(job: MetaPurchaseJob) {
  const r = await sendMetaPurchase(job.orderId);
  if (r.sent) console.log(`[meta-purchase] sent ${r.publicId}${r.test ? " (test event code)" : ""}`);
  else console.log(`[meta-purchase] skipped order ${job.orderId}: ${r.reason}`);
}
