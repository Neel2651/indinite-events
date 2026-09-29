"use server";

import { revalidatePath } from "next/cache";
import { EventAdminError, setBookingsClosed } from "@indinite/db";
import { asStaff, requireOrg } from "@/lib/staff";

/** Owner (or super admin): close or reopen bookings for one of this organiser's events, or a single night. */
export async function setBookingsClosedAction(slug: string, eventId: string, sessionId: string | null, closed: boolean, reason: string): Promise<{ ok?: string; error?: string }> {
  const { user, organizer, can } = await requireOrg(slug);
  if (!can("event.manageSales")) return { error: "Only the organiser's owner can close or reopen bookings." };
  try {
    // organizerId from the session: an owner can't touch another organiser's event.
    await asStaff(user, () => setBookingsClosed(eventId, { sessionId, closed, reason, by: user.id, organizerId: organizer.id }), organizer.id);
  } catch (e) {
    if (e instanceof EventAdminError) return { error: e.message };
    return { error: "Couldn't change bookings." };
  }
  revalidatePath(`/org/${slug}`);
  revalidatePath("/");
  return { ok: closed ? "Bookings closed. Box office can still issue passes." : "Bookings reopened." };
}
