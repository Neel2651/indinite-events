/**
 * Web address and order reference prefix made from an organiser's name (1 Oct 2026). Both are generated, not typed:
 * the server picks the first candidate not already in use.
 */

/** "Shree Garba Events Ltd" → "shree-garba-events-ltd" (lowercase letters, numbers and single hyphens). */
export function slugify(name: string, maxLength = 60): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** Web address candidates: the name, then name-2, name-3, … */
export function slugCandidates(name: string, count = 50): string[] {
  const base = slugify(name) || "organiser";
  return [base, ...Array.from({ length: count - 1 }, (_, i) => `${base.slice(0, 56)}-${i + 2}`)];
}

// Common words that make poor initials ("The Garba Co Ltd" → "GC", not "TGCL").
const SKIP = new Set(["the", "and", "of", "ltd", "limited", "llp", "plc", "co", "company", "uk", "inc", "cic"]);

const letters = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

/**
 * Order reference prefix candidates, 2–5 capital letters (references look like "OMB-7K3F9Q"), in order of
 * preference:
 * - the initials ("OMB Events" → OMB, "Shree Garba Events Ltd" → SGE)
 * - the start of the name (SHREE)
 * - initials plus the next letters of the first word
 * - letter variations
 * Random letters are added by the caller only if all of these are taken.
 */
export function suggestOrderPrefixes(name: string): string[] {
  const words = name
    .normalize("NFKD")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const meaningful = words.filter((w) => !SKIP.has(w.toLowerCase()));
  const use = meaningful.length ? meaningful : words;
  const out: string[] = [];
  const add = (p: string) => {
    const v = letters(p).slice(0, 5);
    if (v.length >= 2 && !out.includes(v)) out.push(v);
  };

  // A word that's already an acronym ("OMB Events") is used as it is.
  const acronym = use.find((w) => /^[A-Z]{2,5}$/.test(w));
  if (acronym) add(acronym);
  add(use.map((w) => w[0] ?? "").join(""));
  const joined = letters(use.join(""));
  add(joined.slice(0, 3));
  add(joined.slice(0, 4));
  add(joined.slice(0, 5));
  const first = letters(use[0] ?? "");
  for (let i = 1; i < first.length && out.length < 12; i++) add(letters(use.map((w) => w[0] ?? "").join("")) + first.slice(i, i + 1));
  // First letter + each later letter: SG, SH, … (short and still recognisable).
  for (let i = 1; i < joined.length && out.length < 20; i++) add((joined[0] ?? "") + joined.slice(i, i + 2));
  return out.length ? out : ["ORG"];
}

/** Random fallback prefix (3 letters, no I or O so it can't be misread as 1 or 0). */
export function randomOrderPrefix(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 3 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
}

/** "Try again in 30 seconds" / "in 1 minute" / "in 4 minutes" / "in about an hour", for rate-limit messages. */
export function retryAfterText(resetAt: Date | number, now: Date | number = Date.now()): string {
  const seconds = Math.max(1, Math.ceil((Number(resetAt) - Number(now)) / 1000));
  if (seconds < 60) return `Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 55) return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  return "Try again in about an hour.";
}
