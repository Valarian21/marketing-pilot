/**
 * HTML templates for carousels, pins and directory screenshots, rendered to PNG
 * with Playwright. Every template is token-based (brand kit colours + theme fonts).
 */
import fs from "node:fs";
import path from "node:path";
import type { BrandKit, CarouselTemplate } from "../../../shared/schemas.js";
import { markPng } from "../../util/png.js";

export interface Slide { kind: "text" | "screenshot"; headline: string; body: string; imageDataUrl?: string; index: number; total: number }
export interface RenderJob { html: string; width: number; height: number; file: string; transparent?: boolean }
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
.img{width:100%;flex:1;margin:${Math.round(w * 0.03)}px 0;border-radius:${Math.round(w * 0.02)}px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18);background:var(--b-soft)}
.img img{width:100%;height:100%;object-fit:contain;object-position:top}
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

/** Eine Zeile der Rangliste, so wie sie auf die Slide kommt. Zahlen kommen fertig aus dem Provider. */
export interface RankingSlide {
  rank: number;
  name: string;
  setLine: string;
  /** Fertig formatiert („626,08 €“) — der Renderer rechnet nichts. */
  price: string;
  /** Nur bei Preis-Bewegungen: „▲ +38 % in 7 Tagen“. */
  change?: string;
  imageDataUrl: string | null;
  index: number;
  total: number;
  /** Ratemodus: der Preis steht erst auf der Folgeslide. */
  hidePrice?: boolean;
}

/** Fußzeile, die laut Plan auf JEDER Daten-Slide steht — Quelle, Stand, Herkunft. */
export const dataFooterText = (priceStand: string, source: string): string =>
  `Preise: Cardmarket-Trend · Stand ${priceStand} · ${source}`;

const dataFoot = (w: number, footer: string) =>
  `<div class="dfoot" style="font-family:var(--f-mono);font-size:${Math.round(w * 0.019)}px;letter-spacing:.02em;opacity:.6;text-align:center">${esc(footer)}</div>`;

const dataCss = (w: number) => `
.dwrap{width:100%;height:100%;display:flex;flex-direction:column;gap:${Math.round(w * 0.025)}px}
.dhead{display:flex;align-items:center;justify-content:space-between;gap:${Math.round(w * 0.02)}px}
.drank{font-family:var(--f-mono);font-weight:500;font-size:${Math.round(w * 0.075)}px;line-height:1;padding:.12em .38em;border-radius:${Math.round(w * 0.02)}px;background:var(--b-primary);color:var(--b-on-primary);font-variant-numeric:tabular-nums}
.dbrand{font-family:var(--f-mono);font-size:${Math.round(w * 0.022)}px;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.dcard{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.dcard::after{content:"";position:absolute;width:62%;height:52%;border-radius:50%;background:var(--b-primary);opacity:.16;filter:blur(${Math.round(w * 0.06)}px);z-index:0}
.dcard img{position:relative;z-index:1;max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 ${Math.round(w * 0.02)}px ${Math.round(w * 0.045)}px rgba(0,0,0,.35))}
.dname{font-family:var(--f-display);font-weight:700;font-size:${Math.round(w * 0.062)}px;line-height:1.1;text-wrap:balance}
.dset{font-family:var(--f-mono);font-size:${Math.round(w * 0.026)}px;opacity:.7;margin-top:.35em}
.dprice{font-family:var(--f-display);font-weight:700;font-size:${Math.round(w * 0.115)}px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-top:${Math.round(w * 0.02)}px}
.dchange{font-family:var(--f-mono);font-size:${Math.round(w * 0.03)}px;margin-top:.4em;color:var(--b-primary)}
.dfan{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.dfan img{position:absolute;max-height:74%;max-width:40%;object-fit:contain;border-radius:${Math.round(w * 0.012)}px;box-shadow:0 ${Math.round(w * 0.02)}px ${Math.round(w * 0.05)}px rgba(0,0,0,.35)}
.dtotal{font-family:var(--f-mono);font-size:${Math.round(w * 0.03)}px;opacity:.75;font-variant-numeric:tabular-nums}
.dshot{flex:1;min-height:0;border-radius:${Math.round(w * 0.02)}px;overflow:hidden;background:var(--b-soft);box-shadow:0 ${Math.round(w * 0.02)}px ${Math.round(w * 0.05)}px rgba(0,0,0,.2)}
.dshot img{width:100%;height:100%;object-fit:cover;object-position:top}`;

/** Rangkarte: Bild groß, Preis groß, alles andere leise. */
export function rankingSlideHtml(kit: BrandKit, slide: RankingSlide, w: number, h: number, brand: string, footer: string): string {
  const body = `<div class="slide" style="background:linear-gradient(170deg,var(--b-soft),var(--b-bg))"><div class="dwrap">
<div class="dhead"><span class="drank">${slide.rank}</span><span class="dbrand">${esc(brand)}</span></div>
<div class="dcard">${slide.imageDataUrl ? `<img src="${slide.imageDataUrl}">` : ""}</div>
<div><div class="dname">${esc(slide.name)}</div><div class="dset">${esc(slide.setLine)}</div>
<div class="dprice"${slide.hidePrice ? ' style="opacity:.35"' : ""}>${slide.hidePrice ? "? ? ?" : esc(slide.price)}</div>${slide.change && !slide.hidePrice ? `<div class="dchange">${esc(slide.change)}</div>` : ""}</div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/** Cover: worum es geht, was die Liste zusammen wert ist, drei Karten angedeutet. */
export function rankingCoverHtml(kit: BrandKit, a: { title: string; totalLabel: string; images: (string | null)[] }, w: number, h: number, brand: string, footer: string): string {
  const imgs = a.images.filter((x): x is string => Boolean(x)).slice(0, 3);
  // Der Versatz bleibt bewusst klein: bei 0,26·w ragten die aeusseren Karten
  // ueber den Slide-Rand hinaus und wurden abgeschnitten.
  const fan = imgs.map((src, i) => {
    const off = (i - (imgs.length - 1) / 2) * 0.17;
    const mid = i === Math.floor(imgs.length / 2);
    return `<img src="${src}" style="transform:translateX(${Math.round(off * w)}px) rotate(${(off * 30).toFixed(1)}deg) scale(${mid ? 1 : 0.9});z-index:${mid ? 2 : 1}">`;
  }).join("");
  const body = `<div class="slide" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div class="dfan">${fan}</div>
<div><h1 style="font-size:${Math.round(w * 0.085)}px">${esc(a.title)}</h1><div class="dtotal" style="margin-top:.6em">${esc(a.totalLabel)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/** Abschluss: Produkt-Screenshot, ein Satz, der Link bzw. der Bio-Hinweis. */
export function rankingCtaHtml(kit: BrandKit, a: { line: string; linkLabel: string; imageDataUrl: string | null }, w: number, h: number, brand: string, footer: string): string {
  const body = `<div class="slide"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
${a.imageDataUrl ? `<div class="dshot"><img src="${a.imageDataUrl}"></div>` : `<div class="dfan"></div>`}
<div><h1 style="font-size:${Math.round(w * (a.line.length > 70 ? 0.056 : a.line.length > 45 ? 0.064 : 0.072))}px">${esc(a.line)}</h1><div class="dset" style="opacity:.85">${esc(a.linkLabel)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/**
 * Binder-Showcase (Shot 11): eine echte Seite aus der geteilten Ansicht.
 *
 * Das Bild wird nie beschnitten — es ist ein Produkt-Screenshot, und ein halb
 * abgeschnittenes Fach wäre eine Falschaussage über die App.
 */
export function showcaseSlideHtml(kit: BrandKit, a: { headline: string; sub: string; imageDataUrl: string | null }, w: number, h: number, brand: string, footer: string): string {
  const body = `<div class="slide" style="background:linear-gradient(170deg,var(--b-soft),var(--b-bg))"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div class="dshot" style="background:transparent;box-shadow:none">${a.imageDataUrl ? `<img src="${a.imageDataUrl}" style="object-fit:contain;object-position:center">` : ""}</div>
<div><div class="dname" style="font-size:${Math.round(w * 0.055)}px">${esc(a.headline)}</div><div class="dset">${esc(a.sub)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/** Cover des Showcase: Name des Binders, eine Seite angedeutet, die Eckdaten. */
export function showcaseCoverHtml(kit: BrandKit, a: { title: string; stats: string; imageDataUrl: string | null }, w: number, h: number, brand: string, footer: string): string {
  const body = `<div class="slide" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div class="dshot" style="background:rgba(255,255,255,.1)">${a.imageDataUrl ? `<img src="${a.imageDataUrl}" style="object-fit:contain">` : ""}</div>
<div><h1 style="font-size:${Math.round(w * 0.08)}px">${esc(a.title)}</h1><div class="dtotal" style="margin-top:.5em">${esc(a.stats)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
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
      await page.screenshot({ path: job.file, type: "png", clip: { x: 0, y: 0, width: job.width, height: job.height }, omitBackground: Boolean(job.transparent) });
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
