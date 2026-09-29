/**
 * Development seed: two demo organisers, each with a published Navratri event, ticket types, a discount code
 * and generated images (written to MEDIA_DIR). London is on sale now; Leicester opens Sun 4 Oct 2026 at 10:00.
 * Auth users (super admin, organizer owner) are added once Better Auth is wired up.
 *
 *   pnpm --filter @indinite/db seed             # refuses if demo data already exists
 *   pnpm --filter @indinite/db seed -- --update # adds what's missing and updates what's there, keeping orders and passes
 *   pnpm --filter @indinite/db seed -- --reset  # deletes the demo organisers' data first
 *
 * --update goes through the same audited services as the admin screens, so quotas never drop below passes
 * already sold or held, and a night with passes can't be removed. Pass types and discounts that aren't in this
 * file are left alone.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose, { type ClientSession, type Types } from "mongoose";
import { dayPassMemberName } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import {
  audited,
  connectDb,
  createDayPass,
  createTicketType,
  disconnectDb,
  Discount,
  Event,
  Hold,
  Job,
  mediaDir,
  mediaUrl,
  Order,
  Organizer,
  setEventCharges,
  setEventPricing,
  setEventStatus,
  setOrganizerCommission,
  Ticket,
  TicketType,
  updateDayPass,
  updateEvent,
  updateOrganizer,
  updateTicketType,
  withTransaction,
} from "../src";
import { PALETTES, coverArt, dandiyaArt, diyaArt, mandalaArt, type Palette } from "./seed-media";

// if (process.env.NODE_ENV === "production" && process.env.DEPLOY_ENV !== "staging") {
//   throw new Error("The demo seed is for development and staging (DEPLOY_ENV=staging) only");
// }

const reset = process.argv.includes("--reset");
const update = process.argv.includes("--update");
if (reset && update) throw new Error("Use --reset or --update, not both");

/** Nights run 19:30–23:30 London time (BST, UTC+1). `day` is the October 2026 date. */
const night = (label: string, day: number) => ({
  label,
  startsAt: new Date(Date.UTC(2026, 9, day, 18, 30)),
  endsAt: new Date(Date.UTC(2026, 9, day, 22, 30)),
});

interface SeedTicketType {
  name: string;
  description?: string;
  pricePence: number;
  quota: number;
  maxPerOrder?: number;
  /** Indexes into the event's sessions. */
  nights: number[];
}

interface SeedOrganizer {
  organizer: { name: string; slug: string; contactEmail: string; commissionBps: number; orderPrefix: string };
  /** SPEC §4.7: organiser charges (per ticket) and tax set on the event. */
  pricing?: { taxBps: number; charges: { name: string; kind: "fixed" | "percent"; value: number }[] };
  event: {
    slug: string;
    title: string;
    description: string;
    venue: { name: string; address: string; postcode: string; mapUrl?: string; lat?: number; lng?: number };
    sessions: ReturnType<typeof night>[];
  };
  ticketTypes: SeedTicketType[];
  /** One pass per night (day pass group); `price(nightIndex, weekday)` in pence, weekday "Mon"…"Sun". */
  dayPass?: { name: string; description: string; maxPerOrder: number; quota: number; price: (night: number, weekday: string) => number };
  /** Unset = on sale now. Applied to every ticket type. */
  salesStartAt?: Date;
  palette: Palette;
  images: { file: string; alt: string; art: (p: Palette, seed: number) => string }[];
  discount?: { code: string; kind: "percent" | "fixed"; value: number; maxUses: number };
}

const all = (n: number) => Array.from({ length: n }, (_, i) => i);

// Navratri 2026: nine nights from Sun 11 Oct.
const nineNights = Array.from({ length: 9 }, (_, i) => night(`Night ${i + 1}`, 11 + i));

const DATA: SeedOrganizer[] = [
  {
    organizer: {
      name: "Demo Garba Ltd",
      slug: "demo-garba",
      contactEmail: "owner@demo-garba.example",
      commissionBps: 600,
      orderPrefix: "NAV",
    },
    event: {
      slug: "navratri-2026-london",
      title: "Navratri 2026 — London Garba Nights",
      description:
        "Nine nights of garba and dandiya with a live band, food stalls and a family-friendly atmosphere. Traditional dress encouraged.",
      venue: { name: "Demo Exhibition Hall", address: "1 Example Road, London", postcode: "E1 1AA" },
      sessions: nineNights,
    },
    ticketTypes: [
      { name: "Season pass — adult", description: "Entry to all nine nights.", pricePence: 4500, quota: 500, nights: all(9) },
      { name: "Season pass — child (5–12)", description: "Entry to all nine nights. Under 5s go free.", pricePence: 2000, quota: 200, nights: all(9) },
      { name: "Weekend pass — adult", description: "Fri 16 and Sat 17 October.", pricePence: 1800, quota: 300, nights: [5, 6] },
    ],
    // One pass per night, each with its own price and quota; customers pick any nights (30 Sep 2026).
    dayPass: { name: "Day pass — adult", description: "Entry for the night you choose.", maxPerOrder: 6, quota: 150, price: (_n: number, weekday: string) => (weekday === "Fri" || weekday === "Sat" ? 1500 : 1000) },
    pricing: { taxBps: 2000, charges: [{ name: "Venue fee", kind: "fixed", value: 30 }] },
    palette: PALETTES.saffron,
    images: [
      { file: "cover.svg", alt: "Illustration of garba dancers beneath a glowing mandala", art: coverArt },
      { file: "diyas.svg", alt: "Illustration of lit diya lamps", art: diyaArt },
      { file: "mandala.svg", alt: "Illustration of an orange and yellow mandala", art: mandalaArt },
    ],
    discount: { code: "GARBA10", kind: "percent", value: 1000, maxUses: 100 },
  },
  {
    organizer: {
      name: "Sample Dandiya Events",
      slug: "sample-dandiya",
      contactEmail: "owner@sample-dandiya.example",
      commissionBps: 600,
      orderPrefix: "DAN",
    },
    event: {
      slug: "navratri-2026-leicester",
      title: "Navratri 2026 — Leicester Dandiya Weekend",
      description: "Three nights of dandiya raas over the final weekend of Navratri.",
      venue: { name: "Sample Community Centre", address: "2 Sample Street, Leicester", postcode: "LE1 1AA" },
      sessions: [night("Friday", 16), night("Saturday", 17), night("Sunday", 18)],
    },
    ticketTypes: [
      { name: "All three nights", description: "Fri, Sat and Sun.", pricePence: 3000, quota: 400, nights: all(3) },
    ],
    dayPass: { name: "Day pass", description: "Entry for the night you choose.", maxPerOrder: 8, quota: 150, price: () => 1200 },
    // Sun 4 Oct 2026, 10:00 London time (BST, UTC+1).
    salesStartAt: new Date(Date.UTC(2026, 9, 4, 9, 0)),
    palette: PALETTES.twilight,
    images: [
      { file: "cover.svg", alt: "Illustration of dandiya dancers beneath a glowing mandala", art: coverArt },
      { file: "dandiya.svg", alt: "Illustration of crossed, decorated dandiya sticks", art: dandiyaArt },
      { file: "diyas.svg", alt: "Illustration of lit diya lamps", art: diyaArt },
    ],
    discount: { code: "EARLY5", kind: "fixed", value: 500, maxUses: 50 },
  },
  {
    // OMB Events (30 Sep 2026): ten nights, day passes only, 500 per night, 10% platform fee, on sale now.
    organizer: {
      name: "OMB Events",
      slug: "omb-events",
      contactEmail: "hello@omb-events.example",
      commissionBps: 1000,
      orderPrefix: "OMB",
    },
    event: {
      slug: "omb-navratri-2k26",
      title: "OMB Navratri 2k26",
      description: "Ten nights of garba and dandiya in London. Book the nights you want: each day pass is for one night.",
      // Venue details to be confirmed; coordinates are central London for now.
      venue: { name: "OMB Navratri 2k26", address: "London", postcode: "London", lat: 51.5072, lng: -0.1276 },
      sessions: Array.from({ length: 10 }, (_, i) => night(`Day ${i + 1}`, 9 + i)),
    },
    ticketTypes: [],
    dayPass: {
      name: "Day pass",
      description: "Entry for the night you choose.",
      maxPerOrder: 10,
      quota: 500,
      // Day 1–3 (9–11 Oct) £25, Day 4–7 (12–15 Oct) £20, Day 8–10 (16–18 Oct) £30.
      price: (n: number) => (n <= 2 ? 2500 : n <= 6 ? 2000 : 3000),
    },
    palette: PALETTES.saffron,
    images: [
      { file: "cover.svg", alt: "Illustration of garba dancers beneath a glowing mandala", art: coverArt },
      { file: "diyas.svg", alt: "Illustration of lit diya lamps", art: diyaArt },
      { file: "mandala.svg", alt: "Illustration of an orange and yellow mandala", art: mandalaArt },
    ],
  },
];

/** Write the event's generated images to MEDIA_DIR/events/<slug>/ and return its media entries. */
async function writeImages(d: SeedOrganizer) {
  const rel = path.join("events", d.event.slug);
  await mkdir(path.join(mediaDir(), rel), { recursive: true });
  return Promise.all(
    d.images.map(async (img, i) => {
      await writeFile(path.join(mediaDir(), rel, img.file), img.art(d.palette, i + 1));
      return { type: "image" as const, url: mediaUrl(path.join(rel, img.file)), alt: img.alt, order: i };
    }),
  );
}

type Media = Awaited<ReturnType<typeof writeImages>>;

const weekdayOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(d);

async function seedOne(session: ClientSession, d: SeedOrganizer, media: Media) {
  const [organizer] = await Organizer.create(
    [{ ...d.organizer, authOrgId: `seed-org-${d.organizer.slug}` }],
    { session },
  );
  await audited(session, { action: "organizer.created", entity: { type: "organizer", id: organizer!._id }, after: organizer!.toObject(), organizerId: organizer!._id, reason: "dev seed" });
  return seedEvent(session, d, organizer!._id, media);
}

/** The event, its pass types, day pass and discount, for an organiser that already exists. */
async function seedEvent(session: ClientSession, d: SeedOrganizer, orgId: Types.ObjectId, media: Media) {
  const audit = (action: string, type: "event" | "ticketType" | "discount", id: Types.ObjectId, after: Record<string, unknown>) =>
    audited(session, { action, entity: { type, id }, after, organizerId: orgId, reason: "dev seed" });

  const [event] = await Event.create([{ ...d.event, ...(d.pricing ?? {}), media, organizerId: orgId, status: "published" }], { session });
  await audit("event.created", "event", event!._id, event!.toObject());

  const sessionIds = event!.sessions.map((s) => s._id);
  const types = await TicketType.create(
    d.ticketTypes.map((t, i) => ({
      eventId: event!._id,
      name: t.name,
      description: t.description ?? "",
      pricePence: t.pricePence,
      quota: t.quota,
      maxPerOrder: t.maxPerOrder ?? 10,
      validSessionIds: t.nights.map((n) => sessionIds[n]!),
      salesStartAt: d.salesStartAt,
      sortOrder: i + 1,
    })),
    { session, ordered: true },
  );
  for (const t of types) await audit("ticketType.created", "ticketType", t._id, t.toObject());

  if (d.dayPass) {
    const groupId = new mongoose.Types.ObjectId();
    const dp = d.dayPass;
    const members = await TicketType.create(
      event!.sessions.map((s, i) => ({
        eventId: event!._id,
        name: dayPassMemberName(dp.name, s.startsAt),
        description: dp.description,
        pricePence: dp.price(i, weekdayOf(s.startsAt)),
        quota: dp.quota,
        maxPerOrder: dp.maxPerOrder,
        validSessionIds: [s._id],
        salesStartAt: d.salesStartAt,
        sortOrder: 100 + i,
        dayPass: { groupId, name: dp.name },
      })),
      { session, ordered: true },
    );
    for (const t of members) await audit("ticketType.created", "ticketType", t._id, t.toObject());
  }

  let discountCode: string | null = null;
  if (d.discount) {
    const [discount] = await Discount.create([{ ...d.discount, organizerId: orgId, eventId: event!._id, createdBy: "seed" }], { session });
    await audit("discount.created", "discount", discount!._id, discount!.toObject());
    discountCode = discount!.code ?? null;
  }

  return { organizer: d.organizer.slug, event: event!.slug, ticketTypes: await TicketType.countDocuments({ eventId: event!._id }).session(session), discount: discountCode, images: media.length };
}

/** Same value? (plain JSON comparison, enough for seed data) */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const time = (d: Date | null | undefined) => (d ? new Date(d).getTime() : null);

/**
 * --update: bring an existing demo organiser in line with this file without touching its orders or passes.
 * Returns the list of things that changed.
 */
async function updateOne(d: SeedOrganizer, media: Media): Promise<string[]> {
  const changes: string[] = [];
  const org = await Organizer.findOne({ slug: d.organizer.slug }).lean();
  if (!org) throw new Error(`${d.organizer.slug} not found`);
  const orgId = String(org._id);

  const details = { name: d.organizer.name, contactEmail: d.organizer.contactEmail, orderPrefix: d.organizer.orderPrefix };
  if (!same(details, { name: org.name, contactEmail: org.contactEmail, orderPrefix: org.orderPrefix })) {
    await updateOrganizer(orgId, { ...details, status: org.status ?? "active", maxDiscountBpsForManager: org.maxDiscountBpsForManager ?? 0 });
    changes.push("updated organiser details");
  }
  if (org.commissionBps !== d.organizer.commissionBps) {
    await setOrganizerCommission(orgId, d.organizer.commissionBps);
    changes.push(`set commission to ${d.organizer.commissionBps / 100}%`);
  }

  const existing = await Event.findOne({ slug: d.event.slug, organizerId: org._id, deletedAt: null }).lean();
  if (!existing) {
    await withTransaction((session) => seedEvent(session, d, org._id, media));
    return [...changes, "created the event"];
  }
  const eventId = String(existing._id);

  // Nights are matched by position, so passes already issued keep pointing at the same night.
  const sessions = d.event.sessions.map((s, i) => ({ ...(existing.sessions[i] ? { id: String(existing.sessions[i]._id) } : {}), label: s.label, startsAt: s.startsAt, endsAt: s.endsAt }));
  const venue = { ...d.event.venue, postcode: d.event.venue.postcode.toUpperCase() };
  const eventNow = { title: existing.title, description: existing.description ?? "", venue: { name: existing.venue.name, address: existing.venue.address, postcode: existing.venue.postcode, mapUrl: existing.venue.mapUrl ?? undefined, lat: existing.venue.lat ?? undefined, lng: existing.venue.lng ?? undefined }, sessions: existing.sessions.map((s) => ({ label: s.label, startsAt: time(s.startsAt), endsAt: time(s.endsAt) })) };
  const eventWanted = { title: d.event.title, description: d.event.description, venue: { name: venue.name, address: venue.address, postcode: venue.postcode, mapUrl: venue.mapUrl, lat: venue.lat, lng: venue.lng }, sessions: sessions.map((s) => ({ label: s.label, startsAt: time(s.startsAt), endsAt: time(s.endsAt) })) };
  if (!same(eventNow, eventWanted)) {
    await updateEvent(eventId, { title: d.event.title, slug: d.event.slug, description: d.event.description, venue: d.event.venue, sessions });
    changes.push("updated event details and nights");
  }
  const taxBps = d.pricing?.taxBps ?? 0;
  if ((existing.taxBps ?? 0) !== taxBps || existing.commissionBps != null) {
    await setEventPricing(eventId, { commissionBps: null, taxBps });
    changes.push("updated event tax");
  }
  const charges = d.pricing?.charges ?? [];
  if (!same((existing.charges ?? []).map((c) => ({ name: c.name, kind: c.kind, value: c.value })), charges)) {
    await setEventCharges(orgId, eventId, charges);
    changes.push("updated event charges");
  }
  const mediaNow = (existing.media ?? []).map((m) => ({ type: m.type, url: m.url, alt: m.alt, order: m.order }));
  if (!same(mediaNow, media)) {
    await withTransaction(async (session) => {
      await Event.updateOne({ _id: existing._id }, { $set: { media } }, { session });
      await audited(session, { action: "event.media_updated", entity: { type: "event", id: existing._id }, before: { media: mediaNow }, after: { media }, organizerId: org._id, reason: "dev seed" });
    });
    changes.push("updated images");
  }
  if (existing.status !== "published") {
    await setEventStatus(eventId, "published");
    changes.push("published the event");
  }

  // Pass types: matched by name. Ones not in this file are left as they are.
  const event = (await Event.findById(existing._id).lean())!;
  const types = await TicketType.find({ eventId: existing._id }).lean();
  for (const [i, t] of d.ticketTypes.entries()) {
    const input = {
      name: t.name,
      description: t.description ?? "",
      pricePence: t.pricePence,
      quota: t.quota,
      maxPerOrder: t.maxPerOrder ?? 10,
      validSessionIds: t.nights.map((n) => String(event.sessions[n]!._id)),
      salesStartAt: d.salesStartAt,
      sortOrder: i + 1,
      active: true,
    };
    const found = types.find((x) => !x.dayPass?.groupId && x.name === t.name);
    if (!found) {
      await createTicketType({ ...input, eventId });
      changes.push(`added ${t.name}`);
      continue;
    }
    const now = { name: found.name, description: found.description ?? "", pricePence: found.pricePence, quota: found.quota, maxPerOrder: found.maxPerOrder ?? 10, validSessionIds: found.validSessionIds.map(String), salesStartAt: time(found.salesStartAt), sortOrder: found.sortOrder ?? 0, active: found.active ?? true };
    if (!same(now, { ...input, salesStartAt: time(input.salesStartAt) }) || found.salesEndAt) {
      await updateTicketType(String(found._id), input);
      changes.push(`updated ${t.name}`);
    }
  }

  if (d.dayPass) {
    const dp = d.dayPass;
    const nights = event.sessions.map((s, i) => ({ sessionId: String(s._id), pricePence: dp.price(i, weekdayOf(s.startsAt)), quota: dp.quota, active: true }));
    const input = { name: dp.name, description: dp.description, maxPerOrder: dp.maxPerOrder, salesStartAt: d.salesStartAt, sortOrder: 1, nights };
    const members = types.filter((x) => x.dayPass?.groupId && x.dayPass.name === dp.name);
    if (!members.length) {
      await createDayPass(eventId, input);
      changes.push(`added ${dp.name}`);
    } else {
      const byNight = new Map(members.map((m) => [String(m.validSessionIds[0]), m]));
      const now = members.map((m) => ({ night: String(m.validSessionIds[0]), name: m.name, description: m.description ?? "", pricePence: m.pricePence, quota: m.quota, maxPerOrder: m.maxPerOrder, active: m.active ?? true, salesStartAt: time(m.salesStartAt), salesEndAt: time(m.salesEndAt) }));
      const wanted = event.sessions.map((s, i) => {
        const m = byNight.get(String(s._id));
        return m && { night: String(s._id), name: dayPassMemberName(dp.name, s.startsAt), description: dp.description, pricePence: nights[i]!.pricePence, quota: dp.quota, maxPerOrder: dp.maxPerOrder, active: true, salesStartAt: time(d.salesStartAt), salesEndAt: null };
      });
      if (members.length !== event.sessions.length || !same(now.sort((a, b) => a.night.localeCompare(b.night)), wanted.filter(Boolean).sort((a, b) => a!.night.localeCompare(b!.night)))) {
        await updateDayPass(String(members[0]!.dayPass!.groupId), input);
        changes.push(`updated ${dp.name} (${nights.length} nights)`);
      }
    }
  }

  if (d.discount) {
    const found = await Discount.findOne({ organizerId: org._id, code: d.discount.code }).lean();
    const wanted = { ...d.discount, eventId: existing._id };
    await withTransaction(async (session) => {
      if (!found) {
        const [discount] = await Discount.create([{ ...wanted, organizerId: org._id, createdBy: "seed" }], { session });
        await audited(session, { action: "discount.created", entity: { type: "discount", id: discount!._id }, after: discount!.toObject(), organizerId: org._id, reason: "dev seed" });
        changes.push(`added discount ${d.discount!.code}`);
        return;
      }
      const before = { kind: found.kind, value: found.value, maxUses: found.maxUses, eventId: String(found.eventId) };
      const after = { kind: wanted.kind, value: wanted.value, maxUses: wanted.maxUses, eventId: String(wanted.eventId) };
      if (same(before, after)) return;
      await Discount.updateOne({ _id: found._id }, { $set: { kind: wanted.kind, value: wanted.value, maxUses: wanted.maxUses, eventId: wanted.eventId } }, { session, runValidators: true });
      await audited(session, { action: "discount.updated", entity: { type: "discount", id: found._id }, before, after, organizerId: org._id, reason: "dev seed" });
      changes.push(`updated discount ${d.discount!.code}`);
    });
  }
  return changes;
}

/** Delete everything belonging to the demo organisers. Audit logs are append-only and stay. */
async function deleteDemoData(session: ClientSession, orgIds: Types.ObjectId[]) {
  const eventIds = (await Event.find({ organizerId: { $in: orgIds } }, { _id: 1 }, { session }).lean()).map((e) => e._id);
  const orderIds = (await Order.find({ organizerId: { $in: orgIds } }, { _id: 1 }, { session }).lean()).map((o) => o._id);
  await Ticket.deleteMany({ organizerId: { $in: orgIds } }, { session });
  await Hold.deleteMany({ orderId: { $in: orderIds } }, { session });
  await Job.deleteMany({ "data.orderId": { $in: orderIds.map(String) } }, { session });
  await Order.deleteMany({ _id: { $in: orderIds } }, { session });
  await Discount.deleteMany({ organizerId: { $in: orgIds } }, { session });
  await TicketType.deleteMany({ eventId: { $in: eventIds } }, { session });
  await Event.deleteMany({ _id: { $in: eventIds } }, { session });
  await Organizer.deleteMany({ _id: { $in: orgIds } }, { session });
}

await connectDb();

// Files first: they're idempotent, and a failed transaction below leaves nothing pointing at them.
const mediaByEvent = new Map<string, Awaited<ReturnType<typeof writeImages>>>();
for (const d of DATA) mediaByEvent.set(d.event.slug, await writeImages(d));
console.log(`Wrote images to ${mediaDir()}`);

const describe = (d: SeedOrganizer, r: { organizer: string; event: string; ticketTypes: number; images: number; discount: string | null }) => {
  const sales = d.salesStartAt ? `bookings open ${d.salesStartAt.toISOString()}` : "bookings open now";
  return `Seeded ${r.organizer}: event ${r.event} (published, ${sales}), ${r.ticketTypes} pass types, ${r.images} images${r.discount ? `, discount ${r.discount}` : ""}`;
};

if (update) {
  // One organiser at a time; each step is its own audited transaction (the services' own).
  let failed = 0;
  await runWithContext({ actor: systemActor, requestId: "seed:update" }, async () => {
    for (const d of DATA) {
      const media = mediaByEvent.get(d.event.slug)!;
      try {
        if (!(await Organizer.exists({ slug: d.organizer.slug }))) {
          console.log(describe(d, await withTransaction((session) => seedOne(session, d, media))));
          continue;
        }
        const changes = await updateOne(d, media);
        console.log(`${d.organizer.slug}: ${changes.length ? changes.join(", ") : "already up to date"}`);
      } catch (e) {
        failed++;
        console.error(`${d.organizer.slug}: couldn't update. ${e instanceof Error ? e.message : e}`);
      }
    }
  });
  if (failed) process.exitCode = 1;
} else {
  await runWithContext({ actor: systemActor, requestId: "seed" }, () =>
    withTransaction(async (session) => {
      const slugs = DATA.map((d) => d.organizer.slug);
      const existing = await Organizer.find({ slug: { $in: slugs } }, { _id: 1 }, { session }).lean();
      if (existing.length) {
        if (!reset) throw new Error(`Demo data already exists (${slugs.join(", ")}). Rerun with --update to add and update it, or --reset to replace it.`);
        await deleteDemoData(session, existing.map((o) => o._id));
        console.log(`Removed existing demo data for ${existing.length} organiser(s)`);
      }
      for (const d of DATA) console.log(describe(d, await seedOne(session, d, mediaByEvent.get(d.event.slug)!)));
    }),
  );
}

await disconnectDb();
