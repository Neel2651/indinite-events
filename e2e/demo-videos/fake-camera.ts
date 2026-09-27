import type { BrowserContext, Page } from "playwright";

/**
 * Replaces the phone camera with a canvas stream we control, so the scanner decodes real QR codes
 * on cue in the recording. Passed as a string (tsx rewrites functions with helpers the page lacks).
 */
const FAKE_CAMERA = `(() => {
  const W = 720, H = 960;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  let card = null; // { img, title, sub }
  const draw = () => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2b2a33"); g.addColorStop(1, "#141319");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // A little camera noise so it reads as a live feed.
    for (let i = 0; i < 220; i++) { ctx.fillStyle = "rgba(255,255,255," + (Math.random() * 0.05) + ")"; ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    if (card && card.img.complete) {
      const cw = 440, ch = 560, x = (W - cw) / 2, y = (H - ch) / 2 + Math.sin(Date.now() / 400) * 4;
      ctx.fillStyle = "#0a0e1f"; roundRect(x, y, cw, ch, 28); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "600 26px Inter, Arial"; ctx.textAlign = "center";
      ctx.fillText(card.title, W / 2, y + 52);
      ctx.fillStyle = "#aab1cc"; ctx.font = "20px Inter, Arial"; ctx.fillText(card.sub, W / 2, y + 84);
      ctx.fillStyle = "#fff"; roundRect(x + 50, y + 110, cw - 100, cw - 100, 18); ctx.fill();
      ctx.drawImage(card.img, x + 70, y + 130, cw - 140, cw - 140);
      ctx.fillStyle = "#aab1cc"; ctx.font = "18px Inter, Arial"; ctx.fillText(card.code || "", W / 2, y + ch - 22);
    }
    requestAnimationFrame(draw);
  };
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  draw();
  window.__fakeCam = {
    show(src, title, sub, code) { const img = new Image(); img.src = src; card = { img, title, sub, code }; },
    clear() { card = null; },
  };
  const md = navigator.mediaDevices || (navigator.mediaDevices = {});
  md.getUserMedia = async () => canvas.captureStream(30);
  md.enumerateDevices = async () => [{ kind: "videoinput", deviceId: "fake-back", label: "Back camera", groupId: "g" }];
})();`;

export async function installFakeCamera(context: BrowserContext) {
  await context.addInitScript({ content: FAKE_CAMERA });
}

export async function showPass(page: Page, pngDataUrl: string, title: string, sub: string, code = "") {
  await page.evaluate(`window.__fakeCam.show(${JSON.stringify(pngDataUrl)}, ${JSON.stringify(title)}, ${JSON.stringify(sub)}, ${JSON.stringify(code)})`);
}

export async function clearCamera(page: Page) {
  await page.evaluate("window.__fakeCam.clear()");
}
