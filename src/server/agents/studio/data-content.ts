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
import { hashtagPolicy, linkRuleFor, mediaLimitFor } from "../../../shared/channels.js";
import { PLATFORM_LIMITS } from "../../util/utm.js";
import { applyHashtagPolicy, loadHashtags, saveHashtags } from "../../hashtags.js";
import { createProductDataProvider } from "../../data-source.js";
import { estimateReelLineMs, planSlideshow, reelCardLine } from "../video/slideshow.js";
import type { PriceMover, ProductDataProvider, RankedCard, ScopeCoverage } from "../../providers/product-data.js";
import { binderCoverHtml, binderCtaHtml, binderPageHtml, binderRankHtml, binderTeaserHtml, dataFooterText, dataUrlFor, rankingCoverHtml, rankingCtaHtml, rankingOverviewHtml, rankingSlideHtml, storyHtml, type BinderChrome, type RenderJob, type RankingSlide } from "./render.js";
import { loadSlideSettings } from "../../slide-settings.js";
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
/**
 * Gerundet, nur für die Fächer der Übersichtsseite: auf 15 Kacheln passt
 * „1.171 €", nicht „1.170,71 €". Einzelslides bleiben auf den Cent genau.
 */
const fmtEurRund = (v: number, lang: "de" | "en") =>
  lang === "de" ? `${Math.round(v).toLocaleString("de-DE")} €` : `€${Math.round(v).toLocaleString("en-GB")}`;
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

/**
 * Aufteilung der Binderseite: die Top-Plätze einzeln, der Rest in 9er-Seiten,
 * absteigend — Platz 20 steht auf der ersten Seite oben links.
 */
export function binderPlan(n: number, einzeln = 5): { pages: number[][]; singles: number[] } {
  const top = Math.min(einzeln, Math.max(0, n));
  const rest = Array.from({ length: Math.max(0, n - top) }, (_, i) => n - i);
  const pages: number[][] = [];
  for (let i = 0; i < rest.length; i += 9) pages.push(rest.slice(i, i + 9));
  return { pages, singles: Array.from({ length: top }, (_, i) => top - i) };
}
/** Slides eines Binderseiten-Carousels: Deckseite, Seiten, Einzelplätze, Abschluss. */
export const binderSlideCount = (n: number): number => { const pl = binderPlan(n); return 1 + pl.pages.length + pl.singles.length + 1; };

/** Reel B: Hook, eine Seite, die Top 3 je verdeckt und aufgedeckt, Abschluss — Standzeiten in ms. */
export const REEL_B_SEGMENTS: { key: string; ms: number }[] = [
  { key: "hook", ms: 2000 }, { key: "seite", ms: 3000 },
  { key: "c3q", ms: 900 }, { key: "c3", ms: 1800 }, { key: "c2q", ms: 900 }, { key: "c2", ms: 1800 },
  { key: "c1q", ms: 1000 }, { key: "c1", ms: 2600 }, { key: "end", ms: 2500 },
];

const Out = z.object({
  title: z.string().default(""),
  /**
   * Die Zeile unter dem Abschluss-Satz — Tatsachen über das Produkt
   * („Kostenlos starten · 33.746 Karten"). Bleibt leer, wenn niemand sie
   * setzt: erfundene Produktdaten wären schlimmer als gar keine.
   */
  trustLine: z.string().default(""),
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
): Promise<{ loaded: Loaded[]; skipped: string[]; scopeLabel: string; scopeSub: string; scopeSubEn: string; scopeOfficial: number; totalEur: number; priceStand: string; coverage: ScopeCoverage | null; withHistory: number }> {
  const want = q.n + IMAGE_SPARE;
  if (q.kind === "movers") {
    const res = await provider.priceMovers({ days: q.days, direction: q.direction, minBaseEur: q.minBaseEur, n: want, region: q.region, minPoints: q.minPoints });
    // Ausreisser aussortieren: ein Trendpreis, der sich in einer Woche vervierfacht,
    // misst bei duenn gehandelten Karten die Datenlage, nicht den Markt.
    const plausible = q.maxChangePct > 0 ? res.cards.filter((c) => Math.abs(c.changePct) <= q.maxChangePct) : res.cards;
    const verworfen = res.cards.length - plausible.length;
    const { loaded, skipped } = await withImages(provider, plausible, q.n, lang);
    if (verworfen > 0) skipped.push(`${verworfen} Karten mit über ${q.maxChangePct} % Ausschlag verworfen (unglaubwürdig bei dieser Datenlage)`);
    return { loaded, skipped, scopeLabel: res.scopeLabel, scopeSub: "", scopeSubEn: "", scopeOfficial: 0, totalEur: 0, priceStand: res.priceStand, coverage: null, withHistory: res.withHistory };
  }
  if (!q.set && !q.era && !q.illustrator) throw err("Bereich fehlt: Set, Ära oder Illustrator wählen.");
  const res = await provider.topCards({
    scope: { ...(q.set ? { set: q.set } : {}), ...(q.era ? { era: q.era } : {}), ...(q.illustrator ? { illustrator: q.illustrator } : {}), region: q.region },
    n: want, priceBasis: q.priceBasis, ...(q.minPrice !== undefined ? { minPrice: q.minPrice } : {}),
  });
  const { loaded, skipped } = await withImages(provider, res.cards, q.n, lang);
  // Gesamtwert der Liste, die wirklich veroeffentlicht wird - nicht der ueberholten Abfrage.
  const totalEur = Math.round(loaded.reduce((sum, x) => sum + x.card.priceEur, 0) * 100) / 100;
  const scopeLabel = lang === "en" && res.scopeLabelEn ? res.scopeLabelEn : res.scopeLabel;
  return { loaded, skipped, scopeLabel, scopeSub: res.scopeSub, scopeSubEn: res.scopeSubEn, scopeOfficial: res.scopeOfficial, totalEur, priceStand: res.priceStand, coverage: res.coverage, withHistory: 0 };
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

  // Aufbau der Slides: Binderseite (Projekt-Einstellung oder Anfrage) oder klassisch.
  // Im Ratemodus bleibt es klassisch — dort kommt jede Karte zweimal.
  const slideSettings = loadSlideSettings(ctx.db, base.project.id);
  const binder = (req.layout ?? slideSettings.layout) === "binder" && q.kind !== "guess";
  const projektDomain = base.project.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const domain = lang === "de" && slideSettings.linkDomain ? slideSettings.linkDomain : projektDomain;
  const logoAsset = base.kit.logoAssetId ? ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.id, base.kit.logoAssetId)).get() : undefined;
  const logoDataUrl = logoAsset ? dataUrlFor(path.join(ctx.dataDir, logoAsset.path)) : null;

  /**
   * Ein Reel muss unter 60 s bleiben. Die Entscheidung, wie viele Karten das
   * hergibt, faellt **vor** dem Modellaufruf — sonst schriebe es „die Top 10“
   * ueber ein Video, das nur acht zeigt. Geschaetzt wird mit demselben Satz und
   * demselben Schaetzer, den der Job spaeter benutzt.
   */
  const reelOpts = s.ReelOptions.parse(req.reel ?? {});
  const reelNotes: string[] = [];
  if (format === "data_reel" && binder) {
    const pl = binderPlan(data.loaded.length, 3);
    if (pl.pages.length > 1) {
      const vorher = data.loaded.length;
      data.loaded = data.loaded.slice(0, 12);
      data.totalEur = Math.round(data.loaded.reduce((sum, x) => sum + x.card.priceEur, 0) * 100) / 100;
      if (req.manualText) throw err(`${vorher} Karten passen nicht in ein Binder-Reel: eine Seite trägt neun, dazu die Top 3 — höchstens 12 Karten anfragen (n=12).`);
      reelNotes.push(`Aus ${vorher} Karten wurden 12: eine Binderseite trägt neun, dazu die Top 3.`);
    }
  } else if (format === "data_reel") {
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
      // Dieselbe Rechnung wie im Job: ohne Textkachel faellt ihre Zeit weg.
      // Weicht die Vorab-Planung ab, kuendigt die Caption Karten an, die das
      // Video nicht zeigt.
      ...(reelOpts.hookCard ? {} : { hookMs: 0 }),
      ...(reelOpts.voiceover ? { ...(reelOpts.hookCard ? { hookMs: 4500 } : {}), endMs: 4500 } : {}),
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

  /**
   * Karten auf das Bilder-Limit der engsten Plattform bringen — **vor** dem Text.
   *
   * Instagram nimmt zehn Bilder je Carousel und wirft den Rest wortlos weg. Bei
   * einer Rangliste im Countdown wären das Platz 1 bis 6 und der Abschluss-Slide.
   * Dieselbe Regel wie beim Reel: die Zahl steht fest, bevor jemand „die 15
   * teuersten" darüberschreibt.
   */
  let kappNotiz = "";
  if (format === "data_carousel" && binder) {
    const zaehlen = platforms.filter((p) => mediaLimitFor(p) > 1);
    const platz = zaehlen.length ? Math.min(...zaehlen.map((p) => mediaLimitFor(p))) : Infinity;
    if (binderSlideCount(data.loaded.length) > platz) {
      let passen = data.loaded.length;
      while (passen > 3 && binderSlideCount(passen) > platz) passen--;
      const vorher = data.loaded.length;
      const engste = zaehlen.reduce((a, b) => (mediaLimitFor(a) <= mediaLimitFor(b) ? a : b));
      if (req.manualText) throw err(`${vorher} Karten ergeben ${binderSlideCount(vorher)} Slides — ${engste} nimmt nur ${platz}. Höchstens ${passen} Karten anfragen (n=${passen}).`);
      data.loaded = data.loaded.slice(0, passen);
      data.totalEur = Math.round(data.loaded.reduce((sum, x) => sum + x.card.priceEur, 0) * 100) / 100;
      kappNotiz = `Aus ${vorher} Karten wurden ${passen}: ${engste} nimmt nur ${platz} Bilder je Beitrag.`;
    }
  } else if (format === "data_carousel") {
    // Abschluss-Slide, Deckseite und Übersichtskachel belegen Plätze, bevor die
    // erste Karte drankommt.
    const feste = 1 + (req.cover ? 1 : 0) + (req.overview && q.kind !== "guess" ? 1 : 0);
    const proKarte = q.kind === "guess" ? 2 : 1;  // im Ratemodus kommt jede Karte zweimal
    // Plattformen, die grundsätzlich nur ein Bild zeigen (Pinterest: ein Pin ist
    // ein Bild), dürfen die Länge des Carousels nicht bestimmen — sie nehmen
    // ohnehin die Deckseite und ignorieren den Rest.
    const zaehlen = platforms.filter((p) => mediaLimitFor(p) > 1);
    const platz = zaehlen.length ? Math.min(...zaehlen.map((p) => mediaLimitFor(p))) : Infinity;
    const passen = Math.max(1, Math.floor((platz - feste) / proKarte));
    if (data.loaded.length > passen) {
      const vorher = data.loaded.length;
      data.loaded = data.loaded.slice(0, passen);
      data.totalEur = Math.round(data.loaded.reduce((sum, x) => sum + x.card.priceEur, 0) * 100) / 100;
      const engste = zaehlen.reduce((a, b) => (mediaLimitFor(a) <= mediaLimitFor(b) ? a : b));
      // Bei fertigen Texten muss der Lauf abbrechen: „die 15 teuersten" über
      // acht Karten zu schreiben wäre eine Falschaussage, und niemand kann den
      // Text hinterher noch anpassen. Schreibt das Modell, reicht die Notiz —
      // es sieht die gekürzte Liste und formuliert danach.
      if (req.manualText) {
        throw err(
          `${vorher} Karten ergeben ${vorher * proKarte + feste} Slides — ${engste} nimmt nur ${platz}. `
          + `Höchstens ${passen} Karten anfragen (n=${passen}), sonst fehlen im Beitrag die vorderen Plätze.`,
        );
      }
      kappNotiz = `Aus ${vorher} Karten wurden ${passen}: ${engste} nimmt nur ${platz} Bilder je Beitrag.`;
    }
  }
  const footer = dataFooterText(fmtDate(data.priceStand, lang), domain, q.priceBasis);
  const brand = base.brief.productName;

  // --- der einzige Modellaufruf des Laufs -----------------------------------
  // ... es sei denn, die Texte kommen schon fertig herein. Dann bleibt vom Lauf
  // genau das uebrig, was ohnehin deterministisch ist: die Slides aus den Zahlen.
  const out = req.manualText
    ? Out.parse(req.manualText)
    : await chatJson(ctx.llm, modelFor("content"), Out, dataContentPrompt({
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
  const slideOf = (x: Loaded, i: number, total: number, hidePrice = false): RankingSlide => {
    const mover = "changePct" in x.card ? (x.card as PriceMover) : null;
    return {
      rank: rankOf.get(x.card.id)!,
      name: lang === "en" && x.card.nameEn ? x.card.nameEn : x.card.name,
      setLine: `${x.card.setName} · ${x.card.localId}${x.card.priceBasisUsed === "holo" ? " · holo" : ""}`,
      price: fmtEur(x.card.priceEur, lang),
      ...(mover ? { change: changeLabel(mover, lang) } : {}),
      imageDataUrl: x.dataUrl,
      index: i + 1, total,
      ...(hidePrice ? { hidePrice: true } : {}),
    };
  };
  // Ratemodus: jede Karte kommt zweimal — erst verdeckt, dann aufgeloest.
  const slides: RankingSlide[] = q.kind === "guess"
    ? ordered.flatMap((x, i) => [slideOf(x, i * 2, ordered.length * 2 + (req.cover ? 2 : 1), true), slideOf(x, i * 2 + 1, ordered.length * 2 + (req.cover ? 2 : 1))])
    : ordered.map((x, i) => slideOf(x, i, ordered.length + (req.cover ? 2 : 1)));
  const totalLabel = q.kind === "guess"
    ? (lang === "de" ? `${data.loaded.length} Karten — was schätzt du?` : `${data.loaded.length} cards — what's your guess?`)
    : q.kind === "top"
    ? (lang === "de" ? `Zusammen ${fmtEur(data.totalEur, lang)}` : `Together ${fmtEur(data.totalEur, lang)}`)
    : (lang === "de" ? `Letzte ${q.days} Tage` : `Last ${q.days} days`);
  const coverImages = data.loaded.slice(0, 3).map((x) => x.dataUrl);
  const shot = opts.screenshotPath ? dataUrlFor(opts.screenshotPath) : null;
  // Die drei Ansichten der Startseite fuer den Abschluss-Slide. Sie liegen als
  // Projekt-Assets mit `produktbild` in der Meta und sind nach `rang` sortiert.
  const produktBilder = ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.projectId, base.project.id)).all()
    .map((a) => ({ a, m: parseJson<Record<string, unknown>>(a.meta, {}) }))
    .filter((x) => x.m["produktbild"] === true)
    .sort((a, b) => Number(a.m["rang"] ?? 0) - Number(b.m["rang"] ?? 0))
    .map((x) => ({ url: dataUrlFor(path.join(ctx.dataDir, x.a.path)), label: String(x.m["label"] ?? "") }))
    .filter((x): x is { url: string; label: string } => Boolean(x.url));

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
  // Etiketten und Hinweise der Binderseite, je Sprache.
  const L = lang === "de"
    ? { platz: "Platz", nr: "Nr.", illu: "Illustration", bis: "bis", karten: "Karten", naechste: "Nächste Seite", setcheck: "Set-Check" }
    : { platz: "No.", nr: "No.", illu: "Illustration", bis: "to", karten: "cards", naechste: "Next page", setcheck: "Set check" };
  const chrome = (corner: string): BinderChrome => ({ brand, footer, logoDataUrl, corner });
  const pocketOf = (x: Loaded): { rank: number; price: string; imageDataUrl: string | null } => ({ rank: rankOf.get(x.card.id)!, price: fmtEurRund(x.card.priceEur, lang), imageDataUrl: x.dataUrl });
  const rankSlideOf = (x: Loaded, hidePrice = false) => ({
    rank: rankOf.get(x.card.id)!, name: lang === "en" && x.card.nameEn ? x.card.nameEn : x.card.name,
    numLine: `${x.card.localId}${data.scopeOfficial ? ` / ${data.scopeOfficial}` : ""}`, illustrator: x.card.illustrator,
    price: fmtEur(x.card.priceEur, lang), imageDataUrl: x.dataUrl, ...(hidePrice ? { hidePrice: true } : {}),
  });
  const byRank = new Map(data.loaded.map((x) => [rankOf.get(x.card.id)!, x]));
  const coverSub = lang === "en" ? data.scopeSubEn : data.scopeSub;
  const linkLabelFor = (rule: string) => (rule === "bio" ? (lang === "de" ? "Link in Bio" : "Link in bio") : domain);
  /** Reel B: der feste Zeitplan, den der Video-Job übernimmt — nur beim Binder-Reel gesetzt. */
  let reelSegments: { key: string; ms: number }[] | null = null;

  for (const size of sizes) {
    const files: string[] = [];
    if (binder && format === "data_carousel") {
      const pl = binderPlan(data.loaded.length);
      const gesamt = binderSlideCount(data.loaded.length);
      let i = 1;
      const cover = path.join(outDir, `${lang}-${size.tag}-00-cover.png`);
      jobs.push({ html: binderCoverHtml(base.kit, { title: coverTitle, sub: coverSub, images: data.loaded.slice(0, 9).map((x) => x.dataUrl), hint: `Top ${data.loaded.length} ${L.karten}` }, size.w, size.h, chrome(L.setcheck)), width: size.w, height: size.h, file: cover });
      files.push(cover);
      pl.pages.forEach((ranks, k) => {
        i++;
        const file = path.join(outDir, `${lang}-${size.tag}-00${String.fromCharCode(98 + k)}-seite${k + 1}.png`);
        const letzte = k === pl.pages.length - 1;
        jobs.push({ html: binderPageHtml(base.kit, {
          tab: `${L.platz} ${ranks[0]} ${L.bis} ${ranks[ranks.length - 1]}`,
          pockets: ranks.map((r) => pocketOf(byRank.get(r)!)),
          leerText: `Top ${pl.singles.length}`, hint: letzte ? `Top ${pl.singles.length} ${L.karten}` : L.naechste,
        }, size.w, size.h, chrome(`${i} / ${gesamt}`)), width: size.w, height: size.h, file });
        files.push(file);
      });
      pl.singles.forEach((r) => {
        i++;
        const file = path.join(outDir, `${lang}-${size.tag}-${String(i).padStart(2, "0")}-rang${r}.png`);
        jobs.push({ html: binderRankHtml(base.kit, rankSlideOf(byRank.get(r)!), size.w, size.h, chrome(`${i} / ${gesamt}`), L), width: size.w, height: size.h, file });
        files.push(file);
      });
      for (const rule of linkRules) {
        const file = path.join(outDir, `${lang}-${size.tag}-99-cta-${rule}.png`);
        jobs.push({ html: binderCtaHtml(base.kit, { line: ctaLine, trustLine: out.trustLine, linkLabel: linkLabelFor(rule), productImages: produktBilder }, size.w, size.h, chrome(`${gesamt} / ${gesamt}`)), width: size.w, height: size.h, file });
        ctaFiles.set(`${size.tag}:${rule}`, file);
      }
      bySize.set(size.tag, files);
      continue;
    }
    if (binder && format === "data_reel") {
      // Reel B: Hook (Frage), eine Seite mit Platz n bis 4, Top 3 je verdeckt und
      // aufgedeckt, Abschluss. Die Reihenfolge hier ist die Reihenfolge im Video.
      const pl = binderPlan(data.loaded.length, 3);
      const hook = path.join(outDir, `${lang}-${size.tag}-00-hook.png`);
      jobs.push({ html: binderTeaserHtml(base.kit, { line: out.hook || coverTitle, images: data.loaded.slice(3, 6).map((x) => x.dataUrl), hint: `Top ${data.loaded.length}`, down: false }, size.w, size.h, chrome("")), width: size.w, height: size.h, file: hook });
      files.push(hook);
      const ranks = pl.pages[0] ?? [];
      const seite = path.join(outDir, `${lang}-${size.tag}-01-seite.png`);
      jobs.push({ html: binderPageHtml(base.kit, {
        tab: ranks.length ? `${L.platz} ${ranks[0]} ${L.bis} ${ranks[ranks.length - 1]}` : coverTitle,
        pockets: ranks.map((r) => pocketOf(byRank.get(r)!)), leerText: "Top 3", hint: `Top 3 ${L.karten}`, width: "84%",
      }, size.w, size.h, chrome("")), width: size.w, height: size.h, file: seite });
      files.push(seite);
      let i = 1;
      for (const r of pl.singles) {
        for (const frage of [true, false]) {
          i++;
          const file = path.join(outDir, `${lang}-${size.tag}-${String(i).padStart(2, "0")}-rang${r}${frage ? "-frage" : ""}.png`);
          jobs.push({ html: binderRankHtml(base.kit, rankSlideOf(byRank.get(r)!, frage), size.w, size.h, chrome(""), L), width: size.w, height: size.h, file });
          files.push(file);
        }
      }
      for (const rule of linkRules) {
        const file = path.join(outDir, `${lang}-${size.tag}-99-cta-${rule}.png`);
        jobs.push({ html: binderCtaHtml(base.kit, { line: ctaLine, trustLine: out.trustLine, linkLabel: linkLabelFor(rule), productImages: produktBilder }, size.w, size.h, chrome("")), width: size.w, height: size.h, file });
        ctaFiles.set(`${size.tag}:${rule}`, file);
      }
      reelSegments = [REEL_B_SEGMENTS[0]!, REEL_B_SEGMENTS[1]!, ...pl.singles.flatMap((r) => [{ key: `c${r}q`, ms: r === 1 ? 1000 : 900 }, { key: `c${r}`, ms: r === 1 ? 2600 : 1800 }]), REEL_B_SEGMENTS[REEL_B_SEGMENTS.length - 1]!];
      bySize.set(size.tag, files);
      continue;
    }
    if (req.cover) {
      const cover = path.join(outDir, `${lang}-${size.tag}-00-cover.png`);
      jobs.push({ html: rankingCoverHtml(base.kit, { title: coverTitle, totalLabel, images: coverImages, ...(out.hook ? { hook: out.hook } : {}) }, size.w, size.h, brand, footer), width: size.w, height: size.h, file: cover });
      files.push(cover);
    }
    // Slide 2: die ganze Liste auf einem Bild. Im Ratemodus ergibt sie keinen
    // Sinn — sie verriete die Preise, die erst aufgelöst werden sollen.
    if (req.overview && q.kind !== "guess") {
      const uebersicht = path.join(outDir, `${lang}-${size.tag}-00b-uebersicht.png`);
      jobs.push({
        html: rankingOverviewHtml(base.kit, {
          title: lang === "de" ? "Alle auf einen Blick" : "All at a glance",
          sub: totalLabel,
          cards: data.loaded.map((x, n) => ({ rank: n + 1, price: fmtEur(x.card.priceEur, lang), imageDataUrl: x.dataUrl })),
        }, size.w, size.h, brand, footer),
        width: size.w, height: size.h, file: uebersicht,
      });
      files.push(uebersicht);
    }
    slides.forEach((sl, i) => {
      const file = path.join(outDir, `${lang}-${size.tag}-${String(i + 1).padStart(2, "0")}-rang${sl.rank}${sl.hidePrice ? "-frage" : ""}.png`);
      jobs.push({ html: rankingSlideHtml(base.kit, sl, size.w, size.h, brand, footer), width: size.w, height: size.h, file });
      files.push(file);
    });
    for (const rule of linkRules) {
      const file = path.join(outDir, `${lang}-${size.tag}-99-cta-${rule}.png`);
      const linkLabel = linkLabelFor(rule);
      jobs.push({ html: rankingCtaHtml(base.kit, { line: ctaLine, linkLabel, imageDataUrl: shot, trustLine: out.trustLine, productImages: produktBilder }, size.w, size.h, brand, footer), width: size.w, height: size.h, file });
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
  // Von Hand geschriebene Texte gehen unangetastet durch: der Kritiker sucht
  // KI-Spuren und wuerde an einem menschlichen Text nur herumschleifen.
  const rev = req.manualText
    ? { body: leadCaption, score: null, notes: "Texte von Hand geschrieben — kein Modellaufruf, keine AI-Tell-Prüfung." }
    : await reviseWithCritic(ctx, usage, { body: leadCaption, language: lang, voiceProfile: base.voice, format, platform: leadPlatform, limit: PLATFORM_LIMITS[leadPlatform] ?? 2000, maxRounds: 2 });

  const notes = [rev.notes];
  if (data.skipped.length) notes.push(`Ohne ladbares Bild übersprungen (${data.skipped.length}): ${data.skipped.join(", ")}. Die Rangfolge ist die der veröffentlichten Liste.`);
  if (data.coverage && data.coverage.skipped > 0) notes.push(`${data.coverage.skipped} Karten im Bereich wurden nicht nachbepreist (Deckel je Abfrage).`);
  if (q.kind === "movers") notes.push(`Beruht auf ${data.withHistory} Karten mit Preisverlauf.`);
  notes.push(...reelNotes);
  if (kappNotiz) notes.push(kappNotiz);

  // --- Story: ein Bild, das auf den Beitrag von heute hinweist ---------------
  // Sie hängt am selben Bündel, ist aber ein eigenes Stück: 24 Stunden sichtbar,
  // eigener Zeitpunkt, eigene Freigabe. Nur Instagram — bei allen anderen
  // Plattformen gibt es über die API keinen Weg dorthin.
  let storyId: string | null = null;
  if (req.withStory && platforms.includes("instagram")) {
    const storyFile = path.join(outDir, `${lang}-story-1080x1920.png`);
    const storyLine = req.manualText?.storyLine || (binder
      ? (lang === "de" ? `Die ${data.loaded.length} teuersten Karten aus ${coverTitle}` : `The ${data.loaded.length} most valuable cards from ${coverTitle}`)
      : out.hook || coverTitle);
    const storyHint = req.manualText?.storyHint || (binder
      ? (lang === "de" ? "Alle im Beitrag" : "All in the post")
      : (lang === "de" ? "Die ganze Liste im Beitrag ↓" : "Full list in the post ↓"));
    await opts.renderer([{
      html: binder ? binderTeaserHtml(base.kit, { line: storyLine, images: coverImages, hint: storyHint, down: true }, 1080, 1920, chrome(lang === "de" ? "Neu im Feed" : "New in the feed")) : storyHtml(base.kit, {
        eyebrow: lang === "de" ? "Neu heute" : "New today",
        line: storyLine, sub: totalLabel, images: coverImages, hint: storyHint,
      }, 1080, 1920, brand, footer),
      width: 1080, height: 1920, file: storyFile,
    }]);
    storyId = newId();
    const ts = nowIso();
    // Zeile zuerst: das Asset hat einen Fremdschluessel auf das Stueck.
    ctx.db.insert(t.mpContentPieces).values({
      id: storyId, projectId: base.project.id, taskId: req.taskId ?? null,
      channel: "instagram", format: "story",
      title: `${coverTitle} · Story`, body: storyLine,
      assets: toJson([]), status: "review", humanEdited: false,
      publishedAt: null, externalUrl: null, utm: toJson({}),
      meta: toJson({
        bundleId: leadId, platform: "instagram", size: "1080x1920", linkRule: "bio",
        storyHint, coverTitle, footer, scopeLabel: data.scopeLabel, language: lang,
        note: "Story: 24 Stunden sichtbar. Sticker und antippbare Links gibt die API nicht her — der Hinweis steht im Bild.",
      }),
      aiTellScore: null, aiTellNotes: "", rejectionReason: "",
      createdAt: ts, updatedAt: ts,
    }).run();
    const storyAsset = opts.addAsset(storyId, storyFile, { size: "1080x1920", slide: "story", language: lang, dataSlide: true });
    ctx.db.update(t.mpContentPieces).set({ assets: toJson([storyAsset]) }).where(eq(t.mpContentPieces.id, storyId)).run();
    notes.push("Story erzeugt (1080×1920, Instagram) — eigenes Stück im selben Bündel.");
  }

  const gebaut = writeBundlePieces({
    db: ctx.db, projectId: base.project.id, leadId, format, language: lang, platforms,
    taskId: req.taskId ?? null,
    title: out.title || coverTitle,
    score: rev.score, notes: notes.filter(Boolean).join("\n"),
    captionFor: (platform, isLead) => (isLead ? rev.body : captionOf(platform) || rev.body),
    hashtagsFor: (platform) => out.captions.find((c) => c.platform.trim().toLowerCase() === platform)?.hashtags ?? [],
    assetsFor: (platform) => {
      const size = sizeForPlatform(platform, format);
      const rule = format === "data_reel" ? linkRuleFor(leadPlatform) : linkRuleFor(platform);
      return [...(bySize.get(size.tag) ?? []), ctaFiles.get(`${size.tag}:${rule}`) ?? ""].filter(Boolean).map((f) => assetIds.get(f)!).filter(Boolean);
    },
    sizeFor: (platform) => sizeForPlatform(platform, format).tag,
    ruleFor: (platform) => (format === "data_reel" ? linkRuleFor(leadPlatform) : linkRuleFor(platform)),
    meta: {
      ...(format === "data_reel" ? { reel: reelOpts } : {}),
      hook: out.hook, coverTitle, ctaLine, footer, layout: binder ? "binder" : "klassisch", linkDomain: domain,
      ...(reelSegments ? { reelSegments } : {}),
      dataQuery: q, scopeLabel: data.scopeLabel, scopeSub: coverSub, priceStand: data.priceStand, totalEur: data.totalEur,
      cards: data.loaded.map((x, n) => ({ rank: n + 1, id: x.card.id, name: x.card.name, nameEn: x.card.nameEn, setName: x.card.setName, localId: x.card.localId, priceEur: x.card.priceEur, priceBasisUsed: x.card.priceBasisUsed, priceUpdatedAt: x.card.priceUpdatedAt })),
      skippedNoImage: data.skipped, coverage: data.coverage, request: req,
    },
  });
  return gebaut;
}

/**
 * Eine Story zu einem Beitrag nachreichen, der schon existiert.
 *
 * Alles, was die Story braucht, steht in `meta` des Leit-Stücks: Titel, Hook,
 * Fußzeile und die Kartenliste. Nur die drei Bilder werden neu geladen — sie
 * liegen im Cache des Providers, das kostet nichts. So muss ein fertiges
 * Bündel nicht noch einmal durch den Renderer, nur weil eine Story fehlt.
 */
export async function generateStoryFor(
  ctx: StudioContext, base: DataBase, pieceId: string,
  opts: { addAsset: (pieceId: string, file: string, meta: Record<string, unknown>) => string; renderer: (jobs: RenderJob[]) => Promise<void>; line?: string; hint?: string },
): Promise<string> {
  const row = ctx.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  if (!row) throw err("Stück nicht gefunden.", 404);
  const meta = parseJson<Record<string, unknown>>(row.meta, {});
  const bundleId = String(meta["bundleId"] ?? row.id);
  const vorhanden = ctx.db.select().from(t.mpContentPieces)
    .where(and(eq(t.mpContentPieces.projectId, base.project.id), eq(t.mpContentPieces.format, "story"))).all()
    .find((x) => parseJson<Record<string, unknown>>(x.meta, {})["bundleId"] === bundleId);
  if (vorhanden) throw err("Zu diesem Beitrag gibt es schon eine Story.");

  const lang: "de" | "en" = String(meta["language"] ?? "de") === "en" ? "en" : "de";
  const karten = (meta["cards"] as { id: string }[] | undefined) ?? [];
  const provider = createProductDataProvider(ctx.db, ctx.env, base.project.id, { log: ctx.log });
  const bilder: string[] = [];
  try {
    for (const k of karten.slice(0, 3)) {
      if (!provider) break;
      const datei = await provider.cardImage(k.id, lang);
      const url = datei ? dataUrlFor(datei) : null;
      if (url) bilder.push(url);
    }
  } finally { provider?.close(); }

  const coverTitle = String(meta["coverTitle"] ?? row.title);
  const footer = String(meta["footer"] ?? "");
  const line = opts.line || String(meta["hook"] ?? "") || coverTitle;
  const hint = opts.hint || (lang === "de" ? "Die ganze Liste im Beitrag ↓" : "Full list in the post ↓");
  const totalEur = typeof meta["totalEur"] === "number" ? (meta["totalEur"] as number) : 0;
  // Zwei Summen auf einem Bild sind eine Falle: die Zeile nennt oft schon einen
  // Betrag, und die Gesamtsumme daneben meint etwas anderes. Trägt die Zeile
  // eine Zahl, bleibt die Summe weg.
  const zeileHatZahl = /\d/.test(line);
  const sub = totalEur > 0 && !zeileHatZahl
    ? (lang === "de" ? `Zusammen ${fmtEur(totalEur, lang)}` : `Together ${fmtEur(totalEur, lang)}`)
    : "";

  const storyId = newId();
  const datei = path.join(ctx.dataDir, "assets", base.project.id, "pieces", bundleId, `${lang}-story-1080x1920.png`);
  // Binderseite: dieselbe Kachel wie beim Erzeugen — eine Zeile, eine Reihe Karten, Pfeil nach unten.
  const binder = meta["layout"] === "binder";
  const logoAsset = base.kit.logoAssetId ? ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.id, base.kit.logoAssetId)).get() : undefined;
  const chrome = { brand: base.brief.productName, footer, logoDataUrl: logoAsset ? dataUrlFor(path.join(ctx.dataDir, logoAsset.path)) : null, corner: lang === "de" ? "Neu im Feed" : "New in the feed" };
  const binderLine = opts.line || (lang === "de" ? `Die ${karten.length} teuersten Karten aus ${coverTitle}` : `The ${karten.length} most valuable cards from ${coverTitle}`);
  const binderHint = opts.hint || (lang === "de" ? "Alle im Beitrag" : "All in the post");
  await opts.renderer([{
    html: binder
      ? binderTeaserHtml(base.kit, { line: binderLine, images: bilder, hint: binderHint, down: true }, 1080, 1920, chrome)
      : storyHtml(base.kit, { eyebrow: lang === "de" ? "Neu heute" : "New today", line, sub, images: bilder, hint },
        1080, 1920, base.brief.productName, footer),
    width: 1080, height: 1920, file: datei,
  }]);
  const ts = nowIso();
  // Zeile zuerst: das Asset hat einen Fremdschluessel auf das Stueck.
  ctx.db.insert(t.mpContentPieces).values({
    id: storyId, projectId: base.project.id, taskId: null,
    channel: "instagram", format: "story",
    title: `${coverTitle} · Story`, body: binder ? binderLine : line,
    assets: toJson([]), status: "review", humanEdited: false,
    publishedAt: null, externalUrl: null, utm: toJson({}),
    meta: toJson({
      bundleId, platform: "instagram", size: "1080x1920", linkRule: "bio",
      storyHint: hint, coverTitle, footer, language: lang,
      note: "Story: 24 Stunden sichtbar. Sticker und antippbare Links gibt die API nicht her — der Hinweis steht im Bild.",
    }),
    aiTellScore: null, aiTellNotes: "", rejectionReason: "",
    createdAt: ts, updatedAt: ts,
  }).run();
  const assetId = opts.addAsset(storyId, datei, { size: "1080x1920", slide: "story", language: lang, dataSlide: true });
  ctx.db.update(t.mpContentPieces).set({ assets: toJson([assetId]) }).where(eq(t.mpContentPieces.id, storyId)).run();
  // Die fertige Zeile holt der Aufrufer über seinen eigenen Mapper — hier
  // waere jede Nachbildung von `ContentPiece` eine zweite Wahrheit.
  return storyId;
}

/**
 * Die Stuecke eines Buendels in die Datenbank schreiben.
 *
 * Steht fuer sich, weil zwei Generatoren sie brauchen: die Ranglisten
 * (`generateDataBundle`) und der Binder-Showcase aus Shot 11. Hier haengen
 * `bundleId`, Asset-Zuordnung und Hashtag-Politik zusammen — genau die Stellen,
 * an denen eine zweite Kopie irgendwann auseinanderlaufen wuerde.
 */
export interface BundleRowsInput {
  db: Db;
  projectId: string;
  leadId: string;
  format: s.ContentPiece["format"];
  language: "de" | "en";
  platforms: string[];
  taskId: string | null;
  title: string;
  score: number | null;
  notes: string;
  captionFor: (platform: string, isLead: boolean) => string;
  hashtagsFor: (platform: string) => string[];
  assetsFor: (platform: string) => string[];
  sizeFor: (platform: string) => string;
  ruleFor: (platform: string) => "bio" | "link";
  meta: Record<string, unknown>;
}

export function writeBundlePieces(i: BundleRowsInput): s.ContentPiece[] {
  const pools = loadHashtags(i.db, i.projectId);
  const ts = nowIso();
  const pieces: s.ContentPiece[] = [];
  i.platforms.forEach((platform, n) => {
    const id = n === 0 ? i.leadId : newId();
    const tags = applyHashtagPolicy(i.hashtagsFor(platform), pools, platform, i.language);
    const body = [stripTags(i.captionFor(platform, n === 0)), tags.join(" ")].filter(Boolean).join("\n\n");
    const assets = i.assetsFor(platform);
    const meta: Record<string, unknown> = {
      ...i.meta,
      bundleId: i.leadId, bundleLead: n === 0, platform, language: i.language,
      size: i.sizeFor(platform), linkRule: i.ruleFor(platform),
      caption: body, hashtags: tags, limit: PLATFORM_LIMITS[platform] ?? 2000,
      // Reihenfolge der Slides = Reihenfolge im Video: Cover, Inhalt, CTA.
      ...(i.format === "data_reel" ? { slideAssets: assets } : {}),
    };
    const row = {
      id, projectId: i.projectId, taskId: n === 0 ? i.taskId : null,
      channel: platform, format: i.format,
      title: `${n === 0 ? i.title : i.title} · ${platform}`.slice(0, 120),
      // Ein Reel ist erst fertig, wenn der Worker die MP4 gebaut hat - bis dahin Entwurf.
      body, assets: toJson(assets), status: (i.format === "data_reel" ? "draft" : "review") as s.ContentPiece["status"], humanEdited: false,
      publishedAt: null, externalUrl: null, utm: "{}", meta: toJson(meta),
      aiTellScore: n === 0 ? i.score : null, aiTellNotes: n === 0 ? i.notes : "",
      rejectionReason: "", createdAt: ts, updatedAt: ts,
    };
    i.db.insert(t.mpContentPieces).values(row).onConflictDoUpdate({ target: t.mpContentPieces.id, set: { ...row } }).run();
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
