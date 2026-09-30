import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventEditor } from "@/components/staff/event-editor";
import { requireOrg } from "@/lib/staff";

export const metadata: Metadata = { title: "Event" };

type Props = { params: Promise<{ slug: string; eventId: string }>; searchParams: Promise<{ created?: string }> };

/** Owner (or super admin): edit one of this organiser's events. Another organiser's event is a 404. */
export default async function OrgEventPage({ params, searchParams }: Props) {
  const { slug, eventId } = await params;
  const { created } = await searchParams;
  const { organizer, can } = await requireOrg(slug);
  if (!can("event.update")) notFound();
  return <EventEditor id={eventId} created={created} context={{ kind: "org", slug: organizer.slug, organizerId: organizer.id }} />;
}
