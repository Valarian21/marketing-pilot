/**
 * Seiten bauen, deren Karten **farblich zusammenpassen** — und die trotzdem
 * wenig kosten.
 *
 * Grundlage ist die Bildmotiv-Analyse des Produkts: `card_art_tags` kennt für
 * 23.461 Karten die drei dominanten Farben, dazu Szene, Ort, Stimmung. Daraus
 * lässt sich eine Seite zusammenstellen, die im Binder wie ein Bild wirkt,
 * statt wie neun zufällige Karten nebeneinander.
 *
 * Zwei Wege zum Zielton:
 *
 *   --ton 210            ein Farbton in Grad (0 rot, 60 gelb, 120 grün, 210 blau, 300 magenta)
 *   --anker cel30-153    die Farben einer Ankerkarte; fehlen sie in der
 *                        Analyse (neues Set), werden sie aus dem Scan gerechnet
 *
 * Dazu `--max 100` als Preisdeckel für die ganze Seite, `--n 9` für die Zahl
 * der Fächer und `--mitte` für die Karte, die in Fach 5 liegt.
 *
 *   pnpm exec tsx scripts/reel-farbseite.ts --ton 210 --max 100
 *   pnpm exec tsx scripts/reel-farbseite.ts --anker cel30-153 --mitte cel30-153 --max 0
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadEnv } from "../src/server/env.js";
import { openDatabase } from "../src/server/db/index.js";
import { createProductDataProvider } from "../src/server/data-source.js";
import { runFfmpeg } from "../src/server/agents/video/assemble.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const eur = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;
const dateiName = (id: string) => id.replace(/[^\w.-]/g, "_");

// --- Farbe -------------------------------------------------------------------

interface Hsv { h: number; s: number; v: number }

/** Hex in Farbton, Sättigung, Helligkeit — nur der Ton entscheidet, ob etwas zusammenpasst. */
function hsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

/** Abstand zweier Farbtöne auf dem Kreis — 350° und 10° liegen 20° auseinander, nicht 340°. */
const tonAbstand = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * Die dominanten Farben eines Kartenscans, wenn die Analyse sie nicht kennt.
 *
 * Das Bild wird auf ein grobes Raster heruntergerechnet; jedes Feld ist dann
 * der Mittelwert seines Bereichs. Gezählt wird nach Sättigung gewichtet —
 * ein graues Feld sagt nichts darüber, welche Farbe eine Karte hat.
 */
async function farbenAusBild(datei: string): Promise<string[]> {
  const roh = path.join("/tmp", `farbe-${path.basename(datei)}.rgb`);
  await runFfmpeg(["-i", datei, "-vf", "crop=iw*0.86:ih*0.6:iw*0.07:ih*0.08,scale=8:10", "-f", "rawvideo", "-pix_fmt", "rgb24", "-y", roh]);
  const buf = fs.readFileSync(roh);
  fs.unlinkSync(roh);
  const eimer = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const r = buf[i]!, g = buf[i + 1]!, b = buf[i + 2]!;
    const f = hsv(`#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`);
    if (!f || f.s < 0.18 || f.v < 0.12) continue;
    const k = Math.round(f.h / 20);                      // 18 Körbe à 20°
    const e = eimer.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1; e.r += r; e.g += g; e.b += b;
    eimer.set(k, e);
  }
  return [...eimer.values()].sort((a, b) => b.n - a.n).slice(0, 3)
    .map((e) => `#${[e.r / e.n, e.g / e.n, e.b / e.n].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`);
}

// --- Auswahl -----------------------------------------------------------------

interface Kandidat {
  id: string; name: string; localId: string; setname: string; rarity: string;
  preis: number; dex: number; farben: Hsv[]; abstand: number; leit: Hsv;
}

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const daten = createProductDataProvider(db, env, PROJEKT, { log: () => {} });
const kartenDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten");
fs.mkdirSync(kartenDir, { recursive: true });

async function bildHolen(cardId: string): Promise<string | null> {
  const name = dateiName(cardId);
  const ziel = path.join(kartenDir, `${name}.jpg`);
  if (fs.existsSync(ziel)) return name;
  const quelle = await daten.cardImage(cardId, "de");
  if (!quelle) return null;
  await runFfmpeg(["-i", quelle, "-vf", "scale=340:-1:flags=lanczos", "-q:v", "3", "-y", ziel]);
  return name;
}

const kat = new Database(path.join(env.MP_DATA_DIR, "cache", "binderplan.db"), { readonly: true });

/** Der Zielton: aus `--ton`, sonst aus den Farben der Ankerkarte. */
async function zielToene(): Promise<{ toene: Hsv[]; quelle: string }> {
  const ton = arg("--ton");
  if (ton) return { toene: [{ h: Number(ton), s: 0.7, v: 0.7 }], quelle: `Ton ${ton}°` };
  const anker = arg("--anker");
  if (!anker) throw new Error("--ton oder --anker angeben");
  const z = kat.prepare(`SELECT farben FROM card_art_tags WHERE card_id = ?`).get(anker) as { farben: string | null } | undefined;
  const ausDb = z?.farben ? (JSON.parse(z.farben) as string[]) : [];
  if (ausDb.length) {
    const t = ausDb.map(hsv).filter((f): f is Hsv => f !== null && f.s > 0.2);
    if (t.length) return { toene: t, quelle: `Analyse von ${anker}: ${ausDb.join(" ")}` };
  }
  // Kein Eintrag in der Analyse — neue Sets sind dort noch nicht drin.
  const scan = path.join(kartenDir, `${dateiName(anker)}.jpg`);
  const datei = fs.existsSync(scan) ? scan : await daten.cardImage(anker, "de");
  if (!datei) throw new Error(`Kein Bild für ${anker}`);
  const hex = await farbenAusBild(datei);
  const t = hex.map(hsv).filter((f): f is Hsv => f !== null);
  return { toene: t, quelle: `aus dem Scan von ${anker}: ${hex.join(" ")}` };
}

const { toene, quelle } = await zielToene();
const maxSumme = Number(arg("--max") ?? 100);
const n = Number(arg("--n") ?? 9);
const mitte = arg("--mitte");
const maxPreisJeKarte = Number(arg("--deckel") ?? (maxSumme > 0 ? Math.max(8, (maxSumme / n) * 2.2) : 99999));

console.log(`Zielton: ${quelle} → ${toene.map((t) => `${Math.round(t.h)}° (S ${t.s.toFixed(2)}, H ${t.v.toFixed(2)})`).join(", ")}`);

/**
 * Nur Seltenheiten, deren Bild die ganze Karte füllt.
 *
 * Eine gewöhnliche Holo hat ein Fenster von einem Drittel Kartenhöhe; neun
 * davon nebeneinander sind neun Rahmen, keine Seite. Die farbige Wirkung, um
 * die es hier geht, entsteht erst bei Illustration Rares, Art Rares und den
 * vollflächigen ex-Karten.
 */
const SCHOEN = ["%illustration rare%", "%art rare%", "%ultra rare%", "%full art%", "%hyper rare%", "%secret rare%"];

const roh = kat.prepare(`
  SELECT c.id, COALESCE(c.name_de, c.name_en) AS name, c.local_id, c.rarity, c.first_dex AS dex,
         s.name AS setname, COALESCE(p.eur_avg30, p.eur) AS preis, t.farben
    FROM card_art_tags t
    JOIN cards c ON c.id = t.card_id
    JOIN sets s ON s.id = c.set_id
    JOIN card_prices p ON p.card_id = c.id
   WHERE t.farben IS NOT NULL
     AND s.region = 'intl'
     AND COALESCE(c.image_de, c.image_en) IS NOT NULL
     AND COALESCE(p.eur_avg30, p.eur) BETWEEN 0.5 AND ?
     AND (${SCHOEN.map(() => "lower(c.rarity) LIKE ?").join(" OR ")})
`).all(maxPreisJeKarte, ...SCHOEN) as Record<string, string | number | null>[];

const kandidaten: Kandidat[] = [];
for (const r of roh) {
  const farben = (JSON.parse(String(r["farben"])) as string[]).map(hsv).filter((f): f is Hsv => f !== null);
  // Eine fast graue Karte „passt" rechnerisch zu allem und im Binder zu nichts.
  const bunt = farben.filter((f) => f.s > 0.28 && f.v > 0.2);
  if (!bunt.length) continue;
  /**
   * Der Abstand misst drei Dinge, nicht nur den Farbton.
   *
   * Feelinara ist blass-rosa; nach reinem Ton gewinnen kräftige Feuerkarten,
   * weil deren Orange demselben Winkel am nächsten liegt. Sättigung und
   * Helligkeit müssen mit hinein, sonst liegt neben einer Pastellkarte ein
   * Knallrot und die Seite fällt auseinander. Die Gewichte sind so gewählt,
   * dass ein Unterschied von 0,3 in der Sättigung etwa 18° Farbton wiegt.
   */
  let abstand = 999, leit = bunt[0]!;
  for (const f of bunt) for (const t of toene) {
    const d = tonAbstand(f.h, t.h) + 60 * Math.abs(f.s - t.s) + 40 * Math.abs(f.v - t.v);
    if (d < abstand) { abstand = d; leit = f; }
  }
  kandidaten.push({
    id: String(r["id"]), name: String(r["name"]), localId: String(r["local_id"]),
    setname: String(r["setname"]), rarity: String(r["rarity"] ?? ""),
    preis: Number(r["preis"]), dex: Number(r["dex"] ?? 0), farben, abstand, leit,
  });
}
/**
 * Sortiert wird nach Farbnähe, bei gleicher Nähe nach **Preis absteigend**.
 *
 * Andersherum füllt sich die Seite mit Ein-Euro-Karten, und das Budget bleibt
 * ungenutzt: Beim ersten Lauf am 14.09.2026 kostete eine 100-€-Seite ganze
 * sechs Euro — rechnerisch richtig, im Binder enttäuschend. Der Deckel je Karte
 * verhindert, dass eine einzige Karte das ganze Budget frisst.
 */
kandidaten.sort((a, b) => a.abstand - b.abstand || b.preis - a.preis);

/**
 * Auswahl: die farbnächsten Karten, aber jedes Pokémon nur einmal — neun
 * Glumanda in einer Reihe sind keine Seite, sondern eine Wiederholung. Das
 * Budget gilt für die ganze Seite.
 */
const gewaehlt: Kandidat[] = [];
const dexGesehen = new Set<number>();
let summe = 0;
const braucht = mitte ? n - 1 : n;
for (const k of kandidaten) {
  if (gewaehlt.length >= braucht) break;
  if (k.id === mitte || dexGesehen.has(k.dex)) continue;
  // Für jeden noch freien Platz einen Euro zurücklegen, sonst bleibt der
  // letzte Platz leer, weil das Budget schon verteilt ist.
  const reserve = braucht - gewaehlt.length - 1;
  if (maxSumme > 0 && summe + k.preis + reserve > maxSumme) continue;
  gewaehlt.push(k); dexGesehen.add(k.dex); summe += k.preis;
}

// Sortiert wird nach Helligkeit: dunkel oben, hell unten — so bekommt die Seite
// ein Gefälle statt eines Flickenteppichs.
gewaehlt.sort((a, b) => a.leit.v - b.leit.v);

let reihe: (Kandidat | { id: string; name: string; preis: number })[] = gewaehlt;
if (mitte) {
  const m = kat.prepare(`
    SELECT c.id, COALESCE(c.name_de, c.name_en) AS name, COALESCE(p.eur_avg30, p.eur) AS preis
      FROM cards c LEFT JOIN card_prices p ON p.card_id = c.id WHERE c.id = ?`).get(mitte) as Record<string, string | number | null> | undefined;
  const ankerKarte = { id: mitte, name: String(m?.["name"] ?? mitte), preis: Number(m?.["preis"] ?? 0) };
  reihe = [...gewaehlt.slice(0, 4), ankerKarte, ...gewaehlt.slice(4)];
}

const karten: string[] = [], preise: string[] = [], namen: string[] = [];
for (const k of reihe) {
  const bild = await bildHolen(k.id);
  karten.push(bild ?? "");
  preise.push(k.preis > 0 ? eur(k.preis) : "–");
  namen.push(k.name);
  const extra = "abstand" in k ? `  ${Math.round(k.abstand)}° · ${k.leit.h.toFixed(0)}°  ${k.setname}` : "  (Mitte)";
  console.log(`  ${k.name.padEnd(22)} ${eur(k.preis).padStart(8)}${extra}${bild ? "" : "  KEIN BILD"}`);
}
console.log(`\n  Summe: ${eur(reihe.reduce((s, k) => s + k.preis, 0))}`);
console.log(`  karten: ${JSON.stringify(karten)},`);
console.log(`  preise: ${JSON.stringify(preise)},`);
console.log(`  namen:  ${JSON.stringify(namen)},`);

kat.close();
daten.close();
