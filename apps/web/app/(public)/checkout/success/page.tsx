import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePaymentsMode } from "@indinite/core";
import { linkSecret, verifyOrderLink } from "@indinite/core/links";
import { AutoRefresh } from "@/components/staff/auto-refresh";
import { getOrderConfirmation } from "@/lib/queries";
import { formatDateRange, price } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking confirmed", robots: { index: false }, referrer: "no-referrer" };

type Props = { searchParams: Promise<{ order?: string; t?: string }> };

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { order: ref, t } = await searchParams;
  const order = ref ? await getOrderConfirmation(ref) : null;
  if (!order) notFound();
  const canView = !!t && verifyOrderLink(order.publicId, t, linkSecret()).ok;

  const paid = order.status === "paid";
  const passes = order.items.reduce((n, i) => n + i.qty, 0);

  return (
    <>
      {/* Card payments are confirmed by Stripe's webhook, usually within seconds. */}
      {!paid && order.status === "pending" && <AutoRefresh seconds={3} />}
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-5 py-14">
          <span className="badge-pill">{paid ? "BOOKING CONFIRMED" : "BOOKING PENDING"}</span>
          <h1 className="mt-5 text-4xl leading-tight">{paid ? "You're going!" : "We're confirming your booking"}</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {paid
              ? `Your ${passes === 1 ? "pass is" : `${passes} passes are`} booked for ${order.event.title}.`
              : "This usually takes a few seconds. Refresh the page to check again."}
          </p>
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

            {resolvePaymentsMode(process.env) === "demo" && (
              <p className="rounded-md bg-brand-lavender px-4 py-3 text-sm">Demo booking: no payment was taken.</p>
            )}

            <p className="text-muted-foreground">
              We&apos;ve emailed your passes, with a QR code for each person. Show them at the gate on the night.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              {paid && canView && (
                <Link href={`/orders/${encodeURIComponent(order.publicId)}?t=${encodeURIComponent(t!)}`} className="btn-cta inline-block">
                  View my passes
                </Link>
              )}
              <Link href={`/e/${order.event.slug}`} className="font-semibold text-brand-orange-strong hover:underline">
                Back to event
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
