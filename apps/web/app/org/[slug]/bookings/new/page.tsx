import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { available, bookability, cardFeeOf, maxDiscountBps, UNBOOKABLE_LABEL } from "@indinite/core";
import { Event, eventBookingState, Organizer, pricingFor, TicketType } from "@indinite/db";
import { OfflineBookingForm, type BookableEvent } from "@/components/staff/offline-booking-form";
import { PageHeader } from "@/components/staff/shell";
import { formatDay } from "@/lib/format";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "New booking" };

export default async function NewBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, organizer, can } = await requireOrg(slug);
  const discountLimitBps = can("order.applyDiscount") ? maxDiscountBps(user, { organizerId: organizer.id, maxDiscountBpsForManager: organizer.maxDiscountBpsForManager }) : 0;
  if (!can("order.issueOffline") && !can("order.createPaymentLink")) notFound();
  const org = await Organizer.findById(organizer.id, { commissionBps: 1, cardFee: 1 }).lean();

  const events = await Event.find({ organizerId: new Types.ObjectId(organizer.id), status: "published", deletedAt: null, endsAt: { $gt: new Date() } })
    .sort({ startsAt: 1 })
    .lean();
  const types = await TicketType.find({ eventId: { $in: events.map((e) => e._id) }, active: true }).sort({ sortOrder: 1 }).lean();
  const now = new Date();
  const bookable: BookableEvent[] = events.map((e) => ({
    id: String(e._id),
    title: e.title,
    ...pricingFor(e, org ?? {}),
    cardFee: cardFeeOf(org ?? {}),
    ticketTypes: types
      .filter((t) => String(t.eventId) === String(e._id))
      .map((t) => {
        const left = available({ quota: t.quota, sold: t.sold ?? 0, held: t.held ?? 0 });
        // Box office rules (sell until the night ends); online-only closures are shown as a note.
        const staff = bookability({ ...t, validSessionIds: t.validSessionIds.map(String), available: left }, eventBookingState(e), now, "staff");
        const online = bookability({ ...t, validSessionIds: t.validSessionIds.map(String), available: left }, eventBookingState(e), now, "payment_link");
        return {
          id: String(t._id),
          name: t.name,
          pricePence: t.pricePence,
          available: left,
          nightsLabel: t.validSessionIds.length === e.sessions.length && e.sessions.length > 1 ? "All nights" : `${t.validSessionIds.length} night${t.validSessionIds.length > 1 ? "s" : ""}`,
          validSessionIds: t.validSessionIds.map(String),
          dayPassName: t.dayPass?.name ?? null,
          blocked: staff.ok ? null : UNBOOKABLE_LABEL[staff.reason],
          onlineBlocked: online.ok ? null : UNBOOKABLE_LABEL[online.reason],
        };
      }),
    nights: e.sessions.map((s) => ({ id: String(s._id), label: s.label, dayLabel: formatDay(s.startsAt) })),
  }));

  return (
    <>
      <PageHeader title="New booking" description="Book for a customer: paid in cash or to your account, complimentary, or send them a card payment link." />
      <div className="rounded-lg border border-border bg-card p-6">
        <OfflineBookingForm slug={slug} events={bookable} canOffline={can("order.issueOffline")} canComplimentary={can("order.issueComplimentary")} canPaymentLink={can("order.createPaymentLink")} discountLimitBps={discountLimitBps} />
      </div>
    </>
  );
}
