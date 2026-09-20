/**
 * Aus einem Basis-Reel die Fassungen für Instagram, TikTok und Shorts machen.
 *
 * Die drei Fassungen eines Stücks unterscheiden sich nur in einer Ebene: der
 * Folgen-Pille samt Pfeil, der auf den Folgen-Knopf der jeweiligen App zeigt.
 * Das ganze Reel dafür dreimal zu rechnen kostet je vier Minuten; hier wird die
 * Ebene in Sekunden aufgelegt.
 *
 * Voraussetzung ist eine Basis, gebaut mit
 * `reel-binder.ts --drehbuch <name> --ohne-folgen`: Sie trägt in `meta` die
 * Zeitspanne, in der die Pille stehen soll, und ihr Clip-Text weicht dieser
 * Spanne bereits aus.
 *
 * Aufruf:
 *   pnpm exec tsx scripts/reel-plattformen.ts --drehbuch slab
 *   pnpm exec tsx scripts/reel-plattformen.ts --drehbuch slab --plattformen tiktok
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, newId, nowIso, parseJson, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { playwrightRenderer } from "../src/server/agents/studio/render.js";
import { runFfmpeg, OUTPUT_FPS } from "../src/server/agents/video/assemble.js";
import { folgenHtml, SITZE, KANAL, type Plattform } from "../src/server/agents/video/folgen-pille.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const W = 1080, H = 1920;
const s3 = (ms: number) => (ms / 1000).toFixed(3);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const kit = loadBrandKit(db, PROJEKT);
const akzent = kit.accent2 ?? kit.colors?.[1] ?? "#F5C518";

const drehbuch = arg("--drehbuch");
if (!drehbuch) throw new Error("--drehbuch fehlt");
const ziele = (arg("--plattformen") ?? "instagram,tiktok,shorts").split(",") as Plattform[];

/** Die jüngste Basis dieses Drehbuchs — abgelehnte Läufe zählen nicht. */
const basis = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, PROJEKT)).all()
  .filter((p) => {
    const m = parseJson<Record<string, unknown>>(p.meta, {});
    return m["drehbuch"] === drehbuch && m["basis"] === true && p.status !== "rejected";
  })
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
if (!basis) throw new Error(`Keine Basis für „${drehbuch}" — erst mit --ohne-folgen bauen.`);

const basisMeta = parseJson<Record<string, unknown>>(basis.meta, {});
const zeit = basisMeta["folgenZeit"] as { startMs: number; endMs: number } | null;
const basisAsset = db.select().from(t.mpAssets).all()
  .find((a) => a.contentPieceId === basis.id && a.kind === "video");
if (!basisAsset) throw new Error(`Kein Video an der Basis ${basis.id}`);
const basisDatei = path.join(env.MP_DATA_DIR, basisAsset.path);
console.log(`Basis: ${basis.title} (${(Number(basisMeta["dauerMs"] ?? 0) / 1000).toFixed(1)} s)`);

/**
 * `--ersetzen` aktualisiert die vorhandene Fassung, statt eine neue anzulegen.
 *
 * Wichtig, sobald ein Stück im Kalender steht: Ein neues Stück hieße, dass der
 * geplante Termin weiter auf die alte Datei zeigt. So bleibt die Planung heil
 * und bekommt trotzdem das neue Video.
 */
const ersetzen = process.argv.includes("--ersetzen");
const vorhandene = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, PROJEKT)).all();

for (const plattform of ziele) {
  if (!SITZE[plattform]) throw new Error(`Keine Plattform „${plattform}"`);
  const alteFassung = ersetzen ? vorhandene
    .filter((p) => { const m = parseJson<Record<string, unknown>>(p.meta, {});
      return m["drehbuch"] === drehbuch && m["platform"] === plattform && m["basis"] !== true && p.status !== "rejected"; })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
  const pieceId = alteFassung?.id ?? newId();
  const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
  fs.mkdirSync(outDir, { recursive: true });

  const pille = path.join(outDir, "folgen.png");
  // Formate mit Text unter dem Bild geben einen Versatz mit — sonst läge die
  // Pille dort mitten im Motiv statt beim Text.
  const versatz = Number(basisMeta["folgenVersatz"] ?? 0);
  await playwrightRenderer([{ html: folgenHtml(akzent, plattform, versatz), width: W, height: H, transparent: true, file: pille }]);

  const reel = path.join(outDir, "reel.mp4");
  if (zeit) {
    // Nur das Bild wird neu kodiert; die Tonspur bleibt unangetastet.
    await runFfmpeg(["-i", basisDatei, "-loop", "1", "-framerate", String(OUTPUT_FPS), "-i", pille,
      "-filter_complex",
      `[1:v]format=rgba,setsar=1[p];[0:v][p]overlay=0:0:eof_action=pass:enable='between(t,${s3(zeit.startMs)},${s3(zeit.endMs)})'[v]`,
      "-map", "[v]", "-map", "0:a", "-c:a", "copy",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      // Die Kennzeichnung in den Dateidaten gilt nur, wenn im Bild wirklich etwas
      // Gemaltes steckt. Eine Rangliste aus echten Scans als „AI-generated" zu
      // markieren wäre schlicht falsch — und die Apps lesen das aus.
      ...(basisMeta["kiBild"] === false ? []
        : ["-metadata", "comment=AI-generated: true (Binderplan Kunstseite, Marketing Pilot)"]),
      "-metadata", `title=${basis.title}`, "-y", reel]);
  } else {
    fs.copyFileSync(basisDatei, reel);
    console.log("  (Basis ohne Folgen-Zeitspanne — Fassung ist eine reine Kopie)");
  }

  // Text und Schlagworte stehen am Basis-Stück je Plattform bereit.
  const lang = String(basisMeta["captionLang"] ?? basisMeta["caption"] ?? "");
  const kurz = String(basisMeta["captionKurz"] ?? lang.split("\n\n").slice(0, 2).join("\n\n"));
  const tags = (basisMeta["hashtagsAlle"] as string[] | undefined)
    ?? (basisMeta["hashtags"] as string[] | undefined) ?? [];
  const caption = plattform === "instagram" ? lang : kurz;
  const hashtags = plattform === "instagram" ? tags : tags.slice(0, 3);

  const ts = nowIso();
  const assetId = newId();
  if (alteFassung) {
    // Nur Video und Text erneuern; Status und Termin des Stücks bleiben.
    db.update(t.mpContentPieces).set({
      body: `${caption}\n\n${hashtags.join(" ")}`, assets: toJson([assetId]),
      meta: toJson({ ...parseJson<Record<string, unknown>>(alteFassung.meta, {}), ...basisMeta,
        platform: plattform, caption, hashtags, basis: false, ausBasis: basis.id }),
      updatedAt: ts,
    }).where(eq(t.mpContentPieces.id, pieceId)).run();
    for (const a of db.select().from(t.mpAssets).all().filter((a2) => a2.contentPieceId === pieceId)) {
      db.delete(t.mpAssets).where(eq(t.mpAssets.id, a.id)).run();
    }
  } else db.insert(t.mpContentPieces).values({
    id: pieceId, projectId: PROJEKT, taskId: null, channel: KANAL[plattform], format: "artwork_reel",
    title: `${basis.title.replace(/ · \w+$/, "")} · ${plattform}`,
    body: `${caption}\n\n${hashtags.join(" ")}`,
    assets: toJson([assetId]), status: "review", humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}",
    meta: toJson({ ...basisMeta, platform: plattform, caption, hashtags, basis: false, ausBasis: basis.id }),
    aiTellScore: null, aiTellNotes: "Kunstseiten-Reel ohne Stimme, Texte von Hand.", rejectionReason: "",
    createdAt: ts, updatedAt: ts,
  }).run();
  db.insert(t.mpAssets).values({
    id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video",
    path: path.relative(env.MP_DATA_DIR, reel),
    meta: toJson({ aiGenerated: true, provenance: "reel-plattformen", drehbuch, plattform, size: `${W}x${H}` }),
    createdAt: ts,
  }).run();
  console.log(`  ${plattform.padEnd(10)} ${alteFassung ? "aktualisiert" : "neu       "} → ${path.relative(env.MP_DATA_DIR, reel)}`);
}
