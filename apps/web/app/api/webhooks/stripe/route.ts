import { appUrl } from "@indinite/auth";
import { connectDb, handleStripeEvent, stripeGateway } from "@indinite/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook (SPEC rule 6): verify the signature on the raw body, then process each event once.
 * Returns 5xx on processing errors so Stripe retries.
 */
export async function POST(req: Request) {
  const gw = stripeGateway();
  if (!gw) return new Response("Stripe isn't configured", { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const payload = await req.text();

  let event;
  try {
    event = gw.verifyWebhook(payload, signature);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  try {
    await connectDb();
    const { duplicate } = await handleStripeEvent(event, appUrl());
    return Response.json({ received: true, duplicate });
  } catch (e) {
    console.error(`[stripe webhook] ${event.type} ${event.id} failed:`, e instanceof Error ? e.message : e);
    return new Response("Processing failed", { status: 500 });
  }
}
