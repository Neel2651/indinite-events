import { normalisePublicId, PUBLIC_ID_RE, resolvePaymentsMode } from "@indinite/core";
import { linkSecret, signOrderLink, verifyOrderLink } from "@indinite/core/links";
import { appUrl } from "@indinite/auth";
import { connectDb, Event, Order, Ticket } from "@indinite/db";
import { buildPassesData, groupPassesByNight, renderPassesPdf } from "@indinite/emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const problem = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * PDF of every valid pass on a paid order: the same file as the email attachment. Needs the signed 30-minute
 * link (from the confirmation page, the ticket page or "Find my tickets"); passes stop being available once the
 * event has ended (SPEC §4.4).
 */
export async function GET(req: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const publicId = normalisePublicId(decodeURIComponent((await params).publicId));
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!PUBLIC_ID_RE.test(publicId)) return problem("Booking not found.", 404);
  const link = verifyOrderLink(publicId, token, linkSecret());
  if (!link.ok) return problem(link.reason === "expired" ? "This link has expired. Use Find my tickets to get a new one." : "This link isn't valid.", link.reason === "expired" ? 410 : 403);

  await connectDb();
  const order = await Order.findOne({ publicId }).lean();
  if (!order || (order.status !== "paid" && order.status !== "partially_refunded") || !order.customer) return problem("There are no passes to download for this booking.", 404);
  const event = await Event.findById(order.eventId).lean();
  if (!event) return problem("Booking not found.", 404);
  if (event.endsAt <= new Date()) return problem("This event has ended, so passes are no longer available.", 410);
  const tickets = await Ticket.find({ orderId: order._id, status: "valid" }).sort({ _id: 1 }).lean();
  if (!tickets.length) return problem("There are no valid passes on this booking.", 404);

  let demo = false;
  try {
    demo = resolvePaymentsMode(process.env) === "demo" && order.source !== "offline" && !order.stripe?.paymentIntentId;
  } catch {}
  const data = await buildPassesData({
    order: { ...order, customer: order.customer },
    event,
    tickets,
    viewUrl: `${appUrl()}/orders/${encodeURIComponent(publicId)}?t=${encodeURIComponent(signOrderLink(publicId, linkSecret()))}`,
    demo,
    reason: "resend",
  });
  // ?night=<sessionId> or ?night=multi: just that night's passes (one PDF per night, 30 Sep 2026).
  const night = new URL(req.url).searchParams.get("night");
  const group = night ? groupPassesByNight(data.tickets).find((g) => g.key === night) : null;
  if (night && !group) return problem("There are no passes for that night on this booking.", 404);
  const pdf = await renderPassesPdf(group ? { ...data, tickets: group.tickets } : data, group?.title);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="passes-${publicId}${group ? `-${group.fileLabel}` : ""}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
