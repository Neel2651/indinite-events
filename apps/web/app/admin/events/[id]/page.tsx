import type { Metadata } from "next";
import { EventEditor } from "@/components/staff/event-editor";

export const metadata: Metadata = { title: "Event" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

export default async function AdminEventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { created } = await searchParams;
  return <EventEditor id={id} created={created} context={{ kind: "admin" }} />;
}
