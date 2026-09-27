import { formatGBP } from "@indinite/core";

/** Indinite brand palette (mirrors apps/web/app/globals.css — do not invent colours). */
export const brand = {
  orange: "#eb5e28",
  orangeLight: "#f69852",
  orangeStrong: "#c44a18",
  yellow: "#ffe46a",
  ink: "#17130f",
  body: "#5f5a54",
  cream: "#fff6ef",
  navy: "#0a0e1f",
  navyRaised: "#1a2040",
  onDarkMuted: "#aab1cc",
  border: "#e7e6e6",
  white: "#ffffff",
} as const;

export const fontStack = "Poppins, 'Segoe UI', Helvetica, Arial, sans-serif";
export const bodyFontStack = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif";

const TZ = "Europe/London";
const dayYear = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
const dayShort = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const price = formatGBP;
export const formatDay = (d: Date) => dayShort.format(d);
export const formatTime = (d: Date) => time.format(d);

export function formatDateRange(start: Date, end: Date): string {
  const s = dayYear.formatToParts(start);
  const e = dayYear.formatToParts(end);
  const get = (p: Intl.DateTimeFormatPart[], t: string) => p.find((x) => x.type === t)?.value ?? "";
  if (get(s, "month") === get(e, "month") && get(s, "year") === get(e, "year")) {
    return `${get(s, "day")}–${get(e, "day")} ${get(e, "month")} ${get(e, "year")}`;
  }
  return `${dayYear.format(start)} – ${dayYear.format(end)}`;
}
