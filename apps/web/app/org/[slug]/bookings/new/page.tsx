import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { available } from "@indinite/core";
import { Event, Organizer, pricingFor, TicketType } from "@indinite/db";
import { OfflineBookingForm, type BookableEvent } from "@/components/staff/offline-booking-form";
import { PageHeader } from "@/components/staff/shell";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "New booking" };

export default async function NewBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { organizer, can } = await requireOrg(slug);
  if (!can("order.issueOffline") && !can("order.createPaymentLink")) notFound();
  const org = await Organizer.findById(organizer.id, { commissionBps: 1 }).lean();

  const events = await Event.find({ organizerId: new Types.ObjectId(organizer.id), status: "published", deletedAt: null, endsAt: { $gt: new Date() } })
    .sort({ startsAt: 1 })
    .lean();
  const types = await TicketType.find({ eventId: { $in: events.map((e) => e._id) }, active: true }).sort({ sortOrder: 1 }).lean();
  const bookable: BookableEvent[] = events.map((e) => ({
    id: String(e._id),
    title: e.title,
    ...pricingFor(e, org ?? {}),
    ticketTypes: types
      .filter((t) => String(t.eventId) === String(e._id))
      .map((t) => ({
        id: String(t._id),
        name: t.name,
        pricePence: t.pricePence,
        available: available({ quota: t.quota, sold: t.sold ?? 0, held: t.held ?? 0 }),
        nightsLabel: t.validSessionIds.length === e.sessions.length && e.sessions.length > 1 ? "All nights" : `${t.validSessionIds.length} night${t.validSessionIds.length > 1 ? "s" : ""}`,
      })),
  }));

  return (
    <>
      <PageHeader title="New booking" description="Book for a customer: paid in cash or to your account, complimentary, or send them a card payment link." />
      <div className="rounded-lg border border-border bg-card p-6">
        <OfflineBookingForm slug={slug} events={bookable} canOffline={can("order.issueOffline")} canPaymentLink={can("order.createPaymentLink")} />
      </div>
    </>
  );
}
