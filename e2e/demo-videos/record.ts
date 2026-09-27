/**
 * Records client-demo videos against the local dev server (PAYMENTS_MODE=demo, seeded data).
 *   pnpm --filter @indinite/e2e demo:videos            # all
 *   pnpm --filter @indinite/e2e demo:videos booking    # one: booking | organiser | scanning
 * Output: e2e/demo-videos/out/*.mp4
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";
import { MongoClient } from "mongodb";
import { clearCamera, installFakeCamera, showPass } from "./fake-camera";
import { caption, captionsAtTop, click, installOverlay, pause, scroll, scrollTo, type } from "./helpers";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3001";
const OUT = path.resolve(import.meta.dirname, "out");
// Dev seed password (see packages/auth/scripts/seed-users.ts).
const PASSWORD = process.env.SEED_PASSWORD || "IndiniteDemo2026!";

const mongo = new MongoClient(process.env.MONGODB_URI!);
const db = mongo.db();

async function record(browser: Browser, name: string, options: BrowserContextOptions, scenario: (page: Page) => Promise<void>, fakeCamera = false) {
  const tmp = path.join(OUT, `.tmp-${name}`);
  rmSync(tmp, { recursive: true, force: true });
  const size = options.viewport!;
  const context = await browser.newContext({ ...options, recordVideo: { dir: tmp, size } });
  await installOverlay(context);
  if (fakeCamera) await installFakeCamera(context);
  const page = await context.newPage();
  try {
    await scenario(page);
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, `${name}-error.png`) }).catch(() => {});
    console.error(`✗ ${name} failed at ${page.url()}`);
    throw e;
  } finally {
    await context.close();
  }
  const webm = readdirSync(tmp).find((f) => f.endsWith(".webm"))!;
  const mp4 = path.join(OUT, `${name}.mp4`);
  // H.264 MP4 plays everywhere (WhatsApp, email, Slides). Trim the blank first half-second.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.5", "-i", path.join(tmp, webm), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ ${path.relative(process.cwd(), mp4)}`);
}

// ---------------------------------------------------------------------------------------------
// 1. Customer booking
// ---------------------------------------------------------------------------------------------
const CUSTOMER = { name: "Asha Patel", email: "asha.patel@example.com" };

async function bookingFlow(page: Page) {
  // Re-recording repeats the Find my tickets lookup; reset its per-hour limit (dev database only).
  await db.collection("ratelimits").deleteMany({});
  await page.goto(BASE);
  await caption(page, "Customers find events at events.indinite.co.uk", 2200);
  await scroll(page, 420);
  await caption(page, "London is open for bookings; Leicester opens on Sun 4 Oct", 2400);
  await click(page, page.getByRole("link", { name: "View passes" }).first(), 1200);

  await caption(page, "Event page: dates, venue and photos", 1800);
  await scroll(page, 500, 1400);
  await scroll(page, 500, 1400);
  await caption(page, "Choose passes", 1200);
  const add = (name: string) => page.getByRole("button", { name: `Add one ${name}` });
  await scrollTo(page, add("Season pass — adult"));
  await click(page, add("Season pass — adult"), 500);
  await click(page, add("Season pass — adult"), 500);
  await click(page, add("Season pass — child (5–12)"), 800);
  await caption(page, "The total updates as you go", 1400);

  await type(page, page.getByLabel("Full name"), CUSTOMER.name);
  await type(page, page.getByLabel("Email"), CUSTOMER.email);
  await scrollTo(page, page.getByRole("button", { name: /Confirm booking/ }));
  await caption(page, "Demo mode: payment is skipped. In production this goes to secure Stripe card payment", 3000);
  await click(page, page.getByRole("button", { name: /Confirm booking/ }), 400);

  await page.waitForURL(/\/checkout\/success/, { timeout: 30_000 });
  await pause(page, 800);
  await caption(page, "Booking confirmed, with an order reference", 2200);
  const ref = (await page.locator("text=/^[A-Z]{2,5}-[0-9A-Z]{6}$/").first().textContent())!.trim();
  await scroll(page, 450, 1200);
  await caption(page, "Passes are also emailed, with a PDF for each person", 2200);
  await click(page, page.getByRole("link", { name: "View my passes" }), 1200);

  await page.waitForURL(/\/orders\//);
  await caption(page, "Booking details and one QR code per person", 2000);
  await scroll(page, 520, 1400);
  await scroll(page, 520, 1400);
  await caption(page, "Show the QR code at the gate", 1800);
  await scroll(page, 700, 1400);

  await page.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })");
  await pause(page, 900);
  await caption(page, "Lost the email? Use Find my tickets", 1800);
  await click(page, page.getByRole("link", { name: "Find my tickets" }), 1000);
  await type(page, page.getByLabel("Email address"), CUSTOMER.email);
  await type(page, page.getByLabel("Order reference"), ref);
  await click(page, page.getByRole("button", { name: "Show my tickets" }), 400);
  await page.waitForURL(/\/orders\/[A-Z]/);
  await caption(page, "Tickets straight back, no account needed", 2400);
  await scroll(page, 600, 1200);
  await pause(page, 1200);
}

// ---------------------------------------------------------------------------------------------
// 2. Organiser login
// ---------------------------------------------------------------------------------------------
const NEW_STAFF = { name: "Meera Shah", email: "meera@demo-garba.test" };

/** Seed roles the videos rely on (dev database only). */
async function resetSeedRoles() {
  const roles: Record<string, string> = { "owner@demo-garba.test": "owner", "boxoffice@demo-garba.test": "box_office", "scanner@demo-garba.test": "scanner" };
  for (const [email, role] of Object.entries(roles)) {
    const u = await db.collection("user").findOne({ email });
    if (u) await db.collection("member").updateMany({ userId: u._id }, { $set: { role } });
  }
}

/** Remove the demo invitee from any earlier run so the video can be re-recorded. */
async function resetNewStaff() {
  await resetSeedRoles();
  const user = await db.collection("user").findOne({ email: NEW_STAFF.email });
  if (user) {
    await db.collection("member").deleteMany({ userId: user._id });
    await db.collection("session").deleteMany({ userId: user._id });
    await db.collection("account").deleteMany({ userId: user._id });
    await db.collection("user").deleteOne({ _id: user._id });
  }
  await db.collection("invitation").updateMany({ email: NEW_STAFF.email, status: "pending" }, { $set: { status: "canceled" } });
}

async function signIn(page: Page, email: string) {
  await type(page, page.getByLabel("Email"), email);
  await type(page, page.getByLabel("Password"), PASSWORD);
  await click(page, page.getByRole("button", { name: "Sign in" }), 400);
}

async function organiserFlow(page: Page) {
  await resetNewStaff();
  await page.goto(BASE);
  await caption(page, "Organiser teams sign in from the Staff sign in link", 2000);
  await page.evaluate("window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })");
  await pause(page, 1000);
  await click(page, page.getByRole("link", { name: "Staff sign in" }), 1000);

  await caption(page, "Owners sign in with email and password. There's no public sign-up", 2400);
  await signIn(page, "owner@demo-garba.test");
  await page.waitForURL(/\/org\/demo-garba$/);
  await caption(page, "Organiser dashboard: passes sold, orders and sales", 2600);
  await scroll(page, 300);

  await click(page, page.getByRole("link", { name: "Team" }), 1000);
  await caption(page, "Owners invite their team, each with a role", 2200);
  await scroll(page, 450, 1200);
  await caption(page, "Roles control what each person can do", 2400);
  await type(page, page.getByLabel("Email address"), NEW_STAFF.email);
  // The invite form's own role picker (not a team member's row).
  await page.locator('form select[name="role"]').selectOption("box_office");
  await pause(page, 800);
  await click(page, page.getByRole("button", { name: "Send invitation" }), 1600);
  await caption(page, "Invitation sent. Meera gets an email with a link", 2400);

  const invitation = await db.collection("invitation").findOne({ email: NEW_STAFF.email, status: "pending" }, { sort: { _id: -1 } });
  await click(page, page.getByRole("button", { name: "Sign out" }), 1000);

  await caption(page, "Meera opens the invitation link from her email", 2000);
  await page.goto(`${BASE}/invite/${invitation!._id}`);
  await pause(page, 800);
  await type(page, page.getByLabel("Your full name"), NEW_STAFF.name);
  await type(page, page.getByLabel("Choose a password"), PASSWORD);
  await type(page, page.getByLabel("Confirm password"), PASSWORD);
  await click(page, page.getByRole("button", { name: "Create account and accept" }), 400);
  await page.waitForURL(/\/org\/demo-garba$/, { timeout: 30_000 });
  await caption(page, "She's in, as Box office. No Team menu: only owners manage the team", 3000);
  await click(page, page.getByRole("button", { name: "Sign out" }), 1000);

  await caption(page, "Indinite admins sign in to the same page", 2000);
  await signIn(page, "admin@indinite.test");
  await page.waitForURL(/\/admin$/);
  await caption(page, "Admin overview across every organiser", 2400);
  await click(page, page.getByRole("link", { name: "Organisers" }), 1000);
  await caption(page, "Admins create organisers and invite their owners", 2600);
  await scroll(page, 400, 1200);
  await pause(page, 1500);
}

// ---------------------------------------------------------------------------------------------
// 3. Ticket checking at the gate
// ---------------------------------------------------------------------------------------------

async function scanningFlow(page: Page) {
  const QRCode = (await import("qrcode")).default;
  const qr = (text: string) => QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: 600 });
  const { passCode } = await import("@indinite/core");

  // Passes to scan: a season-pass order (valid tonight) and a weekend pass (wrong night on Night 1).
  const london = await db.collection("events").findOne({ slug: "navratri-2026-london" });
  const night1 = london!.sessions[0]._id;
  const seasonOrder = await db.collection("orders").findOne({ eventId: london!._id, status: "paid", "items.name": "Season pass — adult" }, { sort: { _id: -1 } });
  const season = await db.collection("tickets").find({ orderId: seasonOrder!._id, ticketTypeName: "Season pass — adult", status: "valid" }).sort({ _id: 1 }).toArray();
  const weekend = await db.collection("tickets").findOne({ eventId: london!._id, ticketTypeName: "Weekend pass — adult", status: "valid" });
  if (season.length < 2 || !weekend) throw new Error("Seed a season-pass order with 2+ adults and a weekend pass first");
  await resetSeedRoles();
  // Fresh night for re-recording (dev database only).
  await db.collection("scans").deleteMany({ eventId: london!._id, sessionId: night1 });

  await page.goto(`${BASE}/sign-in`);
  await captionsAtTop(page);
  await caption(page, "Gate staff sign in on their phone", 1800);
  await type(page, page.getByLabel("Email"), "scanner@demo-garba.test");
  await type(page, page.getByLabel("Password"), PASSWORD);
  await click(page, page.getByRole("button", { name: "Sign in" }), 400);
  await page.waitForURL(/\/scan$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Start scanning" }).waitFor();
  await caption(page, "Scanner staff go straight to the scanner. Pick the event, night and gate", 2600);
  await page.getByLabel("Gate").fill("");
  await type(page, page.getByLabel("Gate"), "Main gate");
  await caption(page, "Passes download to the phone, so scanning works without signal", 2400);
  await click(page, page.getByRole("button", { name: "Start scanning" }), 1500);
  await page.getByText("Point the camera at a pass").waitFor();
  await caption(page, "Point the camera at a pass", 1800);

  const admitted = page.getByText("Admitted", { exact: true });
  const tapToContinue = async () => {
    await pause(page, 2200);
    await click(page, page.getByText("Tap to scan the next pass"), 600);
  };

  // 1. Valid pass
  await showPass(page, await qr(season[0]!.qrToken), "Season pass — adult", "Pass 1 of " + season.length, passCode(season[0]!.qrToken));
  await admitted.waitFor({ timeout: 15_000 });
  await caption(page, "Green: admitted. Shows the pass type and order", 1800);
  await clearCamera(page);
  await page.getByText("Point the camera at a pass").waitFor();
  await pause(page, 900);

  // 2. Same pass again
  await caption(page, "Someone tries the same pass again…", 1400);
  await showPass(page, await qr(season[0]!.qrToken), "Season pass — adult", "Pass 1 of " + season.length, passCode(season[0]!.qrToken));
  await page.getByText("Already scanned").waitFor({ timeout: 15_000 });
  await caption(page, "Amber: already scanned, with the time and gate", 1600);
  await clearCamera(page);
  await tapToContinue();

  // 3. Wrong night
  await caption(page, "A weekend pass on opening night…", 1400);
  await showPass(page, await qr(weekend.qrToken), "Weekend pass — adult", "Fri 16 Oct, Sat 17 Oct", passCode(weekend.qrToken));
  await page.getByText("Wrong night").waitFor({ timeout: 15_000 });
  await caption(page, "Red: wrong night, showing which nights it's for", 1600);
  await clearCamera(page);
  await tapToContinue();

  // 4. Fake
  await caption(page, "A screenshot of some other QR code…", 1400);
  await showPass(page, await qr("https://example.com/free-entry"), "Not a real pass", "", "");
  await page.getByText("Not a valid pass").waitFor({ timeout: 15_000 });
  await caption(page, "Red: not a valid pass. Fakes and edited passes are caught", 1600);
  await clearCamera(page);
  await tapToContinue();

  // 5. Manual code
  await caption(page, "Cracked phone screen? Type the code under the QR", 1800);
  await click(page, page.getByRole("button", { name: "Enter code" }), 600);
  await type(page, page.getByPlaceholder("e.g. K7Q2-M9XA"), passCode(season[1]!.qrToken));
  await click(page, page.getByRole("button", { name: "Check pass" }), 200);
  await admitted.waitFor({ timeout: 15_000 });
  await caption(page, "Admitted", 1600);
  await page.getByText("Point the camera at a pass").waitFor();
  await caption(page, "Scans sync every 10 seconds. Two gates can't let the same pass in", 2600);

  // Organiser's live view
  await page.context().clearCookies();
  await page.goto(`${BASE}/sign-in`);
  await caption(page, "Meanwhile the organiser watches entries live", 1800);
  await type(page, page.getByLabel("Email"), "owner@demo-garba.test");
  await type(page, page.getByLabel("Password"), PASSWORD);
  await click(page, page.getByRole("button", { name: "Sign in" }), 400);
  await page.waitForURL(/\/org\/demo-garba$/);
  await page.goto(`${BASE}/org/demo-garba/checkins`);
  await caption(page, "Check-ins: people in per night and per gate", 3000);
  await scroll(page, 300);
  await pause(page, 1500);
}

// ---------------------------------------------------------------------------------------------

const SCENARIOS: Record<string, { run: (b: Browser) => Promise<void> }> = {
  booking: {
    run: (b) =>
      record(b, "1-customer-booking", { viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: false }, bookingFlow),
  },
  organiser: {
    run: (b) => record(b, "2-organiser-login", { viewport: { width: 1280, height: 800 } }, organiserFlow),
  },
  scanning: {
    run: (b) => record(b, "3-ticket-checking", { viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: false }, scanningFlow, true),
  },
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [name, s] of Object.entries(SCENARIOS)) {
    if (wanted.length && !wanted.includes(name)) continue;
    await s.run(browser);
  }
  // The demo customer uses example.com: never try to email them.
  const orderIds = (await db.collection("orders").find({ "customer.email": CUSTOMER.email }, { projection: { _id: 1 } }).toArray()).map((o) => String(o._id));
  await db.collection("jobs").updateMany(
    { "data.orderId": { $in: orderIds }, status: { $in: ["pending", "running"] } },
    { $set: { status: "failed", lastError: "skipped: demo video customer (example.com)" } },
  );
} finally {
  await browser.close();
  await mongo.close();
}
