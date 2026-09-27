import type { Metadata } from "next";
import Link from "next/link";
import { allEventsFinance, Organizer } from "@indinite/db";
import { PageHeader, StatCard } from "@/components/staff/shell";
import { price } from "@/lib/format";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage() {
  const [rows, orgs] = await Promise.all([allEventsFinance(), Organizer.find({}, { name: 1 }).lean()]);
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
  const total = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);

  return (
    <>
      <PageHeader title="Finance" description="Sales, commission owed by organisers, and Indinite's income, per event." />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total sales" value={price(total((r) => r.totalSalesPence))} />
        <StatCard label="Organisers owe us" value={price(total((r) => r.direct.outstandingPence))} hint="Commission on cash, account and complimentary" />
        <StatCard label="Credited to organisers via Indinite" value={price(total((r) => r.platform.organizerCreditedPence))} />
        <StatCard label="Our income" value={price(total((r) => r.ourIncomePence))} hint="Platform fees + commission owed" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 text-right font-semibold">Total sales</th>
              <th className="px-4 py-3 text-right font-semibold">Organiser direct (cash / account)</th>
              <th className="px-4 py-3 text-right font-semibold">Organiser owes us</th>
              <th className="px-4 py-3 text-right font-semibold">Credited via Indinite</th>
              <th className="px-4 py-3 text-right font-semibold">Our income</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.eventId} className="hover:bg-muted/60">
                <td className="px-4 py-3">
                  <Link href={`/admin/finance/${r.eventId}`} className="font-semibold text-brand-orange-strong hover:underline">
                    {r.title}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {orgName.get(r.organizerId)} · {r.passes} passes
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{price(r.totalSalesPence)}</td>
                <td className="px-4 py-3 text-right">
                  {price(r.direct.cashPence + r.direct.accountPence)}
                  {r.direct.complimentaryPasses > 0 && <span className="block text-xs text-muted-foreground">+ {r.direct.complimentaryPasses} comp</span>}
                </td>
                <td className={`px-4 py-3 text-right font-semibold ${r.direct.outstandingPence > 0 ? "text-warning" : ""}`}>
                  {price(r.direct.outstandingPence)}
                  <span className="block text-xs font-normal text-muted-foreground">of {price(r.direct.commissionOwedPence)}</span>
                </td>
                <td className="px-4 py-3 text-right">{price(r.platform.organizerCreditedPence)}</td>
                <td className="px-4 py-3 text-right font-semibold">{price(r.ourIncomePence)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                  No events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
