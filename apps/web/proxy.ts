import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_ID_RE } from "@indinite/core";
import { orderLinkCookie } from "@/lib/order-link";

/**
 * Booking confirmation links arrive as /checkout/success?order=REF&t=TOKEN (from checkout, Stripe and payment links).
 * The 30-minute token opens the buyer's passes, so it must not stay in the address bar: anything that reads the page
 * address (browser history, a shared screenshot, the event's Meta pixel — SPEC §4.11) would see it. Move it into a
 * short-lived cookie for that page only and redirect to the same page without it. The page still verifies the token.
 */
export function proxy(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const order = searchParams.get("order");
  const t = searchParams.get("t");
  if (!order || !t || !PUBLIC_ID_RE.test(order)) return NextResponse.next();

  // The public address (APP_URL), so the redirect is right behind the reverse proxy whatever host Next thinks it's on.
  const to = new URL(`/checkout/success?order=${encodeURIComponent(order)}`, process.env.APP_URL || request.url);
  const res = NextResponse.redirect(to, 303);
  res.cookies.set(orderLinkCookie(order), t, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/checkout/success",
    maxAge: 30 * 60,
  });
  return res;
}

export const config = { matcher: "/checkout/success" };
