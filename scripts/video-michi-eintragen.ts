/**
 * Das fertige Anleitungsvideo als Stück in den Piloten legen — Zustand „in Freigabe".
 *
 * Die Montage (`video-michi-montage.ts`) schreibt nur eine Datei auf die Platte. Erst hier
 * wird daraus ein Stück, das in der Mediathek auftaucht und über Freigabe und Zeitplan
 * laufen kann. Getrennt, weil die Montage beliebig oft wiederholbar sein muss — ein
 * Eintrag je Lauf gäbe lauter Doppelgänger.
 *
 * Reihenfolge ist Pflicht: `mp_assets.content_piece_id` zeigt auf das Stück, also muss das
 * Stück zuerst stehen. Die Datei wird in den Stück-Ordner kopiert, nicht verlinkt — die
 * Mediathek liefert nur aus `MP_DATA_DIR` aus.
 *
 * Aufruf: pnpm exec tsx scripts/video-michi-eintragen.ts [--datei <mp4>] [--ersetzen]
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, newId, nowIso, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { runFfmpeg, probeDurationMs } from "../src/server/agents/video/assemble.js";
import { eq } from "drizzle-orm";

const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";           // Binderplan
const ORDNER = process.env.MICHI_AUSGABE || path.join(process.cwd(), "data", "video-michi");
const QUELLE = arg("--datei") || path.join(ORDNER, "michi-30jahre.mp4");

const TITEL = "Michi Method: eigene Kunstseiten fürs 30-Jahre-Set — in 10 Minuten";

/** Beschreibung für YouTube. Kapitelmarken kommen aus der geschnittenen Zeitachse. */
function beschreibung(kapitel: string[]): string {
  return [
    "Drei Seiten aus meinem 30-Jahre-Binder — kein Sticker, kein gekauftes PDF. Die Karten",
    "stecken wirklich in den Fächern, das Drumherum ist gemalt. In diesem Video baue ich die",
    "drei Seiten von Null: Konto anlegen, Binder aufsetzen, Karten einsortieren, Kunstseiten",
    "erzeugen, durchblättern.",
    "",
    "Die erste Seite ist gratis — ein neues Konto bekommt 12 Startcredits, und eine Seite mit",
    "einer Ankerkarte kostet genau 12. Die beiden anderen zusammen unter einem Euro.",
    "",
    "Binderplan: https://binderplan.app",
    "",
    "Kapitel:",
    ...kapitel,
    "",
    "Aufgenommen im echten Produkt, ungeschnitten bis auf die Wartezeiten des Bildmodells.",
  ].join("\n");
}

async function lauf() {
  if (!fs.existsSync(QUELLE)) throw new Error("Video fehlt: " + QUELLE);
  const env = loadEnv();
  const { db } = openDatabase(env.MP_DATA_DIR);

  const schon = db.select().from(t.mpContentPieces).all()
    .filter((p: any) => (p.meta || "").includes("\"provenance\":\"video-michi\""));
  if (schon.length && !process.argv.includes("--ersetzen")) {
    console.log(`Steht schon drin: ${schon.map((p: any) => p.id).join(", ")} — mit --ersetzen überschreiben.`);
    return;
  }
  for (const p of schon) {
    db.delete(t.mpAssets).where(eq(t.mpAssets.contentPieceId, p.id)).run();
    db.delete(t.mpContentPieces).where(eq(t.mpContentPieces.id, p.id)).run();
    // Auch die Dateien: 126 MB je Lauf bleiben sonst als Waise im Asset-Ordner liegen.
    const alterOrdner = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", p.id);
    fs.rmSync(alterOrdner, { recursive: true, force: true });
    console.log(`Alten Eintrag ${p.id} samt Dateien entfernt.`);
  }

  const dauerMs = await probeDurationMs(QUELLE);
  const pieceId = newId();
  const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
  fs.mkdirSync(outDir, { recursive: true });
  const ziel = path.join(outDir, "michi-30jahre.mp4");
  fs.copyFileSync(QUELLE, ziel);

  // Kapitel aus dem Sprechtext: die Zeilen, die einen neuen Abschnitt eröffnen.
  const srtDatei = path.join(ORDNER, "sprechtext.srt");
  const kapitel = kapitelMarken(srtDatei);

  const ts = nowIso();
  const assetId = newId();
  db.insert(t.mpContentPieces).values({
    id: pieceId, projectId: PROJEKT, taskId: null, channel: "youtube", format: "video",
    title: `${TITEL} · youtube`,
    body: beschreibung(kapitel),
    assets: toJson([assetId]), status: "review", humanEdited: true,
    publishedAt: null, externalUrl: null, utm: "{}",
    meta: toJson({
      platform: "youtube", language: "de", size: "1920x1080", linkRule: "beschreibung",
      caption: TITEL, hashtags: ["#PokemonTCG", "#BinderCollection", "#Pokemon30"],
      provenance: "video-michi", ohneStimme: true, dauerMs, untertitelImBild: true,
      sprechtext: path.relative(process.cwd(), srtDatei), anheften: false,
    }),
    aiTellScore: null,
    aiTellNotes: "Bildschirmaufnahme des echten Produkts, Untertitel von Hand geschrieben.",
    rejectionReason: "", createdAt: ts, updatedAt: ts,
  }).run();
  db.insert(t.mpAssets).values({
    id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video",
    path: path.relative(env.MP_DATA_DIR, ziel),
    meta: toJson({ aiGenerated: false, provenance: "video-michi", size: "1920x1080", dauerMs }),
    createdAt: ts,
  }).run();

  // Standbild, sonst steht das Stück als graue Kachel zwischen den Reels.
  const vorschau = path.join(outDir, "vorschau.jpg");
  await runFfmpeg(["-ss", "6", "-i", ziel, "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "4", "-y", vorschau]);
  db.insert(t.mpAssets).values({
    id: newId(), projectId: PROJEKT, contentPieceId: pieceId, kind: "image",
    path: path.relative(env.MP_DATA_DIR, vorschau),
    meta: toJson({ role: "thumbnail", provenance: "video-michi" }), createdAt: ts,
  }).run();

  console.log(`Stück ${pieceId} steht auf „review" — Mediathek → Freigabe.`);
  console.log(`Datei: ${ziel} (${(fs.statSync(ziel).size / 1e6).toFixed(1)} MB, ${(dauerMs / 60000).toFixed(1)} min)`);
}

/**
 * Kapitelmarken aus dem geschnittenen Sprechtext.
 *
 * Gesucht wird **fortlaufend**: jeder Anker erst ab der Stelle, an der der vorige gefunden
 * wurde. Ein erster Treffer über die ganze Datei liefert Unsinn — „Binder" steht schon im
 * allerersten Satz, das Kapitel „Binder aufsetzen" landete dadurch bei 0:03 und die Liste
 * lief rückwärts. YouTube braucht aufsteigende Zeiten und einen Eintrag bei 0:00.
 */
function kapitelMarken(srtDatei: string): string[] {
  if (!fs.existsSync(srtDatei)) return [];
  const cues = fs.readFileSync(srtDatei, "utf8").split(/\n\n+/).map((b) => {
    const z = b.trim().split("\n").filter(Boolean);
    const m = z[1]?.match(/^(\d\d):(\d\d):(\d\d),/);
    if (!m) return null;
    return { s: +m[1] * 3600 + +m[2] * 60 + +m[3], text: z.slice(2).join(" ") };
  }).filter(Boolean) as { s: number; text: string }[];

  const ANKER: [string, string][] = [
    ["Das hier sind drei Seiten", "Worum es geht"],
    ["Die Sache heißt Michi Method", "Michi Method statt Etsy-Vorlage"],
    ["Kurz anmelden", "Konto anlegen — 12 Credits geschenkt"],
    ["damit du dich zurechtfindest", "Kurzer Rundgang"],
    ["Neuer Binder, und zwar ein leerer", "Leeren Binder anlegen"],
    ["Seite eins. Eine Karte", "Seite 1: Feelinara ex in die Mitte"],
    ["Seite zwei. Die drei Mauzis", "Seite 2: drei Mauzi diagonal"],
    ["Und Seite drei", "Seite 3: die drei Vögel"],
    ["jetzt das eigentliche", "Erste Kunstseite malen — gratis"],
    ["Startguthaben ist damit weg", "Was es kostet: 50 Cent je Seite"],
    ["der interessantere Fall", "Mauzi-Seite mit Wunschtext"],
    ["Letzte Seite", "Vogel-Seite ganz ohne Wunsch"],
    ["den die meisten nicht erwarten", "Druckbogen als PDF"],
    ["Antwort auf den Anfang", "Vitrine: Credits zurückbekommen"],
    ["so sieht der Binder jetzt aus", "Der fertige Binder"],
  ];
  const zeit = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const out: string[] = [];
  let ab = 0;
  for (const [nadel, name] of ANKER) {
    const i = cues.findIndex((c, j) => j >= ab && c.text.toLowerCase().includes(nadel.toLowerCase()));
    if (i < 0) { console.warn(`  Kapitel ohne Anker: ${name} („${nadel}")`); continue; }
    ab = i + 1;
    out.push(`${zeit(out.length === 0 ? 0 : cues[i].s)} ${name}`);
  }
  return out;
}

lauf().catch((e) => { console.error(e); process.exit(1); });
