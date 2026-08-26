/**
 * Site crawler (Playwright): text extraction, robots.txt, priority queue for
 * pricing/docs/changelog, app-store and GitHub readme side trips, screenshots
 * of the most important pages.
 */
import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import type { PageKind } from "../../../shared/schemas.js";
import { fetchPage, hostOf, parseRobots, sleep, USER_AGENT } from "../../providers/html.js";
import { mpAssets, mpPages } from "../../db/schema.js";
import { newId, nowIso, toJson } from "../../db/index.js";
import type { AgentContext } from "../runner.js";

export interface CrawledPage { url: string; title: string; kind: PageKind; status: number; text: string }
export interface CrawlResult { pages: CrawledPage[]; screenshots: { url: string; kind: PageKind; file: string }[]; warnings: string[] }
export interface CrawlOptions { maxPages: number; maxScreenshots: number; screenshotDir: string; log: (m: string) => void }
export type Crawler = (startUrl: string, opts: CrawlOptions) => Promise<CrawlResult>;

const SKIP = /(login|signin|sign-in|signup|sign-up|register|anmeld|registr|logout|impressum|datenschutz|privacy|agb\b|terms|legal|cookie|cart|checkout|account|konto|passwor|\.(png|jpe?g|gif|svg|pdf|zip|css|js|xml|ico|webp|mp4|woff2?)(\?|$)|^mailto:|^tel:|^javascript:)/i;

export function classifyUrl(url: string): PageKind {
  const host = hostOf(url);
  if (host === "apps.apple.com" || host === "play.google.com") return "appstore";
  if (host === "github.com") return "github";
  let p = "";
  try { p = new URL(url).pathname.toLowerCase(); } catch { return "other"; }
  if (p === "" || p === "/" || /^\/(de|en|home|index\.html?)\/?$/.test(p)) return "home";
  if (/pric|preis|plans|tarif|kosten/.test(p)) return "pricing";
  if (/feature|funktion|produkt|product|solution|loesung|lösung|warum|why/.test(p)) return "features";
  if (/docs|dokument|help|hilfe|faq|support|guide|anleitung|tutorial/.test(p)) return "docs";
  if (/changelog|updates?$|release|neuigkeiten|whats-new|news/.test(p)) return "changelog";
  if (/about|ueber|über|team|story/.test(p)) return "about";
  if (/blog|ratgeber|magazin|artikel|wissen/.test(p)) return "blog";
  return "other";
}

const KIND_SCORE: Record<PageKind, number> = { home: 100, pricing: 90, features: 80, docs: 70, changelog: 65, appstore: 60, github: 60, about: 40, blog: 20, other: 10 };

export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/.test(k)) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

export const playwrightCrawler: Crawler = async (startUrl, opts) => {
  const { chromium } = await import("playwright");
  const start = normalizeUrl(startUrl);
  if (!start) throw new Error(`Ungültige Start-URL: ${startUrl}`);
  const host = hostOf(start);
  const origin = new URL(start).origin;
  const warnings: string[] = [];
  const pages: CrawledPage[] = [];
  const screenshots: CrawlResult["screenshots"] = [];

  let robots = parseRobots("");
  try {
    const r = await fetch(origin + "/robots.txt", { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (r.ok) robots = parseRobots(await r.text());
  } catch { warnings.push("robots.txt nicht abrufbar - alles erlaubt angenommen"); }
  const delay = Math.max(600, Math.min(robots.crawlDelayMs ?? 0, 10_000));

  const seen = new Set<string>([start]);
  const queue: { url: string; score: number; order: number }[] = [{ url: start, score: KIND_SCORE.home + 1000, order: 0 }];
  const externals: { url: string; kind: PageKind }[] = [];
  let order = 1;
  const enqueue = (raw: string, base: string) => {
    const u = normalizeUrl(raw, base);
    if (!u || seen.has(u) || SKIP.test(u)) return;
    const h = hostOf(u);
    if (h === host) {
      if (!robots.isAllowed(new URL(u).pathname)) return;
      seen.add(u);
      queue.push({ url: u, score: KIND_SCORE[classifyUrl(u)], order: order++ });
    } else if ((h === "apps.apple.com" || h === "play.google.com") && externals.filter((e) => e.kind === "appstore").length < 3) {
      seen.add(u); externals.push({ url: u, kind: "appstore" });
    } else if (h === "github.com" && /^\/[^/]+\/[^/]+\/?$/.test(new URL(u).pathname) && !externals.some((e) => e.kind === "github")) {
      seen.add(u); externals.push({ url: u, kind: "github" });
    }
  };

  fs.mkdirSync(opts.screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 800 }, locale: "de-DE" });
    const page = await context.newPage();
    while (queue.length && pages.length < opts.maxPages) {
      queue.sort((a, b) => b.score - a.score || a.order - b.order);
      const item = queue.shift()!;
      opts.log(`crawl ${pages.length + 1}/${opts.maxPages}: ${item.url}`);
      try {
        const response = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 25_000 });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        const ct = response?.headers()["content-type"] ?? "";
        if (ct && !/html|xhtml/.test(ct)) continue;
        const status = response?.status() ?? 0;
        const data = await page.evaluate(() => ({
          title: document.title,
          text: (document.body?.innerText ?? "").slice(0, 60_000),
          links: Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href).slice(0, 500),
        }));
        const kind = pages.length === 0 ? "home" : classifyUrl(item.url);
        const text = data.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 30_000);
        if (status >= 400 || text.length < 40) { warnings.push(`${item.url}: Status ${status}, ${text.length} Zeichen`); if (pages.length > 0) continue; }
        pages.push({ url: item.url, title: data.title, kind, status, text });
        if (screenshots.length < opts.maxScreenshots) {
          const file = path.join(opts.screenshotDir, `${String(screenshots.length + 1).padStart(2, "0")}-${kind}.png`);
          await page.screenshot({ path: file, fullPage: false });
          screenshots.push({ url: item.url, kind, file });
        }
        for (const l of data.links) enqueue(l, item.url);
      } catch (e) {
        warnings.push(`${item.url}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
      await sleep(delay);
    }
  } finally {
    await browser.close();
  }

  for (const ext of externals) {
    if (pages.length >= opts.maxPages) break;
    try {
      if (ext.kind === "github") {
        const m = /github\.com\/([^/]+)\/([^/]+)/.exec(ext.url);
        const r = await fetch(`https://api.github.com/repos/${m?.[1]}/${m?.[2]?.replace(/\.git$/, "")}/readme`, {
          headers: { Accept: "application/vnd.github.raw+json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) pages.push({ url: ext.url, title: `README ${m?.[1]}/${m?.[2]}`, kind: "github", status: r.status, text: (await r.text()).slice(0, 30_000) });
      } else {
        const f = await fetchPage(ext.url, { maxChars: 15_000 });
        pages.push({ url: ext.url, title: f.title, kind: "appstore", status: f.status, text: f.text });
      }
    } catch (e) { warnings.push(`${ext.url}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { pages, screenshots, warnings };
};

export async function runCrawlStep(ctx: AgentContext & { crawler?: Crawler }, project: { id: string; url: string }): Promise<string> {
  const crawler = ctx.crawler ?? playwrightCrawler;
  const dir = path.join(ctx.dataDir, "assets", project.id, "crawl");
  // Reset previous crawl (pages + screenshot files) so a re-run is clean.
  const old = ctx.db.select().from(mpAssets).where(and(eq(mpAssets.projectId, project.id), eq(mpAssets.kind, "screenshot"))).all();
  for (const a of old) { try { fs.unlinkSync(path.join(ctx.dataDir, a.path)); } catch { /* already gone */ } }
  ctx.db.delete(mpAssets).where(and(eq(mpAssets.projectId, project.id), eq(mpAssets.kind, "screenshot"))).run();
  ctx.db.delete(mpPages).where(eq(mpPages.projectId, project.id)).run();

  const result = await crawler(project.url, { maxPages: 40, maxScreenshots: 5, screenshotDir: dir, log: ctx.log });
  if (result.pages.length === 0) throw new Error(`Keine Seite lesbar unter ${project.url} (${result.warnings.join(" | ") || "keine Details"})`);
  const ts = nowIso();
  for (const p of result.pages) {
    ctx.db.insert(mpPages).values({ id: newId(), projectId: project.id, url: p.url, title: p.title, kind: p.kind, status: p.status, text: p.text, fetchedAt: ts }).run();
  }
  for (const s of result.screenshots) {
    ctx.db.insert(mpAssets).values({
      id: newId(), projectId: project.id, contentPieceId: null, kind: "screenshot",
      path: path.relative(ctx.dataDir, s.file),
      meta: toJson({ url: s.url, kind: s.kind, width: 1280, height: 800, aiGenerated: false }), createdAt: ts,
    }).run();
  }
  const kinds = [...new Set(result.pages.map((p) => p.kind))].join(", ");
  return `${result.pages.length} Seiten (${kinds}), ${result.screenshots.length} Screenshots` + (result.warnings.length ? `, ${result.warnings.length} Warnungen` : "");
}
