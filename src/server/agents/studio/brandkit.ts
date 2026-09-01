/** Brand kit: colours, logo and fonts from the product website (Playwright, no LLM). */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { BrandKit } from "../../../shared/schemas.js";
import { BrandKit as BrandKitSchema } from "../../../shared/schemas.js";
import { mpAssets, mpProjects } from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { USER_AGENT } from "../../providers/html.js";

interface LogoCandidate { url: string; w: number; h: number; rank: number }

/**
 * Welches Bild wirklich das Logo ist.
 *
 * Der frühere Weg — „erstes Bild im Header, sonst og:image" — lieferte bei
 * Binderplan einen App-Screenshot, der als Kachel im Banner unlesbar war. Ein
 * Logo ist nahezu quadratisch; ein Screenshot nicht. Und die verlässlichste
 * Quelle ist das Web-Manifest: wer eine PWA hat, hinterlegt dort ein sauberes
 * Icon in mehreren Größen.
 */
export async function pickLogo(cands: LogoCandidate[], manifestUrl: string | null, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const all = [...cands];
  if (manifestUrl) {
    try {
      const res = await fetchImpl(manifestUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const man = (await res.json()) as { icons?: { src: string; sizes?: string }[] };
        for (const icon of man.icons ?? []) {
          const size = Number(/([0-9]+)x/.exec(icon.sizes ?? "")?.[1] ?? "0");
          all.push({ url: new URL(icon.src, manifestUrl).toString(), w: size, h: size, rank: 0 });
        }
      }
    } catch { /* ohne Manifest geht es auch */ }
  }
  const square = (c: LogoCandidate) => c.w > 0 && c.h > 0 && c.w / c.h >= 0.8 && c.w / c.h <= 1.25;
  // Erst quadratische Kandidaten, dort die größten und aus der verlässlichsten Quelle.
  const best = all.filter((c) => square(c) && Math.max(c.w, c.h) >= 96)
    .sort((a, b) => a.rank - b.rank || Math.max(b.w, b.h) - Math.max(a.w, a.h))[0];
  return best?.url ?? all.sort((a, b) => a.rank - b.rank)[0]?.url ?? null;
}

export interface BrandExtract { colors: string[]; primary: string | null; ink: string | null; background: string | null; logoUrl: string | null; fonts: string[] }
export type BrandExtractor = (url: string) => Promise<BrandExtract>;

const toHex = (c: string): string | null => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (!m) return /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : null;
  if (m[4] !== undefined && Number(m[4]) < 0.5) return null;
  return "#" + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("").toUpperCase();
};
const isGrey = (hex: string): boolean => { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return Math.max(r, g, b) - Math.min(r, g, b) < 18; };
const luma = (hex: string): number => { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

/** Turn raw colour counts into palette/primary/ink/background. Exported for tests. */
export function pickPalette(counts: Map<string, number>, buttonColors: string[], bodyBg: string | null, bodyColor: string | null): Pick<BrandExtract, "colors" | "primary" | "ink" | "background"> {
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const saturated = ranked.filter((c) => !isGrey(c));
  const primary = buttonColors.find((c) => !isGrey(c) && luma(c) < 0.85) ?? saturated.find((c) => luma(c) < 0.85) ?? null;
  const colors = [...new Set([primary, ...saturated, ...ranked].filter((c): c is string => Boolean(c)))].slice(0, 8);
  const ink = bodyColor && luma(bodyColor) < 0.5 ? bodyColor : ranked.find((c) => luma(c) < 0.3) ?? null;
  const background = bodyBg && luma(bodyBg) > 0.85 ? bodyBg : ranked.find((c) => luma(c) > 0.9) ?? null;
  return { colors, primary, ink, background };
}

export const playwrightBrandExtractor: BrandExtractor = async (url) => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT, viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    const raw = await page.evaluate(() => {
      const counts: Record<string, number> = {};
      const add = (c: string, w = 1) => { if (c && c !== "transparent" && !c.startsWith("rgba(0, 0, 0, 0)")) counts[c] = (counts[c] ?? 0) + w; };
      const els = Array.from(document.querySelectorAll("body *")).slice(0, 1500);
      for (const el of els) {
        const cs = getComputedStyle(el);
        const rect = (el as HTMLElement).getBoundingClientRect();
        const weight = Math.max(1, Math.round((rect.width * rect.height) / 20000));
        add(cs.backgroundColor, weight); add(cs.color, 1); add(cs.borderColor, 1);
      }
      const buttons = Array.from(document.querySelectorAll("a, button")).filter((b) => /btn|button|cta|primary/i.test(b.className) || b.tagName === "BUTTON").slice(0, 30)
        .map((b) => getComputedStyle(b).backgroundColor);
      const body = getComputedStyle(document.body);
      const theme = (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)?.content ?? null;
      // Logo-Kandidaten mit ihren echten Massen sammeln - die Auswahl faellt
      // spaeter in Node, weil dafuer noch das Web-Manifest gelesen wird.
      const cands: { url: string; w: number; h: number; rank: number }[] = [];
      const push = (url: string | null | undefined, w: number, h: number, rank: number) => { if (url) cands.push({ url, w, h, rank }); };
      for (const el of Array.from(document.querySelectorAll("header img, nav img, a[href='/'] img, img[alt*='logo' i], img[src*='logo' i], img[class*='logo' i]")).slice(0, 8)) {
        const img = el as HTMLImageElement;
        push(img.src, img.naturalWidth, img.naturalHeight, 2);
      }
      for (const el of Array.from(document.querySelectorAll('link[rel="apple-touch-icon"], link[rel~="icon"]')).slice(0, 8)) {
        const link = el as HTMLLinkElement;
        const size = Number(/([0-9]+)x/.exec(link.getAttribute("sizes") ?? "")?.[1] ?? "0");
        push(link.href, size, size, 1);
      }
      push((document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content, 0, 0, 3);
      const manifest = (document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null)?.href ?? null;
      const fonts = new Set<string>();
      for (const el of Array.from(document.querySelectorAll("h1, h2, p, body")).slice(0, 40)) fonts.add(getComputedStyle(el).fontFamily.split(",")[0]!.replace(/["']/g, "").trim());
      return { counts, buttons, bodyBg: body.backgroundColor, bodyColor: body.color, theme, cands, manifest, fonts: Array.from(fonts) };
    });
    const logo = await pickLogo(raw.cands, raw.manifest);
    const counts = new Map<string, number>();
    for (const [c, n] of Object.entries(raw.counts)) { const h = toHex(c); if (h) counts.set(h, (counts.get(h) ?? 0) + n); }
    if (raw.theme) { const h = toHex(raw.theme); if (h) counts.set(h, (counts.get(h) ?? 0) + 50); }
    const buttons = raw.buttons.map(toHex).filter((c): c is string => Boolean(c));
    return { ...pickPalette(counts, buttons, toHex(raw.bodyBg), toHex(raw.bodyColor)), logoUrl: logo, fonts: raw.fonts.filter((f) => f && !/^(inherit|initial|system-ui|-apple-system)$/i.test(f)).slice(0, 4) };
  } finally {
    await browser.close();
  }
};

export function loadBrandKit(db: Db, projectId: string): BrandKit {
  const row = db.select({ brandKit: mpProjects.brandKit }).from(mpProjects).where(eq(mpProjects.id, projectId)).get();
  const parsed = BrandKitSchema.safeParse(parseJson<Record<string, unknown>>(row?.brandKit ?? "{}", {}));
  return parsed.success ? parsed.data : BrandKitSchema.parse({});
}

export function saveBrandKit(db: Db, projectId: string, kit: BrandKit): void {
  db.update(mpProjects).set({ brandKit: toJson(kit), updatedAt: nowIso() }).where(eq(mpProjects.id, projectId)).run();
}

export async function extractBrandKit(db: Db, dataDir: string, project: { id: string; url: string }, extractor: BrandExtractor = playwrightBrandExtractor): Promise<BrandKit> {
  const kit = loadBrandKit(db, project.id);
  const ex = await extractor(project.url);
  let logoAssetId = kit.logoAssetId;
  if (ex.logoUrl) {
    try {
      const res = await fetch(ex.logoUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        const ext = ct.includes("svg") ? "svg" : ct.includes("png") ? "png" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : ct.includes("icon") ? "ico" : "bin";
        const dir = path.join(dataDir, "assets", project.id, "brand"); fs.mkdirSync(dir, { recursive: true });
        const rel = path.join("assets", project.id, "brand", `logo.${ext}`);
        fs.writeFileSync(path.join(dataDir, rel), Buffer.from(await res.arrayBuffer()));
        if (logoAssetId) db.delete(mpAssets).where(eq(mpAssets.id, logoAssetId)).run();
        logoAssetId = newId();
        db.insert(mpAssets).values({ id: logoAssetId, projectId: project.id, contentPieceId: null, kind: "image", path: rel, meta: toJson({ role: "logo", sourceUrl: ex.logoUrl, aiGenerated: false }), createdAt: nowIso() }).run();
      }
    } catch { /* logo is optional */ }
  }
  const next: BrandKit = { ...kit, colors: ex.colors, primary: ex.primary, ink: ex.ink, background: ex.background, logoUrl: ex.logoUrl, logoAssetId, fonts: ex.fonts, extractedAt: nowIso() };
  saveBrandKit(db, project.id, next);
  return next;
}
