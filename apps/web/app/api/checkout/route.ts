import { publicCheckoutSchema, resolvePaymentsMode } from "@indinite/core";
import { systemActor } from "@indinite/core/context";
import { linkSecret, signOrderLink } from "@indinite/core/links";
import { headers } from "next/headers";
import { CheckoutError, connectDb, createCheckoutOrder, fulfilOrder, hitRateLimit } from "@indinite/db";
import { withRequestContext } from "@/lib/request-context";

export const runtime = "nodejs";

const error = (message: string, status: number) => Response.json({ error: message }, { status });

/** SPEC §4.1: POST { eventId, customer, items } → { redirectUrl }. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = publicCheckoutSchema.safeParse(body);
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Check your details and try again.", 400);

  const mode = resolvePaymentsMode(process.env);
  if (mode === "stripe") {
    // TODO(M4): Stripe Checkout Session (destination charge) — needs organisers onboarded to Stripe Connect (M3).
    return error("Online payment isn't available yet. Please try again later.", 503);
  }

  try {
    await connectDb();
    // Each checkout holds seats for 30 minutes: stop scripts from holding the whole event.
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const [byIp, byEmail] = await Promise.all([
      hitRateLimit(`checkout:ip:${ip}`, 20, 10 * 60_000),
      hitRateLimit(`checkout:email:${parsed.data.customer.email}`, 8, 10 * 60_000),
    ]);
    if (!byIp.allowed || !byEmail.allowed) return error("Too many bookings in a short time. Please wait a few minutes and try again.", 429);
    const order = await withRequestContext({ type: "customer" }, () => createCheckoutOrder(parsed.data));
    // Demo payments (development only): approve straight away through the same fulfilment as the Stripe webhook.
    await withRequestContext(systemActor, () => fulfilOrder(order._id, { mode: "demo" }));
    // Only the buyer's browser gets this signed link, so the confirmation page can show their passes straight away.
    const t = signOrderLink(order.publicId, linkSecret());
    return Response.json({ redirectUrl: `/checkout/success?order=${encodeURIComponent(order.publicId)}&t=${encodeURIComponent(t)}` });
  } catch (e) {
    if (e instanceof CheckoutError) return error(e.message, e.status);
    console.error("[checkout] failed", e instanceof Error ? e.message : e);
    return error("Something went wrong and you haven't been charged. Please try again.", 500);
  }
}
