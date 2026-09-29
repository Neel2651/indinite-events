import { publicCheckoutSchema, resolvePaymentsMode } from "@indinite/core";
import { systemActor } from "@indinite/core/context";
import { linkSecret, signOrderLink } from "@indinite/core/links";
import { headers } from "next/headers";
import { appUrl } from "@indinite/auth";
import { CheckoutError, connectDb, createCheckoutOrder, Event, fulfilOrder, hitRateLimit, startCardCheckout, StripeNotConfiguredError } from "@indinite/db";
import { withRequestContext } from "@/lib/request-context";

export const runtime = "nodejs";

const error = (message: string, status: number) => Response.json({ error: message }, { status });

/**
 * 20 checkouts per IP per 10 minutes. A load test comes from one IP, so a demo server can raise it with
 * LOAD_TEST_CHECKOUT_LIMIT; demo mode is refused on the live site, so this never loosens real checkout.
 */
function checkoutLimitPerIp(mode: "stripe" | "demo"): number {
  const override = Number(process.env.LOAD_TEST_CHECKOUT_LIMIT);
  return mode === "demo" && Number.isInteger(override) && override > 0 ? override : 20;
}

/**
 * SPEC §4.1: POST { eventId, customer, items, couponCode? } → { redirectUrl }.
 * Stripe mode: pending order + hold, then Stripe Checkout (tickets are issued by the webhook).
 * Demo mode (dev / staging only): approved straight away through the same fulfilment.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = publicCheckoutSchema.safeParse(body);
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Check your details and try again.", 400);
  const mode = resolvePaymentsMode(process.env);

  try {
    await connectDb();
    // Each checkout holds seats: stop scripts from holding the whole event.
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const [byIp, byEmail] = await Promise.all([
      hitRateLimit(`checkout:ip:${ip}`, checkoutLimitPerIp(mode), 10 * 60_000),
      hitRateLimit(`checkout:email:${parsed.data.customer.email}`, 8, 10 * 60_000),
    ]);
    if (!byIp.allowed || !byEmail.allowed) return error("Too many bookings in a short time. Please wait a few minutes and try again.", 429);

    const order = await withRequestContext({ type: "customer" }, () => createCheckoutOrder(parsed.data, new Date(), { requireCardPayments: mode === "stripe" }));
    // Only the buyer's browser gets this signed link, so the confirmation page can show their passes straight away.
    const t = signOrderLink(order.publicId, linkSecret());
    const successPath = `/checkout/success?order=${encodeURIComponent(order.publicId)}&t=${encodeURIComponent(t)}`;

    if (mode === "stripe") {
      const event = await Event.findById(order.eventId, { slug: 1 }).lean();
      const { url } = await withRequestContext({ type: "customer" }, () =>
        startCardCheckout(String(order._id), { successUrl: `${appUrl()}${successPath}`, cancelUrl: `${appUrl()}/e/${event?.slug ?? ""}?cancelled=1` }),
      );
      return Response.json({ redirectUrl: url });
    }

    await withRequestContext(systemActor, () => fulfilOrder(order._id, { mode: order.totalPence === 0 ? "free" : "demo" }));
    return Response.json({ redirectUrl: successPath });
  } catch (e) {
    if (e instanceof CheckoutError) return error(e.message, e.status);
    if (e instanceof StripeNotConfiguredError) return error("Card payments aren't available right now. Please try again later.", 503);
    console.error("[checkout] failed", e instanceof Error ? e.message : e);
    return error("Something went wrong and you haven't been charged. Please try again.", 500);
  }
}
