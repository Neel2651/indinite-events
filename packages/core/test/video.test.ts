import { describe, expect, it } from "vitest";
import { embedUrlFor, eventUpsertSchema, ticketTypeUpsertSchema } from "../src";

describe("embedUrlFor", () => {
  it("turns YouTube links into privacy-friendly embeds", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"]) {
      expect(embedUrlFor(u)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    }
  });
  it("turns Vimeo links into player embeds", () => {
    expect(embedUrlFor("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(embedUrlFor("https://player.vimeo.com/video/76979871")).toBe("https://player.vimeo.com/video/76979871");
  });
  it("refuses anything else", () => {
    for (const u of ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://evil.example/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.example/watch?v=x", "javascript:alert(1)", "not a url", "https://www.youtube.com/watch?v=<script>"]) {
      expect(embedUrlFor(u)).toBeNull();
    }
  });
});

describe("event and pass type schemas", () => {
  const base = { organizerId: "a".repeat(24), title: "Garba", slug: "Garba-2026", venue: { name: "Hall", address: "1 Road", postcode: "e1 1aa", mapUrl: "" }, sessions: [{ label: "Night 1", startsAt: "2026-10-11T18:00:00Z", endsAt: "2026-10-11T22:00:00Z" }] };
  it("normalises the slug and postcode and drops an empty map link", () => {
    const e = eventUpsertSchema.parse(base);
    expect(e.slug).toBe("garba-2026");
    expect(e.venue).toEqual({ name: "Hall", address: "1 Road", postcode: "E1 1AA", mapUrl: undefined });
  });
  it("rejects nights that end before they start, or the same night twice", () => {
    expect(eventUpsertSchema.safeParse({ ...base, sessions: [{ label: "N", startsAt: "2026-10-11T22:00:00Z", endsAt: "2026-10-11T18:00:00Z" }] }).success).toBe(false);
    const id = "b".repeat(24);
    expect(eventUpsertSchema.safeParse({ ...base, sessions: [{ id, ...base.sessions[0] }, { id, ...base.sessions[0] }] }).success).toBe(false);
  });
  it("needs sales to end after they start", () => {
    const t = { eventId: "a".repeat(24), name: "Season", pricePence: 4500, validSessionIds: ["b".repeat(24)], quota: 10 };
    expect(ticketTypeUpsertSchema.safeParse({ ...t, salesStartAt: "2026-10-04T09:00:00Z", salesEndAt: "2026-10-01T09:00:00Z" }).success).toBe(false);
    expect(ticketTypeUpsertSchema.safeParse({ ...t, salesStartAt: "2026-10-01T09:00:00Z", salesEndAt: "2026-10-04T09:00:00Z" }).success).toBe(true);
  });
});

import { londonLocalToUtc, utcToLondonLocal } from "../src";

describe("London time", () => {
  it("converts summer (BST) and winter (GMT) times", () => {
    expect(londonLocalToUtc("2026-10-11T19:30")?.toISOString()).toBe("2026-10-11T18:30:00.000Z");
    expect(londonLocalToUtc("2026-10-26T19:30")?.toISOString()).toBe("2026-10-26T19:30:00.000Z");
    expect(utcToLondonLocal(new Date("2026-10-11T18:30:00Z"))).toBe("2026-10-11T19:30");
    expect(utcToLondonLocal(new Date("2026-12-01T19:30:00Z"))).toBe("2026-12-01T19:30");
  });
  it("round-trips across the October clock change", () => {
    for (const v of ["2026-10-24T23:30", "2026-10-25T00:30", "2026-10-25T03:00", "2026-10-25T23:59"]) expect(utcToLondonLocal(londonLocalToUtc(v)!)).toBe(v);
  });
  it("rejects invalid input", () => {
    for (const v of ["", "2026-02-31T10:00", "2026-13-01T10:00", "11/10/2026 19:30", "2026-10-11T24:00"]) expect(londonLocalToUtc(v)).toBeNull();
  });
});
