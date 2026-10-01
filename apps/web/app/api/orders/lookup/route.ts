import { headers } from "next/headers";
import { normalisePublicId, orderLookupSchema, retryAfterText } from "@indinite/core";
import { linkSecret, signOrderLink } from "@indinite/core/links";
import { connectDb, hitRateLimit, Order } from "@indinite/db";

export const runtime = "nodejs";

// 5 tries a minute per IP and per email (1-minute windows, 1 Oct 2026).
const MINUTE = 60_000;
const LIMIT = 5;

/**
 * Find my tickets (SPEC §4.4): email + order reference → signed 30-min link to the passes page.
 * Both must match, and attempts are limited per IP and per email, so references can't be guessed.
 */
export async function POST(req: Request) {
  const parsed = orderLookupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter your email address and order reference." }, { status: 400 });
  const { email } = parsed.data;
  const publicId = normalisePublicId(parsed.data.publicId);

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  await connectDb();
  const [byIp, byEmail] = await Promise.all([
    hitRateLimit(`lookup:ip:${ip}`, LIMIT, MINUTE),
    hitRateLimit(`lookup:email:${email}`, LIMIT, MINUTE),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    const resetAt = Math.max(byIp.allowed ? 0 : byIp.resetAt.getTime(), byEmail.allowed ? 0 : byEmail.resetAt.getTime());
    return Response.json(
      { error: `Too many attempts. ${retryAfterText(resetAt)}` },
      { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) } },
    );
  }

  const order = await Order.findOne(
    { publicId, "customer.email": email, status: { $in: ["paid", "partially_refunded"] } },
    { publicId: 1 },
  ).lean();
  if (!order) {
    return Response.json(
      { error: "We couldn't find a booking with that email and order reference. Check both and try again." },
      { status: 404 },
    );
  }
  const t = signOrderLink(order.publicId, linkSecret());
  return Response.json({ redirectUrl: `/orders/${encodeURIComponent(order.publicId)}?t=${encodeURIComponent(t)}` });
}
