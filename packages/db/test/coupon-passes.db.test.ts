/** Real-MongoDB tests for coupons limited to certain passes (8 Oct 2026): a night's passes, the season pass, or a mix. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair } from "@indinite/core";
import { runWithContext, systemActor } from "@indinite/core/context";
import { CheckoutError, createCheckoutOrder, createCoupon, Discount, Event, findCoupon, fulfilOrder, Order, Organizer, quoteRefund, TicketType } from "../src";

let replSet: MongoMemoryReplSet;
let orgId: string;
let eventId: string;
let otherEventPass: string;
let night2: string;
let night3: string;
let season: string;

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const org = await Organizer.create({ name: "Org", slug: "org", contactEmail: "o@example.com", authOrgId: "a1", commissionBps: 1000, orderPrefix: "OME" });
  orgId = String(org._id);
  const day = (d: number) => new Date(Date.now() + d * 86_400_000);
  const event = await Event.create({
    organizerId: org._id,
    slug: "united-raas",
    title: "United Raas",
    venue: { name: "Hall", address: "1 Road", postcode: "HA1 1AA" },
    sessions: [
      { label: "Day 2", startsAt: day(2), endsAt: day(2.2) },
      { label: "Day 3", startsAt: day(3), endsAt: day(3.2) },
    ],
    status: "published",
  });
  eventId = String(event._id);
  const [s2, s3] = event.sessions.map((s) => s._id);
  const [a, b, c] = await TicketType.create(
    [
      { eventId: event._id, name: "Day pass · Day 2", pricePence: 2500, quota: 100, validSessionIds: [s2] },
      { eventId: event._id, name: "Day pass · Day 3", pricePence: 2500, quota: 100, validSessionIds: [s3] },
      { eventId: event._id, name: "Season pass", pricePence: 4000, quota: 100, validSessionIds: [s2, s3] },
    ],
    { ordered: true },
  );
  night2 = String(a!._id);
  night3 = String(b!._id);
  season = String(c!._id);
  const other = await Event.create({ organizerId: org._id, slug: "other", title: "Other", venue: { name: "H", address: "R", postcode: "E1 1AA" }, sessions: [{ label: "N", startsAt: day(5), endsAt: day(5.2) }], status: "published" });
  otherEventPass = String((await TicketType.create({ eventId: other._id, name: "Other pass", pricePence: 1000, quota: 10, validSessionIds: [other.sessions[0]!._id] }))._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

const owner = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id: "u-own" } }, fn);
const coupon = (code: string, ticketTypeIds: string[], extra: { eventId?: string | null; kind?: "percent" | "fixed"; value?: number } = {}) =>
  owner(() => createCoupon(orgId, "u-own", { code, eventId: eventId, kind: "percent", value: 2000, maxUses: null, validFrom: null, validTo: null, ticketTypeIds, ...extra }));
const book = (items: { ticketTypeId: string; qty: number }[], couponCode: string) =>
  runWithContext({ actor: { type: "customer" } }, () => createCheckoutOrder({ eventId, customer: { name: "Asha", email: "asha@example.com" }, items, couponCode }));

describe("coupons limited to certain passes", () => {
  it("needs an event, and only that event's passes", async () => {
    await expect(coupon("NOEVENT", [night2], { eventId: null })).rejects.toThrow("Choose the event to limit the code to certain passes.");
    await expect(coupon("WRONG", [otherEventPass])).rejects.toThrow("Choose passes from this event only.");
    const c = await coupon("DAY2", [night2]);
    expect((await Discount.findById(c._id).lean())!.ticketTypeIds!.map(String)).toEqual([night2]);
    const found = await findCoupon(orgId, eventId, "day2");
    expect(found!.rule).toMatchObject({ ticketTypeIds: [night2], appliesToLabel: "Day pass · Day 2" });
  });

  it("discounts only the chosen night, stores what it discounted, and refunds other passes in full", async () => {
    const order = await book([{ ticketTypeId: night2, qty: 2 }, { ticketTypeId: night3, qty: 1 }], "DAY2");
    expect(order).toMatchObject({ subtotalPence: 7500, discount: { amountPence: 1000, ticketTypeIds: [night2] }, ticketsPence: 6500, platformFeePence: 650 });
    await runWithContext({ actor: systemActor }, () => fulfilOrder(order._id, { mode: "demo" }));
    const quote = await quoteRefund(orgId, order.publicId);
    const byType = quote.tickets.map((t) => [t.ticketTypeName, t.refundablePence]);
    expect(byType).toEqual([
      ["Day pass · Day 2", 2000],
      ["Day pass · Day 2", 2000],
      ["Day pass · Day 3", 2500],
    ]);
  });

  it("a season-only code discounts the season pass and not day passes", async () => {
    await coupon("SEASON10", [season], { value: 1000 });
    const order = await book([{ ticketTypeId: season, qty: 1 }, { ticketTypeId: night2, qty: 1 }], "SEASON10");
    expect(order).toMatchObject({ subtotalPence: 6500, discount: { amountPence: 400 } });
  });

  it("refuses checkout, naming the passes, when none of them are in the basket", async () => {
    const before = await Order.countDocuments();
    await expect(book([{ ticketTypeId: night3, qty: 1 }], "SEASON10")).rejects.toThrow(new CheckoutError("This code is only for Season pass."));
    expect(await Order.countDocuments()).toBe(before);
  });

  it("an old coupon with no passes still discounts the whole basket", async () => {
    await Discount.create({ organizerId: orgId, eventId, code: "ALL20", kind: "percent", value: 2000, createdBy: "u-own" });
    const order = await book([{ ticketTypeId: night2, qty: 1 }, { ticketTypeId: night3, qty: 1 }], "ALL20");
    expect(order.discount).toMatchObject({ amountPence: 1000 });
    expect(order.discount!.ticketTypeIds).toBeUndefined();
    expect(await Event.exists({ _id: eventId })).toBeTruthy();
  });
});
