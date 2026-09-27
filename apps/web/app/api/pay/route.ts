import { normalisePublicId, resolvePaymentsMode } from "@indinite/core";
import { systemActor } from "@indinite/core/context";
import { linkSecret, signOrderLink, verifyOrderLink } from "@indinite/core/links";
import { connectDb, fulfilOrder, HoldExpiredError, Order } from "@indinite/db";
import { withRequestContext } from "@/lib/request-context";

export const runtime = "nodejs";

const error = (message: string, status: number) => Response.json({ error: message }, { status });

/** Pay for a payment-link booking (SPEC §4.2). Demo mode approves instantly; Stripe Checkout once connected. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { publicId?: string; t?: string } | null;
  const publicId = normalisePublicId(String(body?.publicId ?? ""));
  if (!body?.t || !verifyOrderLink(publicId, body.t, linkSecret()).ok) return error("This payment link has expired. Ask the organiser for a new one.", 410);
  await connectDb();
  const order = await Order.findOne({ publicId }, { status: 1, source: 1 }).lean();
  if (!order || order.source !== "payment_link") return error("Booking not found.", 404);
  const viewUrl = () => `/orders/${encodeURIComponent(publicId)}?t=${encodeURIComponent(signOrderLink(publicId, linkSecret()))}`;
  if (order.status === "paid") return Response.json({ redirectUrl: viewUrl() });
  if (order.status !== "pending") return error("This booking has expired. Ask the organiser for a new link.", 410);

  if (resolvePaymentsMode(process.env) === "stripe") {
    // TODO(M4): Stripe Checkout Session for this order (destination charge), redirect to session.url.
    return error("Card payment isn't available yet. Please contact the organiser.", 503);
  }
  try {
    await withRequestContext(systemActor, () => fulfilOrder(order._id, { mode: "demo" }));
  } catch (e) {
    if (e instanceof HoldExpiredError) return error("This booking has expired. Ask the organiser for a new link.", 410);
    console.error("[pay] failed", e instanceof Error ? e.message : e);
    return error("Something went wrong and you haven't been charged. Please try again.", 500);
  }
  return Response.json({ redirectUrl: viewUrl() });
}
