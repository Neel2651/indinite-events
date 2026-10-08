import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Discount, Event, passesLabel, TicketType } from "@indinite/db";
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
    Event.find({ organizerId: orgId, deletedAt: null }, { title: 1, sessions: 1 }).sort({ startsAt: 1 }).lean(),
  ]);
  const title = new Map(events.map((e) => [String(e._id), e.title]));
  // Pass types for the "Applies to" choice (8 Oct 2026): one-night passes under their night, then multi-night ones.
  const types = await TicketType.find({ eventId: { $in: events.map((e) => e._id) } }, { eventId: 1, name: 1, validSessionIds: 1, sortOrder: 1 }).sort({ sortOrder: 1, name: 1 }).lean();
  const typeName = new Map(types.map((t) => [String(t._id), t.name]));
  const passGroups = Object.fromEntries(
    events.map((e) => {
      const mine = types.filter((t) => String(t.eventId) === String(e._id));
      const nights = e.sessions
        .map((s) => ({
          title: `${s.label} · ${formatDay(s.startsAt)}`,
          passes: mine.filter((t) => t.validSessionIds.length === 1 && String(t.validSessionIds[0]) === String(s._id)).map((t) => ({ id: String(t._id), name: t.name })),
        }))
        .filter((g) => g.passes.length);
      const multi = mine.filter((t) => t.validSessionIds.length !== 1).map((t) => ({ id: String(t._id), name: t.name }));
      return [String(e._id), [...nights, ...(multi.length ? [{ title: "Passes for more than one night", passes: multi }] : [])]];
    }),
  );
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
                  <td className="px-4 py-3">
                    {c.kind === "percent" ? `${c.value / 100}% off` : `${price(c.value)} off`}
                    {(c.maxDiscountPence || c.minSubtotalPence) && (
                      <span className="block text-xs text-muted-foreground">
                        {[c.maxDiscountPence ? `up to ${price(c.maxDiscountPence)}` : "", c.minSubtotalPence ? `min spend ${price(c.minSubtotalPence)}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {c.ticketTypeIds && c.ticketTypeIds.length > 0 && (
                      <span className="block text-xs text-muted-foreground">Only: {passesLabel(c.ticketTypeIds.map((id) => typeName.get(String(id)) ?? "a removed pass"))}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{c.eventId ? title.get(String(c.eventId)) : "All events"}</td>
                  <td className="px-4 py-3">
                    {(c.used ?? 0) > 0 ? (
                      <Link href={`/org/${slug}/orders?coupon=${encodeURIComponent(c.code!)}`} className="font-semibold text-brand-orange-strong hover:underline">
                        {c.used}
                        {c.maxUses ? ` / ${c.maxUses}` : ""}
                        <span className="sr-only"> uses: see orders</span>
                      </Link>
                    ) : (
                      <>0{c.maxUses ? ` / ${c.maxUses}` : ""}</>
                    )}
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
        <CouponForm slug={slug} events={events.map((e) => ({ id: String(e._id), title: e.title, passGroups: passGroups[String(e._id)] ?? [] }))} />
      </section>
    </>
  );
}
