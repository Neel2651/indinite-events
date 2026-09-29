import { randomBytes } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Types } from "mongoose";
import { dayPassMemberName, dayPassUpsertSchema, embedUrlFor, eventUpsertSchema, ticketTypeUpsertSchema, type BookableEventState, type DayPassRaw, type EventUpsertRaw, type TicketTypeUpsertInput, type TicketTypeUpsertRaw } from "@indinite/core";
import { audited } from "../audit";
import { MEDIA_URL_PREFIX, mediaDir, mediaUrl, resolveMediaPath } from "../media";
import { Event } from "../models/event";
import { Order } from "../models/order";
import { Organizer } from "../models/organizer";
import { Ticket } from "../models/ticket";
import { TicketType } from "../models/ticket-type";
import { quota, QuotaTooLowError } from "../quota";
import { withTransaction } from "../transaction";

/**
 * Super admin event management (SPEC §1, M2): events, nights, ticket types and media. Callers check
 * `event.create` / `event.update` / `event.delete` / `ticketType.manage` (super admin only) first.
 */

export class EventAdminError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const isDuplicateKey = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === 11000;

async function loadEvent(eventId: string) {
  if (!Types.ObjectId.isValid(eventId)) throw new EventAdminError("Event not found.", 404);
  const event = await Event.findOne({ _id: eventId, deletedAt: null }).lean();
  if (!event) throw new EventAdminError("Event not found.", 404);
  return event;
}

const span = (sessions: { startsAt: Date; endsAt: Date }[]) => ({
  startsAt: new Date(Math.min(...sessions.map((s) => s.startsAt.getTime()))),
  endsAt: new Date(Math.max(...sessions.map((s) => s.endsAt.getTime()))),
});

/** Plain snapshot for the audit diff. */
const eventSnapshot = (e: { title: string; slug: string; description?: string | null; venue: unknown; sessions: { _id?: unknown; label: string; startsAt: Date; endsAt: Date }[]; status?: string | null }) => ({
  title: e.title,
  slug: e.slug,
  description: e.description ?? "",
  venue: e.venue,
  sessions: e.sessions.map((s) => ({ id: s._id ? String(s._id) : undefined, label: s.label, startsAt: s.startsAt, endsAt: s.endsAt })),
  status: e.status,
});

export async function createEvent(raw: EventUpsertRaw) {
  const input = eventUpsertSchema.parse(raw);
  const organizer = await Organizer.findById(input.organizerId, { status: 1 }).lean();
  if (!organizer) throw new EventAdminError("Choose an organiser.", 404);
  if (organizer.status !== "active") throw new EventAdminError("That organiser is suspended.", 409);
  try {
    return await withTransaction(async (session) => {
      const [event] = await Event.create(
        [
          {
            organizerId: organizer._id,
            title: input.title,
            slug: input.slug,
            description: input.description,
            venue: input.venue,
            sessions: input.sessions.map((s) => ({ label: s.label, startsAt: s.startsAt, endsAt: s.endsAt })),
            status: "draft", // publish separately, once it has passes
          },
        ],
        { session },
      );
      await audited(session, { action: "event.created", entity: { type: "event", id: event!._id }, after: eventSnapshot(event!.toObject()), organizerId: organizer._id });
      return event!.toObject();
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new EventAdminError("Another event already uses that web address. Choose a different one.", 409);
    throw e;
  }
}

/**
 * Update details and nights. Nights are matched by id: kept nights keep their id (ticket types and passes point
 * at them); a night can't be removed while a ticket type or pass uses it.
 */
export async function updateEvent(eventId: string, raw: Omit<EventUpsertRaw, "organizerId" | "status">) {
  const before = await loadEvent(eventId);
  const input = eventUpsertSchema.parse({ ...raw, organizerId: String(before.organizerId), status: before.status ?? "draft" });
  const existing = new Set(before.sessions.map((s) => String(s._id)));
  for (const s of input.sessions) if (s.id && !existing.has(s.id)) throw new EventAdminError("One of those nights isn't on this event. Refresh and try again.", 409);
  const kept = new Set(input.sessions.map((s) => s.id).filter(Boolean) as string[]);
  const removed = [...existing].filter((id) => !kept.has(id)).map((id) => new Types.ObjectId(id));

  const sessions = input.sessions.map((s) => ({ _id: s.id ? new Types.ObjectId(s.id) : new Types.ObjectId(), label: s.label, startsAt: s.startsAt, endsAt: s.endsAt }));
  try {
    return await withTransaction(async (session) => {
      if (removed.length) {
        const usedBy = await TicketType.findOne({ eventId: before._id, validSessionIds: { $in: removed } }, { name: 1 }, { session }).lean();
        if (usedBy) throw new EventAdminError(`You can't remove a night that “${usedBy.name}” is valid for. Change that pass type first.`, 409);
        if (await Ticket.exists({ eventId: before._id, validSessionIds: { $in: removed } }).session(session)) {
          throw new EventAdminError("You can't remove a night that passes have already been issued for.", 409);
        }
      }
      const set = { title: input.title, slug: input.slug, description: input.description, venue: input.venue, sessions, ...span(sessions) };
      await Event.updateOne({ _id: before._id, deletedAt: null }, { $set: set }, { session, runValidators: true });
      // Day passes carry their night's date in the name: keep it right if a night moved.
      const members = await TicketType.find({ eventId: before._id, "dayPass.groupId": { $exists: true } }, { name: 1, dayPass: 1, validSessionIds: 1 }, { session }).lean();
      for (const m of members) {
        const night = sessions.find((x) => String(x._id) === String(m.validSessionIds[0]));
        if (!night || !m.dayPass?.name) continue;
        const name = dayPassMemberName(m.dayPass.name, night.startsAt);
        if (name !== m.name) await TicketType.updateOne({ _id: m._id }, { $set: { name } }, { session });
      }
      await audited(session, {
        action: "event.updated",
        entity: { type: "event", id: before._id },
        before: eventSnapshot(before),
        after: eventSnapshot({ ...set, status: before.status }),
        organizerId: before.organizerId,
      });
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new EventAdminError("Another event already uses that web address. Choose a different one.", 409);
    throw e;
  }
}

/** Draft / published / archived. Publishing needs at least one active pass type. */
export async function setEventStatus(eventId: string, status: "draft" | "published" | "archived") {
  const before = await loadEvent(eventId);
  if (!["draft", "published", "archived"].includes(status)) throw new EventAdminError("Unknown status.");
  if (status === "published" && !(await TicketType.exists({ eventId: before._id, active: true }))) {
    throw new EventAdminError("Add at least one pass type before publishing.", 409);
  }
  return withTransaction(async (session) => {
    await Event.updateOne({ _id: before._id }, { $set: { status } }, { session });
    await audited(session, { action: "event.status_changed", entity: { type: "event", id: before._id }, before: { status: before.status }, after: { status }, organizerId: before.organizerId });
  });
}

/**
 * Hard delete only when the event has no orders at all (SPEC §3); otherwise soft delete (hidden everywhere,
 * records kept for finance and audit).
 */
export async function deleteEvent(eventId: string, reason: string): Promise<{ mode: "deleted" | "archived" }> {
  const before = await loadEvent(eventId);
  if (reason.trim().length < 3) throw new EventAdminError("Add a reason (it's recorded in the audit log).");
  const hasOrders = await Order.exists({ eventId: before._id });
  const mode = hasOrders ? "archived" : "deleted";
  await withTransaction(async (session) => {
    if (hasOrders) {
      await Event.updateOne({ _id: before._id }, { $set: { deletedAt: new Date(), status: "archived" } }, { session });
    } else {
      await TicketType.deleteMany({ eventId: before._id }, { session });
      await Event.deleteOne({ _id: before._id }, { session });
    }
    await audited(session, {
      action: hasOrders ? "event.soft_deleted" : "event.deleted",
      entity: { type: "event", id: before._id },
      before: eventSnapshot(before),
      reason: reason.trim(),
      organizerId: before.organizerId,
    });
  });
  if (mode === "deleted") await rm(path.join(mediaDir(), "events", String(before._id)), { recursive: true, force: true }).catch(() => undefined);
  return { mode };
}

// ─── Media ─────────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Image type from the file's first bytes (never trust the name or the browser's content type). SVG isn't accepted. */
export function sniffImageType(bytes: Uint8Array): ".jpg" | ".png" | ".webp" | ".avif" | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ".jpg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return ".png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return ".webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return ".avif";
  return null;
}

const nextOrder = (media: { order?: number | null }[]) => media.reduce((m, x) => Math.max(m, x.order ?? 0), -1) + 1;

export async function addEventImage(eventId: string, file: { bytes: Uint8Array; alt: string }) {
  const event = await loadEvent(eventId);
  if (file.bytes.length === 0) throw new EventAdminError("Choose an image to upload.");
  if (file.bytes.length > MAX_IMAGE_BYTES) throw new EventAdminError("Images can be up to 5 MB.");
  const ext = sniffImageType(file.bytes);
  if (!ext) throw new EventAdminError("Upload a JPEG, PNG, WebP or AVIF image.");
  const alt = file.alt.trim().slice(0, 200);
  if (!alt) throw new EventAdminError("Describe the image for people using screen readers (alt text).");

  const rel = path.join("events", String(event._id), `${randomBytes(9).toString("base64url")}${ext}`);
  const full = resolveMediaPath(rel);
  if (!full) throw new EventAdminError("Couldn't save that image.");
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, file.bytes, { flag: "wx" });
  const item = { type: "image" as const, url: mediaUrl(rel), alt, order: nextOrder(event.media ?? []) };
  try {
    await withTransaction(async (session) => {
      await Event.updateOne({ _id: event._id }, { $push: { media: item } }, { session });
      await audited(session, { action: "event.media_added", entity: { type: "event", id: event._id }, after: { media: item }, organizerId: event.organizerId });
    });
  } catch (e) {
    await unlink(full).catch(() => undefined);
    throw e;
  }
  return item;
}

export async function addEventVideo(eventId: string, url: string, alt: string) {
  const event = await loadEvent(eventId);
  const clean = url.trim();
  if (!embedUrlFor(clean)) throw new EventAdminError("Paste a YouTube or Vimeo link, e.g. https://www.youtube.com/watch?v=…");
  const title = alt.trim().slice(0, 200);
  if (!title) throw new EventAdminError("Give the video a short title (read out by screen readers).");
  const item = { type: "video" as const, url: clean, alt: title, order: nextOrder(event.media ?? []) };
  await withTransaction(async (session) => {
    await Event.updateOne({ _id: event._id }, { $push: { media: item } }, { session });
    await audited(session, { action: "event.media_added", entity: { type: "event", id: event._id }, after: { media: item }, organizerId: event.organizerId });
  });
  return item;
}

export async function removeEventMedia(eventId: string, url: string) {
  const event = await loadEvent(eventId);
  const item = (event.media ?? []).find((m) => m.url === url);
  if (!item) throw new EventAdminError("That image or video isn't on this event.", 404);
  await withTransaction(async (session) => {
    await Event.updateOne({ _id: event._id }, { $pull: { media: { url } } }, { session });
    await audited(session, { action: "event.media_removed", entity: { type: "event", id: event._id }, before: { media: { type: item.type, url: item.url, alt: item.alt } }, organizerId: event.organizerId });
  });
  // Uploaded file: only ever inside this event's own media folder.
  const prefix = `${MEDIA_URL_PREFIX}/events/${String(event._id)}/`;
  if (item.type === "image" && url.startsWith(prefix)) {
    const full = resolveMediaPath(decodeURIComponent(url.slice(MEDIA_URL_PREFIX.length + 1)));
    if (full) await unlink(full).catch(() => undefined);
  }
}

/** New display order: `urls` lists every media item's url in the order to show them. */
export async function reorderEventMedia(eventId: string, urls: string[]) {
  const event = await loadEvent(eventId);
  const media = event.media ?? [];
  if (urls.length !== media.length || !media.every((m) => urls.includes(m.url))) throw new EventAdminError("The media list changed. Refresh and try again.", 409);
  const reordered = urls.map((u, i) => ({ ...media.find((m) => m.url === u)!, order: i }));
  await withTransaction(async (session) => {
    await Event.updateOne({ _id: event._id }, { $set: { media: reordered } }, { session });
    await audited(session, { action: "event.media_reordered", entity: { type: "event", id: event._id }, before: { order: [...media].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((m) => m.url) }, after: { order: urls }, organizerId: event.organizerId });
  });
}

// ─── Ticket types ──────────────────────────────────────────────────────────────────────────────────────────

const typeSnapshot = (t: Partial<TicketTypeUpsertInput> & { validSessionIds?: unknown[] }) => ({
  name: t.name,
  description: t.description,
  pricePence: t.pricePence,
  validSessionIds: (t.validSessionIds ?? []).map(String),
  quota: t.quota,
  maxPerOrder: t.maxPerOrder,
  salesStartAt: t.salesStartAt ?? null,
  salesEndAt: t.salesEndAt ?? null,
  sortOrder: t.sortOrder,
  active: t.active,
});

function checkNights(event: { sessions: { _id: unknown }[] }, ids: string[]) {
  const nights = new Set(event.sessions.map((s) => String(s._id)));
  if (!ids.every((id) => nights.has(id))) throw new EventAdminError("Choose nights from this event.");
}

export async function createTicketType(raw: TicketTypeUpsertRaw) {
  const input = ticketTypeUpsertSchema.parse(raw);
  const event = await loadEvent(input.eventId);
  checkNights(event, input.validSessionIds);
  return withTransaction(async (session) => {
    const [tt] = await TicketType.create(
      [{ ...input, eventId: event._id, validSessionIds: input.validSessionIds.map((id) => new Types.ObjectId(id)), sold: 0, held: 0 }],
      { session },
    );
    await audited(session, { action: "ticketType.created", entity: { type: "ticketType", id: tt!._id }, after: typeSnapshot(input), organizerId: event.organizerId, metadata: { eventId: String(event._id) } });
    return tt!.toObject();
  });
}

/** Price changes apply to new bookings only (orders keep their price). Quota never drops below sold + held. */
export async function updateTicketType(ticketTypeId: string, raw: Omit<TicketTypeUpsertRaw, "eventId">) {
  if (!Types.ObjectId.isValid(ticketTypeId)) throw new EventAdminError("Pass type not found.", 404);
  const before = await TicketType.findById(ticketTypeId).lean();
  if (!before) throw new EventAdminError("Pass type not found.", 404);
  const input = ticketTypeUpsertSchema.parse({ ...raw, eventId: String(before.eventId) });
  const event = await loadEvent(String(before.eventId));
  checkNights(event, input.validSessionIds);
  const removedNights = before.validSessionIds.map(String).filter((id) => !input.validSessionIds.includes(id));
  if (removedNights.length && (before.sold > 0 || before.held > 0)) {
    throw new EventAdminError("Passes of this type have been sold, so its nights can't be removed. You can add nights.", 409);
  }
  try {
    await withTransaction(async (session) => {
      const { quota: newQuota, eventId: _e, ...rest } = input;
      await TicketType.updateOne(
        { _id: before._id },
        { $set: { ...rest, validSessionIds: input.validSessionIds.map((id) => new Types.ObjectId(id)) }, $unset: { ...(input.salesStartAt ? {} : { salesStartAt: 1 }), ...(input.salesEndAt ? {} : { salesEndAt: 1 }) } },
        { session },
      );
      if (newQuota !== before.quota) await quota.set(before._id, newQuota, session);
      await audited(session, { action: "ticketType.updated", entity: { type: "ticketType", id: before._id }, before: typeSnapshot(before as never), after: typeSnapshot(input), organizerId: event.organizerId, metadata: { eventId: String(event._id) } });
    });
  } catch (e) {
    if (e instanceof QuotaTooLowError) {
      const now = await TicketType.findById(before._id, { sold: 1, held: 1 }).lean();
      throw new EventAdminError(`The quota can't be lower than ${(now?.sold ?? 0) + (now?.held ?? 0)} (passes already sold or being paid for).`, 409);
    }
    throw e;
  }
}

/** Hard delete only if nothing was ever sold or held and no passes exist; otherwise switch it off. */
export async function deleteTicketType(ticketTypeId: string): Promise<{ mode: "deleted" | "deactivated" }> {
  if (!Types.ObjectId.isValid(ticketTypeId)) throw new EventAdminError("Pass type not found.", 404);
  const before = await TicketType.findById(ticketTypeId).lean();
  if (!before) throw new EventAdminError("Pass type not found.", 404);
  const event = await Event.findById(before.eventId, { organizerId: 1 }).lean();
  let mode: "deleted" | "deactivated" = "deactivated";
  await withTransaction(async (session) => {
    const used = (await Ticket.exists({ ticketTypeId: before._id }).session(session)) || (await Order.exists({ "items.ticketTypeId": before._id }).session(session));
    if (used) {
      await TicketType.updateOne({ _id: before._id }, { $set: { active: false } }, { session });
    } else {
      // Conditional: a booking that started meanwhile keeps the type alive.
      const res = await TicketType.deleteOne({ _id: before._id, sold: 0, held: 0 }, { session });
      if (res.deletedCount !== 1) await TicketType.updateOne({ _id: before._id }, { $set: { active: false } }, { session });
      else mode = "deleted";
    }
    await audited(session, {
      action: mode === "deleted" ? "ticketType.deleted" : "ticketType.deactivated",
      entity: { type: "ticketType", id: before._id },
      before: typeSnapshot(before as never),
      organizerId: event?.organizerId ?? undefined,
      metadata: { eventId: String(before.eventId) },
    });
  });
  return { mode };
}

// ─── Booking state (sold out / time / closed by hand) ──────────────────────────────────────────────────────

/** An event's state for `bookability()` in @indinite/core. */
export function eventBookingState(e: { sessions: { _id: unknown; startsAt: Date; endsAt: Date }[]; bookingsClosed?: { closed?: boolean | null } | null; closedNights?: { sessionId: unknown }[] | null }): BookableEventState {
  return {
    sessions: e.sessions.map((s) => ({ id: String(s._id), startsAt: s.startsAt, endsAt: s.endsAt })),
    bookingsClosed: Boolean(e.bookingsClosed?.closed),
    closedSessionIds: (e.closedNights ?? []).map((n) => String(n.sessionId)),
  };
}

/**
 * Close or reopen bookings for the whole event (no `sessionId`) or one night. Stops online sales and new payment
 * links; box office can still issue passes. Callers check `event.manageSales` (owner or super admin) first.
 */
export async function setBookingsClosed(eventId: string, input: { sessionId?: string | null; closed: boolean; reason: string; by: string; organizerId?: string }) {
  const event = await loadEvent(eventId);
  if (input.organizerId && String(event.organizerId) !== input.organizerId) throw new EventAdminError("Event not found.", 404);
  const reason = input.reason.trim();
  if (input.closed && reason.length < 3) throw new EventAdminError("Add a reason (it's recorded in the audit log).");
  const night = input.sessionId ? event.sessions.find((s) => String(s._id) === input.sessionId) : null;
  if (input.sessionId && !night) throw new EventAdminError("That night isn't on this event.", 404);
  const at = new Date();
  await withTransaction(async (session) => {
    if (!night) {
      await Event.updateOne({ _id: event._id }, { $set: { bookingsClosed: input.closed ? { closed: true, reason, at, by: input.by } : { closed: false } } }, { session });
    } else if (input.closed) {
      await Event.updateOne({ _id: event._id, "closedNights.sessionId": { $ne: night._id } }, { $push: { closedNights: { sessionId: night._id, reason, at, by: input.by } } }, { session });
    } else {
      await Event.updateOne({ _id: event._id }, { $pull: { closedNights: { sessionId: night._id } } }, { session });
    }
    await audited(session, {
      action: input.closed ? "event.bookings_closed" : "event.bookings_reopened",
      entity: { type: "event", id: event._id },
      reason: reason || undefined,
      organizerId: event.organizerId,
      metadata: { night: night ? night.label : "whole event", sessionId: night ? String(night._id) : null },
    });
  });
}

// ─── Day passes: one one-night pass type per night, grouped ─────────────────────────────────────────────────

/** Create a day pass: one pass type per chosen night, each with its own price and quota. */
export async function createDayPass(eventId: string, raw: DayPassRaw) {
  const input = dayPassUpsertSchema.parse(raw);
  const event = await loadEvent(eventId);
  const nightBy = new Map(event.sessions.map((s) => [String(s._id), s]));
  for (const n of input.nights) if (!nightBy.has(n.sessionId)) throw new EventAdminError("Choose nights from this event.");
  const groupId = new Types.ObjectId();
  return withTransaction(async (session) => {
    const docs = input.nights
      .map((n) => ({ n, night: nightBy.get(n.sessionId)! }))
      .sort((a, b) => a.night.startsAt.getTime() - b.night.startsAt.getTime())
      .map(({ n, night }, i) => ({
        eventId: event._id,
        name: dayPassMemberName(input.name, night.startsAt),
        description: input.description,
        pricePence: n.pricePence,
        validSessionIds: [night._id],
        quota: n.quota,
        sold: 0,
        held: 0,
        maxPerOrder: input.maxPerOrder,
        salesStartAt: input.salesStartAt,
        salesEndAt: input.salesEndAt,
        sortOrder: input.sortOrder * 100 + i,
        active: n.active,
        dayPass: { groupId, name: input.name },
      }));
    const created = await TicketType.create(docs, { session, ordered: true });
    await audited(session, {
      action: "ticketType.day_pass_created",
      entity: { type: "ticketType", id: groupId },
      after: { name: input.name, nights: docs.map((d) => ({ name: d.name, pricePence: d.pricePence, quota: d.quota })) },
      organizerId: event.organizerId,
      metadata: { eventId: String(event._id), passTypes: created.map((c) => String(c._id)) },
    });
    return { groupId: String(groupId), passTypes: created.map((c) => c.toObject()) };
  });
}

/**
 * Update a day pass: name and shared settings for every night, and per night its price, quota (atomic, never below
 * sold + held) and whether it's on sale. Nights can be added; a night left out is deleted if unused, otherwise
 * switched off (bookings keep their passes).
 */
export async function updateDayPass(groupId: string, raw: DayPassRaw) {
  if (!Types.ObjectId.isValid(groupId)) throw new EventAdminError("Day pass not found.", 404);
  const input = dayPassUpsertSchema.parse(raw);
  const members = await TicketType.find({ "dayPass.groupId": new Types.ObjectId(groupId) }).lean();
  if (!members.length) throw new EventAdminError("Day pass not found.", 404);
  const event = await loadEvent(String(members[0]!.eventId));
  const nightBy = new Map(event.sessions.map((s) => [String(s._id), s]));
  for (const n of input.nights) if (!nightBy.has(n.sessionId)) throw new EventAdminError("Choose nights from this event.");
  const memberByNight = new Map(members.map((m) => [String(m.validSessionIds[0]), m]));
  const wanted = new Set(input.nights.map((n) => n.sessionId));

  try {
    await withTransaction(async (session) => {
      const ordered = [...input.nights].sort((a, b) => nightBy.get(a.sessionId)!.startsAt.getTime() - nightBy.get(b.sessionId)!.startsAt.getTime());
      for (const [i, n] of ordered.entries()) {
        const night = nightBy.get(n.sessionId)!;
        const shared = {
          name: dayPassMemberName(input.name, night.startsAt),
          description: input.description,
          pricePence: n.pricePence,
          maxPerOrder: input.maxPerOrder,
          sortOrder: input.sortOrder * 100 + i,
          active: n.active,
          dayPass: { groupId: new Types.ObjectId(groupId), name: input.name },
        };
        const existing = memberByNight.get(n.sessionId);
        if (existing) {
          const set = { ...shared, ...(input.salesStartAt ? { salesStartAt: input.salesStartAt } : {}), ...(input.salesEndAt ? { salesEndAt: input.salesEndAt } : {}) };
          const unset = { ...(input.salesStartAt ? {} : { salesStartAt: 1 }), ...(input.salesEndAt ? {} : { salesEndAt: 1 }) };
          await TicketType.updateOne({ _id: existing._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
          if (n.quota !== existing.quota) await quota.set(existing._id, n.quota, session);
        } else {
          await TicketType.create([{ ...shared, eventId: event._id, validSessionIds: [night._id], quota: n.quota, sold: 0, held: 0, salesStartAt: input.salesStartAt, salesEndAt: input.salesEndAt }], { session });
        }
      }
      // Nights no longer wanted: delete if never used, otherwise switch off.
      for (const m of members) {
        if (wanted.has(String(m.validSessionIds[0]))) continue;
        const used = (await Ticket.exists({ ticketTypeId: m._id }).session(session)) || (await Order.exists({ "items.ticketTypeId": m._id }).session(session));
        const res = used ? { deletedCount: 0 } : await TicketType.deleteOne({ _id: m._id, sold: 0, held: 0 }, { session });
        if (res.deletedCount !== 1) await TicketType.updateOne({ _id: m._id }, { $set: { active: false } }, { session });
      }
      await audited(session, {
        action: "ticketType.day_pass_updated",
        entity: { type: "ticketType", id: groupId },
        before: { name: members[0]!.dayPass?.name, nights: members.map((m) => ({ night: String(m.validSessionIds[0]), pricePence: m.pricePence, quota: m.quota, active: m.active })) },
        after: { name: input.name, nights: input.nights.map((n) => ({ night: n.sessionId, pricePence: n.pricePence, quota: n.quota, active: n.active })) },
        organizerId: event.organizerId,
        metadata: { eventId: String(event._id) },
      });
    });
  } catch (e) {
    if (e instanceof QuotaTooLowError) {
      const m = members.find((x) => String(x._id) === e.ticketTypeId);
      const now = m ? await TicketType.findById(m._id, { sold: 1, held: 1, name: 1 }).lean() : null;
      throw new EventAdminError(`${now?.name ?? "That night"}: the quota can't be lower than ${(now?.sold ?? 0) + (now?.held ?? 0)} (passes already sold or being paid for).`, 409);
    }
    throw e;
  }
}

/** Delete a day pass: each night is deleted if never used, otherwise switched off. */
export async function deleteDayPass(groupId: string) {
  if (!Types.ObjectId.isValid(groupId)) throw new EventAdminError("Day pass not found.", 404);
  const members = await TicketType.find({ "dayPass.groupId": new Types.ObjectId(groupId) }, { _id: 1 }).lean();
  if (!members.length) throw new EventAdminError("Day pass not found.", 404);
  const results = [];
  for (const m of members) results.push(await deleteTicketType(String(m._id)));
  return { deleted: results.filter((r) => r.mode === "deleted").length, deactivated: results.filter((r) => r.mode === "deactivated").length };
}
