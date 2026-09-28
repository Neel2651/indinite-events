/** Real-MongoDB tests for super admin event management (SPEC §1, M2). */
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair } from "@indinite/core";
import { runWithContext } from "@indinite/core/context";
import {
  addEventImage,
  addEventVideo,
  AuditLog,
  createEvent,
  createTicketType,
  deleteEvent,
  deleteTicketType,
  Event,
  EventAdminError,
  issueOfflineOrder,
  Organizer,
  quota,
  removeEventMedia,
  reorderEventMedia,
  setEventStatus,
  sniffImageType,
  TicketType,
  updateEvent,
  updateTicketType,
} from "../src";

let replSet: MongoMemoryReplSet;
let orgId: string;
let mediaRoot: string;

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  mediaRoot = await mkdtemp(path.join(tmpdir(), "indinite-media-"));
  process.env.MEDIA_DIR = mediaRoot;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const org = await Organizer.create({ name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1", commissionBps: 600 });
  orgId = String(org._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const asAdmin = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id: "admin-1", role: "super_admin" } }, fn);
const day = (d: number, h: number) => new Date(Date.UTC(2026, 9, d, h));
const venue = { name: "Hall", address: "1 Road, London", postcode: "e1 1aa" };
const nights = [
  { label: "Night 1", startsAt: day(11, 18), endsAt: day(11, 22) },
  { label: "Night 2", startsAt: day(12, 18), endsAt: day(12, 22) },
];
let slugN = 0;
const newEvent = () => asAdmin(() => createEvent({ organizerId: orgId, title: "Garba Nights", slug: `garba-${++slugN}`, description: "", venue, sessions: nights, status: "draft" }));
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("events", () => {
  it("creates a draft event with nights, audited, with the span taken from the nights", async () => {
    const e = await newEvent();
    expect(e).toMatchObject({ status: "draft", startsAt: day(11, 18), endsAt: day(12, 22), venue: { postcode: "E1 1AA" } });
    expect(e.sessions).toHaveLength(2);
    expect(await AuditLog.findOne({ action: "event.created", "entity.id": String(e._id) }).lean()).toMatchObject({ actor: { id: "admin-1" } });
  });

  it("refuses a duplicate web address", async () => {
    const e = await newEvent();
    await expect(asAdmin(() => createEvent({ organizerId: orgId, title: "Copy", slug: e.slug, description: "", venue, sessions: nights, status: "draft" }))).rejects.toThrow(/already uses that web address/);
  });

  it("keeps night ids on edit, adds nights, and won't remove a night a pass type uses", async () => {
    const e = await newEvent();
    const [n1, n2] = e.sessions.map((s) => String(s._id));
    await asAdmin(() => createTicketType({ eventId: String(e._id), name: "Night 2 pass", description: "", pricePence: 1000, validSessionIds: [n2!], quota: 10, maxPerOrder: 5, sortOrder: 0, active: true }));

    await asAdmin(() =>
      updateEvent(String(e._id), { title: "Garba Nights 2026", slug: e.slug, description: "Live band", venue, sessions: [{ id: n1, ...nights[0]! }, { id: n2, ...nights[1]! }, { label: "Night 3", startsAt: day(13, 18), endsAt: day(13, 23) }] }),
    );
    const after = (await Event.findById(e._id).lean())!;
    expect(after.sessions.map((s) => String(s._id)).slice(0, 2)).toEqual([n1, n2]);
    expect(after).toMatchObject({ title: "Garba Nights 2026", endsAt: day(13, 23) });

    await expect(asAdmin(() => updateEvent(String(e._id), { title: after.title, slug: e.slug, description: "", venue, sessions: [{ id: n1, ...nights[0]! }] }))).rejects.toThrow(/“Night 2 pass” is valid for/);
    // Removing an unused night is fine.
    await asAdmin(() => updateEvent(String(e._id), { title: after.title, slug: e.slug, description: "", venue, sessions: [{ id: n2, ...nights[1]! }] }));
    expect((await Event.findById(e._id).lean())!.sessions.map((s) => String(s._id))).toEqual([n2]);
  });

  it("only publishes with an active pass type", async () => {
    const e = await newEvent();
    await expect(asAdmin(() => setEventStatus(String(e._id), "published"))).rejects.toThrow(/at least one pass type/);
    await asAdmin(() => createTicketType({ eventId: String(e._id), name: "Season", description: "", pricePence: 4500, validSessionIds: e.sessions.map((s) => String(s._id)), quota: 10, maxPerOrder: 5, sortOrder: 0, active: true }));
    await asAdmin(() => setEventStatus(String(e._id), "published"));
    expect((await Event.findById(e._id).lean())!.status).toBe("published");
  });

  it("hard-deletes an event with no orders, soft-deletes one with orders", async () => {
    const empty = await newEvent();
    await asAdmin(() => createTicketType({ eventId: String(empty._id), name: "Season", description: "", pricePence: 4500, validSessionIds: [String(empty.sessions[0]!._id)], quota: 10, maxPerOrder: 5, sortOrder: 0, active: true }));
    expect(await asAdmin(() => deleteEvent(String(empty._id), "Created by mistake"))).toEqual({ mode: "deleted" });
    expect(await Event.exists({ _id: empty._id })).toBeNull();
    expect(await TicketType.countDocuments({ eventId: empty._id })).toBe(0);

    const sold = await newEvent();
    const tt = await asAdmin(() => createTicketType({ eventId: String(sold._id), name: "Season", description: "", pricePence: 4500, validSessionIds: [String(sold.sessions[0]!._id)], quota: 10, maxPerOrder: 5, sortOrder: 0, active: true }));
    await asAdmin(() => setEventStatus(String(sold._id), "published"));
    await asAdmin(() => issueOfflineOrder(orgId, "admin-1", { eventId: String(sold._id), customer: { name: "A", email: "a@example.com" }, items: [{ ticketTypeId: String(tt._id), qty: 1 }], method: "cash", note: "Paid" }));
    expect(await asAdmin(() => deleteEvent(String(sold._id), "Event cancelled"))).toEqual({ mode: "archived" });
    expect(await Event.findById(sold._id).lean()).toMatchObject({ status: "archived", deletedAt: expect.any(Date) });
    expect(await AuditLog.findOne({ action: "event.soft_deleted", "entity.id": String(sold._id) }).lean()).toMatchObject({ reason: "Event cancelled" });
  });
});

describe("pass types", () => {
  it("never lets the quota go below sold + held, even while bookings run", async () => {
    const e = await newEvent();
    const tt = await asAdmin(() => createTicketType({ eventId: String(e._id), name: "Season", description: "", pricePence: 4500, validSessionIds: [String(e.sessions[0]!._id)], quota: 10, maxPerOrder: 10, sortOrder: 0, active: true }));
    await quota.reserve(tt._id, 4);
    await quota.sellDirect(tt._id, 3);
    const base = { name: "Season", description: "", pricePence: 5000, validSessionIds: [String(e.sessions[0]!._id)], maxPerOrder: 10, sortOrder: 0, active: true };
    await expect(asAdmin(() => updateTicketType(String(tt._id), { ...base, quota: 6 }))).rejects.toThrow(/lower than 7/);
    await asAdmin(() => updateTicketType(String(tt._id), { ...base, quota: 7 }));
    expect(await TicketType.findById(tt._id).lean()).toMatchObject({ quota: 7, pricePence: 5000, sold: 3, held: 4 });

    // Shrinking to exactly sold + held while more reservations race: never oversold.
    await asAdmin(() => updateTicketType(String(tt._id), { ...base, quota: 20 }));
    const results = await Promise.allSettled([
      ...Array.from({ length: 10 }, () => quota.reserve(tt._id, 1)),
      asAdmin(() => updateTicketType(String(tt._id), { ...base, quota: 12 })),
    ]);
    const t = (await TicketType.findById(tt._id).lean())!;
    expect(t.sold + t.held).toBeLessThanOrEqual(t.quota);
    expect(results.length).toBe(11);
  });

  it("checks nights belong to the event and sales windows make sense", async () => {
    const e = await newEvent();
    const other = await newEvent();
    await expect(asAdmin(() => createTicketType({ eventId: String(e._id), name: "X", description: "", pricePence: 100, validSessionIds: [String(other.sessions[0]!._id)], quota: 1, maxPerOrder: 1, sortOrder: 0, active: true }))).rejects.toBeInstanceOf(EventAdminError);
    await expect(
      asAdmin(() => createTicketType({ eventId: String(e._id), name: "X", description: "", pricePence: 100, validSessionIds: [String(e.sessions[0]!._id)], quota: 1, maxPerOrder: 1, sortOrder: 0, active: true, salesStartAt: day(5, 10), salesEndAt: day(4, 10) })),
    ).rejects.toThrow(/Sales must end after they start/);
  });

  it("deletes an unused pass type, switches off one that has been sold", async () => {
    const e = await newEvent();
    const mk = () => asAdmin(() => createTicketType({ eventId: String(e._id), name: "Season", description: "", pricePence: 4500, validSessionIds: [String(e.sessions[0]!._id)], quota: 10, maxPerOrder: 5, sortOrder: 0, active: true }));
    const unused = await mk();
    expect(await asAdmin(() => deleteTicketType(String(unused._id)))).toEqual({ mode: "deleted" });
    const used = await mk();
    await asAdmin(() => setEventStatus(String(e._id), "published"));
    await asAdmin(() => issueOfflineOrder(orgId, "admin-1", { eventId: String(e._id), customer: { name: "A", email: "a@example.com" }, items: [{ ticketTypeId: String(used._id), qty: 1 }], method: "cash", note: "Paid" }));
    expect(await asAdmin(() => deleteTicketType(String(used._id)))).toEqual({ mode: "deactivated" });
    expect(await TicketType.findById(used._id).lean()).toMatchObject({ active: false, sold: 1 });
  });
});

describe("media", () => {
  it("recognises images by their bytes, not their name", () => {
    expect(sniffImageType(PNG)).toBe(".png");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(".jpg");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("uploads an image into the event's folder, then removes it with its file", async () => {
    const e = await newEvent();
    const item = await asAdmin(() => addEventImage(String(e._id), { bytes: PNG, alt: "Dancers" }));
    expect(item.url).toMatch(new RegExp(`^/media/events/${e._id}/[A-Za-z0-9_-]+\\.png$`));
    expect(await readdir(path.join(mediaRoot, "events", String(e._id)))).toHaveLength(1);
    await expect(asAdmin(() => addEventImage(String(e._id), { bytes: new TextEncoder().encode("<svg/>"), alt: "x" }))).rejects.toThrow(/JPEG, PNG, WebP or AVIF/);
    await expect(asAdmin(() => addEventImage(String(e._id), { bytes: new Uint8Array(5 * 1024 * 1024 + 1), alt: "x" }))).rejects.toThrow(/up to 5 MB/);
    await expect(asAdmin(() => addEventImage(String(e._id), { bytes: PNG, alt: " " }))).rejects.toThrow(/alt text/);

    await asAdmin(() => removeEventMedia(String(e._id), item.url));
    expect(await readdir(path.join(mediaRoot, "events", String(e._id)))).toHaveLength(0);
    expect((await Event.findById(e._id).lean())!.media).toHaveLength(0);
  });

  it("accepts YouTube and Vimeo links only, and reorders media", async () => {
    const e = await newEvent();
    await expect(asAdmin(() => addEventVideo(String(e._id), "https://evil.example/video", "Promo"))).rejects.toThrow(/YouTube or Vimeo/);
    const img = await asAdmin(() => addEventImage(String(e._id), { bytes: PNG, alt: "Dancers" }));
    const vid = await asAdmin(() => addEventVideo(String(e._id), "https://youtu.be/dQw4w9WgXcQ", "Promo"));
    await asAdmin(() => reorderEventMedia(String(e._id), [vid.url, img.url]));
    const media = (await Event.findById(e._id).lean())!.media;
    expect(media.map((m) => [m.type, m.order])).toEqual([["video", 0], ["image", 1]]);
  });
});
