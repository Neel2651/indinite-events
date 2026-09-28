import { describe, expect, it } from "vitest";
import { csvCell, penceToPounds, toCsv } from "../src";

describe("csv", () => {
  it("quotes every cell and doubles quotes", () => {
    expect(csvCell('Priya "P" Shah')).toBe('"Priya ""P"" Shah"');
    expect(csvCell("a,b\nc")).toBe('"a,b\nc"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
  });
  it("stops spreadsheet formulas from running", () => {
    for (const bad of ["=HYPERLINK(\"x\")", "+1+1", "-2", "@SUM(A1)", "\tcmd"]) expect(csvCell(bad).startsWith(`"'`)).toBe(true);
    expect(csvCell(-2)).toBe('"-2"'); // real numbers are fine
  });
  it("builds a file Excel opens correctly", () => {
    const out = toCsv(["Ref", "Total (£)"], [["NAV-1", penceToPounds(1562)]]);
    expect(out).toBe('﻿"Ref","Total (£)"\r\n"NAV-1","15.62"\r\n');
  });
});
