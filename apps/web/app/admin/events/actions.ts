"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { londonLocalToUtc } from "@indinite/core";
import {
  addEventImage,
  addEventVideo,
  createEvent,
  createTicketType,
  deleteEvent,
  deleteTicketType,
  EventAdminError,
  removeEventMedia,
  reorderEventMedia,
  setEventStatus,
  updateEvent,
  updateTicketType,
} from "@indinite/db";
import { asStaff, requireSuperAdmin } from "@/lib/staff";

export type ActionState = { error?: string; ok?: string } | null;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function failure(e: unknown, fallback: string): ActionState {
  if (e instanceof EventAdminError) return { error: e.message };
  if (e instanceof ZodError) return { error: e.issues[0]?.message ?? fallback };
  console.error("[admin events]", e instanceof Error ? e.message : e);
  return { error: fallback };
}

type NightInput = { id?: string; label: string; start: string; end: string };

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
    venue: { name: text(form, "venueName"), address: text(form, "venueAddress"), postcode: text(form, "postcode"), mapUrl: text(form, "mapUrl") },
    sessions: parseNights(form),
  };
}

export async function createEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  let id: string;
  try {
    const organizerId = text(form, "organizerId");
    const event = await asStaff(user, () => createEvent({ organizerId, status: "draft", ...eventFields(form) }), organizerId);
    id = String(event._id);
  } catch (e) {
    return failure(e, "Couldn't create the event.");
  }
  revalidatePath("/admin/events");
  redirect(`/admin/events/${id}?created=1`);
}

export async function updateEventAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => updateEvent(eventId, eventFields(form)));
  } catch (e) {
    return failure(e, "Couldn't save the event.");
  }
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/");
  return { ok: "Event saved." };
}

export async function setEventStatusAction(eventId: string, status: "draft" | "published" | "archived"): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => setEventStatus(eventId, status));
  } catch (e) {
    return failure(e, "Couldn't change the status.");
  }
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/events");
  revalidatePath("/");
  return { ok: status === "published" ? "Published. It's now on the public site." : status === "draft" ? "Unpublished. It's hidden from the public site." : "Archived." };
}

export async function deleteEventAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  if (text(form, "confirm") !== "DELETE") return { error: "Type DELETE to confirm." };
  try {
    await asStaff(user, () => deleteEvent(eventId, text(form, "reason")));
  } catch (e) {
    return failure(e, "Couldn't delete the event.");
  }
  revalidatePath("/admin/events");
  revalidatePath("/");
  redirect("/admin/events?deleted=1");
}

// ─── Media ───

export async function uploadImageAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await asStaff(user, () => addEventImage(eventId, { bytes, alt: text(form, "alt") }));
  } catch (e) {
    return failure(e, "Couldn't upload that image.");
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { ok: "Image added." };
}

export async function addVideoAction(eventId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => addEventVideo(eventId, text(form, "url"), text(form, "alt")));
  } catch (e) {
    return failure(e, "Couldn't add that video.");
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { ok: "Video added." };
}

export async function removeMediaAction(eventId: string, url: string): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => removeEventMedia(eventId, url));
  } catch (e) {
    return failure(e, "Couldn't remove it.");
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { ok: "Removed." };
}

export async function reorderMediaAction(eventId: string, urls: string[]): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => reorderEventMedia(eventId, urls));
  } catch (e) {
    return failure(e, "Couldn't change the order.");
  }
  revalidatePath(`/admin/events/${eventId}`);
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
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => createTicketType({ eventId, ...ticketTypeFields(form) }));
  } catch (e) {
    return failure(e, "Couldn't add the pass type.");
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { ok: "Pass type added." };
}

export async function updateTicketTypeAction(eventId: string, ticketTypeId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    await asStaff(user, () => updateTicketType(ticketTypeId, ticketTypeFields(form)));
  } catch (e) {
    return failure(e, "Couldn't save the pass type.");
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { ok: "Pass type saved. New bookings use these details; existing bookings keep theirs." };
}

export async function deleteTicketTypeAction(eventId: string, ticketTypeId: string): Promise<ActionState> {
  const user = await requireSuperAdmin();
  try {
    const { mode } = await asStaff(user, () => deleteTicketType(ticketTypeId));
    revalidatePath(`/admin/events/${eventId}`);
    return { ok: mode === "deleted" ? "Pass type deleted." : "Passes of this type have been sold, so it's been switched off instead of deleted." };
  } catch (e) {
    return failure(e, "Couldn't delete the pass type.");
  }
}
