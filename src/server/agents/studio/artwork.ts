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
  artworkCoverHtml, artworkKarteHtml, artworkRasterHtml, artworkSchritteHtml, artworkWerbungHtml,
  dataUrlFor, type BinderChrome, type RenderJob,
} from "./render.js";
import { reviseWithCritic } from "./critic.js";
import { sizeForPlatform, writeBundlePieces, type DataBase } from "./data-content.js";
import {
  bildFaecher, downloadArtworkImage, echteFaecher, listArtworkPages,
  type ArtworkOptions as ProviderOptions, type ArtworkPage,
} from "../../providers/artwork.binderplan.js";
import type { CardFacts, ProductDataProvider } from "../../providers/product-data.js";
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

/**
 * Die Herkunftszeile einer Karte: Set, Nummer, Seltenheit.
 *
 * Das ist die Angabe, nach der Sammler suchen — „Groudon" allein gibt es
 * zwanzigmal. Japanische Sets bekommen ihr Kürzel dazu, weil derselbe Name in
 * beiden Regionen vorkommt.
 */
export function herkunftsZeile(f: CardFacts | null, lang: "de" | "en"): string {
  if (!f) return "";
  const teile: string[] = [];
  if (f.setName) teile.push(f.region === "jp" ? `${f.setName} (JP)` : f.setName);
  // Die gedruckte Gesamtzahl, nicht die tatsächliche: auf der Karte steht
  // „080/076", und die Bildunterschrift darf ihr nicht widersprechen.
  const gesamt = f.setOfficial || f.setTotal;
  // Auf gleiche Stellenzahl auffüllen: die Karte druckt „080/076", nicht „080/76".
  const gesamtText = /^\d+$/.test(f.localId) ? String(gesamt).padStart(f.localId.length, "0") : String(gesamt);
  if (f.localId) teile.push(gesamt ? `${f.localId}/${gesamtText}` : f.localId);
  // Seltenheit nur bei internationalen Karten. TCGdex wirft bei japanischen
  // Sets alle Sonderkarten in einen Topf — in „Storm Emeralda" tragen alle 37
  // Karten über der gedruckten Setgröße dasselbe Etikett, obwohl die Karte
  // selbst „AR" aufdruckt. Eine falsche Seltenheit im Beitrag ist schlimmer
  // als keine.
  if (f.rarity && f.region !== "jp") teile.push(f.rarity);
  if (f.illustrator) teile.push(`${lang === "de" ? "Illustration" : "Art"}: ${f.illustrator}`);
  return teile.join(" · ");
}

export interface ArtworkBundleOpts {
  leadPieceId?: string;
  language: "de" | "en";
  addAsset: (pieceId: string, file: string, meta: Record<string, unknown>) => string;
  renderer: (jobs: RenderJob[]) => Promise<void>;
  /** Binderplans HTTP-Dienst und ein einspeisbares `fetch`, damit Tests ohne Netz laufen. */
  provider: ProviderOptions;
  /**
   * Die Produktdatenquelle — für Kartenscans und Set-Angaben der echten Fächer.
   * Fehlt sie, laufen die Karten-Slides ohne Bild und ohne Herkunft weiter.
   */
  daten?: ProductDataProvider | null;
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

  // Die Rückfallwerte tragen dieselbe Aussage wie der Prompt: das Bild setzt die
  // Kunst der Karten fort. Nichts davon spricht von Lücken oder Platzhaltern.
  const coverTitle = (out.coverTitle
    || (lang === "de" ? "Wo hört die Karte auf?" : "Where does the card end?")).slice(0, 80);
  const ctaLine = (out.ctaLine || (lang === "de" ? "Mach deine eigene Kunstseite." : "Make your own art page.")).slice(0, 120);
  const claims = (out.claims.length ? out.claims : lang === "de"
    ? ["Ob eine Karte oder neun", "Das Motiv läuft über alle Fächer", "Wertet den ganzen Binder auf"]
    : ["One card or nine", "The scene runs across every pocket", "Lifts the whole binder"]
  ).slice(0, 3).map((x) => x.slice(0, 46));

  // --- Kartenscans der echten Fächer -----------------------------------------
  // Höchstens drei: mehr macht das Bündel lang, ohne mehr zu zeigen.
  const beweise = echt.slice(0, 3);
  const karten = await Promise.all(beweise.map(async (x) => {
    const id = page.faecher[x.slot]?.kartenId ?? "";
    const fakten = id ? opts.daten?.cardFacts(id, lang) ?? null : null;
    const datei = id ? await opts.daten?.cardImage(id, lang) ?? null : null;
    return { ...x, id, fakten, dataUrl: datei ? dataUrlFor(datei) : null };
  }));

  /**
   * Drei weitere Seiten für den Abschluss.
   *
   * Eigene zuerst — der Beitrag wirbt für das Werkzeug, nicht für fremde
   * Arbeit —, danach was die Vitrine sonst hergibt. Ohne weitere Seiten fällt
   * der Fächer auf die gezeigte Seite allein zurück.
   */
  const eigen = (p: ArtworkPage) => p.mein || (cfg.owner.trim() && p.besitzer.trim().toLowerCase() === cfg.owner.trim().toLowerCase());
  const weitere = [...pages.filter((p) => p.id !== page.id)]
    .sort((a, b) => (Number(eigen(b)) - Number(eigen(a))) || b.veroeffentlichtAt.localeCompare(a.veroeffentlichtAt))
    .slice(0, 3);
  const faecherBilder = (await Promise.all(weitere.map(async (p) => {
    try { return dataUrlFor(await downloadArtworkImage(p.id, path.join(outDir, "quelle"), opts.provider)); }
    catch { return null; }
  }))).filter((x): x is string => Boolean(x));
  if (!faecherBilder.length) faecherBilder.push(bild);

  // --- rendern ---------------------------------------------------------------
  const logoAsset = base.kit.logoAssetId ? ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.id, base.kit.logoAssetId)).get() : undefined;
  const logoDataUrl = logoAsset ? dataUrlFor(path.join(ctx.dataDir, logoAsset.path)) : null;
  const chrome = (corner: string): BinderChrome => ({ brand, footer, logoDataUrl, corner });

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
        hint: lang === "de" ? "Sieh selbst" : "See for yourself",
      }, size.w, size.h, chrome(page.titel)),
      width: size.w, height: size.h, file: cover,
    });
    files.push(cover);

    karten.forEach((x, i) => {
      const file = datei(`${String(i + 1).padStart(2, "0")}-karte${x.slot + 1}`);
      const herkunft = herkunftsZeile(x.fakten, lang)
        || (lang === "de" ? `Fach ${x.slot + 1} von ${gesamt}` : `Pocket ${x.slot + 1} of ${gesamt}`);
      jobs.push({
        html: artworkKarteHtml(base.kit, {
          name: x.fakten?.name || x.name || (lang === "de" ? `Fach ${x.slot + 1}` : `Pocket ${x.slot + 1}`),
          herkunft, imageDataUrl: x.dataUrl, marke: L.echt,
        }, size.w, size.h, chrome(`${i + 1} / ${karten.length}`)),
        width: size.w, height: size.h, file,
      });
      files.push(file);
    });

    const reveal = datei(`${String(beweise.length + 1).padStart(2, "0")}-aufloesung`);
    jobs.push({
      html: artworkRasterHtml(base.kit, {
        headline: lang === "de" ? `${echt.length} echte Karten, ein Motiv` : `${echt.length} real cards, one scene`,
        sub: lang === "de"
          ? `Das Bild führt ihre Kunst über die anderen ${bilder} Fächer weiter.`
          : `The picture carries their artwork on across the other ${bilder} pockets.`,
        imageDataUrl: bild, spalten: page.spalten, zeilen: page.zeilen,
        echt: echt.map((x) => x.slot), etikett: L.nurEcht, ratio,
      }, size.w, size.h, chrome(L.aufloesung)),
      width: size.w, height: size.h, file: reveal,
    });
    files.push(reveal);

    const wie = datei(`${String(karten.length + 2).padStart(2, "0")}-entstehung`);
    jobs.push({
      html: artworkSchritteHtml(base.kit, {
        title: lang === "de" ? "So entsteht sie" : "How it is made",
        schritte: lang === "de"
          // Keine Stilzahl: „12 stehen bereit" sagt jemandem, der das Werkzeug
          // nicht kennt, nichts — er hält es womöglich für zwölf fertige Bilder.
          ? ["Karten im Binder anordnen", "Stil wählen", "Extras beschreiben, wenn du magst", "Bild wird erzeugt, PDF drucken"]
          : ["Arrange the cards in the binder", "Pick a style", "Describe extras if you like", "The image is generated, print the PDF"],
        // Kein Hinweis unten: Schritt 4 sagt schon, was passiert, und die Ecke
        // wiederholte bis hierher die Überschrift.
        imageDataUrl: bild, ratio, hint: "",
      }, size.w, size.h, chrome(lang === "de" ? "4 Schritte" : "4 steps")),
      width: size.w, height: size.h, file: wie,
    });
    files.push(wie);

    for (const rule of linkRules) {
      const file = datei(`99-cta-${rule}`);
      const linkLabel = rule === "bio" ? (lang === "de" ? "Link in Bio" : "Link in bio") : domain;
      jobs.push({
        html: artworkWerbungHtml(base.kit, {
          line: ctaLine,
          sub: lang === "de" ? "Eigene erzeugen oder die besten aus der Vitrine übernehmen." : "Make your own, or take the best ones from the showcase.",
          linkLabel, seiten: faecherBilder,
        }, size.w, size.h, chrome(L.seite)),
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
  if (karten.length < echt.length) notes.push(`${karten.length} von ${echt.length} echten Karten gezeigt.`);
  const ohneScan = karten.filter((x) => !x.dataUrl).map((x) => x.fakten?.name || x.name || `Fach ${x.slot + 1}`);
  if (ohneScan.length) notes.push(`Kein Kartenscan für ${ohneScan.join(", ")} — die Slide bleibt ohne Bild.`);

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
