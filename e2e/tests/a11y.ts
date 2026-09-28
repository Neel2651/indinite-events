/**
 * Accessibility check (SPEC §7: WCAG AA on public pages and the ticket view), using axe-core.
 *   pnpm --filter @indinite/e2e test:a11y            (dev server running, seeded data)
 *   A11Y_BASE_URL=http://localhost:3002 pnpm --filter @indinite/e2e test:a11y
 * Fails on any "serious" or "critical" WCAG 2.1 A/AA violation. Minor ones are listed but don't fail.
 */
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "playwright";

const BASE = process.env.A11Y_BASE_URL ?? process.env.DEMO_BASE_URL ?? "http://localhost:3001";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

async function check(p: Page, label: string) {
  const res = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = res.violations.length - bad.length;
  console.log(`${bad.length ? "✗" : "✓"} ${label}${minor ? ` (${minor} minor)` : ""}`);
  for (const v of res.violations) {
    console.log(`    [${v.impact}] ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`       ${n.target.join(" ")}`);
  }
  return bad.length;
}

let failures = 0;
try {
  const pages = ["/", "/orders/lookup", "/privacy", "/booking-terms", "/refund-policy", "/sign-in"];
  await page.goto(`${BASE}/`);
  const eventHref = await page.locator('a[href^="/e/"]').first().getAttribute("href");
  if (eventHref) pages.splice(1, 0, eventHref);
  for (const path of pages) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    failures += await check(page, path);
  }
  // Mobile width too: most customers book on their phone.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", eventHref ?? "/"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    failures += await check(page, `${path} (mobile)`);
  }
} finally {
  await browser.close();
}
if (failures) {
  console.error(`\n${failures} serious or critical accessibility problem(s).`);
  process.exit(1);
}
console.log("\nNo serious or critical accessibility problems.");
