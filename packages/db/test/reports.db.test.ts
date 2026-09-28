/** Real-MongoDB tests for exports, audit views, printed gate lists and organiser updates (M8/M9). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { generateQrKeyPair } from "@indinite/core";
import { runWithContext } from "@indinite/core/context";
import { AuditLog, buildExport, CheckoutError, createCheckoutOrder, Event, gatePrintList, issueOfflineOrder, listAuditLogs, Organizer, recordExport, TicketType, updateOrganizer } from "../src";

let replSet: MongoMemoryReplSet;
const ids = { a: "", b: "", eventA: "", eventB: "", nightA: "", typeA: "", typeB: "" };

beforeAll(async () => {
  process.env.QR_SIGNING_PRIVATE_KEY = generateQrKeyPair().privateKeyHex;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  const [a, b] = await Organizer.create(
    [
      { name: "Org A", slug: "a", contactEmail: "a@example.com", authOrgId: "a1", orderPrefix: "AAA" },
      { name: "Org B", slug: "b", contactEmail: "b@example.com", authOrgId: "b1", orderPrefix: "BBB" },
    ],
    { ordered: true },
  );
  const mk = async (org: typeof a, slug: string) => {
    const e = await Event.create({
      organizerId: org!._id,
      slug,
      title: `Event ${slug}`,
      venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" },
      sessions: [
        { label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) },
        { label: "Night 2", startsAt: new Date(Date.now() + 2 * 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000 + 3_600_000) },
      ],
      status: "published",
    });
    const t = await TicketType.create({ eventId: e._id, name: "Night 1 pass", pricePence: 1000, quota: 100, maxPerOrder: 20, validSessionIds: [e.sessions[0]!._id] });
    return { e, t };
  };
  const ea = await mk(a, "ea");
  const eb = await mk(b, "eb");
  Object.assign(ids, { a: String(a!._id), b: String(b!._id), eventA: String(ea.e._id), eventB: String(eb.e._id), nightA: String(ea.e.sessions[0]!._id), typeA: String(ea.t._id), typeB: String(eb.t._id) });

  const as = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id: "u1" } }, fn);
  for (const name of ["Zara Young", "=HYPERLINK(\"http://evil\")", "Anil Bhatt", "Meera Kaur", "Dev Patel"]) {
    await as(() => issueOfflineOrder(ids.a, "u1", { eventId: ids.eventA, customer: { name, email: "x@example.com" }, items: [{ ticketTypeId: ids.typeA, qty: 1 }], method: "cash", note: "Paid" }));
  }
  await as(() => issueOfflineOrder(ids.b, "u1", { eventId: ids.eventB, customer: { name: "Other Org Customer", email: "secret@b.example" }, items: [{ ticketTypeId: ids.typeB, qty: 1 }], method: "cash", note: "Paid" }));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

describe("exports", () => {
  it("only ever contains the organiser's own data, and neutralises spreadsheet formulas", async () => {
    for (const kind of ["orders", "attendees", "checkins"] as const) {
      const out = await buildExport(kind, { organizerId: ids.a });
      expect(out.csv).not.toContain("secret@b.example");
      expect(out.csv).not.toContain("BBB-");
    }
    const orders = await buildExport("orders", { organizerId: ids.a });
    expect(orders.rows).toBe(5);
    expect(orders.csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(orders.csv).toMatch(/"Cash"/);
    // Asking for another organiser's event returns nothing.
    expect((await buildExport("orders", { organizerId: ids.a, eventId: ids.eventB })).rows).toBe(0);
    // Super admin (no organiser) sees both.
    expect((await buildExport("orders", { organizerId: null })).rows).toBe(6);
  });

  it("records every download in the audit log", async () => {
    await runWithContext({ actor: { type: "user", id: "fin-1" } }, () => recordExport({ kind: "orders", scope: { organizerId: ids.a, eventId: ids.eventA }, rows: 5 }));
    expect(await AuditLog.findOne({ action: "export.downloaded", "actor.id": "fin-1" }).lean()).toMatchObject({ organizerId: new mongoose.Types.ObjectId(ids.a), metadata: { kind: "orders", rows: 5 } });
  });
});

describe("printable gate list", () => {
  it("lists that night's valid passes by surname, split across gates", async () => {
    const list = (await gatePrintList(ids.a, ids.eventA, ids.nightA, 2))!;
    expect(list.total).toBe(5);
    expect(list.sheets).toHaveLength(2);
    const names = list.sheets.flatMap((s) => s.rows.map((r) => r.name));
    expect(names.slice(-3)).toEqual(["Meera Kaur", "Dev Patel", "Zara Young"]);
    // Letter ranges cover A–Z with no letter on two sheets.
    expect(list.sheets[0]!.from).toBe("A");
    expect(list.sheets.at(-1)!.to).toBe("Z");
    const lastOfFirst = list.sheets[0]!.rows.at(-1)!.name.split(" ").at(-1)![0];
    const firstOfSecond = list.sheets[1]!.rows[0]!.name.split(" ").at(-1)![0];
    expect(lastOfFirst).not.toBe(firstOfSecond);
    // Another organiser's event, or a night the passes aren't valid for.
    expect(await gatePrintList(ids.b, ids.eventA, ids.nightA, 2)).toBeNull();
    const night2 = String((await Event.findById(ids.eventA).lean())!.sessions[1]!._id);
    expect((await gatePrintList(ids.a, ids.eventA, night2, 2))!.total).toBe(0);
  });
});

describe("audit views", () => {
  it("scopes to the organiser, filters by action prefix and pages with a cursor", async () => {
    const own = await listAuditLogs({ organizerId: ids.a, action: "order.", limit: 3 });
    expect(own.entries).toHaveLength(3);
    expect(own.entries.every((e) => e.organizer?.id === ids.a && e.action.startsWith("order."))).toBe(true);
    const next = await listAuditLogs({ organizerId: ids.a, action: "order.", limit: 3, before: own.nextCursor! });
    expect(next.entries.length).toBeGreaterThan(0);
    expect(next.entries.some((e) => own.entries.some((o) => o.id === e.id))).toBe(false);
    const other = await listAuditLogs({ organizerId: ids.b });
    expect(other.entries.every((e) => e.organizer?.id === ids.b)).toBe(true);
  });
});

describe("organiser details", () => {
  it("updates, audits and suspending stops new bookings", async () => {
    await runWithContext({ actor: { type: "user", id: "admin-1", role: "super_admin" } }, () =>
      updateOrganizer(ids.b, { name: "Org B Ltd", contactEmail: "Hello@B.example", orderPrefix: "obl", status: "suspended", maxDiscountBpsForManager: 1500 }),
    );
    expect(await Organizer.findById(ids.b).lean()).toMatchObject({ name: "Org B Ltd", contactEmail: "hello@b.example", orderPrefix: "OBL", status: "suspended", maxDiscountBpsForManager: 1500 });
    expect(await AuditLog.findOne({ action: "organizer.suspended", "entity.id": ids.b }).lean()).toBeTruthy();
    await expect(
      runWithContext({ actor: { type: "customer", id: "c" } }, () => createCheckoutOrder({ eventId: ids.eventB, customer: { name: "A", email: "a@example.com" }, items: [{ ticketTypeId: ids.typeB, qty: 1 }] })),
    ).rejects.toBeInstanceOf(CheckoutError);
  });
});

describe("gate sheets keep a surname letter together", () => {
  it("never splits one letter (or one booking) across gates", async () => {
    const as = <T>(fn: () => Promise<T>) => runWithContext({ actor: { type: "user", id: "u1" } }, fn);
    const e = await Event.create({ organizerId: new mongoose.Types.ObjectId(ids.a), slug: "family", title: "Family night", venue: { name: "Hall", address: "1 Road", postcode: "E1 1AA" }, sessions: [{ label: "Night 1", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) }], status: "published" });
    const t = await TicketType.create({ eventId: e._id, name: "Pass", pricePence: 1000, quota: 100, maxPerOrder: 20, validSessionIds: [e.sessions[0]!._id] });
    await as(() => issueOfflineOrder(ids.a, "u1", { eventId: String(e._id), customer: { name: "Ravi Bhatt", email: "r@example.com" }, items: [{ ticketTypeId: String(t._id), qty: 4 }], method: "cash", note: "Family" }));
    const list = (await gatePrintList(ids.a, String(e._id), String(e.sessions[0]!._id), 2))!;
    expect(list.sheets).toHaveLength(1);
    expect(list.sheets[0]).toMatchObject({ from: "A", to: "Z" });
    expect(list.sheets[0]!.rows).toHaveLength(4);
  });
});
