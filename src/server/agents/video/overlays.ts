/** HTML overlays for the video assembly: hook card, end card, device frame, background, word captions. Token-based like the carousels. */
import path from "node:path";
import type { BrandKit, VideoDevice } from "../../../shared/schemas.js";
import { themeVars, type RenderJob } from "../studio/render.js";
import type { WordTiming } from "./voice.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@600;700&family=Nunito+Sans:wght@500;700&family=DM+Mono:wght@500&display=swap">`;
const base = (kit: BrandKit, w: number, h: number, body: string, transparent = false) => `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
:root{${themeVars(kit)}} *{box-sizing:border-box;margin:0} html,body{width:${w}px;height:${h}px;overflow:hidden;background:${transparent ? "transparent" : "var(--b-bg)"}}
body{font-family:var(--f-body);color:var(--b-ink);-webkit-font-smoothing:antialiased}
.card{width:${w}px;height:${h}px;padding:${Math.round(w * 0.09)}px;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(w * 0.03)}px}
h1{font-family:var(--f-display);font-weight:700;line-height:1.06;letter-spacing:-.015em;text-wrap:balance}
.meta{font-family:var(--f-mono);font-size:${Math.round(w * 0.024)}px;letter-spacing:.08em;text-transform:uppercase;opacity:.8}
</style></head><body>${body}</body></html>`;

export interface Layout { w: number; h: number; inner: { x: number; y: number; w: number; h: number }; radius: number; captionY: number; captionH: number }

/** Where the recording sits inside the output frame. */
export function layoutFor(device: VideoDevice, landscape: boolean, rec: { width: number; height: number }): Layout {
  const w = landscape ? 1920 : 1080, h = landscape ? 1080 : 1920;
  // a little air between screen and bezel - the recording must never touch the rounded frame corners
  const maxW = landscape ? 1460 : 840, maxH = landscape ? 820 : 1340;
  const s = Math.min(maxW / rec.width, maxH / rec.height);
  const iw = Math.round(rec.width * s / 2) * 2, ih = Math.round(rec.height * s / 2) * 2;
  const x = Math.round((w - iw) / 2), y = landscape ? Math.round((h - ih) / 2) - 20 : Math.round((h - ih) / 2) - 60;
  return { w, h, inner: { x, y, w: iw, h: ih }, radius: device === "mobile" ? 56 : 18, captionY: landscape ? h - 190 : h - 330, captionH: landscape ? 130 : 150 };
}

export function hookCardHtml(kit: BrandKit, hook: string, brand: string, w: number, h: number): string {
  return base(kit, w, h, `<div class="card" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="meta">${esc(brand)}</div><h1 style="font-size:${Math.round(w * 0.1)}px">${esc(hook)}</h1></div>`);
}
export function endCardHtml(kit: BrandKit, cta: string, url: string, brand: string, w: number, h: number): string {
  return base(kit, w, h, `<div class="card" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="meta">${esc(brand)}</div><h1 style="font-size:${Math.round(w * 0.08)}px">${esc(cta)}</h1><p style="font-family:var(--f-mono);font-size:${Math.round(w * 0.036)}px;opacity:.9">${esc(url.replace(/^https?:\/\//, ""))}</p></div>`);
}
export function backgroundHtml(kit: BrandKit, w: number, h: number, brand: string): string {
  return base(kit, w, h, `<div style="width:${w}px;height:${h}px;background:linear-gradient(165deg,var(--b-soft) 0%,var(--b-bg) 60%,var(--b-soft) 100%);position:relative"><div class="meta" style="position:absolute;left:${Math.round(w * 0.06)}px;top:${Math.round(w * 0.05)}px">${esc(brand)}</div></div>`);
}
/** Transparent frame with a rounded cut-out where the recording goes (drawn on top of the video). */
export function deviceFrameHtml(kit: BrandKit, lay: Layout): string {
  const { inner: r, radius } = lay;
  return base(kit, lay.w, lay.h, `<svg width="${lay.w}" height="${lay.h}" viewBox="0 0 ${lay.w} ${lay.h}"><defs><mask id="m"><rect width="100%" height="100%" fill="#fff"/><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${radius}" fill="#000"/></mask></defs><rect width="100%" height="100%" fill="rgba(0,0,0,0)" mask="url(#m)"/><rect x="${r.x - 22}" y="${r.y - 22}" width="${r.w + 44}" height="${r.h + 44}" rx="${radius + 22}" fill="none" stroke="rgba(20,20,20,.96)" stroke-width="44" mask="url(#m)"/><rect x="${r.x - 44}" y="${r.y - 44}" width="${r.w + 88}" height="${r.h + 88}" rx="${radius + 44}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2"/></svg>`, true);
}
/** Alpha mask for the recording itself: white rounded rectangle (screen shape) on black - the square video corners must not poke past the bezel. */
export function screenMaskHtml(lay: Layout): string {
  const { inner: r, radius } = lay;
  return `<!doctype html><html><body style="margin:0;background:#000"><svg width="${r.w}" height="${r.h}" viewBox="0 0 ${r.w} ${r.h}" style="display:block"><rect width="${r.w}" height="${r.h}" rx="${radius}" fill="#fff"/></svg></body></html>`;
}
/** One caption frame: the current chunk with the active word highlighted. */
export function captionHtml(kit: BrandKit, words: string[], active: number, w: number, h: number): string {
  const size = Math.round(w * 0.052);
  const spans = words.map((x, i) => `<span style="${i === active ? "color:var(--b-on-primary);background:var(--b-primary);border-radius:.25em;padding:0 .18em" : ""}">${esc(x)}</span>`).join(" ");
  return base(kit, w, h, `<div style="width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;padding:0 ${Math.round(w * 0.08)}px"><div style="display:inline-block;background:rgba(15,18,16,.82);color:#fff;font-family:var(--f-body);font-weight:700;font-size:${size}px;line-height:1.25;padding:.35em .7em;border-radius:.45em;text-align:center;text-wrap:balance">${spans}</div></div>`, true);
}

export interface CaptionCue { file: string; startMs: number; endMs: number }

/** Words -> chunks of 3-4 words -> one PNG per word (active highlight). */
export function chunkWords(words: WordTiming[], maxWords = 4, maxChars = 26): WordTiming[][] {
  const chunks: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  for (const w of words) {
    const len = cur.reduce((n, x) => n + x.word.length + 1, 0) + w.word.length;
    if (cur.length && (cur.length >= maxWords || len > maxChars)) { chunks.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function captionJobs(kit: BrandKit, words: WordTiming[], offsetMs: number, lay: Layout, outDir: string, prefix: string): { jobs: RenderJob[]; cues: CaptionCue[] } {
  const jobs: RenderJob[] = []; const cues: CaptionCue[] = [];
  chunkWords(words).forEach((chunk, ci) => {
    chunk.forEach((w, wi) => {
      const file = path.join(outDir, `${prefix}-cap-${String(ci).padStart(2, "0")}-${wi}.png`);
      const next = chunk[wi + 1];
      jobs.push({ html: captionHtml(kit, chunk.map((x) => x.word), wi, lay.w, lay.captionH), width: lay.w, height: lay.captionH, file, transparent: true });
      cues.push({ file, startMs: offsetMs + w.startMs, endMs: offsetMs + (next ? next.startMs : w.endMs + 120) });
    });
  });
  return { jobs, cues };
}
