import { receiptLines } from "@indinite/core";
import { Event, Order, Organizer, type SendPaymentLinkJob } from "@indinite/db";
import { renderPaymentLinkEmail } from "@indinite/emails";
import { sendEmail } from "../mailer";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** send-payment-link: email the customer their link (SPEC §4.2). Skips if already paid or expired. */
export async function sendPaymentLink(job: SendPaymentLinkJob, jobId: string) {
  const order = await Order.findById(job.orderId).lean();
  if (!order || order.status !== "pending" || !order.customer?.email) return;
  const [event, organizer] = await Promise.all([Event.findById(order.eventId, { title: 1 }).lean(), Organizer.findById(order.organizerId, { name: 1 }).lean()]);
  const email = await renderPaymentLinkEmail({
    customerName: order.customer.name,
    eventTitle: event?.title ?? "your event",
    organizerName: organizer?.name ?? "The organiser",
    publicId: order.publicId,
    totalText: gbp.format(order.totalPence / 100),
    expiresText: order.expiresAt ? when.format(order.expiresAt) : "soon",
    url: job.url,
    lines: receiptLines({
      items: order.items,
      discountPence: order.discount?.amountPence,
      discountLabel: order.discount?.reason,
      platformFeePence: order.platformFeePence,
      commissionBps: order.commissionBps,
      charges: order.charges,
      taxPence: order.taxPence,
      taxBps: order.taxBps,
    }).map((l) => ({ label: l.label, amount: `${l.negative ? "−" : ""}${gbp.format(l.amountPence / 100)}` })),
  });
  const id = await sendEmail({ to: order.customer.email, subject: email.subject, html: email.html, text: email.text, idempotencyKey: `send-payment-link/${jobId}`, tags: [{ name: "type", value: "payment-link" }] });
  console.log(`[send-payment-link] sent for ${order.publicId} (${id})`);
}
