import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventForm } from "@/components/staff/event-form";
import { PageHeader } from "@/components/staff/shell";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Create event" };

export default async function OrgNewEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { organizer, can } = await requireOrg(slug);
  if (!can("event.create")) notFound();
  return (
    <>
      <PageHeader
        title="Create event"
        description="Saved as a draft. Add pass types and images next, then publish."
        actions={
          <Link href={`/org/${organizer.slug}/events`} className="font-semibold text-brand-orange-strong hover:underline">
            All events
          </Link>
        }
      />
      <section className="rounded-lg border border-border bg-card p-6">
        <EventForm organizerId={organizer.id} returnTo={`/org/${organizer.slug}/events`} />
      </section>
    </>
  );
}
