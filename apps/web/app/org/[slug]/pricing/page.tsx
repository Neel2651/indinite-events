import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { Event, Organizer, pricingFor, TicketType } from "@indinite/db";
import { ChargesEditor } from "@/components/staff/charges-editor";
import { PageHeader } from "@/components/staff/shell";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Pricing & charges" };

export default async function PricingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { organizer, can } = await requireOrg(slug);
  if (!can("event.read")) notFound();
  const org = await Organizer.findById(organizer.id).lean();
  const events = await Event.find({ organizerId: new Types.ObjectId(organizer.id), deletedAt: null }).sort({ startsAt: 1 }).lean();
  const cheapest = await TicketType.aggregate<{ _id: Types.ObjectId; min: number }>([
    { $match: { eventId: { $in: events.map((e) => e._id) }, active: true } },
    { $group: { _id: "$eventId", min: { $min: "$pricePence" } } },
  ]);
  const minBy = new Map(cheapest.map((c) => [String(c._id), c.min]));

  return (
    <>
      <PageHeader title="Pricing & charges" description="Charges you add go to you and are added to each ticket at checkout. Indinite sets the platform fee and tax." />
      <div className="space-y-6">
        {events.map((e) => {
          const s = pricingFor(e, org ?? {});
          return (
            <section key={String(e._id)} className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg">{e.title}</h2>
                <p className="text-sm text-muted-foreground">
                  Platform fee {s.commissionBps / 100}% · Tax {s.taxBps / 100}%
                </p>
              </div>
              <ChargesEditor
                slug={slug}
                eventId={String(e._id)}
                canEdit={can("event.manageCharges")}
                commissionBps={s.commissionBps}
                taxBps={s.taxBps}
                examplePricePence={minBy.get(String(e._id)) ?? 1200}
                initial={s.charges.map((c) => ({ name: c.name, kind: c.kind, amount: (c.value / 100).toString() }))}
              />
            </section>
          );
        })}
        {events.length === 0 && <p className="text-muted-foreground">No events yet.</p>}
      </div>
    </>
  );
}
