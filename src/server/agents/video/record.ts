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
import { dismissConsent } from "../analysis/crawl.js";

export interface RecordedClick { tMs: number; x: number; y: number }
export interface RecordedScene { id: string; startMs: number; endMs: number; clicks: RecordedClick[]; error: string | null; /** dead time (waitFor) - cut out in assembly */ idle?: { startMs: number; endMs: number }[]; /** still image after the scene's actions (for the scene check) - extracted from the recording by the pipeline */ shot?: string }
export interface Recording { file: string; device: VideoDevice; width: number; height: number; viewportWidth: number; viewportHeight: number; scenes: RecordedScene[]; durationMs: number; warnings: string[]; /** visible button/link/field labels seen during the recording (UI map for script authors) */ uiLabels?: string[] }
export interface RecordOptions {
  device: VideoDevice; outDir: string; baseUrl: string | null;
  login?: { user: string; password: string } | undefined; resetUrl?: string | undefined; loginUrl?: string | undefined;
  log: (m: string) => void;
}
export type Recorder = (script: VideoScript, opts: RecordOptions) => Promise<Recording>;

/**
 * Playwright's recorder captures the window in *device* pixels only when
 * Chromium itself runs at that scale: with `--force-device-scale-factor=3` a
 * 390 px phone viewport records as a crisp 1170x2532 video and the page still
 * sees a 390 px layout (media queries, innerWidth). Plain deviceScaleFactor
 * emulation would leave the 390 px image in the corner of the frame.
 */
export const DEVICES: Record<VideoDevice, { viewport: { width: number; height: number }; dpr: number; video: { width: number; height: number }; mobile: boolean; cursor: number }> = {
  mobile: { viewport: { width: 390, height: 844 }, dpr: 3, video: { width: 1170, height: 2532 }, mobile: true, cursor: 0.75 },
  desktop: { viewport: { width: 1440, height: 900 }, dpr: 1, video: { width: 1440, height: 900 }, mobile: false, cursor: 1 },
};

export const isSelector = (target: string): boolean => /^[#.[]|^[a-z]+[#.[:]|[>~+]|^\/\//.test(target.trim());
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export function substitute(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}
export function resolveUrl(url: string, base: string | null): string {
  try { return new URL(url, base ?? undefined).toString(); } catch { return url; }
}

/** Cursor + click ripple injected into every page (headless Chromium draws no pointer). `__CURSOR__` = size factor per device. */
export const CURSOR_SCRIPT = `(() => {
  const CURSOR = __CURSOR__;
  const mk = () => {
    if (document.getElementById("mp-cursor")) return;
    const c = document.createElement("div"); c.id = "mp-cursor";
    c.innerHTML = '<svg width="28" height="34" viewBox="0 0 28 34"><path d="M2 2 L2 27 L8.5 21 L13 31 L18 29 L13.5 19.5 L22 19 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0px", top: "0px", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-2px,-2px) scale(" + CURSOR + ")", transformOrigin: "top left", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))", transition: "none" });
    (document.body || document.documentElement).appendChild(c);
  };
  const move = (e) => { mk(); const c = document.getElementById("mp-cursor"); if (c) { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; } };
  const ripple = (e) => { mk(); const r = document.createElement("div"); const d = Math.round(36 * CURSOR); Object.assign(r.style, { position: "fixed", left: (e.clientX - d / 2) + "px", top: (e.clientY - d / 2) + "px", width: d + "px", height: d + "px", borderRadius: "50%", border: "3px solid rgba(20,20,20,.55)", zIndex: "2147483646", pointerEvents: "none", animation: "mp-ripple .45s ease-out forwards" }); document.body.appendChild(r); setTimeout(() => r.remove(), 500); };
  const style = document.createElement("style"); style.textContent = "@keyframes mp-ripple{from{transform:scale(.4);opacity:.9}to{transform:scale(1.6);opacity:0}}";
  document.addEventListener("DOMContentLoaded", () => { document.head.appendChild(style); mk(); });
  document.addEventListener("mousemove", move, true); document.addEventListener("mousedown", ripple, true);
})();`;



const FIELD_XPATH = 'xpath=following::*[self::textarea or self::input[not(@type="hidden")] or @contenteditable="true"][1]';

async function findTarget(page: Page, target: string, kind: "click" | "type" = "click"): Promise<Locator | null> {
  const candidates: { loc: Locator; fieldBelow?: boolean }[] = [];
  const add = (...locs: Locator[]) => { for (const loc of locs) candidates.push({ loc }); };
  if (isSelector(target)) add(page.locator(target).first());
  else {
    const re = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (kind === "type") {
      // typing must land in a field: label/placeholder first, then the first field that follows the matching text
      // (many forms show the field name as plain text above the textarea, without a <label for>)
      add(page.getByLabel(re).first(), page.getByPlaceholder(re).first(), page.locator(`[aria-label*="${target}" i]`).first(), page.getByText(re).first().locator(FIELD_XPATH).first(), page.getByRole("textbox", { name: re }).first());
    }
    add(page.getByRole("button", { name: re }).first(), page.getByRole("link", { name: re }).first(), page.getByPlaceholder(re).first(), page.getByLabel(re).first(), page.locator(`[aria-label*="${target}" i], [title*="${target}" i]`).first());
    // plain text last - and when that text is a field caption (a field sits right below it), the field is what the author meant
    candidates.push({ loc: page.getByText(re).first(), fieldBelow: true });
  }
  for (const { loc, fieldBelow } of candidates) {
    try {
      if (!(await loc.count() > 0 && await loc.isVisible({ timeout: 800 }))) continue;
      if (fieldBelow) {
        const field = loc.locator(FIELD_XPATH).first();
        const [tb, fb] = await Promise.all([loc.boundingBox(), field.count().then((n) => (n ? field.boundingBox() : null))]);
        if (tb && fb && fb.y >= tb.y - 8 && fb.y - (tb.y + tb.height) < 140) return field;
      }
      return loc;
    } catch { /* next */ }
  }
  return null;
}

/** Visible interactive labels on the current page - "button: Material erstellen", "field: Thema / Auftrag". */
export async function collectUiLabels(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const out: string[] = [];
      const visible = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input, textarea, select, label').forEach((e) => {
        if (!visible(e)) return;
        const tag = e.tagName.toLowerCase();
        const isField = tag === "input" || tag === "textarea" || tag === "select";
        const text = isField ? ((e as HTMLInputElement).placeholder || e.getAttribute("aria-label") || "") : (e.textContent || "").trim().replace(/\s+/g, " ");
        if (text && text.length <= 60) out.push(`${isField ? "field" : tag === "a" ? "link" : tag === "label" ? "label" : "button"}: ${text}`);
      });
      return Array.from(new Set(out)).slice(0, 80);
    });
  } catch { return []; }
}

/** Field that currently has keyboard focus (after a click on a caption/field) - or null. */
async function focusedField(page: Page): Promise<Locator | null> {
  const loc = page.locator(":focus").first();
  try {
    if (!(await loc.count())) return null;
    const ok = await loc.evaluate((e) => ["TEXTAREA", "INPUT"].includes(e.tagName) || (e as HTMLElement).isContentEditable);
    return ok ? loc : null;
  } catch { return null; }
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
  const uiLabels = new Set<string>();
  fs.mkdirSync(opts.outDir, { recursive: true });
  const vars = { DEMO_USER: opts.login?.user, DEMO_PASSWORD: opts.login?.password, BASE_URL: opts.baseUrl ?? "" };
  if (opts.resetUrl) {
    try { await fetch(opts.resetUrl, { method: "POST", signal: AbortSignal.timeout(20_000) }); opts.log("demo reset ok"); }
    catch (e) { warnings.push(`Reset-Endpoint: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const browser = await chromium.launch({ headless: true, args: dev.dpr !== 1 ? [`--force-device-scale-factor=${dev.dpr}`] : [] });
  try {
    let storageState: string | undefined;
    if (opts.login && opts.baseUrl) {
      // Log in outside the recorded context so the credentials never appear on video.
      const lctx = await browser.newContext({ userAgent: USER_AGENT, viewport: dev.viewport, deviceScaleFactor: dev.dpr, isMobile: dev.mobile, hasTouch: dev.mobile });
      const lp = await lctx.newPage();
      let ok = false;
      const paths = [...(opts.loginUrl ? [opts.loginUrl] : []), "/", "/login", "/anmelden", "/start", "/signin", "/auth/login"];
      for (const p of paths) {
        try {
          await lp.goto(resolveUrl(p, opts.baseUrl), { waitUntil: "domcontentloaded", timeout: 20_000 });
          await lp.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
          await dismissConsent(lp);
          let pw = lp.locator('input[type="password"]:visible').first();
          if (!(await pw.count())) {
            // Login form hidden behind a button/link (modal or tab)? Reveal it first.
            const opener = lp.getByRole("button", { name: /anmelden|einloggen|login|log in|sign in/i }).or(lp.getByRole("link", { name: /anmelden|einloggen|login|log in|sign in/i })).first();
            if (await opener.count()) { await opener.click({ timeout: 3000 }).catch(() => undefined); await lp.waitForTimeout(600); }
            pw = lp.locator('input[type="password"]:visible').first();
          }
          if (!(await pw.count())) continue;
          const user = lp.locator('input[type="email"]:visible, input[name*="mail" i]:visible, input[name*="user" i]:visible, input[autocomplete="username"]:visible').first();
          if (await user.count()) await user.fill(opts.login.user);
          await pw.fill(opts.login.password);
          await pw.press("Enter");
          await lp.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
          await lp.waitForTimeout(1200);
          ok = !(await lp.locator('input[type="password"]:visible').count());
          if (ok) break;
        } catch { /* try next path */ }
      }
      if (!ok) warnings.push("Login fehlgeschlagen - Aufnahme läuft ohne Anmeldung");
      else {
        // First-run tours often appear only on the first app visit: burn that visit here, not on tape.
        try { await lp.goto(resolveUrl(opts.loginUrl ?? "/", opts.baseUrl), { waitUntil: "domcontentloaded", timeout: 20_000 }); await lp.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined); await lp.waitForTimeout(800); await dismissConsent(lp); await lp.waitForTimeout(400); await dismissConsent(lp); } catch { /* best effort */ }
      }
      storageState = path.join(opts.outDir, "state.json");
      await lctx.storageState({ path: storageState });
      await lctx.close();
    }
    const context = await browser.newContext({
      userAgent: USER_AGENT, viewport: dev.viewport, deviceScaleFactor: dev.dpr, isMobile: dev.mobile, hasTouch: dev.mobile, locale: "de-DE",
      recordVideo: { dir: opts.outDir, size: dev.video }, ...(storageState ? { storageState } : {}),
    });
    await context.addInitScript(CURSOR_SCRIPT.replace("__CURSOR__", String(dev.cursor)));
    const page = await context.newPage();
    await sleep(400);
    const t0 = Date.now();
    const cur = { x: Math.round(dev.viewport.width * 0.6), y: Math.round(dev.viewport.height * 0.55) };
    await page.mouse.move(cur.x, cur.y);
    const scenes: RecordedScene[] = [];
    for (const scene of script.scenes) {
      const rec: RecordedScene = { id: scene.id, startMs: Date.now() - t0, endMs: 0, clicks: [], error: null, idle: [] };
      opts.log(`record ${opts.device} ${scene.id}`);
      for (const raw of scene.actions) {
        const tA = Date.now();
        const a: VideoAction = { ...raw, url: raw.url ? substitute(raw.url, vars) : undefined, text: raw.text ? substitute(raw.text, vars) : undefined, target: raw.target ? substitute(raw.target, vars) : undefined } as VideoAction;
        try {
          switch (a.type) {
            case "goto": {
              await page.goto(resolveUrl(a.url ?? "/", opts.baseUrl), { waitUntil: "domcontentloaded", timeout: 25_000 });
              await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
              await sleep(600);
              await dismissConsent(page);
              await sleep(300); break;
            }
            case "click": case "hover": case "type": {
              let loc = a.target ? await findTarget(page, a.target, a.type === "type" ? "type" : "click") : null;
              if (!loc && a.type === "type" && !a.target) loc = await focusedField(page);   // "click caption, then type" - no target on the type step
              if (!loc && a.type === "type") {
                // the script author guessed a label/selector that does not exist - the first visible empty text field is the best bet
                const fallback = page.locator('textarea:visible, input[type="text"]:visible, input[type="search"]:visible, input:not([type]):visible, [contenteditable="true"]:visible').first();
                if (await fallback.count() > 0) { loc = fallback; warnings.push(`Szene ${scene.id}: ${a.target ? `Ziel „${a.target}“ nicht gefunden` : "type ohne Ziel und ohne fokussiertes Feld"} – erstes sichtbares Textfeld genutzt`); }
              }
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
              await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
              await sleep(400); break;
            }
            case "scroll": {
              // rAF-driven eased scroll of the scrollable container under the cursor (dialogs scroll inside themselves),
              // on the page's own frame clock - wheel ticks arrived as discrete steps and read as stutter at 25 fps
              const total = a.y ?? 600;
              await page.evaluate(({ x, y, dy, ms }) => new Promise<void>((resolve) => {
                const scrollable = (el: Element) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4; };
                let el: Element | null = document.elementFromPoint(x, y);
                while (el && el !== document.body && el !== document.documentElement && !scrollable(el)) el = el.parentElement;
                const target = el && el !== document.body && el !== document.documentElement && scrollable(el) ? el : (document.scrollingElement ?? document.documentElement);
                const from = target.scrollTop, to = Math.max(0, Math.min(target.scrollHeight - target.clientHeight, from + dy));
                const t0 = performance.now();
                const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
                const tick = (now: number) => { const k = Math.min(1, (now - t0) / ms); target.scrollTop = from + (to - from) * ease(k); if (k < 1) requestAnimationFrame(tick); else resolve(); };
                requestAnimationFrame(tick);
              }), { x: cur.x, y: cur.y, dy: total, ms: Math.min(1600, Math.max(700, Math.abs(total) * 1.6)) });
              await sleep(500); break;
            }
            case "wait": await sleep(a.ms ?? 1000); break;
            case "waitFor": {
              // the app is working (generate/save): poll for the completion text; the waiting span is dead time and gets cut in assembly
              const maxMs = a.ms ?? 90_000, started = Date.now() - t0;
              let found = false;
              while (Date.now() - t0 - started < maxMs) {
                if (a.target && await findTarget(page, a.target)) { found = true; break; }
                await sleep(500);
              }
              const waited = Date.now() - t0 - started;
              if (waited > 1500) (rec.idle ??= []).push({ startMs: started, endMs: Date.now() - t0 });
              if (!found) throw new Error(`waitFor: „${a.target ?? ""}“ ist nach ${Math.round(waited / 1000)} s nicht erschienen`);
              await sleep(600); break;
            }
            case "press": await page.keyboard.press(a.text ?? "Enter"); await sleep(400); break;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message.split("\n")[0] ?? "" : String(e);
          rec.error = rec.error ? `${rec.error} | ${msg}` : msg;
          const w = `${scene.id}: ${msg}`;
          if (!warnings.includes(w)) warnings.push(w);
        } finally {
          opts.log(`[rec ${opts.device}] ${scene.id} ${a.type} ${JSON.stringify(a.target ?? a.url ?? a.text ?? a.y ?? a.ms ?? "")} ${Date.now() - tA} ms`);
        }
      }
      for (const l of await collectUiLabels(page)) uiLabels.add(l);
      const elapsed = Date.now() - t0 - rec.startMs;
      if (elapsed < scene.durationMs) await sleep(scene.durationMs - elapsed);
      // no page.screenshot() here: it resets Chromium's device scale for ~1 s and the screencast shows the page as a thumbnail in the corner.
      // Scene stills for the check are extracted from the finished webm by the pipeline instead.
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
    return { file, device: opts.device, width: dev.video.width, height: dev.video.height, viewportWidth: dev.viewport.width, viewportHeight: dev.viewport.height, scenes, durationMs, warnings, uiLabels: [...uiLabels] };
  } finally {
    await browser.close();
  }
};
