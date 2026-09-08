/**
 * Kunstseiten-Beitrag: die Kategorie, die kein anderer Binder-Planer hat.
 *
 * Eine Kunstseite ist eine 9er-Binderseite, deren Fächer teils echte Karten und
 * teils ein durchgehendes, erzeugtes Bild sind. Der Beitrag hat genau eine
 * Aufgabe: den Moment zeigen, in dem jemand begreift, dass die Hälfte der Seite
 * kein Kartenfoto ist. Deshalb steht die Auflösung in der Mitte und nicht am
 * Anfang.
 *
 * Aufbau der Slides — die Seite hat neun Fächer, der Beitrag hat sieben Slides:
 *
 * | 1 | Deckseite: die ganze Seite, die Frage darauf              |
 * | 2 | ein echtes Fach, herausvergrößert                         |
 * | 3 | ein zweites echtes Fach                                   |
 * | 4 | ein drittes echtes Fach                                   |
 * | 5 | Auflösung: dieselbe Seite, die echten Fächer markiert     |
 * | 6 | wie sie entsteht: Stil, Fächerzahl, Druck                 |
 * | 7 | Abschluss                                                 |
 *
 * Der Weg danach — Größen je Plattform, Caption je Kanal, Hashtag-Politik,
 * Bündel-Zeilen — ist derselbe wie bei Ranglisten und Showcase.
 */
import path from "node:path";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { newId, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, type UsageCollector } from "../runner.js";
import { artworkPrompt } from "../prompts/studio.js";
import { hashtagPolicy, linkRuleFor } from "../../../shared/channels.js";
import { PLATFORM_LIMITS } from "../../util/utm.js";
import { loadHashtags } from "../../hashtags.js";
import {
  artworkCoverHtml, artworkCtaHtml, artworkFachHtml, artworkRasterHtml, binderExplainerSlideHtml,
  dataUrlFor, type BinderChrome, type RenderJob,
} from "./render.js";
import { reviseWithCritic } from "./critic.js";
import { sizeForPlatform, writeBundlePieces, type DataBase } from "./data-content.js";
import {
  bildFaecher, downloadArtworkImage, echteFaecher, listArtworkPages,
  type ArtworkOptions as ProviderOptions, type ArtworkPage,
} from "../../providers/artwork.binderplan.js";
import type { StudioContext } from "./generate.js";

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });

/** Die zwölf Stile der Vitrine — für den Prompt und die „so entsteht sie"-Slide. */
export const ARTWORK_STILE = [
  "karte", "comic", "foto", "aquarell", "oel", "anime", "retro", "pixel", "neon", "skizze", "minimal", "dunkel",
] as const;

const Out = z.object({
  title: z.string().default(""),
  coverTitle: z.string().default(""),
  claims: z.array(z.string()).default([]),
  hook: z.string().default(""),
  ctaLine: z.string().default(""),
  captions: z.array(z.object({ platform: z.string(), caption: z.string().default(""), hashtags: z.array(z.string()).default([]) })).default([]),
});

const fmtDate = (d: Date, lang: "de" | "en") =>
  d.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Welche Kunstseite gezeigt wird.
 *
 * `ownOnly` ist die wichtigste Regel und steht standardmäßig an: „in der
 * Vitrine veröffentlicht" heißt sichtbar in der App und ist **keine**
 * Zustimmung, die Seite eines anderen Kontos auf Instagram zu stellen. Ohne
 * Anmeldung meldet die Vitrine `mein: false` für alles — dann entscheidet der
 * Besitzername, den der Aufrufer mitgibt.
 */
export function pickArtwork(
  pages: ArtworkPage[], cfg: { artworkId: string; ownOnly: boolean; styles: string[]; exclude?: string[] }, eigner: string,
): ArtworkPage {
  if (cfg.artworkId) {
    const treffer = pages.find((p) => p.id === cfg.artworkId);
    if (!treffer) throw err(`Die Kunstseite „${cfg.artworkId}" steht nicht (mehr) in der Vitrine.`, 404);
    return treffer;
  }
  let frei = pages;
  if (cfg.ownOnly) {
    const eigen = eigner.trim().toLowerCase();
    frei = frei.filter((p) => p.mein || (eigen && p.besitzer.trim().toLowerCase() === eigen));
    if (!frei.length) {
      throw err(`Keine eigene Kunstseite in der Vitrine${eigner ? ` (gesucht: „${eigner}")` : ""}. Fremde Seiten posten wir nicht ohne Zustimmung — entweder eine eigene Seite veröffentlichen oder in den Serien-Parametern „nur eigene" abschalten.`, 409);
    }
  }
  if (cfg.styles.length) {
    const gefiltert = frei.filter((p) => cfg.styles.includes(p.stil));
    if (gefiltert.length) frei = gefiltert;
  }
  // Neueste zuerst: eine frisch veroeffentlichte Seite ist die interessanteste.
  const sortiert = [...frei].sort((a, b) => b.veroeffentlichtAt.localeCompare(a.veroeffentlichtAt));
  // Kuerzlich Gezeigtes ueberspringen — aber lieber eine Wiederholung als ein
  // ausgefallener Slot, deshalb faellt die Sperre weg, wenn nichts uebrig bleibt.
  const gesperrt = new Set(cfg.exclude ?? []);
  return sortiert.find((p) => !gesperrt.has(p.id)) ?? sortiert[0]!;
}

export interface ArtworkBundleOpts {
  leadPieceId?: string;
  language: "de" | "en";
  addAsset: (pieceId: string, file: string, meta: Record<string, unknown>) => string;
  renderer: (jobs: RenderJob[]) => Promise<void>;
  /** Binderplans HTTP-Dienst und ein einspeisbares `fetch`, damit Tests ohne Netz laufen. */
  provider: ProviderOptions;
}

export async function generateArtworkBundle(
  ctx: StudioContext, base: DataBase, req: s.ContentRequest, usage: UsageCollector, opts: ArtworkBundleOpts,
): Promise<s.ContentPiece[]> {
  const cfg = s.ArtworkContentOptions.parse(req.artwork ?? {});
  const lang = opts.language;
  const leadId = opts.leadPieceId ?? newId();

  const pages = await listArtworkPages(opts.provider);
  if (!pages.length) throw err("Die Vitrine hat keine veröffentlichte Kunstseite mit lesbarem Raster.", 409);
  const page = pickArtwork(pages, cfg, cfg.owner);

  const outDir = path.join(ctx.dataDir, "assets", base.project.id, "pieces", leadId);
  const quelle = await downloadArtworkImage(page.id, path.join(outDir, "quelle"), opts.provider);
  const bild = dataUrlFor(quelle);
  if (!bild) throw err("Das Vorschaubild der Kunstseite ließ sich nicht lesen.");

  const echt = echteFaecher(page);
  const bilder = bildFaecher(page);
  const gesamt = page.faecher.length;
  const ratio = `${page.breite}/${page.hoehe}`;

  const platforms = (req.bundlePlatforms.length ? req.bundlePlatforms : [req.platform ?? "instagram"])
    .map((p) => p.trim().toLowerCase()).filter((p, i, all) => p && all.indexOf(p) === i);
  const leadPlatform = platforms[0]!;
  const brand = base.brief.productName;
  const domain = base.project.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const L = lang === "de"
    ? { faecher: "Fächer", echt: "echt", aufloesung: "Aufgelöst", stil: "Stil", so: "So entsteht sie", nurEcht: "echte Karte", seite: "Kunstseite", kiHinweis: "Bild KI-erzeugt", drucken: "Als PDF drucken, in dieselbe Hülle" }
    : { faecher: "pockets", echt: "real", aufloesung: "Revealed", stil: "Style", so: "How it is made", nurEcht: "real card", seite: "Art page", kiHinweis: "Image AI-generated", drucken: "Print as PDF, into the same sleeve" };
  const footer = `${L.seite} · ${domain} · ${fmtDate(new Date(), lang)} · ${L.kiHinweis}`;

  // --- der einzige Modellaufruf ---------------------------------------------
  const out = await chatJson(ctx.llm, modelFor("content"), Out, artworkPrompt({
    brief: base.brief, ...(base.personas[0] ? { persona: base.personas[0] } : {}), voiceProfile: base.voice, language: lang,
    titel: page.titel, stil: page.stil, bildFaecher: bilder, gesamtFaecher: gesamt,
    karten: echt.map((x) => x.name), stile: [...ARTWORK_STILE],
    platforms: platforms.map((p) => ({ platform: p, limit: PLATFORM_LIMITS[p] ?? 2000, policy: hashtagPolicy(p), linkRule: linkRuleFor(p) })),
    pools: loadHashtags(ctx.db, base.project.id), topic: req.topic, hint: req.hint,
  }), usage, { maxTokens: 3000, temperature: 0.6 });

  const coverTitle = (out.coverTitle
    || (lang === "de" ? `${bilder} von ${gesamt} Fächern gab es nie als Karte` : `${bilder} of ${gesamt} pockets were never a card`)).slice(0, 80);
  const ctaLine = (out.ctaLine || (lang === "de" ? `Plane deine Seiten mit ${brand}.` : `Plan your pages with ${brand}.`)).slice(0, 120);
  const claims = (out.claims.length ? out.claims : [
    lang === "de" ? `${echt.length} echte Karten, ${bilder} Fächer Bild` : `${echt.length} real cards, ${bilder} image pockets`,
    lang === "de" ? `Stil „${page.stil}"` : `Style "${page.stil}"`,
  ]).slice(0, 3).map((x) => x.slice(0, 46));

  // --- rendern ---------------------------------------------------------------
  const logoAsset = base.kit.logoAssetId ? ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.id, base.kit.logoAssetId)).get() : undefined;
  const logoDataUrl = logoAsset ? dataUrlFor(path.join(ctx.dataDir, logoAsset.path)) : null;
  const chrome = (corner: string): BinderChrome => ({ brand, footer, logoDataUrl, corner });

  // Höchstens drei Beweis-Fächer: mehr macht das Carousel lang, ohne mehr zu zeigen.
  const beweise = echt.slice(0, 3);
  const sizes = [...new Map(platforms.map((p) => [sizeForPlatform(p).tag, sizeForPlatform(p)])).values()];
  const linkRules = [...new Set(platforms.map(linkRuleFor))];
  const jobs: RenderJob[] = [];
  const bySize = new Map<string, string[]>();
  const ctaFiles = new Map<string, string>();

  for (const size of sizes) {
    const files: string[] = [];
    const datei = (n: string) => path.join(outDir, `${lang}-${size.tag}-${n}.png`);

    const cover = datei("00-deckseite");
    jobs.push({
      html: artworkCoverHtml(base.kit, {
        title: coverTitle, claims, imageDataUrl: bild, ratio,
        hint: lang === "de" ? `Welche ${echt.length}?` : `Which ${echt.length}?`,
      }, size.w, size.h, chrome(page.titel)),
      width: size.w, height: size.h, file: cover,
    });
    files.push(cover);

    beweise.forEach((x, i) => {
      const file = datei(`${String(i + 1).padStart(2, "0")}-fach${x.slot + 1}`);
      jobs.push({
        html: artworkFachHtml(base.kit, {
          headline: x.name || (lang === "de" ? `Fach ${x.slot + 1}` : `Pocket ${x.slot + 1}`),
          sub: lang === "de" ? `Fach ${x.slot + 1} von ${gesamt} — eine echte Karte` : `Pocket ${x.slot + 1} of ${gesamt} — a real card`,
          imageDataUrl: bild, spalten: page.spalten, zeilen: page.zeilen, slot: x.slot, marke: L.echt,
        }, size.w, size.h, chrome(`${i + 1} / ${beweise.length}`)),
        width: size.w, height: size.h, file,
      });
      files.push(file);
    });

    const reveal = datei(`${String(beweise.length + 1).padStart(2, "0")}-aufloesung`);
    jobs.push({
      html: artworkRasterHtml(base.kit, {
        headline: lang === "de" ? `${echt.length} echt, ${bilder} gemalt` : `${echt.length} real, ${bilder} painted`,
        sub: lang === "de" ? "Ein Bild, das um die vorhandenen Karten herum gebaut wurde." : "One image, built around the cards that were already there.",
        imageDataUrl: bild, spalten: page.spalten, zeilen: page.zeilen,
        echt: echt.map((x) => x.slot), etikett: L.nurEcht, ratio,
      }, size.w, size.h, chrome(L.aufloesung)),
      width: size.w, height: size.h, file: reveal,
    });
    files.push(reveal);

    const wie = datei(`${String(beweise.length + 2).padStart(2, "0")}-entstehung`);
    jobs.push({
      html: binderExplainerSlideHtml(base.kit, {
        headline: lang === "de" ? `Ein Satz, ein Stil, eine Seite` : `One sentence, one style, one page`,
        sub: lang === "de"
          ? `${L.stil}: „${page.stil}" — einer von ${ARTWORK_STILE.length}. Bis zu drei Pokémon je Seite. ${L.drucken}.`
          : `${L.stil}: "${page.stil}" — one of ${ARTWORK_STILE.length}. Up to three Pokémon per page. ${L.drucken}.`,
        imageDataUrl: bild, ratio,
      }, size.w, size.h, chrome(L.so)),
      width: size.w, height: size.h, file: wie,
    });
    files.push(wie);

    for (const rule of linkRules) {
      const file = datei(`99-cta-${rule}`);
      const linkLabel = rule === "bio" ? (lang === "de" ? "Link in Bio" : "Link in bio") : domain;
      jobs.push({
        html: artworkCtaHtml(base.kit, { line: ctaLine, linkLabel, imageDataUrl: bild, ratio }, size.w, size.h, chrome(L.seite)),
        width: size.w, height: size.h, file,
      });
      ctaFiles.set(`${size.tag}:${rule}`, file);
    }
    bySize.set(size.tag, files);
  }
  await opts.renderer(jobs);

  const assetIds = new Map<string, string>();
  for (const [tag, files] of bySize) files.forEach((file, i) => assetIds.set(file, opts.addAsset(leadId, file, { size: tag, slide: i, language: lang, artwork: page.id })));
  for (const [k, file] of ctaFiles) assetIds.set(file, opts.addAsset(leadId, file, { size: k.split(":")[0]!, slide: "cta", linkRule: k.split(":")[1]!, language: lang, artwork: page.id }));

  // --- Captions --------------------------------------------------------------
  const captionOf = (platform: string) => out.captions.find((c) => c.platform.trim().toLowerCase() === platform)?.caption.trim() ?? "";
  const leadCaption = captionOf(leadPlatform) || out.captions[0]?.caption.trim() || coverTitle;
  const rev = await reviseWithCritic(ctx, usage, {
    body: leadCaption, language: lang, voiceProfile: base.voice, format: "artwork_carousel",
    platform: leadPlatform, limit: PLATFORM_LIMITS[leadPlatform] ?? 2000, maxRounds: 2,
  });

  const notes = [rev.notes];
  if (!page.mein) notes.push(`Die Seite steht unter „${page.besitzer}“ in der Vitrine — vor dem Posten prüfen, ob das dein Konto ist.`);
  if (beweise.length < echt.length) notes.push(`${beweise.length} von ${echt.length} echten Fächern gezeigt.`);
  if (echt.some((x) => !x.name)) notes.push("Zu mindestens einer echten Karte kennt die Vitrine keinen Namen — die Slide zeigt dann die Fachnummer.");

  return writeBundlePieces({
    db: ctx.db as Db, projectId: base.project.id, leadId, format: "artwork_carousel", language: lang, platforms,
    taskId: req.taskId ?? null,
    title: out.title || `${page.titel} · ${L.seite}`,
    score: rev.score, notes: notes.filter(Boolean).join("\n"),
    captionFor: (platform, isLead) => (isLead ? rev.body : captionOf(platform) || rev.body),
    hashtagsFor: (platform) => out.captions.find((c) => c.platform.trim().toLowerCase() === platform)?.hashtags ?? [],
    assetsFor: (platform) => {
      const size = sizeForPlatform(platform);
      return [...(bySize.get(size.tag) ?? []), ctaFiles.get(`${size.tag}:${linkRuleFor(platform)}`) ?? ""].filter(Boolean).map((f) => assetIds.get(f)!).filter(Boolean);
    },
    sizeFor: (platform) => sizeForPlatform(platform).tag,
    ruleFor: (platform) => linkRuleFor(platform),
    meta: {
      hook: out.hook, coverTitle, ctaLine, claims, footer,
      artwork: {
        id: page.id, titel: page.titel, stil: page.stil, besitzer: page.besitzer, mein: page.mein,
        bildFaecher: bilder, gesamtFaecher: gesamt, karten: echt.map((x) => ({ slot: x.slot, name: x.name })),
        veroeffentlichtAt: page.veroeffentlichtAt,
      },
      scopeLabel: page.titel, request: req,
    },
  });
}
