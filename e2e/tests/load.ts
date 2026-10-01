/**
 * Load test: a sales-opening rush against a demo server (PAYMENTS_MODE=demo), e.g. staging.
 *   LOAD_BASE_URL=https://events.neelshah.co pnpm --filter @indinite/e2e test:load
 *
 * Each virtual customer opens the home page, then the event page, and some of them book 1–3 nights
 * (1–2 passes each) and open their confirmation page, with pauses in between like a real person.
 * Demo checkouts go through the real hold → order → fulfilment path, so this loads MongoDB exactly like
 * paid bookings (minus Stripe).
 *
 * Before running against staging (checkout has no rate limit, so nothing needs changing on the server):
 *   - Stop the worker (`pm2 stop indinite-worker`) unless you want to load it too. Bookings go to
 *     delivered+…@resend.dev (Resend's test inbox, no bounces) but still count against the Resend quota.
 *   - The test sells real (demo) passes and can sell the event out. Reset staging afterwards:
 *     `pnpm --filter @indinite/db seed -- --reset` then re-seed users.
 *
 * Settings (environment variables):
 *   LOAD_BASE_URL      required. Refused for the live site.
 *   LOAD_EVENT_SLUG    event to book (default omb-navratri-2k26)
 *   LOAD_USERS         customers at the peak (default 50)
 *   LOAD_RAMP          seconds to reach the peak (default 30)
 *   LOAD_DURATION      total seconds (default 120)
 *   LOAD_BOOK_RATIO    share of page visits that go on to book (default 0.3)
 *   LOAD_THINK_MS      average pause between steps (default 2000)
 *
 * Exits with 1 if more than 1% of requests fail with a server error or timeout.
 */

const LIVE_HOSTS = ["events.indinite.co.uk"];

const base = (process.env.LOAD_BASE_URL ?? "").replace(/\/+$/, "");
if (!base) exit("Set LOAD_BASE_URL, e.g. LOAD_BASE_URL=https://events.neelshah.co");
if (LIVE_HOSTS.includes(new URL(base).hostname)) exit(`Refusing to load test the live site (${new URL(base).hostname}). Use staging.`);

const slug = process.env.LOAD_EVENT_SLUG ?? "omb-navratri-2k26";
const users = int("LOAD_USERS", 50);
const rampS = int("LOAD_RAMP", 30);
const durationS = int("LOAD_DURATION", 120);
const bookRatio = Number(process.env.LOAD_BOOK_RATIO ?? 0.3);
const thinkMs = int("LOAD_THINK_MS", 2000);
const runId = Date.now().toString(36);
const TIMEOUT_MS = 30_000;

function int(name: string, fallback: number): number {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(v) || v < 1) exit(`${name} must be a whole number above 0`);
  return v;
}

function exit(message: string): never {
  console.error(message);
  process.exit(1);
}

// ---- Metrics ---------------------------------------------------------------------------------------------

interface Step {
  times: number[];
  statuses: Map<string, number>;
}
const steps = new Map<string, Step>();
let serverErrors = 0;
let total = 0;
let ordersOk = 0;
let passesSold = 0;
let soldOut = 0;
let rateLimited = 0;
let active = 0;
const started = Date.now();

function record(label: string, ms: number, status: string) {
  const s = steps.get(label) ?? { times: [], statuses: new Map() };
  steps.set(label, s);
  s.times.push(ms);
  s.statuses.set(status, (s.statuses.get(status) ?? 0) + 1);
  total++;
  if (status === "timeout" || status === "network" || status.startsWith("5")) serverErrors++;
}

async function hit(label: string, path: string, init?: RequestInit): Promise<Response | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    // Read the whole body so the timing includes the full page, like a browser.
    const body = await res.arrayBuffer();
    record(label, performance.now() - t0, String(res.status));
    return new Response(body, { status: res.status, headers: res.headers });
  } catch (e) {
    record(label, performance.now() - t0, e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
    return null;
  }
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0);
const ms = (n: number) => `${Math.round(n)} ms`.padStart(9);

// ---- Setup: find the event and its passes from the public page -------------------------------------------

interface Pass {
  id: string;
  name: string;
}

async function loadEvent(): Promise<{ eventId: string; passes: Pass[] }> {
  const res = await fetch(`${base}/e/${slug}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) exit(`GET /e/${slug} returned ${res.status}. Is the event seeded and published?`);
  // The page's props are embedded in the HTML (React Server Components payload), with escaped quotes.
  const html = (await res.text()).replace(/\\"/g, '"');
  const eventId = html.match(/"eventId":"([0-9a-f]{24})"/)?.[1];
  const passes = [...html.matchAll(/"id":"([0-9a-f]{24})","name":"([^"]+)","pricePence":/g)].map((m) => ({ id: m[1]!, name: m[2]! }));
  const unique = [...new Map(passes.map((p) => [p.id, p])).values()];
  if (!eventId || !unique.length) exit(`Couldn't find the event or its passes on /e/${slug}.`);
  return { eventId, passes: unique };
}

// ---- One customer ----------------------------------------------------------------------------------------

const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
const think = () => sleep(thinkMs * (0.5 + Math.random()));
const pick = <T>(xs: T[], n: number) => [...xs].sort(() => Math.random() - 0.5).slice(0, n);
let bookingNo = 0;

async function book(eventId: string, passes: Pass[]) {
  const n = ++bookingNo;
  const items = pick(passes, 1 + Math.floor(Math.random() * 3)).map((p) => ({ ticketTypeId: p.id, qty: 1 + Math.floor(Math.random() * 2) }));
  const res = await hit("POST /api/checkout", "/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId, customer: { name: `Load test ${n}`, email: `delivered+lt-${runId}-${n}@resend.dev` }, items }),
  });
  if (!res) return;
  if (res.status === 409) soldOut++;
  if (res.status === 429) rateLimited++;
  if (!res.ok) return;
  const { redirectUrl } = (await res.json()) as { redirectUrl: string };
  ordersOk++;
  passesSold += items.reduce((s, i) => s + i.qty, 0);
  await think();
  await hit("GET confirmation page", redirectUrl);
}

async function customer(eventId: string, passes: Pass[], until: number) {
  active++;
  while (Date.now() < until) {
    await hit("GET /", "/");
    await think();
    await hit(`GET /e/${slug}`, `/e/${slug}`);
    await think();
    if (Math.random() < bookRatio) {
      await book(eventId, passes);
      await think();
    }
  }
  active--;
}

// ---- Run -------------------------------------------------------------------------------------------------

const { eventId, passes } = await loadEvent();
console.log(`${base}/e/${slug}: ${passes.length} pass types`);

// One booking first: stop straight away if the server takes real card payments or refuses checkout.
const probe = await fetch(`${base}/api/checkout`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ eventId, customer: { name: "Load test probe", email: `delivered+lt-${runId}-0@resend.dev` }, items: [{ ticketTypeId: passes[0]!.id, qty: 1 }] }),
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
const probeBody = (await probe.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
if (!probe.ok) exit(`Test booking refused (${probe.status}): ${probeBody.error ?? "no message"}`);
if (!probeBody.redirectUrl?.startsWith("/checkout/success")) {
  exit("This server takes card payments (PAYMENTS_MODE=stripe). The test booking made one Stripe Checkout Session, which expires in 30 minutes. Run load tests against a demo server only.");
}
console.log(`Demo payments confirmed. Ramping to ${users} customers over ${rampS}s, running ${durationS}s in total.\n`);

const until = started + durationS * 1000;
const progress = setInterval(() => {
  const s = Math.round((Date.now() - started) / 1000);
  console.log(`${String(s).padStart(4)}s  customers ${String(active).padStart(4)}  requests ${String(total).padStart(6)} (${(total / Math.max(1, s)).toFixed(1)}/s)  bookings ${ordersOk}  errors ${serverErrors}`);
}, 10_000);

const runs: Promise<void>[] = [];
for (let i = 0; i < users && Date.now() < until; i++) {
  runs.push(customer(eventId, passes, until));
  await sleep((rampS * 1000) / users);
}
await Promise.all(runs);
clearInterval(progress);

// ---- Report ----------------------------------------------------------------------------------------------

const secs = (Date.now() - started) / 1000;
console.log(`\n${"Step".padEnd(28)}${"count".padStart(7)}${"p50".padStart(9)}${"p95".padStart(9)}${"p99".padStart(9)}${"max".padStart(9)}  responses`);
for (const [label, s] of steps) {
  const sorted = [...s.times].sort((a, b) => a - b);
  const statuses = [...s.statuses].map(([k, v]) => `${k}×${v}`).join(" ");
  console.log(`${label.padEnd(28)}${String(sorted.length).padStart(7)}${ms(pct(sorted, 50))}${ms(pct(sorted, 95))}${ms(pct(sorted, 99))}${ms(sorted.at(-1) ?? 0)}  ${statuses}`);
}
const errorRate = total ? serverErrors / total : 0;
console.log(`\n${total} requests in ${secs.toFixed(0)}s (${(total / secs).toFixed(1)}/s). Bookings: ${ordersOk} (${(ordersOk / secs).toFixed(2)}/s), ${passesSold} passes.`);
if (soldOut) console.log(`${soldOut} bookings refused as sold out (expected once nights fill up).`);
if (rateLimited) console.log(`${rateLimited} bookings rate limited (429).`);
console.log(`Server errors and timeouts: ${serverErrors} (${(errorRate * 100).toFixed(2)}%).`);
if (errorRate > 0.01) exit("✗ More than 1% of requests failed.");
console.log("✓ Passed.");
