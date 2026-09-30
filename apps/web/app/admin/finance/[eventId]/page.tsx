import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DEFAULT_FREE_COMPLIMENTARY_PASSES } from "@indinite/core";
import { Event, eventFinance, Organizer } from "@indinite/db";
import { EventPricingForm, RecordPaymentForm } from "@/components/staff/finance-forms";
import { PageHeader, StatCard } from "@/components/staff/shell";
import { formatDay, price } from "@/lib/format";

export const metadata: Metadata = { title: "Event finance" };

const pct = (bps: number | null | undefined) => (bps == null ? "" : (bps / 100).toString());

export default async function EventFinancePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const f = await eventFinance(eventId);
  if (!f) notFound();
  const [event, organizer] = await Promise.all([Event.findById(eventId).lean(), Organizer.findById(f.organizerId).lean()]);

  return (
    <>
      <PageHeader title={f.title} description={`${organizer?.name} · ${f.orders} orders · ${f.passes} passes`} actions={
          <div className="flex flex-wrap gap-4 text-sm">
            {(["orders", "attendees", "checkins"] as const).map((k) => (
              <a key={k} href={`/admin/export/${k}?event=${eventId}`} className="font-semibold text-brand-orange-strong hover:underline">
                {k === "orders" ? "Orders" : k === "attendees" ? "Attendees" : "Check-ins"} (CSV)
              </a>
            ))}
            <Link href="/admin/finance" className="font-semibold text-brand-orange-strong hover:underline">
              All events
            </Link>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total sales" value={price(f.totalSalesPence)} hint="Everything customers paid" />
        <StatCard label="Organiser direct" value={price(f.direct.cashPence + f.direct.accountPence)} hint={`Cash ${price(f.direct.cashPence)} · Account ${price(f.direct.accountPence)}`} />
        <StatCard label="Credited to organiser via Indinite" value={price(f.platform.organizerCreditedPence)} hint={`From ${price(f.platform.grossPence)} card and link sales${f.platform.cardFeesPence ? `, less ${price(f.platform.cardFeesPence)} card fees` : ""}${f.platform.ownStripeAccountPence ? `. ${price(f.platform.ownStripeAccountPence)} went into their own Stripe account, where Stripe takes its fee` : ""}`} />
        <StatCard label="Our income" value={price(f.ourIncomePence)} hint={`Fees ${price(f.platform.platformFeesPence)} + commission ${price(f.direct.commissionOwedPence)}`} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg">Organiser owes Indinite</h2>
          <p className="mt-1 text-sm text-muted-foreground">Commission on cash, organiser&apos;s account and complimentary passes ({f.direct.complimentaryPasses} comp).</p>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <dt className="text-xs text-muted-foreground">Owed</dt>
              <dd className="font-display text-xl font-bold">{price(f.direct.commissionOwedPence)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid</dt>
              <dd className="font-display text-xl font-bold text-success">{price(f.direct.commissionPaidPence)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Outstanding</dt>
              <dd className={`font-display text-xl font-bold ${f.direct.outstandingPence > 0 ? "text-warning" : ""}`}>{price(Math.max(0, f.direct.outstandingPence))}</dd>
            </div>
          </dl>
          <h3 className="mt-6 font-semibold">Payments received</h3>
          {f.payments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {f.payments.map((p, i) => (
                <li key={i} className="flex justify-between py-2">
                  <span>
                    {formatDay(p.at)} · {p.note}
                  </span>
                  <span className="font-semibold">{price(p.amountPence)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg">Record a payment</h2>
            <RecordPaymentForm eventId={eventId} outstandingPounds={f.direct.outstandingPence > 0 ? (f.direct.outstandingPence / 100).toFixed(2) : ""} />
          </section>
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg">Rates for this event</h2>
            <EventPricingForm eventId={eventId} commission={pct(event?.commissionBps)} tax={pct(event?.taxBps ?? 0)} organiserRate={pct(organizer?.commissionBps ?? 600)} freeComps={event?.freeComplimentaryPasses ?? DEFAULT_FREE_COMPLIMENTARY_PASSES} compsIssued={event?.complimentaryIssued ?? 0} />
          </section>
        </aside>
      </div>
    </>
  );
}
