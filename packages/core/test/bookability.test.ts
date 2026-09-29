import { describe, expect, it } from "vitest";
import { bookability, can, dayPassMemberName, dayPassUpsertSchema, type AuthUser, type BookableEventState } from "../src";

// Two nights, 4:00 pm BST (15:00 UTC) on 11 and 12 Oct 2026, 4 hours each.
const n1 = { id: "a".repeat(24), startsAt: "2026-10-11T15:00:00Z", endsAt: "2026-10-11T19:00:00Z" };
const n2 = { id: "b".repeat(24), startsAt: "2026-10-12T15:00:00Z", endsAt: "2026-10-12T19:00:00Z" };
const event = (over: Partial<BookableEventState> = {}): BookableEventState => ({ sessions: [n1, n2], ...over });
const day1 = { name: "Day pass · Sun 11 Oct", available: 10, validSessionIds: [n1.id] };
const season = { name: "Season pass", available: 10, validSessionIds: [n1.id, n2.id] };
const at = (iso: string) => new Date(iso);

describe("bookability", () => {
  it("sells a day pass online until its night starts, at the box office until it ends", () => {
    expect(bookability(day1, event(), at("2026-10-11T14:59:00Z"), "online")).toEqual({ ok: true });
    expect(bookability(day1, event(), at("2026-10-11T15:00:00Z"), "online")).toMatchObject({ ok: false, reason: "started" });
    expect(bookability(day1, event(), at("2026-10-11T18:59:00Z"), "staff")).toEqual({ ok: true });
    expect(bookability(day1, event(), at("2026-10-11T19:00:00Z"), "staff")).toMatchObject({ ok: false, reason: "ended" });
  });

  it("keeps selling a season pass online until its last night starts", () => {
    expect(bookability(season, event(), at("2026-10-11T20:00:00Z"), "online")).toEqual({ ok: true });
    expect(bookability(season, event(), at("2026-10-12T15:00:00Z"), "online")).toMatchObject({ ok: false, reason: "started", message: "Season pass is no longer on sale: its last night has started." });
  });

  it("says sold out when nothing is left, online and at the box office", () => {
    expect(bookability({ ...day1, available: 0 }, event(), at("2026-10-01T10:00:00Z"), "online")).toMatchObject({ ok: false, reason: "sold_out", message: "Day pass · Sun 11 Oct has sold out." });
    expect(bookability({ ...day1, available: 0 }, event(), at("2026-10-01T10:00:00Z"), "staff")).toMatchObject({ reason: "sold_out" });
  });

  it("stops online sales when the event or the night is closed by hand; box office carries on", () => {
    const now = at("2026-10-01T10:00:00Z");
    expect(bookability(day1, event({ bookingsClosed: true }), now, "online")).toMatchObject({ reason: "event_closed" });
    expect(bookability(day1, event({ closedSessionIds: [n1.id] }), now, "online")).toMatchObject({ reason: "night_closed" });
    expect(bookability(day1, event({ bookingsClosed: true, closedSessionIds: [n1.id] }), now, "staff")).toEqual({ ok: true });
    // A season pass stays on sale while any of its nights is open.
    expect(bookability(season, event({ closedSessionIds: [n1.id] }), now, "online")).toEqual({ ok: true });
    expect(bookability(season, event({ closedSessionIds: [n1.id, n2.id] }), now, "online")).toMatchObject({ reason: "night_closed" });
  });

  it("respects sales windows and switched-off passes online", () => {
    const now = at("2026-10-01T10:00:00Z");
    expect(bookability({ ...day1, salesStartAt: "2026-10-04T09:00:00Z" }, event(), now, "online")).toMatchObject({ reason: "not_on_sale_yet" });
    expect(bookability({ ...day1, salesEndAt: "2026-09-30T09:00:00Z" }, event(), now, "online")).toMatchObject({ reason: "sales_ended" });
    expect(bookability({ ...day1, salesStartAt: "2026-10-04T09:00:00Z" }, event(), now, "staff")).toEqual({ ok: true });
    expect(bookability({ ...day1, active: false }, event(), now, "staff")).toMatchObject({ reason: "inactive" });
  });
});

describe("day passes", () => {
  it("names each night's pass with its UK date", () => {
    expect(dayPassMemberName("Day pass — adult", "2026-10-11T15:00:00Z")).toBe("Day pass — adult · Sun 11 Oct");
    // 00:30 BST on 12 Oct is 23:30 UTC on 11 Oct: the UK date wins.
    expect(dayPassMemberName("Day pass", "2026-10-11T23:30:00Z")).toBe("Day pass · Mon 12 Oct");
  });

  it("needs at least one night, each only once", () => {
    const base = { name: "Day pass", nights: [{ sessionId: n1.id, pricePence: 1000, quota: 100 }] };
    expect(dayPassUpsertSchema.safeParse(base).success).toBe(true);
    expect(dayPassUpsertSchema.safeParse({ ...base, nights: [] }).success).toBe(false);
    expect(dayPassUpsertSchema.safeParse({ ...base, nights: [...base.nights, ...base.nights] }).success).toBe(false);
  });

  it("only owners and super admins close bookings", () => {
    const org = "c".repeat(24);
    const u = (role: "owner" | "manager" | "box_office" | "scanner" | "finance"): AuthUser => ({ id: "u", isSuperAdmin: false, memberships: [{ organizerId: org, role }] });
    expect(can(u("owner"), "event.manageSales", { organizerId: org })).toBe(true);
    for (const r of ["manager", "box_office", "scanner", "finance"] as const) expect(can(u(r), "event.manageSales", { organizerId: org })).toBe(false);
    expect(can({ id: "a", isSuperAdmin: true, memberships: [] }, "event.manageSales", { organizerId: org })).toBe(true);
  });
});

describe("payment links", () => {
  it("follow the night-start and manual-close rules but not public sales windows", () => {
    const now = at("2026-10-01T10:00:00Z");
    expect(bookability({ ...day1, salesStartAt: "2026-10-04T09:00:00Z" }, event(), now, "payment_link")).toEqual({ ok: true });
    expect(bookability(day1, event({ bookingsClosed: true }), now, "payment_link")).toMatchObject({ reason: "event_closed" });
    expect(bookability(day1, event(), at("2026-10-11T15:00:00Z"), "payment_link")).toMatchObject({ reason: "started" });
  });
});
