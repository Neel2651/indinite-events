import type { BrowserContext, Locator, Page } from "playwright";

/** A visible cursor + caption bar, injected into every page (Playwright videos don't show the mouse). */
/**
 * A visible cursor + caption bar, injected into every page (Playwright videos don't show the mouse).
 * Passed as a string: tsx rewrites functions with a `__name` helper that doesn't exist in the page.
 */
const OVERLAY_SCRIPT = `(() => {
  const root = () => document.documentElement;
  const pos = { x: -100, y: -100 };
  const install = () => {
    if (!document.documentElement || !document.body) return;
    if (!document.getElementById("__demo_style")) {
      const style = document.createElement("style");
      style.id = "__demo_style";
      style.textContent = [
        "nextjs-portal{display:none!important}",
        "#__demo_cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(235,94,40,.35);border:2px solid #eb5e28;pointer-events:none;transition:transform 120ms ease}",
        "#__demo_caption{position:fixed;z-index:2147483646;left:50%;bottom:18px;transform:translateX(-50%);width:max-content;max-width:min(92vw,760px);padding:10px 18px;border-radius:18px;background:rgba(10,14,31,.93);color:#fff;font:600 15px/1.35 Inter,system-ui,sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;opacity:0;transition:opacity 200ms ease}",
      ].join("");
      root().appendChild(style);
    }
    if (!document.getElementById("__demo_cursor")) {
      const c = document.createElement("div");
      c.id = "__demo_cursor";
      c.style.left = pos.x + "px";
      c.style.top = pos.y + "px";
      root().appendChild(c);
    }
    if (!document.getElementById("__demo_caption")) {
      const bar = document.createElement("div");
      bar.id = "__demo_caption";
      let saved = null;
      let top = false;
      try { saved = sessionStorage.getItem("__demo_caption"); top = sessionStorage.getItem("__demo_caption_top") === "1"; } catch {}
      if (top) { bar.style.top = "76px"; bar.style.bottom = "auto"; }
      if (saved) { bar.textContent = saved; bar.style.opacity = "1"; }
      root().appendChild(bar);
    }
  };
  document.addEventListener("mousemove", (e) => {
    pos.x = e.clientX; pos.y = e.clientY;
    const c = document.getElementById("__demo_cursor");
    if (c) { c.style.left = pos.x + "px"; c.style.top = pos.y + "px"; }
  }, true);
  document.addEventListener("mousedown", () => { const c = document.getElementById("__demo_cursor"); if (c) c.style.transform = "scale(0.7)"; }, true);
  document.addEventListener("mouseup", () => { const c = document.getElementById("__demo_cursor"); if (c) c.style.transform = "scale(1)"; }, true);
  // React hydration can drop foreign nodes, so re-install whenever they go missing.
  setInterval(install, 100);
  document.addEventListener("DOMContentLoaded", install);
})();`;

export async function installOverlay(context: BrowserContext) {
  await context.addInitScript({ content: OVERLAY_SCRIPT });
}

export async function caption(page: Page, text: string, holdMs = 1600) {
  await page.evaluate(`(() => {
    const t = ${JSON.stringify(text)};
    try { sessionStorage.setItem("__demo_caption", t); } catch {}
    const bar = document.getElementById("__demo_caption");
    if (bar) { bar.textContent = t; bar.style.opacity = "1"; }
  })()`);
  await page.waitForTimeout(holdMs);
}

export const pause = (page: Page, ms = 900) => page.waitForTimeout(ms);

/** Glide the visible cursor to an element, then click it. */
export async function click(page: Page, target: Locator, after = 700) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await pause(page, 250);
  await target.click();
  await pause(page, after);
}

/** Click into a field and type at human speed. */
export async function type(page: Page, target: Locator, text: string) {
  await click(page, target, 150);
  await target.pressSequentially(text, { delay: 55 });
  await pause(page, 350);
}

/** Smooth scroll so viewers can follow. */
export async function scroll(page: Page, dy: number, ms = 900) {
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await page.waitForTimeout(ms / steps);
  }
  await pause(page, 400);
}

export async function scrollTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate("el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })");
  await pause(page, 900);
}

/** Show captions at the top of the screen (when the bottom has important UI). */
export async function captionsAtTop(page: Page) {
  await page.evaluate(`(() => {
    try { sessionStorage.setItem("__demo_caption_top", "1"); } catch {}
    const bar = document.getElementById("__demo_caption");
    if (bar) { bar.style.top = "76px"; bar.style.bottom = "auto"; }
  })()`);
}
