import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Discount, Event } from "@indinite/db";
import { CouponForm, EndCouponButton } from "@/components/staff/coupon-form";
import { PageHeader } from "@/components/staff/shell";
import { formatDay, price } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Coupons" };

export default async function CouponsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { organizer, can } = await requireOrg(slug);
  if (!can("coupon.manage")) notFound();
  const orgId = new Types.ObjectId(organizer.id);
  const [coupons, events] = await Promise.all([
    Discount.find({ organizerId: orgId, code: { $type: "string" } }).sort({ createdAt: -1 }).lean(),
    Event.find({ organizerId: orgId, deletedAt: null }, { title: 1 }).sort({ startsAt: 1 }).lean(),
  ]);
  const title = new Map(events.map((e) => [String(e._id), e.title]));
  const now = new Date();

  return (
    <>
      <PageHeader title="Coupons" description="Codes customers enter at checkout. Discounts come off the ticket price, before fees." />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Discount</th>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">Used</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {coupons.map((c) => {
              const ended = !!c.validTo && c.validTo <= now;
              const full = !!c.maxUses && (c.used ?? 0) >= c.maxUses;
              const notYet = !!c.validFrom && c.validFrom > now;
              return (
                <tr key={String(c._id)}>
                  <td className="px-4 py-3 font-display font-semibold tracking-wider">{c.code}</td>
                  <td className="px-4 py-3">{c.kind === "percent" ? `${c.value / 100}% off` : `${price(c.value)} off`}</td>
                  <td className="px-4 py-3">{c.eventId ? title.get(String(c.eventId)) : "All events"}</td>
                  <td className="px-4 py-3">
                    {c.used ?? 0}
                    {c.maxUses ? ` / ${c.maxUses}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    {ended ? `Ended ${formatDay(c.validTo!)}` : full ? "Fully used" : notYet ? `Starts ${formatDay(c.validFrom!)}` : "Active"}
                  </td>
                  <td className="px-4 py-3 text-right">{!ended && <EndCouponButton slug={slug} couponId={String(c._id)} />}</td>
                </tr>
              );
            })}
            {coupons.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                  No coupons yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <section className="mt-8 rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg">New coupon</h2>
        <CouponForm slug={slug} events={events.map((e) => ({ id: String(e._id), title: e.title }))} />
      </section>
    </>
  );
}
