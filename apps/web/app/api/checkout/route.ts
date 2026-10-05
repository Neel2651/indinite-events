import { publicCheckoutSchema, resolvePaymentsMode } from "@indinite/core";
import { systemActor } from "@indinite/core/context";
import { linkSecret, signOrderLink } from "@indinite/core/links";
import { appUrl } from "@indinite/auth";
import { CheckoutError, connectDb, createCheckoutOrder, Event, fulfilOrder, startCardCheckout, StripeNotConfiguredError } from "@indinite/db";
import { cookies } from "next/headers";
import { withRequestContext } from "@/lib/request-context";

export const runtime = "nodejs";

const error = (message: string, status: number) => Response.json({ error: message }, { status });

/**
 * SPEC §4.1: POST { eventId, customer, items, couponCode? } → { redirectUrl }.
 * Stripe mode: pending order + hold, then Stripe Checkout (tickets are issued by the webhook).
 * Demo mode (dev / staging only): approved straight away through the same fulfilment.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = publicCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    console.warn(`[checkout] refused 400 field=${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "invalid"}`);
    return error(issue?.message ?? "Check your details and try again.", 400);
  }
  const mode = resolvePaymentsMode(process.env);

  try {
    await connectDb();
    // No rate limit on checkout (decided 1 Oct 2026). Unpaid holds expire on their own and the sweeper releases them.
    // Meta's browser cookies, saved for the server Purchase on events with a pixel (SPEC §4.11).
    const jar = await cookies();
    const metaCookies = { fbp: jar.get("_fbp")?.value, fbc: jar.get("_fbc")?.value };
    const order = await withRequestContext({ type: "customer" }, () => createCheckoutOrder(parsed.data, new Date(), { requireCardPayments: mode === "stripe", metaCookies }));
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
    // Refusals are logged (status and message only, never customer details) so drop-offs show in pm2 logs.
    if (e instanceof CheckoutError) {
      console.warn(`[checkout] refused ${e.status} event=${parsed.data.eventId}: ${e.message}`);
      return error(e.message, e.status);
    }
    if (e instanceof StripeNotConfiguredError) {
      console.error(`[checkout] stripe not configured event=${parsed.data.eventId}`);
      return error("Card payments aren't available right now. Please try again later.", 503);
    }
    console.error("[checkout] failed", e instanceof Error ? e.message : e);
    return error("Something went wrong and you haven't been charged. Please try again.", 500);
  }
}
