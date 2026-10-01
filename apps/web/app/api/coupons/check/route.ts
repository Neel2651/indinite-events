import { connectDb, CouponError, Event, findCoupon } from "@indinite/db";

export const runtime = "nodejs";

/** Checkout coupon preview (no rate limit, decided 1 Oct 2026). The server re-checks the code at checkout. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { eventId?: string; code?: string } | null;
  const eventId = String(body?.eventId ?? "");
  const code = String(body?.code ?? "").trim();
  if (!/^[a-f0-9]{24}$/.test(eventId) || !code) return Response.json({ error: "Enter a code." }, { status: 400 });
  await connectDb();
  const event = await Event.findOne({ _id: eventId, status: "published", deletedAt: null }, { organizerId: 1 }).lean();
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
  try {
    const c = await findCoupon(event.organizerId, event._id, code);
    return Response.json({ code: c!.code, rule: c!.rule });
  } catch (e) {
    return Response.json({ error: e instanceof CouponError ? e.message : "Couldn't check that code." }, { status: 400 });
  }
}
