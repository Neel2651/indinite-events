import { formatGBP } from "@indinite/core";

const TZ = "Europe/London";

const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const dayYear = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

const dayTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const formatDay = (d: Date) => day.format(d);
/** "Sun 4 Oct, 10:00" */
export const formatDayTime = (d: Date) => dayTime.format(d);
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

export const price = formatGBP;
