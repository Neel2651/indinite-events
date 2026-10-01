import { describe, expect, it } from "vitest";
import { randomOrderPrefix, retryAfterText, slugCandidates, slugify, suggestOrderPrefixes } from "../src";

describe("slugify", () => {
  it("makes a web address from the organiser's name", () => {
    expect(slugify("Shree Garba Events Ltd")).toBe("shree-garba-events-ltd");
    expect(slugify("  OMB  Events!! ")).toBe("omb-events");
    expect(slugify("Rāmā & Sītā Garba")).toBe("rama-and-sita-garba");
    expect(slugify("")).toBe("");
  });

  it("offers name, name-2, name-3 … when taken", () => {
    expect(slugCandidates("OMB Events", 3)).toEqual(["omb-events", "omb-events-2", "omb-events-3"]);
    expect(slugCandidates("!!!", 1)).toEqual(["organiser"]);
  });
});

describe("order reference prefix", () => {
  it("prefers an acronym in the name, then the initials", () => {
    expect(suggestOrderPrefixes("OMB Events")[0]).toBe("OMB");
    expect(suggestOrderPrefixes("Shree Garba Events Ltd")[0]).toBe("SGE");
    expect(suggestOrderPrefixes("The Garba Co")[0]).toBe("GAR");
  });

  it("always gives several distinct 2–5 capital-letter candidates", () => {
    for (const name of ["OMB Events", "Garba", "A B", "Navratri 2026 London Nights", "12345"]) {
      const c = suggestOrderPrefixes(name);
      expect(c.length).toBeGreaterThan(0);
      expect(new Set(c).size).toBe(c.length);
      for (const p of c) expect(p).toMatch(/^[A-Z]{2,5}$/);
    }
    expect(suggestOrderPrefixes("Shree Garba Events Ltd").length).toBeGreaterThan(5);
  });

  it("random fallback is 3 letters with no I or O", () => {
    for (let i = 0; i < 50; i++) expect(randomOrderPrefix()).toMatch(/^[A-HJ-NP-Z]{3}$/);
  });
});

describe("retryAfterText", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("says how long to wait", () => {
    expect(retryAfterText(new Date(now.getTime() + 30_000), now)).toBe("Try again in 30 seconds.");
    expect(retryAfterText(new Date(now.getTime() + 1_000), now)).toBe("Try again in 1 second.");
    expect(retryAfterText(new Date(now.getTime() + 60_000), now)).toBe("Try again in 1 minute.");
    expect(retryAfterText(new Date(now.getTime() + 4 * 60_000 - 10), now)).toBe("Try again in 4 minutes.");
    expect(retryAfterText(new Date(now.getTime() + 3_600_000), now)).toBe("Try again in about an hour.");
    expect(retryAfterText(now, now)).toBe("Try again in 1 second.");
  });
});
