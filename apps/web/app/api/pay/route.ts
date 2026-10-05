import { normalisePublicId, resolvePaymentsMode } from "@indinite/core";
import { systemActor } from "@indinite/core/context";
import { linkSecret, signOrderLink, verifyOrderLink } from "@indinite/core/links";
import { appUrl } from "@indinite/auth";
import { CheckoutError, connectDb, fulfilOrder, HoldExpiredError, Order, recordMetaTracking, startCardCheckout, StripeNotConfiguredError } from "@indinite/db";
import { cookies, headers } from "next/headers";
import { withRequestContext } from "@/lib/request-context";

export const runtime = "nodejs";

const error = (message: string, status: number) => Response.json({ error: message }, { status });

/** Pay for a payment-link booking (SPEC §4.2): Stripe Checkout (tickets issued by the webhook), or instant in demo mode. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { publicId?: string; t?: string } | null;
  const publicId = normalisePublicId(String(body?.publicId ?? ""));
  if (!body?.t || !verifyOrderLink(publicId, body.t, linkSecret()).ok) return error("This payment link has expired. Ask the organiser for a new one.", 410);
  await connectDb();
  const order = await Order.findOne({ publicId }, { status: 1, source: 1, totalPence: 1 }).lean();
  if (!order || order.source !== "payment_link") return error("Booking not found.", 404);
  const viewUrl = () => `/orders/${encodeURIComponent(publicId)}?t=${encodeURIComponent(signOrderLink(publicId, linkSecret()))}`;
  if (order.status === "paid") return Response.json({ redirectUrl: viewUrl() });
  if (order.status !== "pending") return error("This booking has expired. Ask the organiser for a new link.", 410);

  // The customer's browser details for Meta's server Purchase (SPEC §4.11); the link itself was made by staff.
  const [jar, h] = await Promise.all([cookies(), headers()]);
  await withRequestContext({ type: "customer" }, () =>
    recordMetaTracking(String(order._id), { fbp: jar.get("_fbp")?.value, fbc: jar.get("_fbc")?.value }, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined }),
  ).catch((e) => console.error("[pay] couldn't save Meta tracking", e instanceof Error ? e.message : e));

  if (resolvePaymentsMode(process.env) === "stripe") {
    try {
      const back = `${appUrl()}/pay/${encodeURIComponent(publicId)}?t=${encodeURIComponent(body.t)}`;
      const { url } = await withRequestContext({ type: "customer" }, () => startCardCheckout(String(order._id), {
          // Same confirmation page as public checkout: it waits for Stripe's webhook instead of showing an error.
          successUrl: `${appUrl()}/checkout/success?order=${encodeURIComponent(publicId)}&t=${encodeURIComponent(signOrderLink(publicId, linkSecret()))}`,
          cancelUrl: back,
        }));
      return Response.json({ redirectUrl: url });
    } catch (e) {
      if (e instanceof CheckoutError) {
        console.warn(`[pay] refused ${e.status} ${publicId}: ${e.message}`);
        return error(e.message, e.status);
      }
      if (e instanceof StripeNotConfiguredError) return error("Card payment isn't available right now. Please contact the organiser.", 503);
      console.error("[pay] stripe checkout failed", e instanceof Error ? e.message : e);
      return error("Something went wrong and you haven't been charged. Please try again.", 500);
    }
  }
  try {
    await withRequestContext(systemActor, () => fulfilOrder(order._id, { mode: order.totalPence === 0 ? "free" : "demo" }));
  } catch (e) {
    if (e instanceof HoldExpiredError) return error("This booking has expired. Ask the organiser for a new link.", 410);
    console.error("[pay] failed", e instanceof Error ? e.message : e);
    return error("Something went wrong and you haven't been charged. Please try again.", 500);
  }
  return Response.json({ redirectUrl: viewUrl() });
}
