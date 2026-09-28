/**
 * Staff enter times as UK wall-clock time (a `datetime-local` value, "2026-10-11T19:30"); we store UTC
 * (CLAUDE.md rule 9). Handles BST/GMT, including the clocks going back on 25 Oct 2026.
 */
const TZ = "Europe/London";

const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function londonWallClock(d: Date) {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
}

/** Offset of London from UTC at instant `d`, in minutes (0 in winter, 60 in summer). */
function offsetMinutes(d: Date): number {
  const w = londonWallClock(d);
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - d.getTime()) / 60_000);
}

/** "2026-10-11T19:30" (London) → UTC Date. Returns null for anything that isn't a valid local date-time. */
export function londonLocalToUtc(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes settle the offset either side of a clock change.
  let t = asUtc - offsetMinutes(new Date(asUtc)) * 60_000;
  t = asUtc - offsetMinutes(new Date(t)) * 60_000;
  const back = londonWallClock(new Date(t));
  if (back.d !== d || back.mo !== mo) return null; // e.g. 31 Feb
  return new Date(t);
}

/** UTC Date → "2026-10-11T19:30" in London, for `datetime-local` default values. */
export function utcToLondonLocal(d: Date): string {
  const w = londonWallClock(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

/** "2026-10-11 19:30" in London (exports, print). */
export const formatLondonDateTime = (d: Date) => utcToLondonLocal(d).replace("T", " ");
