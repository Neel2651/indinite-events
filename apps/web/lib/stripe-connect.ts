import "server-only";
import { cookies } from "next/headers";

/**
 * Message for the page Stripe's "connect your existing account" flow returns to. Set by
 * /api/stripe/connect/callback as a short-lived cookie, so nobody can put their own text on our page via a link.
 */
export const CONNECT_MESSAGE_COOKIE = "stripe_connect_message";

export async function connectMessage(): Promise<string | null> {
  return (await cookies()).get(CONNECT_MESSAGE_COOKIE)?.value ?? null;
}

/** What to show after coming back from Stripe (`?stripe=` on the Payments and admin organiser pages). */
export function connectOutcomeText(outcome: string | undefined, message: string | null): { tone: "ok" | "error" | "info"; text: string } | null {
  if (outcome === "connected") return { tone: "ok", text: "Your Stripe account is connected." };
  if (outcome === "cancelled") return { tone: "info", text: "You didn't connect a Stripe account. Nothing has changed." };
  if (outcome === "error") return { tone: "error", text: message ?? "Stripe didn't finish connecting. Please try again." };
  return null;
}
