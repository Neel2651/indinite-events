import { NextResponse } from "next/server";
import { can } from "@indinite/core";
import { appUrl } from "@indinite/auth";
import { completeExistingAccountConnect, connectDb, MerchantError, Organizer, readConnectState, stripeErrorMessage, StripeNotConfiguredError } from "@indinite/db";
import { asStaff, getStaffUser } from "@/lib/staff";
import { CONNECT_MESSAGE_COOKIE } from "@/lib/stripe-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe sends the organiser back here after "Connect your existing Stripe account" (OAuth). The signed state
 * says which organiser, who started it and where from; only that same signed-in user can finish it, and they
 * must still be allowed to set up payments (owner or super admin).
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const base = appUrl();
  let target = `${base}/org`;
  const back = (outcome: string, message?: string) => {
    const url = new URL(target);
    url.searchParams.set("stripe", outcome);
    const res = NextResponse.redirect(url, 303);
    if (message) res.cookies.set(CONNECT_MESSAGE_COOKIE, message.slice(0, 300), { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 120, path: "/" });
    return res;
  };

  let state: ReturnType<typeof readConnectState>;
  try {
    state = readConnectState(params.get("state") ?? "");
  } catch (e) {
    return back("error", e instanceof MerchantError ? e.message : "That Stripe link isn't valid.");
  }
  await connectDb();
  const org = await Organizer.findById(state.organizerId, { slug: 1 }).lean();
  if (!org) return back("error", "Organiser not found.");
  target = state.from === "admin" ? `${base}/admin/organisers/${state.organizerId}` : `${base}/org/${org.slug}/payments`;

  // The organiser pressed "Cancel" (or Stripe refused) on Stripe's page.
  if (params.get("error")) return back("cancelled");

  const user = await getStaffUser();
  if (!user) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(new URL(target).pathname)}`, base), 303);
  if (user.id !== state.userId || !can(user, "stripe.onboard", { organizerId: state.organizerId })) {
    return back("error", "Sign in as the person who started connecting Stripe, then try again.");
  }
  const code = params.get("code");
  if (!code) return back("error", "Stripe didn't finish connecting. Please try again.");

  try {
    await asStaff(user, () => completeExistingAccountConnect(state.organizerId, code, base), state.organizerId);
  } catch (e) {
    if (e instanceof MerchantError || e instanceof StripeNotConfiguredError) return back("error", e.message);
    console.error("[stripe connect] failed", e instanceof Error ? e.message : e);
    return back("error", stripeErrorMessage(e));
  }
  return back("connected");
}
