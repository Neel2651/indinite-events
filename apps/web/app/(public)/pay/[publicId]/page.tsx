import type { Metadata } from "next";
import { normalisePublicId, receiptLines, resolvePaymentsMode } from "@indinite/core";
import { linkSecret, verifyOrderLink } from "@indinite/core/links";
import { connectDb, Event, Order, Organizer } from "@indinite/db";
import { PayButton } from "@/components/pay-button";
import { formatDateRange, formatDayTime, price } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Complete your booking", robots: { index: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ publicId: string }>; searchParams: Promise<{ t?: string }> };

function Message({ title, body }: { title: string; body: string }) {
  return (
    <section className="bg-brand-cream">
      <div className="mx-auto max-w-lg px-5 py-16">
        <div className="card-brand">
          <h1 className="text-2xl">{title}</h1>
          <p className="mt-2 text-muted-foreground">{body}</p>
        </div>
      </div>
    </section>
  );
}

export default async function PayPage({ params, searchParams }: Props) {
  const publicId = normalisePublicId(decodeURIComponent((await params).publicId));
  const t = (await searchParams).t ?? "";
  const link = verifyOrderLink(publicId, t, linkSecret());
  if (!link.ok) return <Message title="This link has expired" body="Ask the organiser to send you a new payment link." />;
  await connectDb();
  const order = await Order.findOne({ publicId, source: "payment_link" }).lean();
  if (!order) return <Message title="Booking not found" body="Check you opened the whole link from your email." />;
  if (order.status === "paid") return <Message title="Already paid" body="This booking is paid and your passes have been emailed to you." />;
  if (order.status !== "pending") return <Message title="This booking has expired" body="The passes were released. Ask the organiser for a new link." />;
  const [event, organizer] = await Promise.all([Event.findById(order.eventId).lean(), Organizer.findById(order.organizerId, { name: 1 }).lean()]);
  const lines = receiptLines({
    items: order.items,
    discountPence: order.discount?.amountPence,
    discountLabel: order.discount?.reason,
    platformFeePence: order.platformFeePence,
    commissionBps: order.commissionBps,
    charges: order.charges,
    taxPence: order.taxPence,
    taxBps: order.taxBps,
  });
  const demo = resolvePaymentsMode(process.env) === "demo";

  return (
    <>
      <section className="dark bg-background text-foreground">
        <div className="mx-auto max-w-lg px-5 py-12">
          <span className="badge-pill">COMPLETE YOUR BOOKING</span>
          <h1 className="mt-5 text-3xl leading-tight">{event?.title}</h1>
          <p className="mt-3 text-muted-foreground">
            {event && formatDateRange(event.startsAt, event.endsAt)} · {event?.venue.name} · booked by {organizer?.name}
          </p>
        </div>
      </section>
      <section className="bg-brand-cream">
        <div className="mx-auto max-w-lg px-5 py-10">
          <div className="card-brand space-y-5">
            <p>
              Hi {order.customer?.name.split(" ")[0]}, your passes are reserved until <strong>{order.expiresAt ? formatDayTime(order.expiresAt) : "soon"}</strong>.
            </p>
            <dl className="space-y-2 border-y border-border py-4 text-sm">
              {lines.map((l) => (
                <div key={l.label} className={`flex justify-between ${l.negative ? "text-muted-foreground" : ""}`}>
                  <dt>{l.label}</dt>
                  <dd>
                    {l.negative ? "−" : ""}
                    {price(l.amountPence)}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between pt-2 font-display text-lg font-bold">
                <dt>Total</dt>
                <dd>{price(order.totalPence)}</dd>
              </div>
            </dl>
            <PayButton publicId={order.publicId} token={t} label={demo ? `Confirm booking · ${price(order.totalPence)}` : `Pay ${price(order.totalPence)}`} />
            {demo && <p className="text-center text-xs text-muted-foreground">Demo mode: no payment is taken and the booking is approved straight away.</p>}
            <p className="text-xs text-muted-foreground">Order {order.publicId}</p>
          </div>
        </div>
      </section>
    </>
  );
}
