import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePaymentsMode } from "@indinite/core";
import { linkSecret, verifyOrderLink } from "@indinite/core/links";
import { AutoRefresh } from "@/components/staff/auto-refresh";
import { getOrderConfirmation } from "@/lib/queries";
import { formatDateRange, price } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking", robots: { index: false }, referrer: "no-referrer" };

type Props = { searchParams: Promise<{ order?: string; t?: string }> };

type View = { badge: string; title: string; intro: string; note: string | null };

/** What to tell the customer for each order status (SPEC §4.1): never claim passes were sent before payment is confirmed. */
function viewFor(status: string, passes: number, eventTitle: string, soldOutRefund: boolean): View {
  const passText = passes === 1 ? "pass is" : `${passes} passes are`;
  switch (status) {
    case "paid":
      return { badge: "BOOKING CONFIRMED", title: "You're going!", intro: `Your ${passText} booked for ${eventTitle}.`, note: "We've emailed your passes, with a QR code for each person. Show them at the gate on the night." };
    case "partially_refunded":
      return { badge: "BOOKING CONFIRMED", title: "Your booking", intro: `Some passes on this booking were refunded. The rest are still booked for ${eventTitle}.`, note: "Your remaining passes are in the email we sent you." };
    case "pending":
      return { badge: "CONFIRMING PAYMENT", title: "Confirming your payment…", intro: "This usually takes a few seconds. This page updates by itself.", note: "Your passes will be emailed as soon as your payment is confirmed. Please don't pay again." };
    case "expired":
      return { badge: "BOOKING EXPIRED", title: "This booking has expired", intro: "Payment didn't finish in time, so the passes were released. No money was taken.", note: null };
    case "cancelled":
      return { badge: "BOOKING CANCELLED", title: "This booking was cancelled", intro: "The organiser cancelled this booking, so its passes no longer work.", note: "If you think this is a mistake, contact the organiser." };
    case "refunded":
      return soldOutRefund
        ? { badge: "REFUNDED", title: "Sorry, these passes sold out", intro: "The last passes were taken while your payment was going through, so we've refunded you in full.", note: "The refund usually reaches your card in 5 to 10 working days. We've emailed you the details." }
        : { badge: "REFUNDED", title: "This booking was refunded", intro: "This booking has been refunded, so its passes no longer work.", note: "We emailed you the refund details." };
    default:
      return { badge: "BOOKING", title: "Your booking", intro: "", note: null };
  }
}

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { order: ref, t } = await searchParams;
  const order = ref ? await getOrderConfirmation(ref) : null;
  if (!order) notFound();
  const canView = !!t && verifyOrderLink(order.publicId, t, linkSecret()).ok;

  const hasPasses = order.status === "paid" || order.status === "partially_refunded";
  const passes = order.items.reduce((n, i) => n + i.qty, 0);
  const view = viewFor(order.status, passes, order.event.title, order.soldOutRefund);
  const tryAgain = order.status === "expired";

  return (
    <>
      {/* Card payments are confirmed by Stripe's webhook, usually within seconds. */}
      {order.status === "pending" && <AutoRefresh seconds={3} />}
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-5 py-14" aria-live="polite">
          <span className="badge-pill">{view.badge}</span>
          <h1 className="mt-5 text-4xl leading-tight">{view.title}</h1>
          {view.intro && <p className="mt-4 text-lg text-muted-foreground">{view.intro}</p>}
        </div>
      </section>

      <section className="bg-brand-cream">
        <div className="mx-auto max-w-3xl px-5 py-12">
          <div className="card-brand space-y-6">
            <div>
              <p className="text-sm text-muted-foreground">Order reference</p>
              <p className="font-display text-3xl font-bold tracking-wider">{order.publicId}</p>
              <p className="mt-1 text-sm text-muted-foreground">Keep this handy. You&apos;ll need it if you contact us about your booking.</p>
            </div>

            <div>
              <p className="font-display font-semibold">{order.event.title}</p>
              <p className="text-muted-foreground">
                {formatDateRange(order.event.startsAt, order.event.endsAt)} · {order.event.venue}
              </p>
            </div>

            <ul className="divide-y divide-border border-y border-border">
              {order.lines.map((l) => (
                <li key={l.label} className={`flex justify-between py-3 ${l.negative ? "text-muted-foreground" : ""}`}>
                  <span>{l.label}</span>
                  <span className="font-display font-semibold">
                    {l.negative ? "−" : ""}
                    {price(l.amountPence)}
                  </span>
                </li>
              ))}
              <li className="flex justify-between py-3 font-display text-lg font-bold">
                <span>Total</span>
                <span>{price(order.totalPence)}</span>
              </li>
            </ul>

            {resolvePaymentsMode(process.env) === "demo" && hasPasses && (
              <p className="rounded-md bg-brand-lavender px-4 py-3 text-sm">Demo booking: no payment was taken.</p>
            )}

            {view.note && <p className="text-muted-foreground">{view.note}</p>}

            <div className="flex flex-wrap items-center gap-4">
              {hasPasses && canView && (
                <>
                  <Link href={`/orders/${encodeURIComponent(order.publicId)}?t=${encodeURIComponent(t!)}`} className="btn-cta inline-block">
                    View my passes
                  </Link>
                  <a href={`/orders/${encodeURIComponent(order.publicId)}/pdf?t=${encodeURIComponent(t!)}`} download className="rounded-full border border-border bg-card px-6 py-3 font-display font-bold">
                    Download passes (PDF)
                  </a>
                </>
              )}
              {hasPasses && !canView && (
                <Link href="/orders/lookup" className="btn-cta inline-block">
                  Find my tickets
                </Link>
              )}
              <Link href={`/e/${order.event.slug}`} className={tryAgain ? "btn-cta inline-block" : "font-semibold text-brand-orange-strong hover:underline"}>
                {tryAgain ? "Book again" : "Back to event"}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
