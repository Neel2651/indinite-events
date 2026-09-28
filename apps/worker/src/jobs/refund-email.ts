import { Event, Order, type SendRefundEmailJob } from "@indinite/db";
import { renderRefundEmail } from "@indinite/emails";
import { appUrl, sendEmail } from "../mailer";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** send-refund-email (SPEC §4.6). */
export async function sendRefundEmail(job: SendRefundEmailJob, jobId: string) {
  const order = await Order.findById(job.orderId).lean();
  if (!order?.customer?.email) return;
  const event = await Event.findById(order.eventId, { title: 1 }).lean();
  const last = order.refunds?.[order.refunds.length - 1];
  const refund = job.kind === "refund" || job.kind === "stripe_refund" ? order.refunds?.[job.refundIndex ?? order.refunds.length - 1] : last;
  // A cancelled cash / account / complimentary booking has no refund entry; a card payment made after cancelling does.
  if (!refund && job.kind !== "cancelled") return;
  const email = await renderRefundEmail({
    customerName: order.customer.name,
    eventTitle: event?.title ?? "your event",
    publicId: order.publicId,
    kind: job.kind,
    amountText: gbp.format((refund?.amountPence ?? 0) / 100),
    passes: refund?.ticketIds?.length ?? 0,
    method: (refund?.method ?? "none") as "stripe" | "stripe_dashboard" | "outside_indinite" | "none",
    offlineMethod: order.offline?.method ?? null,
    policyUrl: `${appUrl()}/refund-policy`,
  });
  const id = await sendEmail({ to: order.customer.email, subject: email.subject, html: email.html, text: email.text, idempotencyKey: `send-refund-email/${jobId}`, tags: [{ name: "type", value: "refund" }] });
  console.log(`[send-refund-email] sent for ${order.publicId} (${id})`);
}
