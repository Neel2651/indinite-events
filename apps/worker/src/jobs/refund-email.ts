import { Event, Order, type SendRefundEmailJob } from "@indinite/db";
import { renderRefundEmail } from "@indinite/emails";
import { appUrl, sendEmail } from "../mailer";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** send-refund-email (SPEC §4.6). */
export async function sendRefundEmail(job: SendRefundEmailJob, jobId: string) {
  const order = await Order.findById(job.orderId).lean();
  if (!order?.customer?.email) return;
  const event = await Event.findById(order.eventId, { title: 1 }).lean();
  const refund = job.kind === "refund" ? order.refunds?.[job.refundIndex ?? order.refunds.length - 1] : order.refunds?.[order.refunds.length - 1];
  if (!refund) return;
  const email = await renderRefundEmail({
    customerName: order.customer.name,
    eventTitle: event?.title ?? "your event",
    publicId: order.publicId,
    kind: job.kind,
    amountText: gbp.format(refund.amountPence / 100),
    passes: refund.ticketIds?.length ?? 0,
    method: refund.method as "stripe" | "outside_indinite" | "none",
    policyUrl: `${appUrl()}/refund-policy`,
  });
  const id = await sendEmail({ to: order.customer.email, subject: email.subject, html: email.html, text: email.text, idempotencyKey: `send-refund-email/${jobId}`, tags: [{ name: "type", value: "refund" }] });
  console.log(`[send-refund-email] sent for ${order.publicId} (${id})`);
}
