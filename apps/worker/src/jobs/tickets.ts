import { linkSecret, signOrderLink } from "@indinite/core/links";
import { resolvePaymentsMode } from "@indinite/core";
import { audited, Event, Order, Ticket, withTransaction, type SendTicketsJob } from "@indinite/db";
import { buildPassesData, groupPassesByNight, renderPassesPdf, renderTicketsEmail } from "@indinite/emails";
import { appUrl, sendEmail } from "../mailer";

/** Only labels the email; a misconfigured PAYMENTS_MODE must never stop passes being sent. */
function isDemoPayments() {
  try {
    return resolvePaymentsMode(process.env) === "demo";
  } catch {
    return false;
  }
}

export function viewUrl(publicId: string) {
  return `${appUrl()}/orders/${encodeURIComponent(publicId)}?t=${signOrderLink(publicId, linkSecret())}`;
}

async function loadOrder(orderId: string) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new Error(`Order ${orderId} not found`);
  const { customer } = order;
  if (!customer?.email) throw new Error(`Order ${orderId} has no customer email`);
  const event = await Event.findById(order.eventId).lean();
  if (!event) throw new Error(`Event for order ${orderId} not found`);
  return { order: { ...order, customer }, event };
}

/** send-tickets: ticket email with inline QR codes and a PDF of every pass, then audit it. */
export async function sendTickets(job: SendTicketsJob, jobId: string) {
  const { order, event } = await loadOrder(job.orderId);
  // Part-refunded bookings still have valid passes: send just those.
  if (order.status !== "paid" && order.status !== "partially_refunded") {
    console.log(`[send-tickets] skipping ${order.publicId}: status is ${order.status}`);
    return;
  }
  const tickets = await Ticket.find({ orderId: order._id, status: "valid" }).sort({ _id: 1 }).lean();
  if (tickets.length === 0) throw new Error(`Order ${order.publicId} is paid but has no valid tickets`);

  const data = await buildPassesData({
    order,
    event,
    tickets,
    viewUrl: viewUrl(order.publicId),
    demo: isDemoPayments() && order.source !== "offline" && !order.stripe?.paymentIntentId,
    reason: job.reason,
  });
  const passes = data.tickets;

  // One PDF per night (plus "All nights" for season / weekend passes), SPEC §4.4, 30 Sep 2026.
  const groups = groupPassesByNight(passes);
  const [email, ...pdfs] = await Promise.all([renderTicketsEmail(data), ...groups.map((g) => renderPassesPdf({ ...data, tickets: g.tickets }, g.title))]);
  const emailId = await sendEmail({
    to: order.customer.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `send-tickets/${jobId}`,
    tags: [{ name: "type", value: "tickets" }],
    attachments: [
      ...passes.map((p) => ({ filename: `qr-${p.shortCode}.png`, content: p.qrPng, contentType: "image/png", contentId: p.qrContentId })),
      ...groups.map((g, i) => ({ filename: `passes-${order.publicId}-${g.fileLabel}.pdf`, content: pdfs[i]!, contentType: "application/pdf" })),
    ],
  });

  await withTransaction((session) =>
    audited(session, {
      action: "order.tickets_sent",
      entity: { type: "order", id: order._id },
      organizerId: order.organizerId,
      reason: job.reason,
      metadata: { emailId, tickets: tickets.length },
    }),
  );
  console.log(`[send-tickets] sent ${tickets.length} passes for ${order.publicId} (${emailId})`);
}
