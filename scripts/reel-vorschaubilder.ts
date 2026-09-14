/**
 * Vorschaubilder für Reels nachrüsten.
 *
 * Ohne eigenes Standbild zeigt die Mediathek eine schwarze Fläche: Am Schreibtisch
 * rettet `preload="metadata"` das noch, mobile Browser ignorieren das Attribut
 * aber und laden gar nichts, bis jemand auf Abspielen tippt. Ein Bild-Asset mit
 * `role: "thumbnail"` löst das ein für alle Mal — die Mediathek nimmt es als
 * Poster, die Freigabe auch.
 *
 * Aufruf: `pnpm exec tsx scripts/reel-vorschaubilder.ts [--ab 1.2]`
 * Läuft über alle Video-Assets, die noch kein Vorschaubild haben.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, newId, nowIso, parseJson, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { runFfmpeg } from "../src/server/agents/video/assemble.js";

const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
/** Sekunde 1,2: Der Hook steht dann im Bild, der Anfangs-Aufblender ist vorbei. */
const ab = arg("--ab") ?? "1.2";

const assets = db.select().from(t.mpAssets).all();
const videos = assets.filter((a) => a.kind === "video");
let gebaut = 0, uebersprungen = 0;

for (const v of videos) {
  const hatBild = assets.some((a) => a.contentPieceId === v.contentPieceId && a.kind === "image"
    && parseJson<Record<string, unknown>>(a.meta, {})["role"] === "thumbnail");
  if (hatBild) { uebersprungen++; continue; }
  const datei = path.join(env.MP_DATA_DIR, v.path);
  if (!fs.existsSync(datei)) { uebersprungen++; continue; }
  const ziel = datei.replace(/\.mp4$/, "-thumb.jpg");
  await runFfmpeg(["-ss", ab, "-i", datei, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", "-y", ziel]);
  const id = newId();
  db.insert(t.mpAssets).values({
    id, projectId: v.projectId, contentPieceId: v.contentPieceId, kind: "image",
    path: path.relative(env.MP_DATA_DIR, ziel),
    meta: toJson({ aiGenerated: true, provenance: "reel-vorschaubild", role: "thumbnail", size: "540x960" }),
    createdAt: nowIso(),
  }).run();
  // Das Stück zeigt weiter auf sein Video; das Bild hängt nur daneben.
  const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, v.contentPieceId ?? "")).get();
  if (stueck) db.update(t.mpContentPieces).set({ updatedAt: nowIso() }).where(eq(t.mpContentPieces.id, stueck.id)).run();
  gebaut++;
}
console.log(`${gebaut} Vorschaubilder gebaut, ${uebersprungen} übersprungen (${videos.length} Videos)`);
