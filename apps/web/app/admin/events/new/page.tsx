import type { Metadata } from "next";
import Link from "next/link";
import { Organizer } from "@indinite/db";
import { EventForm } from "@/components/staff/event-form";
import { PageHeader } from "@/components/staff/shell";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage() {
  const organisers = await Organizer.find({ status: "active" }, { name: 1 }).sort({ name: 1 }).lean();
  return (
    <>
      <PageHeader
        title="New event"
        description="Saved as a draft. Add pass types and images next, then publish."
        actions={
          <Link href="/admin/events" className="font-semibold text-brand-orange-strong hover:underline">
            All events
          </Link>
        }
      />
      <section className="rounded-lg border border-border bg-card p-6">
        {organisers.length === 0 ? (
          <p className="text-muted-foreground">
            Create an organiser first on the <Link href="/admin/organisers" className="font-semibold text-brand-orange-strong hover:underline">Organisers page</Link>.
          </p>
        ) : (
          <EventForm organisers={organisers.map((o) => ({ id: String(o._id), name: o.name }))} />
        )}
      </section>
    </>
  );
}
