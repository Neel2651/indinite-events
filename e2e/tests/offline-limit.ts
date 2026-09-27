/**
 * E2E: the scanner stops after 5 offline scans and resumes once back online and synced.
 *   pnpm --filter @indinite/e2e test:offline-limit   (dev server on :3001, seeded data)
 */
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { MongoClient } from "mongodb";
import { chromium } from "playwright";
import { installFakeCamera, showPass, clearCamera } from "../demo-videos/fake-camera";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3001";
const PASSWORD = process.env.SEED_PASSWORD || "IndiniteDemo2026!";
const mongo = new MongoClient(process.env.MONGODB_URI!);
const db = mongo.db();

const london = await db.collection("events").findOne({ slug: "navratri-2026-london" });
const night1 = london!.sessions[0]._id;
const tickets = await db.collection("tickets").find({ eventId: london!._id, status: "valid", validSessionIds: night1 }).limit(6).toArray();
assert.equal(tickets.length, 6, "need 6 valid Night 1 passes in the dev data");
await db.collection("scans").deleteMany({ eventId: london!._id, sessionId: night1 });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
await installFakeCamera(context);
const page = await context.newPage();
try {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill("scanner@demo-garba.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/scan$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Start scanning" }).click();
  await page.getByText("Point the camera at a pass").waitFor({ timeout: 30_000 });

  await context.setOffline(true);
  await page.getByText("5 of 5 offline scans left").waitFor();

  for (let i = 0; i < 6; i++) {
    await showPass(page, await QRCode.toDataURL(tickets[i]!.qrToken, { margin: 1, width: 600 }), tickets[i]!.ticketTypeName, `Pass ${i + 1}`);
    if (i < 5) {
      await page.getByText("Admitted", { exact: true }).waitFor({ timeout: 15_000 });
      await clearCamera(page);
      await page.getByText("Admitted", { exact: true }).waitFor({ state: "detached", timeout: 10_000 });
      await page.getByText(`${4 - i} of 5 offline scans left`).waitFor();
      console.log(`✓ offline scan ${i + 1} admitted, ${4 - i} left`);
    } else {
      await page.getByText("Reconnect to keep scanning").waitFor({ timeout: 15_000 });
      await clearCamera(page);
      console.log("✓ 6th offline scan blocked");
    }
  }
  const beforeSync = await db.collection("scans").countDocuments({ eventId: london!._id, sessionId: night1 });
  assert.equal(beforeSync, 0, "nothing reaches the server while offline");

  await context.setOffline(false);
  await page.getByText("Reconnect to keep scanning").waitFor({ state: "detached", timeout: 30_000 });
  console.log("✓ resumed automatically once back online");
  const admitted = await db.collection("scans").countDocuments({ eventId: london!._id, sessionId: night1, result: "admitted" });
  assert.equal(admitted, 5, "the 5 offline admissions synced; the blocked 6th was never recorded");
  const sixth = await db.collection("scans").countDocuments({ ticketId: tickets[5]!._id });
  assert.equal(sixth, 0);
  console.log("✓ server has exactly 5 admissions, none for the blocked pass");
} finally {
  await db.collection("scans").deleteMany({ eventId: london!._id, sessionId: night1 });
  await browser.close();
  await mongo.close();
}
