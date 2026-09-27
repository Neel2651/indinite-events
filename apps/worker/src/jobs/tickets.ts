import QRCode from "qrcode";
import { linkSecret, signOrderLink } from "@indinite/core/links";
import { passCode, receiptLines, resolvePaymentsMode } from "@indinite/core";
import { audited, Event, Order, Ticket, withTransaction, type SendTicketsJob } from "@indinite/db";
import { renderPassesPdf, renderTicketsEmail, type PassData } from "@indinite/emails";
import { appUrl, sendEmail } from "../mailer";

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/** "All 9 nights" or "Fri 16 Oct, Sat 17 Oct". */
export function nightsLabel(validSessionIds: unknown[], sessions: { _id: unknown; startsAt: Date }[]) {
  const valid = new Set(validSessionIds.map(String));
  const nights = sessions.filter((s) => valid.has(String(s._id)));
  if (nights.length === sessions.length && sessions.length > 1) return `All ${sessions.length} nights`;
  return nights.map((s) => dayFmt.format(s.startsAt)).join(", ");
}


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
  if (order.status !== "paid") {
    console.log(`[send-tickets] skipping ${order.publicId}: status is ${order.status}`);
    return;
  }
  const tickets = await Ticket.find({ orderId: order._id, status: "valid" }).sort({ _id: 1 }).lean();
  if (tickets.length === 0) throw new Error(`Order ${order.publicId} is paid but has no valid tickets`);

  const passes: PassData[] = await Promise.all(
    tickets.map(async (t, i) => ({
      ticketId: String(t._id),
      ticketTypeName: t.ticketTypeName,
      nightsLabel: nightsLabel(t.validSessionIds, event.sessions),
      qrContentId: `pass-${i + 1}-${String(t._id)}`,
      qrPng: await QRCode.toBuffer(t.qrToken, { errorCorrectionLevel: "M", margin: 1, width: 480 }),
      shortCode: passCode(t.qrToken),
    })),
  );

  const data = {
    publicId: order.publicId,
    customerName: order.customer.name,
    event: { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, venue: event.venue },
    lines: receiptLines({
      items: order.items,
      discountPence: order.discount?.amountPence,
      discountLabel: order.discount?.reason,
      complimentary: order.offline?.method === "complimentary",
      platformFeePence: order.platformFeePence,
      commissionBps: order.commissionBps,
      charges: order.charges,
      taxPence: order.taxPence,
      taxBps: order.taxBps,
    }),
    totalPence: order.totalPence,
    tickets: passes,
    viewUrl: viewUrl(order.publicId),
    demo: isDemoPayments() && order.source !== "offline" && !order.stripe?.paymentIntentId,
    reason: job.reason,
  };

  const [email, pdf] = await Promise.all([renderTicketsEmail(data), renderPassesPdf(data)]);
  const emailId = await sendEmail({
    to: order.customer.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `send-tickets/${jobId}`,
    tags: [{ name: "type", value: "tickets" }],
    attachments: [
      ...passes.map((p) => ({ filename: `qr-${p.shortCode}.png`, content: p.qrPng, contentType: "image/png", contentId: p.qrContentId })),
      { filename: `passes-${order.publicId}.pdf`, content: pdf, contentType: "application/pdf" },
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
