/**
 * Screen recording with Playwright: drives the script against the demo
 * instance, shows a cursor overlay (headless has none), moves the mouse with
 * eased motion and human pauses, records per-scene timestamps and click
 * positions so the assembly can zoom in.
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { VideoAction, VideoDevice, VideoScript } from "../../../shared/schemas.js";
import { USER_AGENT, sleep } from "../../providers/html.js";

export interface RecordedClick { tMs: number; x: number; y: number }
export interface RecordedScene { id: string; startMs: number; endMs: number; clicks: RecordedClick[]; error: string | null }
export interface Recording { file: string; device: VideoDevice; width: number; height: number; viewportWidth: number; viewportHeight: number; scenes: RecordedScene[]; durationMs: number; warnings: string[] }
export interface RecordOptions {
  device: VideoDevice; outDir: string; baseUrl: string | null;
  login?: { user: string; password: string } | undefined; resetUrl?: string | undefined;
  log: (m: string) => void;
}
export type Recorder = (script: VideoScript, opts: RecordOptions) => Promise<Recording>;

export const DEVICES: Record<VideoDevice, { viewport: { width: number; height: number }; scale: number; video: { width: number; height: number }; mobile: boolean }> = {
  mobile: { viewport: { width: 390, height: 844 }, scale: 3, video: { width: 1170, height: 2532 }, mobile: true },
  desktop: { viewport: { width: 1440, height: 900 }, scale: 1, video: { width: 1440, height: 900 }, mobile: false },
};

export const isSelector = (target: string): boolean => /^[#.[]|^[a-z]+[#.[:]|[>~+]|^\/\//.test(target.trim());
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export function substitute(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}
export function resolveUrl(url: string, base: string | null): string {
  try { return new URL(url, base ?? undefined).toString(); } catch { return url; }
}

/** Cursor + click ripple injected into every page (headless Chromium draws no pointer). */
export const CURSOR_SCRIPT = `(() => {
  const mk = () => {
    if (document.getElementById("mp-cursor")) return;
    const c = document.createElement("div"); c.id = "mp-cursor";
    c.innerHTML = '<svg width="28" height="34" viewBox="0 0 28 34"><path d="M2 2 L2 27 L8.5 21 L13 31 L18 29 L13.5 19.5 L22 19 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0px", top: "0px", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-2px,-2px)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))", transition: "none" });
    (document.body || document.documentElement).appendChild(c);
  };
  const move = (e) => { mk(); const c = document.getElementById("mp-cursor"); if (c) { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; } };
  const ripple = (e) => { mk(); const r = document.createElement("div"); Object.assign(r.style, { position: "fixed", left: (e.clientX - 18) + "px", top: (e.clientY - 18) + "px", width: "36px", height: "36px", borderRadius: "50%", border: "3px solid rgba(20,20,20,.55)", zIndex: "2147483646", pointerEvents: "none", animation: "mp-ripple .45s ease-out forwards" }); document.body.appendChild(r); setTimeout(() => r.remove(), 500); };
  const style = document.createElement("style"); style.textContent = "@keyframes mp-ripple{from{transform:scale(.4);opacity:.9}to{transform:scale(1.6);opacity:0}}";
  document.addEventListener("DOMContentLoaded", () => { document.head.appendChild(style); mk(); });
  document.addEventListener("mousemove", move, true); document.addEventListener("mousedown", ripple, true);
})();`;



async function findTarget(page: Page, target: string): Promise<Locator | null> {
  const candidates: Locator[] = [];
  if (isSelector(target)) candidates.push(page.locator(target).first());
  else {
    const re = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    candidates.push(page.getByRole("button", { name: re }).first(), page.getByRole("link", { name: re }).first(), page.getByPlaceholder(re).first(), page.getByLabel(re).first(), page.getByText(re).first(), page.locator(`[aria-label*="${target}" i], [title*="${target}" i]`).first());
  }
  for (const c of candidates) {
    try { if (await c.count() > 0 && await c.isVisible({ timeout: 800 })) return c; } catch { /* next */ }
  }
  return null;
}

async function glide(page: Page, cur: { x: number; y: number }, to: { x: number; y: number }, ms = 650): Promise<void> {
  const steps = Math.max(12, Math.round(ms / 25));
  for (let i = 1; i <= steps; i++) {
    const k = easeInOutCubic(i / steps);
    await page.mouse.move(cur.x + (to.x - cur.x) * k, cur.y + (to.y - cur.y) * k);
    await sleep(ms / steps);
  }
  cur.x = to.x; cur.y = to.y;
}

export const playwrightRecorder: Recorder = async (script, opts) => {
  const { chromium } = await import("playwright");
  const dev = DEVICES[opts.device];
  const warnings: string[] = [];
  fs.mkdirSync(opts.outDir, { recursive: true });
  const vars = { DEMO_USER: opts.login?.user, DEMO_PASSWORD: opts.login?.password, BASE_URL: opts.baseUrl ?? "" };
  if (opts.resetUrl) {
    try { await fetch(opts.resetUrl, { method: "POST", signal: AbortSignal.timeout(20_000) }); opts.log("demo reset ok"); }
    catch (e) { warnings.push(`Reset-Endpoint: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const browser = await chromium.launch({ headless: true });
  try {
    let storageState: string | undefined;
    if (opts.login && opts.baseUrl) {
      // Log in outside the recorded context so the credentials never appear on video.
      const lctx = await browser.newContext({ userAgent: USER_AGENT, viewport: dev.viewport, deviceScaleFactor: dev.scale, isMobile: dev.mobile, hasTouch: dev.mobile });
      const lp = await lctx.newPage();
      let ok = false;
      for (const p of ["", "/login", "/anmelden", "/signin", "/auth/login"]) {
        try {
          await lp.goto(resolveUrl(p || "/", opts.baseUrl), { waitUntil: "domcontentloaded", timeout: 20_000 });
          const pw = lp.locator('input[type="password"]').first();
          if (!(await pw.count())) continue;
          const user = lp.locator('input[type="email"], input[name*="mail" i], input[name*="user" i], input[autocomplete="username"]').first();
          if (await user.count()) await user.fill(opts.login.user);
          await pw.fill(opts.login.password);
          await pw.press("Enter");
          await lp.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
          ok = !(await lp.locator('input[type="password"]').count());
          if (ok) break;
        } catch { /* try next path */ }
      }
      if (!ok) warnings.push("Login fehlgeschlagen - Aufnahme läuft ohne Anmeldung");
      storageState = path.join(opts.outDir, "state.json");
      await lctx.storageState({ path: storageState });
      await lctx.close();
    }
    const context = await browser.newContext({
      userAgent: USER_AGENT, viewport: dev.viewport, deviceScaleFactor: dev.scale, isMobile: dev.mobile, hasTouch: dev.mobile, locale: "de-DE",
      recordVideo: { dir: opts.outDir, size: dev.video }, ...(storageState ? { storageState } : {}),
    });
    await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    await sleep(400);
    const t0 = Date.now();
    const cur = { x: Math.round(dev.viewport.width * 0.6), y: Math.round(dev.viewport.height * 0.55) };
    await page.mouse.move(cur.x, cur.y);
    const scenes: RecordedScene[] = [];
    for (const scene of script.scenes) {
      const rec: RecordedScene = { id: scene.id, startMs: Date.now() - t0, endMs: 0, clicks: [], error: null };
      opts.log(`record ${opts.device} ${scene.id}`);
      for (const raw of scene.actions) {
        const a: VideoAction = { ...raw, url: raw.url ? substitute(raw.url, vars) : undefined, text: raw.text ? substitute(raw.text, vars) : undefined, target: raw.target ? substitute(raw.target, vars) : undefined } as VideoAction;
        try {
          switch (a.type) {
            case "goto": {
              await page.goto(resolveUrl(a.url ?? "/", opts.baseUrl), { waitUntil: "domcontentloaded", timeout: 25_000 });
              await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
              await sleep(500); break;
            }
            case "click": case "hover": case "type": {
              const loc = a.target ? await findTarget(page, a.target) : null;
              if (!loc) throw new Error(`Ziel nicht gefunden: ${a.target ?? "(leer)"}`);
              await loc.scrollIntoViewIfNeeded().catch(() => undefined);
              const box = await loc.boundingBox();
              if (!box) throw new Error(`Ziel unsichtbar: ${a.target}`);
              const to = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 24) };
              await glide(page, cur, to);
              await sleep(180);
              if (a.type === "hover") { await sleep(600); break; }
              rec.clicks.push({ tMs: Date.now() - t0, x: to.x, y: to.y });
              await page.mouse.down(); await sleep(70); await page.mouse.up();
              if (a.type === "type") { await sleep(250); await page.keyboard.type(a.text ?? "", { delay: 55 }); }
              await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
              await sleep(400); break;
            }
            case "scroll": {
              const total = a.y ?? 600; const chunks = 8;
              for (let i = 0; i < chunks; i++) { await page.mouse.wheel(0, total / chunks); await sleep(70); }
              await sleep(500); break;
            }
            case "wait": await sleep(a.ms ?? 1000); break;
            case "press": await page.keyboard.press(a.text ?? "Enter"); await sleep(400); break;
          }
        } catch (e) {
          rec.error = (rec.error ? rec.error + " | " : "") + (e instanceof Error ? e.message.split("\n")[0] : String(e));
          warnings.push(`${scene.id}: ${rec.error}`);
        }
      }
      const elapsed = Date.now() - t0 - rec.startMs;
      if (elapsed < scene.durationMs) await sleep(scene.durationMs - elapsed);
      rec.endMs = Date.now() - t0;
      scenes.push(rec);
    }
    await sleep(600);
    const durationMs = Date.now() - t0;
    const video = page.video();
    await context.close();
    const tmp = video ? await video.path() : null;
    if (!tmp) throw new Error("Playwright hat keine Videodatei geliefert.");
    const file = path.join(opts.outDir, `recording-${opts.device}.webm`);
    fs.renameSync(tmp, file);
    return { file, device: opts.device, width: dev.video.width, height: dev.video.height, viewportWidth: dev.viewport.width, viewportHeight: dev.viewport.height, scenes, durationMs, warnings };
  } finally {
    await browser.close();
  }
};
