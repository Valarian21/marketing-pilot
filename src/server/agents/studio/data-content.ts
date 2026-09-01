/**
 * Daten-Content (Shot 7): aus einer Rangliste des Produktdaten-Providers wird
 * in einem Lauf ein ganzes Plattform-Bündel.
 *
 * Die Arbeitsteilung ist der Kern dieses Moduls: **Slides sind deterministisch**
 * (Rang, Name, Set, Preis kommen unverändert aus Shot 6 auf die Fläche), und das
 * LLM wird genau einmal aufgerufen — für Titel, Hook, CTA-Zeile und je Plattform
 * eine Caption samt Hashtags. Kein Modell fasst eine Zahl an.
 *
 * Ein Bündel besteht aus mehreren ContentPieces mit gemeinsamen Assets. Das
 * erste ist das Leit-Stück, seine ID steht in `meta.bundleId` aller Mitglieder —
 * daran hängen Freigabe-Gruppierung und Neu-Erzeugung.
 */
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, withRun, type UsageCollector } from "../runner.js";
import { dataContentPrompt, hashtagPoolPrompt } from "../prompts/studio.js";
import { hashtagPolicy, linkRuleFor } from "../../../shared/channels.js";
import { PLATFORM_LIMITS } from "../../util/utm.js";
import { applyHashtagPolicy, loadHashtags, saveHashtags } from "../../hashtags.js";
import { createProductDataProvider } from "../../data-source.js";
import { estimateReelLineMs, planSlideshow, reelCardLine } from "../video/slideshow.js";
import type { PriceMover, ProductDataProvider, RankedCard, ScopeCoverage } from "../../providers/product-data.js";
import { dataFooterText, dataUrlFor, rankingCoverHtml, rankingCtaHtml, rankingSlideHtml, type RenderJob, type RankingSlide } from "./render.js";
import { reviseWithCritic } from "./critic.js";
// Typ-Import: generate.ts laedt dieses Modul, deshalb darf hier nichts zur Laufzeit zurueckzeigen.
import type { StudioContext } from "./generate.js";

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });

/** Ausgabeformat je Plattform. Fehlt eine, gilt das Feed-Hochformat. */
const SIZE_FOR: Record<string, { w: number; h: number; tag: string }> = {
  instagram: { w: 1080, h: 1350, tag: "1080x1350" },
  facebook: { w: 1080, h: 1350, tag: "1080x1350" },
  linkedin: { w: 1080, h: 1350, tag: "1080x1350" },
  threads: { w: 1080, h: 1350, tag: "1080x1350" },
  bluesky: { w: 1080, h: 1350, tag: "1080x1350" },
  x: { w: 1080, h: 1350, tag: "1080x1350" },
  tiktok: { w: 1080, h: 1920, tag: "1080x1920" },
  youtube: { w: 1080, h: 1920, tag: "1080x1920" },
  pinterest: { w: 1000, h: 1500, tag: "1000x1500" },
};
const DEFAULT_SIZE = { w: 1080, h: 1350, tag: "1080x1350" };
/** Reels sind immer hochkant 1080×1920 — die Plattform spielt dabei keine Rolle. */
const REEL_SIZE = { w: 1080, h: 1920, tag: "1080x1920" };
export const sizeForPlatform = (platform: string, format: "data_carousel" | "data_reel" = "data_carousel") =>
  (format === "data_reel" ? REEL_SIZE : SIZE_FOR[platform] ?? DEFAULT_SIZE);

/** Wie viele Karten über die gewünschte Zahl hinaus geholt werden, damit fehlende Bilder aufgefangen sind. */
const IMAGE_SPARE = 5;

const fmtEur = (v: number, lang: "de" | "en") =>
  lang === "de"
    ? `${v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : `€${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Immer zweistellig — die Fußzeile jeder Slide soll „31.08.2026“ zeigen, nicht „31.8.2026“. */
const fmtDate = (iso: string, lang: "de" | "en") => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/**
 * „▲ +38,2 % in 7 Tagen“ — dieselbe Zeile für Slide und Caption.
 * Auch die Prozentzahl wird lokalisiert: sonst schreibt das Modell sie ab und
 * es steht „+416.2 %“ in einem deutschen Beitrag.
 */
const changeLabel = (m: PriceMover, lang: "de" | "en") => {
  const pct = Math.abs(m.changePct).toLocaleString(lang === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 });
  return `${m.changePct > 0 ? "▲ +" : "▼ −"}${pct} % ${lang === "de" ? `in ${m.days} Tagen` : `in ${m.days} days`}`;
};

const Out = z.object({
  title: z.string().default(""),
  coverTitle: z.string().default(""),
  hook: z.string().default(""),
  ctaLine: z.string().default(""),
  captions: z.array(z.object({ platform: z.string(), caption: z.string().default(""), hashtags: z.array(z.string()).default([]) })).default([]),
});

export interface DataBase {
  db: Db;
  project: s.Project;
  brief: s.Brief;
  personas: s.Persona[];
  kit: s.BrandKit;
  voice: string | null;
  language: string;
}

/** Karte mit geladenem Bild — ohne Bild kommt sie nicht auf eine Slide. */
interface Loaded { card: RankedCard | PriceMover; dataUrl: string }

async function loadCards(
  provider: ProductDataProvider, q: s.DataQuery, lang: "de" | "en",
): Promise<{ loaded: Loaded[]; skipped: string[]; scopeLabel: string; totalEur: number; priceStand: string; coverage: ScopeCoverage | null; withHistory: number }> {
  const want = q.n + IMAGE_SPARE;
  if (q.kind === "movers") {
    const res = await provider.priceMovers({ days: q.days, direction: q.direction, minBaseEur: q.minBaseEur, n: want, region: q.region, minPoints: q.minPoints });
    // Ausreisser aussortieren: ein Trendpreis, der sich in einer Woche vervierfacht,
    // misst bei duenn gehandelten Karten die Datenlage, nicht den Markt.
    const plausible = q.maxChangePct > 0 ? res.cards.filter((c) => Math.abs(c.changePct) <= q.maxChangePct) : res.cards;
    const verworfen = res.cards.length - plausible.length;
    const { loaded, skipped } = await withImages(provider, plausible, q.n, lang);
    if (verworfen > 0) skipped.push(`${verworfen} Karten mit über ${q.maxChangePct} % Ausschlag verworfen (unglaubwürdig bei dieser Datenlage)`);
    return { loaded, skipped, scopeLabel: res.scopeLabel, totalEur: 0, priceStand: res.priceStand, coverage: null, withHistory: res.withHistory };
  }
  if (!q.set && !q.era) throw err("Bereich fehlt: Set oder Ära wählen.");
  const res = await provider.topCards({
    scope: { ...(q.set ? { set: q.set } : {}), ...(q.era ? { era: q.era } : {}), region: q.region },
    n: want, priceBasis: q.priceBasis, ...(q.minPrice !== undefined ? { minPrice: q.minPrice } : {}),
  });
  const { loaded, skipped } = await withImages(provider, res.cards, q.n, lang);
  // Gesamtwert der Liste, die wirklich veroeffentlicht wird - nicht der ueberholten Abfrage.
  const totalEur = Math.round(loaded.reduce((sum, x) => sum + x.card.priceEur, 0) * 100) / 100;
  const scopeLabel = lang === "en" && res.scopeLabelEn ? res.scopeLabelEn : res.scopeLabel;
  return { loaded, skipped, scopeLabel, totalEur, priceStand: res.priceStand, coverage: res.coverage, withHistory: 0 };
}

/** Bilder in der Reihenfolge der Rangliste laden, bis `n` Karten zusammen sind. */
async function withImages<T extends RankedCard>(provider: ProductDataProvider, cards: T[], n: number, lang: "de" | "en"): Promise<{ loaded: Loaded[]; skipped: string[] }> {
  const loaded: Loaded[] = [];
  const skipped: string[] = [];
  for (const card of cards) {
    if (loaded.length >= n) break;
    const file = await provider.cardImage(card.id, card.imageLang ?? lang);
    const dataUrl = file ? dataUrlFor(file) : null;
    if (dataUrl) loaded.push({ card, dataUrl });
    else skipped.push(`${card.name} (${card.setName} ${card.localId})`);
  }
  return { loaded, skipped };
}

/**
 * Ein Bündel erzeugen. `leadPieceId` wird beim Neu-Erzeugen mitgegeben, damit
 * das Leit-Stück seine ID (und damit jeden Link darauf) behält.
 */
export async function generateDataBundle(
  ctx: StudioContext,
  base: DataBase,
  req: s.ContentRequest,
  usage: UsageCollector,
  opts: { leadPieceId?: string; language: "de" | "en"; addAsset: (pieceId: string, file: string, meta: Record<string, unknown>) => string; renderer: (jobs: RenderJob[]) => Promise<void>; screenshotPath: string | null },
): Promise<s.ContentPiece[]> {
  const q = s.DataQuery.parse(req.dataQuery ?? {});
  const format: "data_carousel" | "data_reel" = req.format === "data_reel" ? "data_reel" : "data_carousel";
  const lang = opts.language;
  const provider = createProductDataProvider(ctx.db, ctx.env, base.project.id, { log: ctx.log });
  if (!provider) throw err("Dieses Projekt hat keine Produktdatenquelle — unter „Produktdaten“ eine auswählen.", 400);

  let data;
  try { data = await loadCards(provider, q, lang); } finally { provider.close(); }
  if (data.loaded.length < 3) throw err(`Zu wenige Karten mit Bild und Preis im gewählten Bereich (${data.loaded.length}).`);

  /**
   * Ein Reel muss unter 60 s bleiben. Die Entscheidung, wie viele Karten das
   * hergibt, faellt **vor** dem Modellaufruf — sonst schriebe es „die Top 10“
   * ueber ein Video, das nur acht zeigt. Geschaetzt wird mit demselben Satz und
   * demselben Schaetzer, den der Job spaeter benutzt.
   */
  const reelOpts = s.ReelOptions.parse(req.reel ?? {});
  const reelNotes: string[] = [];
  if (format === "data_reel") {
    const display = q.countdown ? [...data.loaded].reverse() : data.loaded;
    const rankOfId = new Map(data.loaded.map((x, i) => [x.card.id, i + 1]));
    const fit = planSlideshow(display.map((x) => ({
      key: x.card.id,
      ...(reelOpts.voiceover ? { voiceMs: estimateReelLineMs(reelCardLine({ rank: rankOfId.get(x.card.id)!, name: lang === "en" && x.card.nameEn ? x.card.nameEn : x.card.name, priceEur: x.card.priceEur }, lang)) } : {}),
    })), {
      secondsPerCard: reelOpts.secondsPerCard,
      // Hook und Endkarte kommen erst vom Modell — mit Stimme brauchen sie
      // erfahrungsgemaess je einen gesprochenen Satz. Wird das hier nicht
      // reserviert, kappt der Job hinterher, was der Text schon angekuendigt hat.
      ...(reelOpts.voiceover ? { hookMs: 4500, endMs: 4500 } : {}),
    });
    if (fit.dropped.length) {
      const drop = new Set(fit.dropped);
      const before = data.loaded.length;
      data.loaded = data.loaded.filter((x) => !drop.has(x.card.id));
      data.totalEur = Math.round(data.loaded.reduce((sum, x) => sum + x.card.priceEur, 0) * 100) / 100;
      reelNotes.push(`Aus ${before} Karten wurden ${data.loaded.length} — mehr passt mit dieser Standzeit${reelOpts.voiceover ? " und Voiceover" : ""} nicht in 60 Sekunden.`);
    }
    if (fit.secondsPerCard < reelOpts.secondsPerCard) reelNotes.push(`Standzeit je Karte voraussichtlich ${fit.secondsPerCard.toFixed(1)} s statt ${reelOpts.secondsPerCard.toFixed(1)} s.`);
  }

  const platforms = (req.bundlePlatforms.length ? req.bundlePlatforms : [req.platform ?? "instagram"]).map((p) => p.trim().toLowerCase()).filter((p, i, all) => p && all.indexOf(p) === i);
  const leadPlatform = platforms[0]!;
  const footer = dataFooterText(fmtDate(data.priceStand, lang), base.project.url.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  const brand = base.brief.productName;

  // --- der einzige Modellaufruf des Laufs -----------------------------------
  const out = await chatJson(ctx.llm, modelFor("content"), Out, dataContentPrompt({
    brief: base.brief, ...(base.personas[0] ? { persona: base.personas[0] } : {}), voiceProfile: base.voice, language: lang,
    kind: q.kind, scopeLabel: data.scopeLabel,
    cards: data.loaded.map((x, i) => ({
      rank: i + 1, name: lang === "en" && x.card.nameEn ? x.card.nameEn : x.card.name, setName: x.card.setName, localId: x.card.localId,
      price: fmtEur(x.card.priceEur, lang),
      ...("changePct" in x.card ? { change: changeLabel(x.card as PriceMover, lang) } : {}),
    })),
    totalLabel: fmtEur(data.totalEur, lang), priceStand: fmtDate(data.priceStand, lang),
    platforms: platforms.map((p) => ({ platform: p, limit: PLATFORM_LIMITS[p] ?? 2000, policy: hashtagPolicy(p), linkRule: linkRuleFor(p) })),
    pools: loadHashtags(ctx.db, base.project.id), topic: req.topic, hint: req.hint,
  }), usage, { maxTokens: 3000, temperature: 0.6 });

  const coverTitle = (out.coverTitle || data.scopeLabel).slice(0, 80);
  const ctaLine = (out.ctaLine || (lang === "de" ? `Deine Sammlung sortiert in ${brand}.` : `Sort your collection with ${brand}.`)).slice(0, 120);

  // --- Slides: deterministisch aus den Daten --------------------------------
  const ordered = q.countdown ? [...data.loaded].reverse() : data.loaded;
  const rankOf = new Map(data.loaded.map((x, i) => [x.card.id, i + 1]));
  const slides: RankingSlide[] = ordered.map((x, i) => {
    const mover = "changePct" in x.card ? (x.card as PriceMover) : null;
    return {
      rank: rankOf.get(x.card.id)!,
      name: lang === "en" && x.card.nameEn ? x.card.nameEn : x.card.name,
      setLine: `${x.card.setName} · ${x.card.localId}${x.card.priceBasisUsed === "holo" ? " · holo" : ""}`,
      price: fmtEur(x.card.priceEur, lang),
      ...(mover ? { change: changeLabel(mover, lang) } : {}),
      imageDataUrl: x.dataUrl,
      index: i + 1, total: ordered.length + 2,
    };
  });
  const totalLabel = q.kind === "top"
    ? (lang === "de" ? `Zusammen ${fmtEur(data.totalEur, lang)}` : `Together ${fmtEur(data.totalEur, lang)}`)
    : (lang === "de" ? `Letzte ${q.days} Tage` : `Last ${q.days} days`);
  const coverImages = data.loaded.slice(0, 3).map((x) => x.dataUrl);
  const shot = opts.screenshotPath ? dataUrlFor(opts.screenshotPath) : null;

  // --- rendern: eine Datei je Größe, alle Plattformen teilen sie ------------
  const leadId = opts.leadPieceId ?? newId();
  const outDir = path.join(ctx.dataDir, "assets", base.project.id, "pieces", leadId);
  const sizes = [...new Map(platforms.map((p) => [sizeForPlatform(p, format).tag, sizeForPlatform(p, format)])).values()];
  // Ein Reel ist eine Datei fuer alle Plattformen - es kann nur eine CTA-Beschriftung tragen,
  // und zwar die des Leit-Kanals. Beim Carousel bekommt jede Link-Regel ihre eigene Slide.
  const linkRules = format === "data_reel" ? [linkRuleFor(leadPlatform)] : [...new Set(platforms.map(linkRuleFor))];
  const jobs: RenderJob[] = [];
  /** size-tag -> Dateien in Slide-Reihenfolge; CTA getrennt, weil er je Link-Regel anders lautet. */
  const bySize = new Map<string, string[]>();
  const ctaFiles = new Map<string, string>();
  for (const size of sizes) {
    const files: string[] = [];
    const cover = path.join(outDir, `${lang}-${size.tag}-00-cover.png`);
    jobs.push({ html: rankingCoverHtml(base.kit, { title: coverTitle, totalLabel, images: coverImages }, size.w, size.h, brand, footer), width: size.w, height: size.h, file: cover });
    files.push(cover);
    slides.forEach((sl, i) => {
      const file = path.join(outDir, `${lang}-${size.tag}-${String(i + 1).padStart(2, "0")}-rang${sl.rank}.png`);
      jobs.push({ html: rankingSlideHtml(base.kit, sl, size.w, size.h, brand, footer), width: size.w, height: size.h, file });
      files.push(file);
    });
    for (const rule of linkRules) {
      const file = path.join(outDir, `${lang}-${size.tag}-99-cta-${rule}.png`);
      const linkLabel = rule === "bio"
        ? (lang === "de" ? "Link in Bio" : "Link in bio")
        : base.project.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      jobs.push({ html: rankingCtaHtml(base.kit, { line: ctaLine, linkLabel, imageDataUrl: shot }, size.w, size.h, brand, footer), width: size.w, height: size.h, file });
      ctaFiles.set(`${size.tag}:${rule}`, file);
    }
    bySize.set(size.tag, files);
  }
  await opts.renderer(jobs);

  // --- Assets buchen (am Leit-Stück) und je Plattform zuordnen --------------
  const assetIds = new Map<string, string>();
  for (const [tag, files] of bySize) files.forEach((file, i) => assetIds.set(file, opts.addAsset(leadId, file, { size: tag, slide: i, language: lang, dataSlide: true })));
  for (const [k, file] of ctaFiles) assetIds.set(file, opts.addAsset(leadId, file, { size: k.split(":")[0]!, slide: "cta", linkRule: k.split(":")[1]!, language: lang, dataSlide: true }));

  // --- Captions: Kritiker nur auf die des Leit-Stücks -----------------------
  const captionOf = (platform: string) => out.captions.find((c) => c.platform.trim().toLowerCase() === platform)?.caption.trim() ?? "";
  const leadCaption = captionOf(leadPlatform) || out.captions[0]?.caption.trim() || coverTitle;
  const rev = await reviseWithCritic(ctx, usage, { body: leadCaption, language: lang, voiceProfile: base.voice, format, platform: leadPlatform, limit: PLATFORM_LIMITS[leadPlatform] ?? 2000, maxRounds: 2 });

  const pools = loadHashtags(ctx.db, base.project.id);
  const notes = [rev.notes];
  if (data.skipped.length) notes.push(`Ohne ladbares Bild übersprungen (${data.skipped.length}): ${data.skipped.join(", ")}. Die Rangfolge ist die der veröffentlichten Liste.`);
  if (data.coverage && data.coverage.skipped > 0) notes.push(`${data.coverage.skipped} Karten im Bereich wurden nicht nachbepreist (Deckel je Abfrage).`);
  if (q.kind === "movers") notes.push(`Beruht auf ${data.withHistory} Karten mit Preisverlauf.`);
  notes.push(...reelNotes);

  const ts = nowIso();
  const pieces: s.ContentPiece[] = [];
  platforms.forEach((platform, i) => {
    const id = i === 0 ? leadId : newId();
    const size = sizeForPlatform(platform, format);
    const rule = format === "data_reel" ? linkRuleFor(leadPlatform) : linkRuleFor(platform);
    const caption = i === 0 ? rev.body : (captionOf(platform) || rev.body);
    const suggested = out.captions.find((c) => c.platform.trim().toLowerCase() === platform)?.hashtags ?? [];
    const tags = applyHashtagPolicy(suggested, pools, platform, lang);
    const body = [stripTags(caption), tags.join(" ")].filter(Boolean).join("\n\n");
    const files = [...(bySize.get(size.tag) ?? []), ctaFiles.get(`${size.tag}:${rule}`) ?? ""].filter(Boolean);
    const assets = files.map((f) => assetIds.get(f)!).filter(Boolean);
    // Reihenfolge der Slides = Reihenfolge im Video: Cover, Karten, CTA.
    const meta: Record<string, unknown> = {
      bundleId: leadId, bundleLead: i === 0, platform, language: lang, size: size.tag, linkRule: rule,
      ...(format === "data_reel" ? { reel: reelOpts, slideAssets: assets } : {}),
      caption: body, hashtags: tags, hook: out.hook, coverTitle, ctaLine,
      dataQuery: q, scopeLabel: data.scopeLabel, priceStand: data.priceStand, totalEur: data.totalEur,
      footer, limit: PLATFORM_LIMITS[platform] ?? 2000,
      cards: data.loaded.map((x, n) => ({ rank: n + 1, id: x.card.id, name: x.card.name, nameEn: x.card.nameEn, setName: x.card.setName, localId: x.card.localId, priceEur: x.card.priceEur, priceBasisUsed: x.card.priceBasisUsed, priceUpdatedAt: x.card.priceUpdatedAt })),
      skippedNoImage: data.skipped, coverage: data.coverage, request: req,
    };
    const row = {
      id, projectId: base.project.id, taskId: i === 0 ? (req.taskId ?? null) : null,
      channel: platform, format,
      title: `${i === 0 ? out.title || coverTitle : coverTitle} · ${platform}`.slice(0, 120),
      // Ein Reel ist erst fertig, wenn der Worker die MP4 gebaut hat - bis dahin Entwurf.
      body, assets: toJson(assets), status: (format === "data_reel" ? "draft" : "review") as s.ContentPiece["status"], humanEdited: false,
      publishedAt: null, externalUrl: null, utm: "{}", meta: toJson(meta),
      aiTellScore: i === 0 ? rev.score : null, aiTellNotes: i === 0 ? notes.filter(Boolean).join("\n") : "",
      rejectionReason: "", createdAt: ts, updatedAt: ts,
    };
    ctx.db.insert(t.mpContentPieces).values(row).onConflictDoUpdate({ target: t.mpContentPieces.id, set: { ...row } }).run();
    pieces.push({ ...row, assets, utm: {}, meta, costUsd: 0 });
  });
  return pieces;
}

/** Hashtags aus dem Fließtext des Modells nehmen — sie kommen kontrolliert wieder dazu. */
function stripTags(text: string): string {
  return text.split("\n").map((line) => (/^\s*(#[^\s#]+\s*){2,}$/.test(line) ? "" : line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Alle Stücke eines Bündels, Leit-Stück zuerst. */
export function bundlePieces(db: Db, projectId: string, bundleId: string): (typeof t.mpContentPieces.$inferSelect)[] {
  return db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all()
    .filter((r) => parseJson<Record<string, unknown>>(r.meta, {})["bundleId"] === bundleId)
    .sort((a, b) => (a.id === bundleId ? -1 : b.id === bundleId ? 1 : a.channel.localeCompare(b.channel)));
}

/** Beim Neu-Erzeugen: Mitglieder (nicht das Leit-Stück) und alle Assets des Bündels räumen. */
export function clearBundle(db: Db, projectId: string, bundleId: string, unlink: (rel: string) => void): void {
  for (const row of bundlePieces(db, projectId, bundleId)) {
    if (row.id !== bundleId) db.delete(t.mpContentPieces).where(eq(t.mpContentPieces.id, row.id)).run();
  }
  for (const a of db.select().from(t.mpAssets).where(and(eq(t.mpAssets.contentPieceId, bundleId), eq(t.mpAssets.projectId, projectId))).all()) {
    unlink(a.path);
    db.delete(t.mpAssets).where(eq(t.mpAssets.id, a.id)).run();
  }
}

/**
 * Einmaliger Vorschlag für die Hashtag-Vorräte eines Projekts. Danach gehört
 * die Liste Marcel — deshalb wird sie nur vorgeschlagen, nie automatisch
 * nachgeschärft.
 */
export async function suggestHashtagPools(ctx: StudioContext, projectId: string, input: { brief: s.Brief; personas: s.Persona[]; channels: string[] }): Promise<s.HashtagPools> {
  const Pools = z.object({
    brand: z.array(z.string()).default([]),
    topics: z.record(z.string(), z.array(z.string())).default({}),
    byLanguage: z.object({ de: z.array(z.string()).default([]), en: z.array(z.string()).default([]) }).default({ de: [], en: [] }),
  });
  const { result } = await withRun(ctx.db, { task: "studio.hashtags", model: modelFor("critic"), projectId }, (usage) =>
    chatJson(ctx.llm, modelFor("critic"), Pools, hashtagPoolPrompt(input), usage, { maxTokens: 1500, temperature: 0.4 }));
  const existing = loadHashtags(ctx.db, projectId);
  return saveHashtags(ctx.db, projectId, { ...result, suggestedAt: nowIso(), topics: { ...existing.topics, ...result.topics } });
}
