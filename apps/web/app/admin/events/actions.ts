"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { can, londonLocalToUtc, type Permission } from "@indinite/core";
import {
  addEventImage,
  addEventVideo,
  createDayPass,
  createEvent,
  createTicketType,
  deleteDayPass,
  deleteEvent,
  deleteTicketType,
  Event,
  EventAdminError,
  Organizer,
  removeEventMedia,
  TicketType,
  reorderEventMedia,
  setBookingsClosed,
  setEventStatus,
  updateDayPass,
  updateEvent,
  updateTicketType,
} from "@indinite/db";
import { zodFailure, type FormState } from "@/lib/form-state";
import { asStaff, requireStaff } from "@/lib/staff";

export type ActionState = FormState;

/** Zod paths (event, venue, pass type) → the form field names, so the right field is highlighted. */
const FIELD_NAMES: Record<string, string> = {
  "venue.name": "venueName",
  "venue.address": "venueAddress",
  "venue.postcode": "postcode",
  "venue.mapUrl": "mapUrl",
  "venue.lat": "lat",
  "venue.lng": "lng",
  pricePence: "price",
  validSessionIds: "nights",
};

/**
 * Event actions are shared by Admin → Events and the organiser panel (owners manage their own events, 1 Oct 2026).
 * Every action checks the permission against the event's organiser, read from the database, never from the form.
 */
class NotAllowed extends Error {}

async function authorizeEvent(eventId: string, permission: Permission) {
  const user = await requireStaff();
  const event = /^[a-f0-9]{24}$/.test(eventId) ? await Event.findOne({ _id: eventId, deletedAt: null }, { organizerId: 1 }).lean() : null;
  if (!event) throw new EventAdminError("Event not found.", 404);
  const organizerId = String(event.organizerId);
  if (!can(user, permission, { organizerId })) throw new NotAllowed();
  const org = await Organizer.findById(organizerId, { slug: 1 }).lean();
  return { user, organizerId, slug: org?.slug ?? null };
}

/** A pass type (or day pass group) id from the browser must belong to the event the user was authorised for. */
async function assertOnEvent(eventId: string, query: { ticketTypeId?: string; groupId?: string }) {
  const id = query.ticketTypeId ?? query.groupId ?? "";
  if (!/^[a-f0-9]{24}$/.test(id)) throw new EventAdminError("Pass type not found.", 404);
  const found = await TicketType.exists(query.ticketTypeId ? { _id: id, eventId } : { "dayPass.groupId": id, eventId });
  if (!found) throw new NotAllowed();
}

/** Refresh every page that shows this event: admin, the organiser panel and the public site. */
function revalidateEvent(eventId: string, slug: string | null) {
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/events");
  if (slug) {
    revalidatePath(`/org/${slug}/events/${eventId}`);
    revalidatePath(`/org/${slug}/events`);
    revalidatePath(`/org/${slug}`);
  }
  revalidatePath("/");
}

/** Where to go after creating or deleting: the admin list (super admin) or this organiser's events list. */
function safeReturn(returnTo: string, user: { isSuperAdmin: boolean }, slug: string | null): string {
  if (slug && returnTo === `/org/${slug}/events`) return returnTo;
  if (user.isSuperAdmin && returnTo === "/admin/events") return returnTo;
  return user.isSuperAdmin ? "/admin/events" : slug ? `/org/${slug}/events` : "/org";
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function failure(e: unknown, fallback: string): ActionState {
  if (e instanceof NotAllowed) return { error: "You don't have permission to change this event." };
  if (e instanceof EventAdminError) {
    // Point at the field the message is about, where there is one.
    const m = e.message;
    const field = /web address/i.test(m) ? "slug" : /latitude/i.test(m) ? "lat" : /longitude/i.test(m) ? "lng" : /^Enter the price/.test(m) ? "price" : /quota/i.test(m) ? "quota" : null;
    return field ? { error: m, fields: { [field]: m } } : { error: m };
  }
  if (e instanceof ZodError) return zodFailure(e, FIELD_NAMES);
  console.error("[admin events]", e instanceof Error ? e.message : e);
  return { error: fallback };
}

type NightInput = { id?: string; label: string; start: string; end: string };

/** Optional coordinate field: empty = not set; otherwise a decimal number. */
function coord(v: string, key: "lat" | "lng") {
  if (!v) return {};
  const n = Number(v);
  if (!Number.isFinite(n)) throw new EventAdminError(`Enter the ${key === "lat" ? "latitude" : "longitude"} as a number, e.g. ${key === "lat" ? "51.5072" : "-0.1276"}.`);
  return { [key]: n };
}

/** Nights arrive as JSON from the event form, with London wall-clock times. */
function parseNights(form: FormData) {
  let raw: NightInput[];
  try {
    raw = JSON.parse(text(form, "sessions") || "[]");
  } catch {
    throw new EventAdminError("Couldn't read the nights. Refresh and try again.");
  }
  return raw.map((n, i) => {
    const startsAt = londonLocalToUtc(n.start ?? "");
    const endsAt = londonLocalToUtc(n.end ?? "");
    if (!startsAt || !endsAt) throw new EventAdminError(`Enter a start and end time for night ${i + 1}.`);
    return { ...(n.id ? { id: n.id } : {}), label: String(n.label ?? "").trim(), startsAt, endsAt };
  });
}

function eventFields(form: FormData) {
  return {
    title: text(form, "title"),
    slug: text(form, "slug"),
    description: text(form, "description"),
    metaPixelId: text(form, "metaPixelId"),
    venue: {
      name: text(form, "venueName"),
      address: text(form, "venueAddress"),
      postcode: text(form, "postcode"),
      mapUrl: text(form, "mapUrl"),
      ...coord(text(form, "lat"), "lat"),
      ...coord(text(form, "lng"), "lng"),
    },
    sessions: parseNights(form),
  };
}

export async function createEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireStaff();
  const organizerId = text(form, "organizerId");
  if (!/^[a-f0-9]{24}$/.test(organizerId)) return { error: "Choose an organiser." };
  // Owners can create events only for an organiser they own; super admins for any.
  if (!can(user, "event.create", { organizerId })) return { error: "You don't have permission to create events for this organiser." };
  const slug = (await Organizer.findById(organizerId, { slug: 1 }).lean())?.slug ?? null;
  let id: string;
  try {
    const event = await asStaff(user, () => createEvent({ organizerId, status: "draft", ...eventFields(form) }), organizerId);
    id = String(event._id);
  } catch (e) {
    return failure(e, "Couldn't create the event.");
  }
  revalidateEvent(id, slug);
  redirect(`${safeReturn(text(form, "returnTo"), user, slug)}/${id}?created=1`);
}

export async function updateEventAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.update");
    await asStaff(user, () => updateEvent(eventId, eventFields(form)), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't save the event.");
  }
  return { ok: "Event saved." };
}

export async function setEventStatusAction(eventId: string, status: "draft" | "published" | "archived"): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.update");
    await asStaff(user, () => setEventStatus(eventId, status), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't change the status.");
  }
  return { ok: status === "published" ? "Published. It's now on the public site." : status === "draft" ? "Unpublished. It's hidden from the public site." : "Archived." };
}

export async function deleteEventAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  if (text(form, "confirm") !== "DELETE") return { error: "Type DELETE to confirm." };
  let back: string;
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.delete");
    await asStaff(user, () => deleteEvent(eventId, text(form, "reason")), organizerId);
    revalidateEvent(eventId, slug);
    back = safeReturn(text(form, "returnTo"), user, slug);
  } catch (e) {
    return failure(e, "Couldn't delete the event.");
  }
  redirect(`${back}?deleted=1`);
}

// ─── Media ───

export async function uploadImageAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.update");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await asStaff(user, () => addEventImage(eventId, { bytes, alt: text(form, "alt") }), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't upload that image.");
  }
  return { ok: "Image added." };
}

export async function addVideoAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.update");
    await asStaff(user, () => addEventVideo(eventId, text(form, "url"), text(form, "alt")), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't add that video.");
  }
  return { ok: "Video added." };
}

export async function removeMediaAction(eventId: string, url: string): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.update");
    await asStaff(user, () => removeEventMedia(eventId, url), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't remove it.");
  }
  return { ok: "Removed." };
}

export async function reorderMediaAction(eventId: string, urls: string[]): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.update");
    await asStaff(user, () => reorderEventMedia(eventId, urls), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't change the order.");
  }
  return { ok: "Order saved." };
}

// ─── Pass types ───

function ticketTypeFields(form: FormData) {
  const money = Number(text(form, "price").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(money) || money < 0) throw new EventAdminError("Enter the price in pounds, e.g. 12.50");
  const localOrUndefined = (key: string) => {
    const v = text(form, key);
    if (!v) return undefined;
    const d = londonLocalToUtc(v);
    if (!d) throw new EventAdminError("Enter a valid sales date and time.");
    return d;
  };
  return {
    name: text(form, "name"),
    description: text(form, "description"),
    pricePence: Math.round(money * 100),
    validSessionIds: form.getAll("nights").map(String),
    quota: Number(text(form, "quota")),
    maxPerOrder: Number(text(form, "maxPerOrder") || 10),
    salesStartAt: localOrUndefined("salesStartAt"),
    salesEndAt: localOrUndefined("salesEndAt"),
    sortOrder: Number(text(form, "sortOrder") || 0),
    active: form.get("active") === "on",
  };
}

export async function createTicketTypeAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "ticketType.manage");
    await asStaff(user, () => createTicketType({ eventId, ...ticketTypeFields(form) }), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't add the pass type.");
  }
  return { ok: "Pass type added." };
}

export async function updateTicketTypeAction(eventId: string, ticketTypeId: string, _: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "ticketType.manage");
    await assertOnEvent(eventId, { ticketTypeId });
    await asStaff(user, () => updateTicketType(ticketTypeId, ticketTypeFields(form)), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't save the pass type.");
  }
  return { ok: "Pass type saved. New bookings use these details; existing bookings keep theirs." };
}

export async function deleteTicketTypeAction(eventId: string, ticketTypeId: string): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "ticketType.manage");
    await assertOnEvent(eventId, { ticketTypeId });
    const { mode } = await asStaff(user, () => deleteTicketType(ticketTypeId), organizerId);
    revalidateEvent(eventId, slug);
    return { ok: mode === "deleted" ? "Pass type deleted." : "Passes of this type have been sold, so it's been switched off instead of deleted." };
  } catch (e) {
    return failure(e, "Couldn't delete the pass type.");
  }
}

// ─── Day passes (30 Sep 2026) ───

function dayPassFields(form: FormData, sessionIds: string[]) {
  const pounds = (v: string, label: string) => {
    const n = Number(v.replace(/[£,\s]/g, ""));
    if (!v || !Number.isFinite(n) || n < 0) throw new EventAdminError(`Enter a price in pounds for ${label}, e.g. 12.50`);
    return Math.round(n * 100);
  };
  const localOrUndefined = (key: string) => {
    const v = text(form, key);
    if (!v) return undefined;
    const d = londonLocalToUtc(v);
    if (!d) throw new EventAdminError("Enter a valid sales date and time.");
    return d;
  };
  const nights = sessionIds
    .filter((id) => form.get(`night_${id}`) === "on")
    .map((id) => ({
      sessionId: id,
      pricePence: pounds(text(form, `price_${id}`), text(form, `label_${id}`) || "each night"),
      quota: Number(text(form, `quota_${id}`)),
      active: form.get(`active_${id}`) !== "off",
    }));
  return {
    name: text(form, "name"),
    description: text(form, "description"),
    maxPerOrder: Number(text(form, "maxPerOrder") || 10),
    salesStartAt: localOrUndefined("salesStartAt"),
    salesEndAt: localOrUndefined("salesEndAt"),
    sortOrder: Number(text(form, "sortOrder") || 0),
    nights,
  };
}

export async function createDayPassAction(eventId: string, sessionIds: string[], _: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "ticketType.manage");
    await asStaff(user, () => createDayPass(eventId, dayPassFields(form, sessionIds)), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't add the day pass.");
  }
  return { ok: "Day pass added: one pass per night, each with its own price and quota." };
}

export async function updateDayPassAction(eventId: string, groupId: string, sessionIds: string[], _: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "ticketType.manage");
    await assertOnEvent(eventId, { groupId });
    await asStaff(user, () => updateDayPass(groupId, dayPassFields(form, sessionIds)), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't save the day pass.");
  }
  return { ok: "Day pass saved. New bookings use these prices; existing bookings keep theirs." };
}

export async function deleteDayPassAction(eventId: string, groupId: string): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "ticketType.manage");
    await assertOnEvent(eventId, { groupId });
    const r = await asStaff(user, () => deleteDayPass(groupId), organizerId);
    revalidateEvent(eventId, slug);
    return { ok: r.deactivated ? `Deleted ${r.deleted} night(s); ${r.deactivated} with bookings were switched off instead.` : "Day pass deleted." };
  } catch (e) {
    return failure(e, "Couldn't delete the day pass.");
  }
}

export async function adminSetBookingsClosedAction(eventId: string, sessionId: string | null, closed: boolean, reason: string): Promise<ActionState> {
  try {
    const { user, organizerId, slug } = await authorizeEvent(eventId, "event.manageSales");
    await asStaff(user, () => setBookingsClosed(eventId, { sessionId, closed, reason, by: user.id }), organizerId);
    revalidateEvent(eventId, slug);
  } catch (e) {
    return failure(e, "Couldn't change bookings.");
  }
  return { ok: closed ? "Bookings closed. Box office can still issue passes." : "Bookings reopened." };
}
