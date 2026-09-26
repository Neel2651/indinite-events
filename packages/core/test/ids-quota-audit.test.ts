import { describe, expect, it } from "vitest";
import {
  PUBLIC_ID_RE,
  REDACTED,
  available,
  diffForAudit,
  generatePublicId,
  normalisePublicId,
  reserveOp,
  sellDirectOp,
} from "../src";

describe("public ids", () => {
  it("generates readable unique refs", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generatePublicId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(PUBLIC_ID_RE);
  });

  it("normalises what customers type", () => {
    expect(normalisePublicId(" nav-7k3fo q ")).toBe("NAV-7K3F0Q");
    expect(normalisePublicId("NAV-1L1I00")).toBe("NAV-111100");
    expect(normalisePublicId("NOV-ABCDEF")).toBe("NOV-ABCDEF");
  });
});

describe("quota ops", () => {
  it("builds an atomic conditional reserve", () => {
    const op = reserveOp("tt1", 3);
    expect(op.filter.$expr).toEqual({ $lte: [{ $add: ["$sold", "$held", 3] }, "$quota"] });
    expect(op.update).toEqual({ $inc: { held: 3 } });
    expect(sellDirectOp("tt1", 2).update).toEqual({ $inc: { sold: 2 } });
  });

  it("rejects invalid quantities", () => {
    expect(() => reserveOp("tt1", 0)).toThrow();
    expect(() => reserveOp("tt1", 1.5)).toThrow();
  });

  it("computes availability", () => {
    expect(available({ quota: 100, sold: 60, held: 30 })).toBe(10);
    expect(available({ quota: 10, sold: 10, held: 2 })).toBe(0);
  });
});

describe("audit diff", () => {
  it("records only changed fields, nested, ignoring timestamps", () => {
    const before = { title: "Navratri", venue: { name: "Hall A", postcode: "E1 1AA" }, updatedAt: new Date(1) };
    const after = { title: "Navratri 2026", venue: { name: "Hall A", postcode: "E1 2BB" }, updatedAt: new Date(2) };
    expect(diffForAudit(before, after)).toEqual([
      { path: "title", before: "Navratri", after: "Navratri 2026" },
      { path: "venue.postcode", before: "E1 1AA", after: "E1 2BB" },
    ]);
  });

  it("redacts personal data but keeps the fact it changed", () => {
    const changes = diffForAudit({ customer: { email: "a@x.com" } }, { customer: { email: "b@x.com" } });
    expect(changes).toEqual([{ path: "customer.email", before: REDACTED, after: REDACTED }]);
  });

  it("handles creation and deletion", () => {
    expect(diffForAudit(null, { status: "paid" })).toEqual([{ path: "status", before: null, after: "paid" }]);
    expect(diffForAudit({ status: "paid" }, null)).toEqual([{ path: "status", before: "paid", after: null }]);
  });

  it("stringifies ObjectIds and dates", () => {
    const oid = { toHexString: () => "66f1a2b3c4d5e6f708192a3b" };
    expect(diffForAudit({ eventId: null }, { eventId: oid })).toEqual([
      { path: "eventId", before: null, after: "66f1a2b3c4d5e6f708192a3b" },
    ]);
  });
});
