/**
 * Development seed: two demo organisers, each with a published Navratri event, ticket types, a discount code
 * and generated images (written to MEDIA_DIR). London is on sale now; Leicester opens Sun 4 Oct 2026 at 10:00.
 * Auth users (super admin, organizer owner) are added once Better Auth is wired up.
 *
 *   pnpm --filter @indinite/db seed            # refuses if demo data already exists
 *   pnpm --filter @indinite/db seed -- --reset # deletes the demo organisers' data first
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose, { type ClientSession, type Types } from "mongoose";
import { dayPassMemberName } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import {
  audited,
  connectDb,
  disconnectDb,
  Discount,
  Event,
  Hold,
  Job,
  mediaDir,
  mediaUrl,
  Order,
  Organizer,
  Ticket,
  TicketType,
  withTransaction,
} from "../src";
import { PALETTES, coverArt, dandiyaArt, diyaArt, mandalaArt, type Palette } from "./seed-media";

if (process.env.NODE_ENV === "production" && process.env.DEPLOY_ENV !== "staging") {
  throw new Error("The demo seed is for development and staging (DEPLOY_ENV=staging) only");
}

const reset = process.argv.includes("--reset");

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
    venue: { name: string; address: string; postcode: string; mapUrl?: string };
    sessions: ReturnType<typeof night>[];
  };
  ticketTypes: SeedTicketType[];
  /** One pass per night (day pass group); `price(weekend)` in pence. */
  dayPass?: { name: string; description: string; maxPerOrder: number; quota: number; price: (weekend: boolean) => number };
  /** Unset = on sale now. Applied to every ticket type. */
  salesStartAt?: Date;
  palette: Palette;
  images: { file: string; alt: string; art: (p: Palette, seed: number) => string }[];
  discount: { code: string; kind: "percent" | "fixed"; value: number; maxUses: number };
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
    dayPass: { name: "Day pass — adult", description: "Entry for the night you choose.", maxPerOrder: 6, quota: 150, price: (weekend: boolean) => (weekend ? 1500 : 1000) },
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

async function seedOne(session: ClientSession, d: SeedOrganizer, media: Awaited<ReturnType<typeof writeImages>>) {
  const [organizer] = await Organizer.create(
    [{ ...d.organizer, authOrgId: `seed-org-${d.organizer.slug}` }],
    { session },
  );
  const orgId = organizer!._id;
  const audit = (action: string, type: "organizer" | "event" | "ticketType" | "discount", id: Types.ObjectId, after: Record<string, unknown>) =>
    audited(session, { action, entity: { type, id }, after, organizerId: orgId, reason: "dev seed" });

  await audit("organizer.created", "organizer", orgId, organizer!.toObject());

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
      event!.sessions.map((s, i) => {
        const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(s.startsAt);
        return {
          eventId: event!._id,
          name: dayPassMemberName(dp.name, s.startsAt),
          description: dp.description,
          pricePence: dp.price(weekday === "Fri" || weekday === "Sat"),
          quota: dp.quota,
          maxPerOrder: dp.maxPerOrder,
          validSessionIds: [s._id],
          salesStartAt: d.salesStartAt,
          sortOrder: 100 + i,
          dayPass: { groupId, name: dp.name },
        };
      }),
      { session, ordered: true },
    );
    for (const t of members) await audit("ticketType.created", "ticketType", t._id, t.toObject());
  }

  const [discount] = await Discount.create(
    [{ ...d.discount, organizerId: orgId, eventId: event!._id, createdBy: "seed" }],
    { session },
  );
  await audit("discount.created", "discount", discount!._id, discount!.toObject());

  return { organizer: organizer!.slug, event: event!.slug, ticketTypes: types.length, discount: discount!.code, images: media.length };
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

await runWithContext({ actor: systemActor, requestId: "seed" }, () =>
  withTransaction(async (session) => {
    const slugs = DATA.map((d) => d.organizer.slug);
    const existing = await Organizer.find({ slug: { $in: slugs } }, { _id: 1 }, { session }).lean();
    if (existing.length) {
      if (!reset) throw new Error(`Demo data already exists (${slugs.join(", ")}). Rerun with --reset to replace it.`);
      await deleteDemoData(session, existing.map((o) => o._id));
      console.log(`Removed existing demo data for ${existing.length} organiser(s)`);
    }
    for (const d of DATA) {
      const r = await seedOne(session, d, mediaByEvent.get(d.event.slug)!);
      const sales = d.salesStartAt ? `bookings open ${d.salesStartAt.toISOString()}` : "bookings open now";
      console.log(`Seeded ${r.organizer}: event ${r.event} (published, ${sales}), ${r.ticketTypes} ticket types, ${r.images} images, discount ${r.discount}`);
    }
  }),
);

await disconnectDb();
