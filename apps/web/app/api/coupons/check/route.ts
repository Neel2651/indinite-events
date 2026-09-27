import { headers } from "next/headers";
import { connectDb, CouponError, Event, findCoupon, hitRateLimit } from "@indinite/db";

export const runtime = "nodejs";

/** Checkout coupon preview. Rate-limited so codes can't be guessed. The server re-checks at checkout. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { eventId?: string; code?: string } | null;
  const eventId = String(body?.eventId ?? "");
  const code = String(body?.code ?? "").trim();
  if (!/^[a-f0-9]{24}$/.test(eventId) || !code) return Response.json({ error: "Enter a code." }, { status: 400 });
  await connectDb();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await hitRateLimit(`coupon:ip:${ip}`, 20, 3_600_000)).allowed) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  const event = await Event.findOne({ _id: eventId, status: "published", deletedAt: null }, { organizerId: 1 }).lean();
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
  try {
    const c = await findCoupon(event.organizerId, event._id, code);
    return Response.json({ code: c!.code, rule: c!.rule });
  } catch (e) {
    return Response.json({ error: e instanceof CouponError ? e.message : "Couldn't check that code." }, { status: 400 });
  }
}
