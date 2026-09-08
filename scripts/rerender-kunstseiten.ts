/**
 * Die Bühnen-Slides bestehender Kunstseiten-Bündel neu rendern — ohne Modell.
 *
 * Deckseite, Auflösung und „So entsteht sie" zeigen die ganze Kunstseite in
 * einem Rahmen. Wenn sich an diesem Rahmen etwas ändert (08.09.2026: der Rahmen
 * blieb breiter als das Bild), müssen die fertigen Bündel in der Freigabe
 * nachziehen, ohne dass ein Modellaufruf nötig wird: Texte und Kartenscans
 * bleiben, nur diese drei Dateien je Größe werden überschrieben. Reels bekommen
 * anschließend einen neuen Slideshow-Job, damit die MP4 die neuen Slides trägt.
 *
 * Aufruf: `pnpm exec tsx scripts/rerender-kunstseiten.ts [--lead <id>] [--status review,approved]`
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, parseJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { artworkCoverHtml, artworkRasterHtml, artworkSchritteHtml, dataUrlFor, playwrightRenderer, type BinderChrome, type RenderJob } from "../src/server/agents/studio/render.js";
import { listArtworkPages, echteFaecher, bildFaecher } from "../src/server/providers/artwork.binderplan.js";
import { enqueueJob } from "../src/server/jobs.js";
import { SLIDESHOW_STEPS } from "../src/server/agents/video/slideshow.js";

const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const nurLead = arg("--lead");
const status = (arg("--status") ?? "review,approved").split(",").map((s) => s.trim());

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const pages = await listArtworkPages({ apiBase: env.MP_BINDERPLAN_API, log: () => {} });

const leads = db.select().from(t.mpContentPieces).all()
  .filter((r) => (r.format === "artwork_carousel" || r.format === "artwork_reel") && status.includes(r.status))
  .filter((r) => parseJson<Record<string, unknown>>(r.meta, {})["bundleLead"] === true)
  .filter((r) => !nurLead || r.id === nurLead);
console.log(`${leads.length} Bündel`);

let reels = 0;
for (const lead of leads) {
  const meta = parseJson<Record<string, unknown>>(lead.meta, {});
  const art = (meta["artwork"] ?? {}) as { id?: string; titel?: string };
  const page = pages.find((p) => p.id === art.id);
  if (!page) { console.log(`- ${lead.title}: Kunstseite ${art.id} nicht mehr in der Vitrine — übersprungen`); continue; }
  const lang = (meta["language"] === "en" ? "en" : "de") as "de" | "en";
  const outDir = path.join(env.MP_DATA_DIR, "assets", lead.projectId, "pieces", lead.id);
  const quelle = fs.readdirSync(path.join(outDir, "quelle")).find((f) => f.startsWith(`kunstseite-${page.id}.`));
  const bild = quelle ? dataUrlFor(path.join(outDir, "quelle", quelle)) : null;
  if (!bild) { console.log(`- ${lead.title}: Quellbild fehlt — übersprungen`); continue; }

  const project = db.select().from(t.mpProjects).all().find((p) => p.id === lead.projectId);
  const kit = loadBrandKit(db, lead.projectId);
  const logoAsset = kit.logoAssetId ? db.select().from(t.mpAssets).all().find((a) => a.id === kit.logoAssetId) : undefined;
  const logoDataUrl = logoAsset ? dataUrlFor(path.join(env.MP_DATA_DIR, logoAsset.path)) : null;
  const footer = String(meta["footer"] ?? "");
  const chrome = (corner: string): BinderChrome => ({ brand: project?.name ?? "Binderplan", footer, logoDataUrl, corner });
  const ratio = `${page.breite}/${page.hoehe}`;
  const echt = echteFaecher(page); const bilder = bildFaecher(page);
  const claims = Array.isArray(meta["claims"]) ? (meta["claims"] as string[]) : [];
  const coverTitle = String(meta["coverTitle"] ?? "");
  const L = lang === "de" ? { aufloesung: "Aufgelöst", nurEcht: "echte Karte" } : { aufloesung: "Revealed", nurEcht: "real card" };

  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".png"));
  const sizes = [...new Set(files.map((f) => /-(\d+x\d+)-/.exec(f)?.[1]).filter((x): x is string => Boolean(x)))];
  const jobs: RenderJob[] = [];
  for (const tag of sizes) {
    const [w, h] = tag.split("x").map(Number) as [number, number];
    const finde = (suffix: string) => files.find((f) => f.startsWith(`${lang}-${tag}-`) && f.endsWith(`-${suffix}.png`));
    const cover = finde("deckseite"), reveal = finde("aufloesung"), wie = finde("entstehung");
    if (cover) jobs.push({ html: artworkCoverHtml(kit, { title: coverTitle, claims, imageDataUrl: bild, ratio, hint: lang === "de" ? "Sieh selbst" : "See for yourself" }, w, h, chrome(page.titel)), width: w, height: h, file: path.join(outDir, cover) });
    if (reveal) jobs.push({ html: artworkRasterHtml(kit, {
      headline: lang === "de" ? `${echt.length} echte Karten, ein Motiv` : `${echt.length} real cards, one scene`,
      sub: lang === "de" ? `Das Bild führt ihre Kunst über die anderen ${bilder} Fächer weiter.` : `The picture carries their artwork on across the other ${bilder} pockets.`,
      imageDataUrl: bild, spalten: page.spalten, zeilen: page.zeilen, echt: echt.map((x) => x.slot), etikett: L.nurEcht, ratio,
    }, w, h, chrome(L.aufloesung)), width: w, height: h, file: path.join(outDir, reveal) });
    if (wie) jobs.push({ html: artworkSchritteHtml(kit, {
      title: lang === "de" ? "So entsteht sie" : "How it is made",
      schritte: lang === "de" ? ["Karten im Binder anordnen", "Stil wählen", "Extras beschreiben, wenn du magst", "Bild wird erzeugt, PDF drucken"] : ["Arrange the cards in the binder", "Pick a style", "Describe extras if you like", "The image is generated, print the PDF"],
      imageDataUrl: bild, ratio, hint: "",
    }, w, h, chrome(lang === "de" ? "4 Schritte" : "4 steps")), width: w, height: h, file: path.join(outDir, wie) });
  }
  await playwrightRenderer(jobs);
  let hinweis = "";
  if (lead.format === "artwork_reel") { enqueueJob(db, { projectId: lead.projectId, kind: "video.slideshow", payload: { pieceId: lead.id }, steps: SLIDESHOW_STEPS }); reels++; hinweis = " · Reel neu eingereiht"; }
  console.log(`- ${lead.title}: ${jobs.length} Slides (${sizes.join(", ")})${hinweis}`);
}
console.log(`Fertig. ${reels} Reel-Jobs für den Worker.`);
