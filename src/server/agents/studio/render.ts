/**
 * HTML templates for carousels, pins and directory screenshots, rendered to PNG
 * with Playwright. Every template is token-based (brand kit colours + theme fonts).
 */
import fs from "node:fs";
import path from "node:path";
import type { BrandKit, CarouselTemplate } from "../../../shared/schemas.js";
import { markPng } from "../../util/png.js";

export interface Slide { kind: "text" | "screenshot"; headline: string; body: string; imageDataUrl?: string; index: number; total: number }
export interface RenderJob { html: string; width: number; height: number; file: string }
export type Renderer = (jobs: RenderJob[]) => Promise<void>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@600;700&family=Nunito+Sans:wght@400;600&family=DM+Mono:wght@500&display=swap">`;

export function themeVars(kit: BrandKit): string {
  const primary = kit.primary ?? "#3D7A4E";
  const ink = kit.ink ?? "#1E2A20";
  const bg = kit.background ?? "#FFFFFF";
  const soft = kit.colors.find((c) => c !== primary && c !== ink && c !== bg) ?? "#EEF2EA";
  return `--b-primary:${primary};--b-ink:${ink};--b-bg:${bg};--b-soft:${soft};--b-on-primary:#FFFFFF;--f-display:"Gabarito",system-ui,sans-serif;--f-body:"Nunito Sans",system-ui,sans-serif;--f-mono:"DM Mono",monospace;`;
}

const base = (kit: BrandKit, w: number, h: number, body: string, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
:root{${themeVars(kit)}} *{box-sizing:border-box;margin:0} html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:var(--f-body);color:var(--b-ink);background:var(--b-bg);-webkit-font-smoothing:antialiased}
.slide{width:${w}px;height:${h}px;padding:${Math.round(w * 0.08)}px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
h1{font-family:var(--f-display);font-weight:700;font-size:${Math.round(w * 0.075)}px;line-height:1.08;letter-spacing:-.01em;text-wrap:balance}
p{font-size:${Math.round(w * 0.036)}px;line-height:1.4;margin-top:${Math.round(w * 0.03)}px;max-width:90%}
.meta{font-family:var(--f-mono);font-size:${Math.round(w * 0.022)}px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;display:flex;justify-content:space-between}
.img{width:100%;flex:1;margin:${Math.round(w * 0.03)}px 0;border-radius:${Math.round(w * 0.02)}px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18);background:#fff}
.img img{width:100%;height:100%;object-fit:cover;object-position:top}
.pill{display:inline-block;padding:.35em .9em;border-radius:999px;background:var(--b-primary);color:var(--b-on-primary);font-family:var(--f-mono);font-size:${Math.round(w * 0.024)}px;letter-spacing:.06em;text-transform:uppercase}
${extraCss}</style></head><body>${body}</body></html>`;

export function carouselSlideHtml(kit: BrandKit, template: CarouselTemplate, slide: Slide, w: number, h: number, brand: string): string {
  const counter = `<div class="meta"><span>${esc(brand)}</span><span>${slide.index + 1} / ${slide.total}</span></div>`;
  const isCover = slide.index === 0, isLast = slide.index === slide.total - 1;
  if (slide.kind === "screenshot" && slide.imageDataUrl) {
    return base(kit, w, h, `<div class="slide">${counter}<h1 style="font-size:${Math.round(w * 0.055)}px">${esc(slide.headline)}</h1><div class="img"><img src="${slide.imageDataUrl}"></div><p>${esc(slide.body)}</p></div>`);
  }
  switch (template) {
    case "bold":
      return base(kit, w, h, `<div class="slide" style="background:${isCover || isLast ? "var(--b-primary)" : "var(--b-bg)"};color:${isCover || isLast ? "var(--b-on-primary)" : "var(--b-ink)"}">${counter}<div><h1 style="font-size:${Math.round(w * 0.1)}px">${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div><div class="meta"><span>${isLast ? esc(brand) : "→"}</span></div></div>`);
    case "list":
      return base(kit, w, h, `<div class="slide">${counter}<div><span class="pill">${slide.index + 1}</span><h1 style="margin-top:.4em">${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div><div style="height:${Math.round(w * 0.012)}px;background:var(--b-soft);border-radius:99px"><div style="width:${Math.round(((slide.index + 1) / slide.total) * 100)}%;height:100%;background:var(--b-primary);border-radius:99px"></div></div></div>`);
    case "story":
      return base(kit, w, h, `<div class="slide" style="background:linear-gradient(160deg,var(--b-soft),var(--b-bg))">${counter}<div><h1>${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div><div class="meta"><span>${esc(brand)}</span><span>${isLast ? "" : "weiter →"}</span></div></div>`);
    case "screenshot":
    case "clean":
    default:
      return base(kit, w, h, `<div class="slide">${counter}<div><div style="width:${Math.round(w * 0.08)}px;height:${Math.round(w * 0.012)}px;background:var(--b-primary);border-radius:99px;margin-bottom:${Math.round(w * 0.04)}px"></div><h1>${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div>${isLast ? `<span class="pill">${esc(brand)}</span>` : `<div class="meta"><span>→</span></div>`}</div>`);
  }
}

export function pinHtml(kit: BrandKit, overlay: string, brand: string, url: string, imageDataUrl: string | null): string {
  const w = 1000, h = 1500;
  return base(kit, w, h, `<div class="slide" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="meta"><span>${esc(brand)}</span></div>${imageDataUrl ? `<div class="img"><img src="${imageDataUrl}"></div>` : `<div style="flex:1"></div>`}<div><h1 style="font-size:${Math.round(w * 0.085)}px">${esc(overlay)}</h1><p style="opacity:.85">${esc(url.replace(/^https?:\/\//, ""))}</p></div></div>`);
}

export function framedScreenshotHtml(kit: BrandKit, imageDataUrl: string, w: number, h: number): string {
  return base(kit, w, h, `<div style="width:${w}px;height:${h}px;background:linear-gradient(160deg,var(--b-soft),var(--b-bg));display:flex;align-items:center;justify-content:center;padding:${Math.round(w * 0.04)}px"><div style="width:100%;height:100%;border-radius:${Math.round(w * 0.012)}px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2);background:#fff"><img src="${imageDataUrl}" style="width:100%;height:100%;object-fit:cover;object-position:top"></div></div>`);
}

export const playwrightRenderer: Renderer = async (jobs) => {
  if (!jobs.length) return;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const job of jobs) {
      const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
      await page.setContent(job.html, { waitUntil: "load" });
      await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready).catch(() => undefined);
      await page.waitForTimeout(250);
      fs.mkdirSync(path.dirname(job.file), { recursive: true });
      await page.screenshot({ path: job.file, type: "png", clip: { x: 0, y: 0, width: job.width, height: job.height } });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  for (const job of jobs) markPng(job.file, { aiGenerated: true, generator: "Marketing Pilot (template render)" });
};

export function dataUrlFor(file: string): string | null {
  try {
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "svg" ? "image/svg+xml" : "application/octet-stream";
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch { return null; }
}
