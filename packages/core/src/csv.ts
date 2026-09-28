/**
 * CSV for exports (orders, attendees, check-ins). Every cell is quoted, and text that a spreadsheet would run
 * as a formula (starting = + - @, tab or carriage return) is prefixed with ' so it's shown, not executed.
 */
export type CsvCell = string | number | boolean | Date | null | undefined;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '""';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Header row + rows, CRLF line endings, UTF-8 BOM so Excel reads £ and accents correctly. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Pence → "12.50" (a number column in spreadsheets, never floats in our own maths). */
export const penceToPounds = (p: number | null | undefined) => (((p ?? 0) as number) / 100).toFixed(2);
