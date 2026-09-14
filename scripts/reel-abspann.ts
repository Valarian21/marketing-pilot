/**
 * Abspann-Werkzeug: Muster bauen und in fertigen Reels austauschen.
 *
 * Die Bauart selbst steht in `src/server/agents/video/abspann-binderplan.ts` —
 * dort auch die Begründung, warum der Abspann seit dem 11.09.2026 aus Ebenen
 * und ffmpeg-Bewegung besteht statt aus fünfzig CSS-Renders.
 *
 * Aufruf:
 *   `pnpm exec tsx scripts/reel-abspann.ts --bauen`                   → alle Muster
 *   `pnpm exec tsx scripts/reel-abspann.ts --variante d --anhaengen alle`
 *
 * Neu gebaute Reels holen sich den Abspann selbst (`reel-binder.ts`); der
 * Austausch hier ist für Reels gedacht, die schon fertig sind.
 */
import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { openDatabase } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { runFfmpeg } from "../src/server/agents/video/assemble.js";
import { abspannClip, ABSPANN_MS, ABSPANN_VARIANTE, ABSPANN_VARIANTEN } from "../src/server/agents/video/abspann-binderplan.js";

const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);

/**
 * Den Abspann eines fertigen Reels austauschen — **ohne** das Reel neu zu bauen.
 *
 * Der neue Clip ist genauso lang wie der alte, deshalb bleibt die Tonspur
 * unangetastet (`-c:a copy`): geschnitten und neu gesetzt wird nur das Bild.
 * Preis dafür ist ein zweiter Durchlauf durch die Videokompression — wer ein
 * Reel ohnehin neu baut, bekommt den Abspann sauberer über `reel-binder.ts`.
 */
async function tauschen(pieceId: string, clip: string): Promise<void> {
  const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  if (!stueck) throw new Error(`Kein Stück ${pieceId}`);
  const asset = db.select().from(t.mpAssets)
    .where(and(eq(t.mpAssets.contentPieceId, pieceId), eq(t.mpAssets.kind, "video"))).get();
  if (!asset?.path) throw new Error(`Kein Video am Stück ${pieceId}`);
  const reel = path.join(env.MP_DATA_DIR, asset.path);
  const neu = reel.replace(/\.mp4$/, ".neu.mp4");
  const meta = JSON.parse(stueck.meta || "{}");
  const dauer = Number(meta.dauerMs ?? 0) / 1000;
  if (!dauer) throw new Error(`Länge unbekannt bei ${pieceId}`);
  /**
   * Abgeschnitten wird die Länge des **alten** Abspanns, nicht die des neuen.
   * Reels von vor dem 14.09.2026 tragen einen 2000-ms-Abspann und kein
   * `meta.abspannMs`; würde man dort die heutigen 3200 ms abziehen, verlöre das
   * Reel 1,2 s echten Inhalt.
   */
  const altMs = Number(arg("--alt-ms") ?? meta.abspannMs ?? 2000);
  const bis = dauer - altMs / 1000;
  const gesamt = bis + ABSPANN_MS / 1000;
  // Wächst der Abspann, fehlt hinten Ton: `apad` füllt mit Stille auf, statt das
  // Reel stumm enden zu lassen — Instagram-Reels ohne Tonspur sind stumme Reels.
  await runFfmpeg(["-i", reel, "-i", clip, "-filter_complex",
    `[0:v]trim=0:${bis.toFixed(3)},setpts=PTS-STARTPTS[alt];[1:v]setpts=PTS-STARTPTS[end];[alt][end]concat=n=2:v=1:a=0[v];` +
    `[0:a]atrim=0:${bis.toFixed(3)},asetpts=PTS-STARTPTS,apad,afade=t=out:st=${Math.max(0, gesamt - 1.2).toFixed(3)}:d=1.2[a]`,
    "-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "160k",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-t", gesamt.toFixed(3), "-y", neu]);
  fs.renameSync(neu, reel);
  db.update(t.mpContentPieces)
    .set({ meta: JSON.stringify({ ...meta, dauerMs: Math.round(gesamt * 1000), abspannMs: ABSPANN_MS }) })
    .where(eq(t.mpContentPieces.id, pieceId)).run();
  console.log(`  ${stueck.title} → Abspann getauscht (${dauer.toFixed(1)} s → ${gesamt.toFixed(1)} s)`);
}

if (process.argv.includes("--bauen")) {
  for (const v of ABSPANN_VARIANTEN) {
    const datei = await abspannClip(env.MP_DATA_DIR, v.schluessel);
    console.log(`${v.schluessel} — ${v.name}: ${v.beschreibung}\n   ${datei}`);
  }
}

const ziel = arg("--anhaengen");
if (ziel) {
  const variante = arg("--variante") ?? ABSPANN_VARIANTE;
  const clip = await abspannClip(env.MP_DATA_DIR, variante);
  const stuecke = ziel === "alle"
    ? db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.format, "artwork_reel")).all()
        .filter((s) => JSON.parse(s.meta || "{}").drehbuch)
        .map((s) => s.id)
    : ziel.split(",");
  console.log(`Variante ${variante} an ${stuecke.length} Reels:`);
  for (const id of stuecke) await tauschen(id, clip);
}
