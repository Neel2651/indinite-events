/**
 * Check this server's settings (.env.local) before going live or after changing them. Never prints a secret:
 * only whether each value is present, looks right and works.
 *
 *   pnpm check:env              # formats + live checks (database, Stripe, Resend), all read-only
 *   pnpm check:env -- --offline # formats only, no network calls
 *
 * Exits with 1 if anything must be fixed (✗). Warnings (!) are worth a look but don't stop the app.
 */
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import Stripe from "stripe";
import { isStaging, resolvePaymentsMode, signTicket, verifyTicketToken } from "@indinite/core";
import { mediaDir } from "../src/media";

const env = process.env;
const offline = process.argv.includes("--offline");
const production = env.NODE_ENV === "production";
const staging = isStaging(env);
const live = production && !staging;

let failures = 0;
let warnings = 0;
const ok = (name: string, note: string) => console.log(`  ✓ ${name.padEnd(36)} ${note}`);
const warn = (name: string, note: string) => {
  warnings++;
  console.log(`  ! ${name.padEnd(36)} ${note}`);
};
const fail = (name: string, note: string) => {
  failures++;
  console.log(`  ✗ ${name.padEnd(36)} ${note}`);
};
const section = (title: string) => console.log(`\n${title}`);
const val = (name: string) => env[name]?.trim() ?? "";
/** Placeholders from the example files ("sk_test_", "whsec_", "re_") count as not set. */
const set = (name: string, prefix = "") => val(name).length > prefix.length + 4;
const mode = (key: string) => (key.includes("_live_") ? "live" : key.includes("_test_") ? "test" : "unknown");

console.log(`Indinite Events settings check · ${live ? "LIVE server" : staging ? "staging / demo server" : "development"}${offline ? " · offline (formats only)" : ""}`);

// ── App ──────────────────────────────────────────────────────────────────────────────────────────────────
section("App");
const appUrl = val("APP_URL");
try {
  const u = new URL(appUrl);
  if (production && u.protocol !== "https:") fail("APP_URL", "must be https:// on a server (staff sign-in and the camera need it)");
  else if (appUrl.endsWith("/")) fail("APP_URL", "remove the trailing slash");
  else ok("APP_URL", u.origin);
} catch {
  fail("APP_URL", "missing or not a full address (e.g. https://events.indinite.co.uk)");
}
if (!val("BETTER_AUTH_URL")) fail("BETTER_AUTH_URL", "missing (set it to the same value as APP_URL)");
else if (val("BETTER_AUTH_URL") !== appUrl) fail("BETTER_AUTH_URL", "must be exactly the same as APP_URL, or staff sign-in fails (\"Invalid origin\")");
else ok("BETTER_AUTH_URL", "matches APP_URL");
ok("NODE_ENV", env.NODE_ENV ?? "(unset: development)");
if (staging) ok("DEPLOY_ENV", "staging: demo payments and the demo seeds are allowed");
else if (val("DEPLOY_ENV")) warn("DEPLOY_ENV", `"${val("DEPLOY_ENV")}" isn't recognised; only "staging" means anything`);
else ok("DEPLOY_ENV", production ? "unset: live server (demo seeds refused)" : "unset");
try {
  const payments = resolvePaymentsMode(env);
  ok("PAYMENTS_MODE", payments === "demo" ? "demo (orders approved without payment)" : "stripe (real card payments)");
} catch (e) {
  fail("PAYMENTS_MODE", e instanceof Error ? e.message : "invalid");
}

// ── Secrets ──────────────────────────────────────────────────────────────────────────────────────────────
section("Secrets");
const secret = (name: string, min: number, how: string) => {
  const v = val(name);
  if (!v) fail(name, `missing. Generate one: ${how}`);
  else if (v.length < min) fail(name, `too short (${v.length} characters, needs ${min}+). Generate one: ${how}`);
  else if (/change|example|secret|xxx|placeholder/i.test(v)) warn(name, `looks like a placeholder (${v.length} characters); generate a random one: ${how}`);
  else ok(name, `set (${v.length} characters)`);
};
secret("BETTER_AUTH_SECRET", 32, "openssl rand -base64 32");
secret("LINK_SIGNING_SECRET", 32, "openssl rand -base64 48");
if (val("BETTER_AUTH_SECRET") && val("BETTER_AUTH_SECRET") === val("LINK_SIGNING_SECRET")) warn("LINK_SIGNING_SECRET", "is the same as BETTER_AUTH_SECRET; use a different one");

const priv = val("QR_SIGNING_PRIVATE_KEY");
const pub = val("NEXT_PUBLIC_QR_PUBLIC_KEY");
const hex64 = /^[0-9a-f]{64}$/i;
if (!hex64.test(priv)) fail("QR_SIGNING_PRIVATE_KEY", "missing or not 64 hex characters (pnpm --filter @indinite/core gen:qr-keys)");
if (!hex64.test(pub)) fail("NEXT_PUBLIC_QR_PUBLIC_KEY", "missing or not 64 hex characters (pnpm --filter @indinite/core gen:qr-keys)");
if (hex64.test(priv) && hex64.test(pub)) {
  // Sign a made-up pass and check the public key accepts it: proves the two keys are a pair.
  const token = signTicket("000000000000000000000000", priv);
  if (verifyTicketToken(token, pub).ok) ok("QR keys", "private and public keys are a pair (passes will scan)");
  else fail("QR keys", "the public key doesn't match the private key: passes would be rejected at the gate. Generate both again together.");
}

// ── Database ─────────────────────────────────────────────────────────────────────────────────────────────
section("Database");
const mongoUri = val("MONGODB_URI");
if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) fail("MONGODB_URI", "missing or not a mongodb:// / mongodb+srv:// address");
else if (mongoUri.includes("USER:PASS")) fail("MONGODB_URI", "still the example value");
else if (offline) ok("MONGODB_URI", "set (not checked: --offline)");
else {
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
    const db = mongoose.connection.db!;
    const hello = await db.admin().command({ hello: 1 });
    const collections = (await db.listCollections().toArray()).length;
    const admins = await db.collection("user").countDocuments({ isSuperAdmin: true });
    ok("MONGODB_URI", `connected to "${db.databaseName}"${hello.setName ? ` (replica set ${hello.setName})` : ""}, ${collections} collections`);
    if (!hello.setName && !hello.msg) fail("MongoDB replica set", "not a replica set: bookings need transactions (Atlas always is one)");
    if (collections === 0) warn("Collections", "empty database: run pnpm setup:production <admin email>");
    if (admins === 0) warn("Super admin", "no super admin yet: run pnpm setup:production <admin email>");
    else ok("Super admin", `${admins} account${admins === 1 ? "" : "s"}`);
  } catch (e) {
    fail("MONGODB_URI", `can't connect: ${e instanceof Error ? e.message.replace(/mongodb(\+srv)?:\/\/[^\s]+/g, "[address]") : "error"}`);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

// ── Stripe ───────────────────────────────────────────────────────────────────────────────────────────────
section("Stripe");
const payments = (() => {
  try {
    return resolvePaymentsMode(env);
  } catch {
    return null;
  }
})();
const sk = val("STRIPE_SECRET_KEY");
const needStripe = payments === "stripe";
const need = (name: string, note: string) => (needStripe ? fail(name, note) : warn(name, `${note} (only needed for card payments)`));
if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}/.test(sk)) need("STRIPE_SECRET_KEY", "missing or placeholder (Stripe → Developers → API keys, starts sk_test_ or sk_live_)");
else {
  const m = mode(sk);
  if (live && m === "test") warn("STRIPE_SECRET_KEY", "test key on the live server: no real payments will be taken");
  else if (!production && m === "live") warn("STRIPE_SECRET_KEY", "live key on a development machine: use test keys here");
  if (offline) ok("STRIPE_SECRET_KEY", `${m} key (not checked: --offline)`);
  else {
    try {
      const account = await new Stripe(sk).accounts.retrieveCurrent();
      const name = account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id;
      ok("STRIPE_SECRET_KEY", `${m} key works: platform account "${name}" (${account.country ?? "?"})`);
      if (!/indinite/i.test(String(name))) warn("Stripe platform name", `organisers and customers see "${name}" on Stripe pages. Rename it (Settings → Business → Public details) or use Indinite's own Stripe account.`);
      if (account.country && account.country !== "GB") warn("Stripe platform country", `${account.country}: Indinite's platform account should be a UK account`);
    } catch (e) {
      fail("STRIPE_SECRET_KEY", `Stripe refused it: ${e instanceof Error ? e.message.replace(/\b(sk|rk)_(test|live)_[A-Za-z0-9*]+/g, "[key]") : "error"}`);
    }
  }
}
const whsec = (name: string, required: boolean, note: string) => {
  if (!set(name, "whsec_") || !val(name).startsWith("whsec_")) (required ? need : warn)(name, `missing or placeholder (${note})`);
  else ok(name, "set");
};
whsec("STRIPE_WEBHOOK_SECRET", true, "Developers → Webhooks → your endpoint → Signing secret");
const pk = val("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
if (/^pk_(test|live)_[A-Za-z0-9]{10,}/.test(pk)) {
  if (sk && mode(pk) !== mode(sk)) fail("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", `${mode(pk)} key, but the secret key is ${mode(sk)}: use keys from the same mode`);
  else ok("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", `${mode(pk)} key`);
} else warn("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "missing or placeholder (not used yet; fine to leave)");
const ca = val("STRIPE_CONNECT_CLIENT_ID");
if (/^ca_[A-Za-z0-9]{10,}/.test(ca)) {
  ok("STRIPE_CONNECT_CLIENT_ID", `set: "Connect your existing Stripe account" is on (redirect URI to register: ${appUrl}/api/stripe/connect/callback)`);
  whsec("STRIPE_CONNECT_WEBHOOK_SECRET", true, "second webhook endpoint for \"Connected accounts\"");
} else {
  warn("STRIPE_CONNECT_CLIENT_ID", "not set: organisers can't connect an existing Stripe account (optional)");
  whsec("STRIPE_CONNECT_WEBHOOK_SECRET", false, "needed for Express account updates and existing accounts; a second webhook endpoint for \"Connected accounts\"");
}

// ── Email ────────────────────────────────────────────────────────────────────────────────────────────────
section("Email (Resend)");
const resendKey = val("RESEND_API_KEY");
const from = val("EMAIL_FROM");
const fromDomain = from.match(/<?[^\s<>@]+@([^\s<>]+)>?\s*$/)?.[1]?.toLowerCase();
if (!fromDomain) fail("EMAIL_FROM", 'missing or not like "Indinite Events <tickets@example.com>"');
else ok("EMAIL_FROM", `sends from @${fromDomain}`);
if (!/^re_[A-Za-z0-9_]{10,}/.test(resendKey)) fail("RESEND_API_KEY", "missing or placeholder (resend.com → API keys): no emails will be sent");
else if (offline || !fromDomain) ok("RESEND_API_KEY", "set (not checked: --offline)");
else {
  try {
    const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${resendKey}` }, signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 403) {
      // Sending-only keys can't list domains: the key may still be fine.
      warn("RESEND_API_KEY", "can't list domains with this key (a sending-only key is fine); check the domain is verified at resend.com/domains");
    } else if (!res.ok) fail("RESEND_API_KEY", `Resend answered ${res.status}`);
    else {
      const { data } = (await res.json()) as { data: { name: string; status: string }[] };
      const domain = data.find((d) => d.name.toLowerCase() === fromDomain);
      ok("RESEND_API_KEY", "works");
      if (!domain) fail("Sending domain", `${fromDomain} isn't in this Resend account: add and verify it, or change EMAIL_FROM`);
      else if (domain.status !== "verified") fail("Sending domain", `${fromDomain} is "${domain.status}" in Resend: emails will fail until it's verified`);
      else ok("Sending domain", `${fromDomain} verified`);
    }
  } catch (e) {
    fail("RESEND_API_KEY", `couldn't reach Resend: ${e instanceof Error ? e.message : "error"}`);
  }
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────────────
section("Files");
const media = val("MEDIA_DIR");
if (!media) (production ? fail : warn)("MEDIA_DIR", "missing (where uploaded event images are stored); defaults to ./storage/media in the project");
{
  // Resolved exactly as the app does.
  const dir = mediaDir();
  const projectRoot = path.resolve(mediaDir("./"));
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.check-env-${process.pid}`);
    await writeFile(probe, "ok");
    await access(probe);
    await rm(probe);
    ok("MEDIA_DIR", `${dir} (writable)`);
    if (production && dir.startsWith(projectRoot + path.sep)) warn("MEDIA_DIR", "is inside the project folder: keep it outside so deploys never touch uploads");
  } catch (e) {
    fail("MEDIA_DIR", `${dir} isn't writable: ${e instanceof Error ? e.message : "error"}`);
  }
}

// ── Policies and leftovers ───────────────────────────────────────────────────────────────────────────────
section("Policies and test settings");
for (const name of ["LEGAL_ENTITY_NAME", "LEGAL_ICO_NUMBER"]) {
  if (val(name)) ok(name, "set");
  else (live ? warn : ok)(name, live ? "not set: the policies show a [placeholder]" : "not set (placeholder shown; fine before launch)");
}
ok("LEGAL_SUPPORT_EMAIL", val("LEGAL_SUPPORT_EMAIL") || "contact@indinite.co.uk (default)");
if (live && val("LOAD_TEST_CHECKOUT_LIMIT")) warn("LOAD_TEST_CHECKOUT_LIMIT", "set on the live server: remove it (it's ignored with real payments, but shouldn't be here)");
if (live && val("SEED_PASSWORD")) warn("SEED_PASSWORD", "set on the live server: not needed there, remove it");
if (live && val("ADMIN_PASSWORD")) warn("ADMIN_PASSWORD", "is in the settings: pass it only for the setup command, then remove it");

console.log(`\n${failures ? `✗ ${failures} to fix` : "✓ Nothing to fix"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.`);
process.exit(failures ? 1 : 0);
