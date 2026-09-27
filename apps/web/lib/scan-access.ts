import "server-only";
import { can } from "@indinite/core";
import { Event, Organizer } from "@indinite/db";
import { getStaffUser } from "./staff";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Signed-in user who may scan at this event's organiser, or an error response. */
export async function scanAccess(eventId: string | null) {
  const user = await getStaffUser();
  if (!user) return { error: json({ error: "Sign in to scan." }, 401) } as const;
  if (!eventId || !/^[a-f0-9]{24}$/.test(eventId)) return { error: json({ error: "Choose an event." }, 400) } as const;
  const event = await Event.findOne({ _id: eventId, deletedAt: null }, { organizerId: 1 }).lean();
  if (!event || !can(user, "scan.perform", { organizerId: String(event.organizerId) })) {
    return { error: json({ error: "You can't scan at this event." }, 403) } as const;
  }
  return { user, organizerId: String(event.organizerId) } as const;
}

/** Events this user can scan at (published, not finished more than a day ago). */
export async function scannableEvents() {
  const user = await getStaffUser();
  if (!user) return null;
  const orgIds = user.isSuperAdmin
    ? (await Organizer.find({ status: "active" }, { _id: 1 }).lean()).map((o) => o._id)
    : user.memberships.filter((m) => can(user, "scan.perform", { organizerId: m.organizerId })).map((m) => m.organizerId);
  const events = await Event.find(
    { organizerId: { $in: orgIds }, status: "published", deletedAt: null, endsAt: { $gt: new Date(Date.now() - 86_400_000) } },
    { title: 1, sessions: 1, organizerId: 1, startsAt: 1 },
  )
    .sort({ startsAt: 1 })
    .lean();
  return {
    user: { name: user.name },
    events: events.map((e) => ({
      id: String(e._id),
      title: e.title,
      canManualAdmit: can(user, "scan.manualAdmit", { organizerId: String(e.organizerId) }),
      sessions: e.sessions.map((s) => ({ id: String(s._id), label: s.label, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
    })),
  };
}
