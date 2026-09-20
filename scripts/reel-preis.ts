/**
 * Preis-Ranglisten auf der Binderseite — Top 10 und Top 20.
 *
 * Fünf Varianten, ein Aufbau: Set, Ära, Illustrator, Seltenheit, Pokémon. Der
 * Unterschied ist allein der **Bereich**; Bühne, Takt und Dramaturgie sind
 * überall dieselben (`binderbuehne.ts`, Playbook Abschnitt J).
 *
 * Die Dramaturgie ist die wichtigste Regel des Formats: **die Spitze kommt
 * zuletzt.** Die Seite füllt sich von Platz 10 aufwärts bis Platz 2, dann
 * bekommt Platz 1 ein eigenes Bild. Wer mit dem Teuersten anfängt, hat nach
 * zwei Sekunden nichts mehr zu zeigen.
 *
 *   Top 10  — neun Karten auf einer Seite (10 … 2), Platz 1 einzeln
 *   Top 20  — achtzehn Karten auf zwei Seiten (20 … 3), Platz 2 und 1 einzeln
 *
 * Die Karten holt das Skript **beim Bauen** aus dem Katalog, nicht aus dem
 * Drehbuch: Preise ändern sich täglich, und eine einbetonierte Liste wäre nach
 * einer Woche falsch. Was gebaut wurde, steht danach im `meta` des Stücks.
 *
 *   pnpm exec tsx scripts/reel-preis.ts --drehbuch set151 --ohne-folgen
 *   pnpm exec tsx scripts/reel-preis.ts --drehbuch set151 --nur-liste
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadEnv, ROOT } from "../src/server/env.js";
import { openDatabase, newId, nowIso, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { playwrightRenderer, dataUrlFor, type RenderJob } from "../src/server/agents/studio/render.js";
import { createProductDataProvider } from "../src/server/data-source.js";
import { runFfmpeg, OUTPUT_FPS } from "../src/server/agents/video/assemble.js";
import { abspannClip, ABSPANN_MS } from "../src/server/agents/video/abspann-binderplan.js";
import { folgenHtml, SITZE, folgenFenster, KANAL, type Plattform } from "../src/server/agents/video/folgen-pille.js";
import { seiteHtml, einzelHtml, textHtml, TEXT_OBEN, W, H, type Fach }
  from "../src/server/agents/video/binderbuehne.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const s3 = (ms: number) => (ms / 1000).toFixed(3);
const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const flagge = (n: string) => process.argv.includes(n);
const eur = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;
/** Kartennummern enthalten „!" und „/" — als Dateiname taugt nur das Gesäuberte. */
const dateiName = (id: string) => id.replace(/[^\w.-]/g, "_");

/** Takt der Animation — Werte in Millisekunden. */
const TAKT = {
  /** Wie lange die leere Seite am Anfang steht. */
  vorlauf: 1300,
  /** Kürzerer Vorlauf für die zweite Seite: Der Aufbau ist da schon erklärt. */
  vorlaufB: 500,
  /** Abstand zwischen zwei Karten — straffer als bei den Einschub-Reels, weil hier neun Preise zu lesen sind. */
  versatz: 420,
  einschub: 560,
  /** Wie lange die volle Seite steht, bevor geschnitten wird. */
  seiteSteht: 1600,
  /** Wie lange eine Einzelkarte steht. */
  einzelSteht: 2600,
  /** Nach der Folgen-Pille, bevor der Abspann übernimmt. */
  nachlauf: 800,
};

/** Marken im Zeitstrahl, auf die sich die Textzeilen beziehen. */
type Marke = "start" | "vollA" | "seiteB" | "vollB" | "zwei" | "eins";

interface PreisBuch {
  titel: string;
  /** Genau ein Feld setzen — daraus entsteht die Rangliste. */
  bereich: { set?: string; era?: string; illustrator?: string; rarity?: string; pokemon?: string };
  aufbau: "zehn" | "zwanzig";
  /**
   * Textzeilen, an Marken gehängt statt an Millisekunden: Die Länge der Szenen
   * hängt am Aufbau, und eine feste Zahl wäre bei jeder Änderung falsch.
   */
  zeilen: { ab: Marke; versatzMs?: number; text: string; bisMs?: number }[];
  /**
   * Vor welcher Marke die Folgen-Pille läuft — dort, wo das Stück ohnehin Luft
   * holt. Ohne Angabe läuft sie vor der Schlusszeile. Bei der Zwanziger gehört
   * sie **vor** die Spitze: Sonst stünde sie mitten in der Auflösung.
   */
  pilleVor?: Marke;
  /** `{summe} {stand} {top1} {top1preis} {top2} {top2preis} {anzahl} {bereich}` werden eingesetzt. */
  caption: string;
  captionKurz: string;
  hashtags: string[];
  musik: string;
}

const DREHBUECHER: Record<string, PreisBuch> = {
  /** 1 — Top 10 eines Sets. */
  set151: {
    titel: "Die teuersten Karten aus 151",
    bereich: { set: "sv03.5" },
    aufbau: "zehn",
    zeilen: [
      { ab: "start", text: "Die zehn teuersten\nKarten aus 151." },
      { ab: "vollA", versatzMs: -2400, text: "Platz 10 bis 2." },
      { ab: "vollA", versatzMs: 200, text: "Zusammen {summe}." },
      { ab: "eins", versatzMs: 400, text: "Platz 1: {top1preis}." },
      { ab: "eins", versatzMs: 2400, text: "Over- oder underrated?", bisMs: 0 },
    ],
    caption: `Die zehn teuersten Karten aus 151.

Neun davon passen auf eine Binderseite, zusammen {summe}. Oben steht {top1} mit {top1preis} — und das ist der Punkt, an dem die meisten aufhören, das Set zu vervollständigen.

Alle Preise stehen in Binderplan: nach Set, nach Ära, nach Pokémon, in Euro und aus Cardmarket. Der 30-Tage-Schnitt, nicht der Trendpreis — der folgt einzelnen Verkäufen und hebt eine Karte schon mal um das Vierfache.

Stand {stand}: binderplan.app

151 — over- oder underrated?`,
    captionKurz: `Die zehn teuersten Karten aus 151 — neun auf einer Seite, zusammen {summe}. Oben: {top1} mit {top1preis}.

Over- oder underrated?`,
    hashtags: ["#pokemon151", "#pokemonpreise", "#cardmarket", "#pokemonsammeln", "#binderplan", "#pokemontcg"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },

  /** 2 — Top 20 einer Ära. */
  aeraklassik: {
    titel: "Die 20 teuersten der WotC-Zeit",
    bereich: { era: "klassik" },
    aufbau: "zwanzig",
    pilleVor: "zwei",
    zeilen: [
      { ab: "start", text: "Die 20 teuersten Karten\nder WotC-Zeit." },
      { ab: "vollA", versatzMs: -2600, text: "Platz 20 bis 12." },
      { ab: "seiteB", versatzMs: 300, text: "Platz 11 bis 3." },
      { ab: "zwei", versatzMs: 400, text: "Platz 2: {top2preis}." },
      { ab: "eins", versatzMs: 400, text: "Platz 1: {top1preis}." },
      { ab: "eins", versatzMs: 2400, text: "Die Ära: over- oder\nunderrated?", bisMs: 0 },
    ],
    caption: `Die 20 teuersten Karten aus der WotC-Zeit.

1999 bis 2003, achtzehn davon auf zwei Binderseiten, zusammen {summe}. An der Spitze {top1} mit {top1preis}.

Das Base-Set ist überbewertet und die e-Card-Zeit unterbewertet — von Skyridge und Aquapolis liegt schlicht nichts mehr herum, weil die Sets damals kaum jemand ernst genommen hat.

Alle Preise nach Ära in Binderplan, aus Cardmarket im 30-Tage-Schnitt. Stand {stand}: binderplan.app

Die WotC-Zeit — over- oder underrated?`,
    captionKurz: `Die 20 teuersten der WotC-Zeit, zusammen {summe}. Oben: {top1} mit {top1preis}.

Die WotC-Zeit — over- oder underrated?`,
    hashtags: ["#wotc", "#pokemonvintage", "#pokemonpreise", "#cardmarket", "#pokemonsammeln", "#binderplan"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
  },

  /** 3 — Top 10 eines Illustrators. */
  illuarita: {
    titel: "Die teuersten Karten von Mitsuhiro Arita",
    bereich: { illustrator: "Mitsuhiro Arita" },
    aufbau: "zehn",
    zeilen: [
      // „Zehn Karten, ein Zeichner" lief schon als eigenes Reel (`illustrator`) —
      // derselbe Einstieg zweimal im Feed liest sich wie eine Wiederholung.
      { ab: "start", text: "Mitsuhiro Arita." },
      { ab: "vollA", versatzMs: -2400, text: "Seine 10 teuersten Karten." },
      { ab: "vollA", versatzMs: 200, text: "Zusammen {summe}." },
      { ab: "eins", versatzMs: 400, text: "Platz 1: {top1preis}." },
      { ab: "eins", versatzMs: 2400, text: "Sammelt ihr seine Karten?", bisMs: 0 },
    ],
    caption: `Mitsuhiro Arita. Seine zehn teuersten Karten.

Den Base-Set-Glurak kennt jeder, den Zeichner nicht. Neun davon passen auf eine Seite, zusammen {summe}, und oben steht {top1} mit {top1preis}.

Wer eine Seite nach Handschrift baut statt nach Set, bekommt den schöneren Ordner und zahlt meistens weniger. In Binderplan kannst du nach Illustrator suchen und die Seite direkt daraus bauen.

Cardmarket, 30-Tage-Schnitt, Stand {stand}: binderplan.app

Sammelt ihr seine Karten?`,
    captionKurz: `Mitsuhiro Arita — seine zehn teuersten Karten, zusammen {summe}. Den Base-Set-Glurak kennt jeder, den Zeichner nicht.

Sammelt ihr seine Karten?`,
    hashtags: ["#mitsuhiroarita", "#pokemonart", "#pokemonpreise", "#pokemonsammeln", "#binderart", "#binderplan"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },

  /** 4 — Top 20 einer Seltenheit. */
  raritysir: {
    titel: "Die 20 teuersten Special Illustration Rares",
    bereich: { rarity: "Special Illustration Rare" },
    aufbau: "zwanzig",
    pilleVor: "zwei",
    zeilen: [
      { ab: "start", text: "Die teuerste Seltenheit\nder Gegenwart." },
      { ab: "vollA", versatzMs: -2600, text: "Special Illustration Rare.\nPlatz 20 bis 12." },
      { ab: "seiteB", versatzMs: 300, text: "Platz 11 bis 3." },
      { ab: "zwei", versatzMs: 400, text: "Platz 2: {top2preis}." },
      { ab: "eins", versatzMs: 400, text: "Platz 1: {top1preis}." },
      { ab: "eins", versatzMs: 2400, text: "Over- oder underrated?", bisMs: 0 },
    ],
    caption: `Die 20 teuersten Special Illustration Rares.

Die Seltenheit, die den ganzen modernen Markt trägt: {anzahl} Karten gibt es davon, achtzehn passen hier auf zwei Seiten, zusammen {summe}. Oben steht {top1} mit {top1preis}.

Eine SIR ist keine bessere Karte — sie ist eine seltener gezogene. Was den Preis macht, ist das Motiv, und deshalb sind die teuersten fast immer die mit der schönsten Szene.

Alle Seltenheiten nach Preis in Binderplan, Cardmarket im 30-Tage-Schnitt. Stand {stand}: binderplan.app

Special Illustration Rares — over- oder underrated?`,
    captionKurz: `Die 20 teuersten Special Illustration Rares, zusammen {summe}. Oben: {top1} mit {top1preis}.

Over- oder underrated?`,
    hashtags: ["#specialillustrationrare", "#pokemonpreise", "#chasecards", "#cardmarket", "#pokemonsammeln", "#binderplan"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
  },

  /** 5 — Top 10 eines Pokémon. */
  pokeglurak: {
    titel: "Die teuersten Glurak-Karten",
    bereich: { pokemon: "Glurak" },
    aufbau: "zehn",
    zeilen: [
      { ab: "start", text: "Die zehn teuersten\nGlurak-Karten." },
      { ab: "vollA", versatzMs: -2400, text: "Aus 30 Jahren." },
      { ab: "vollA", versatzMs: 200, text: "Zusammen {summe}." },
      { ab: "eins", versatzMs: 400, text: "Platz 1: {top1preis}." },
      { ab: "eins", versatzMs: 2400, text: "Over- oder underrated?", bisMs: 0 },
    ],
    caption: `Die zehn teuersten Glurak-Karten.

Neun auf einer Seite, zusammen {summe}, und oben steht {top1} mit {top1preis} — nicht der Base-Set-Glurak, den alle erwarten.

Genau dafür ist die Pokémon-Suche in Binderplan da: alle Karten eines Pokémon aus allen Sets, mit Preis, auf Seiten verteilt. Eine Glurak-Seite ist das erste, was die meisten bauen wollen.

Cardmarket, 30-Tage-Schnitt, Stand {stand}: binderplan.app

Glurak-Preise — over- oder underrated?`,
    captionKurz: `Die zehn teuersten Glurak-Karten, zusammen {summe}. Oben steht {top1} mit {top1preis} — nicht der aus dem Base-Set.

Over- oder underrated?`,
    hashtags: ["#glurak", "#charizard", "#pokemonpreise", "#cardmarket", "#pokemonsammeln", "#binderplan"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },
};

const name = arg("--drehbuch") ?? "set151";
const buch = DREHBUECHER[name];
if (!buch) throw new Error(`Kein Drehbuch „${name}". Bekannt: ${Object.keys(DREHBUECHER).join(", ")}`);
const plattform = (arg("--plattform") ?? "instagram") as Plattform;
if (!SITZE[plattform]) throw new Error(`Keine Plattform „${plattform}"`);
const ohneFolgen = flagge("--ohne-folgen");

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const kit = loadBrandKit(db, PROJEKT);
const akzent = kit.accent2 ?? kit.colors?.[1] ?? "#F5C518";
const daten = createProductDataProvider(db, env, PROJEKT, { log: () => {} });

// --- Die Rangliste -----------------------------------------------------------

const anzahlKarten = buch.aufbau === "zehn" ? 10 : 20;
const liste = await daten.topCards({ scope: buch.bereich, n: anzahlKarten, priceBasis: "avg30" });
if (liste.cards.length < anzahlKarten) {
  throw new Error(`Nur ${liste.cards.length} bepreiste Karten im Bereich — ${anzahlKarten} gebraucht.`);
}

const kartenDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten");
const grossDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten-gross");
fs.mkdirSync(kartenDir, { recursive: true });
fs.mkdirSync(grossDir, { recursive: true });

/**
 * Scan in zwei Größen ablegen: 340 px fürs Fach, 700 px für die Einzelkarte.
 *
 * Ein Fach ist im Reel höchstens 288 px breit, die Einzelkarte 640 — mit einem
 * 340-px-Scan wäre die Spitze des Videos das unschärfste Bild darin.
 */
async function bildHolen(cardId: string): Promise<{ klein: string; gross: string } | null> {
  const datei = dateiName(cardId);
  const klein = path.join(kartenDir, `${datei}.jpg`);
  const gross = path.join(grossDir, `${datei}.jpg`);
  if (!fs.existsSync(klein) || !fs.existsSync(gross)) {
    const quelle = await daten.cardImage(cardId, "de");
    if (!quelle) return null;
    if (!fs.existsSync(klein)) await runFfmpeg(["-i", quelle, "-vf", "scale=340:-1:flags=lanczos", "-q:v", "3", "-y", klein]);
    if (!fs.existsSync(gross)) await runFfmpeg(["-i", quelle, "-vf", "scale=700:-1:flags=lanczos", "-q:v", "2", "-y", gross]);
  }
  return { klein, gross };
}

interface Karte { rang: number; name: string; preisEur: number; preis: string; klein: string; gross: string }
const karten: Karte[] = [];
for (const c of liste.cards) {
  const bild = await bildHolen(c.id);
  if (!bild) throw new Error(`Kein Scan für ${c.name} (${c.id}) — Rangliste hat eine Lücke.`);
  karten.push({ rang: c.rank, name: c.name, preisEur: c.priceEur, preis: eur(c.priceEur), ...bild });
}
const summe = karten.reduce((s, k) => s + k.preisEur, 0);
console.log(`${liste.scopeLabel} — ${liste.scopeSub}`);
console.log(`Preisstand ${liste.priceStand}, Summe ${eur(summe)}`);
for (const k of karten) console.log(`  ${String(k.rang).padStart(2)}. ${k.name.padEnd(26)} ${k.preis.padStart(10)}`);
if (flagge("--nur-liste")) { daten.close(); process.exit(0); }

/** Platzhalter in den Texten füllen. */
const setzen = (s: string) => s
  .replace(/\{summe\}/g, eur(summe))
  .replace(/\{stand\}/g, liste.priceStand)
  .replace(/\{anzahl\}/g, String(liste.coverage.cardsInScope))
  .replace(/\{bereich\}/g, liste.scopeLabel)
  .replace(/\{top1preis\}/g, karten[0]!.preis)
  .replace(/\{top1\}/g, karten[0]!.name)
  .replace(/\{top2preis\}/g, karten[1]?.preis ?? "")
  .replace(/\{top2\}/g, karten[1]?.name ?? "");

// --- Der Zeitstrahl ----------------------------------------------------------

const pieceId = newId();
const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
const arbeit = path.join(outDir, "arbeit");
fs.mkdirSync(arbeit, { recursive: true });

/**
 * Eine Szene: bewegte Einzelbilder, danach ein Standbild.
 *
 * Gerendert wird nur die Bewegung. Nach der letzten Karte ändert sich im Bild
 * nichts mehr — ffmpeg hängt das letzte Einzelbild als Standbild an, sonst
 * wären zwei Drittel der Renders identisch.
 */
interface Szene { html: string; bewegtMs: number; standMs: number; startMs: number }

/**
 * Welche Karten auf welche Seite kommen.
 *
 * Die **erste** Seite trägt die hinteren Plätze (20 … 12), die zweite die
 * vorderen (11 … 3) — sonst liefe die Rangliste rückwärts und die Spitze käme
 * in der Mitte.
 */
const seitenKarten = buch.aufbau === "zehn"
  ? [karten.slice(1, 10)]
  : [karten.slice(11, 20), karten.slice(2, 11)];
const einzelKarten = buch.aufbau === "zehn" ? [karten[0]!] : [karten[1]!, karten[0]!];

/** Die Seite füllt sich von hinten nach vorn: Platz 10 zuerst, Platz 2 zuletzt. */
const seitenFolge = (gruppe: Karte[]) => [...gruppe].reverse();

const szenen: Szene[] = [];
const marken: Partial<Record<Marke, number>> = { start: 0 };
let uhr = 0;

seitenKarten.forEach((gruppe, si) => {
  const folge = seitenFolge(gruppe);
  const vorlauf = si === 0 ? TAKT.vorlauf : TAKT.vorlaufB;
  const faecher: Fach[] = folge.map((k) => ({
    bild: `background-image:url('${dataUrlFor(k.klein) ?? ""}')`,
    abMs: 0, preis: k.preis, rang: k.rang,
  }));
  folge.forEach((_, i) => { faecher[i]!.abMs = vorlauf + i * TAKT.versatz; });
  const bewegt = vorlauf + (folge.length - 1) * TAKT.versatz + TAKT.einschub + 120;
  if (si === 1) marken.seiteB = uhr;
  szenen.push({ html: seiteHtml(faecher, { einschubMs: TAKT.einschub, akzent }), bewegtMs: bewegt, standMs: TAKT.seiteSteht, startMs: uhr });
  uhr += bewegt + TAKT.seiteSteht;
  if (si === 0) marken.vollA = uhr - TAKT.seiteSteht; else marken.vollB = uhr - TAKT.seiteSteht;
});

einzelKarten.forEach((k, i) => {
  const bewegt = 700;
  if (einzelKarten.length === 2 && i === 0) marken.zwei = uhr;
  if (i === einzelKarten.length - 1) marken.eins = uhr;
  szenen.push({
    html: einzelHtml(dataUrlFor(k.gross) ?? "", { preis: k.preis, rang: k.rang, akzent, einschubMs: 640 }),
    bewegtMs: bewegt, standMs: TAKT.einzelSteht, startMs: uhr,
  });
  uhr += bewegt + TAKT.einzelSteht;
});

/**
 * Der Zeitplan, in dieser Reihenfolge — sonst passt das Ende nicht.
 *
 * Erst steht fest, wann die letzte Textzeile endet; danach kommt die
 * Folgen-Pille, und **daraus** ergibt sich die Gesamtlänge. Die Länge rechnet
 * immer mit der Pille, auch wenn dieser Lauf keine baut: Aus der Basis
 * entstehen später die App-Fassungen, und die legen die Pille an genau diese
 * Stelle.
 */
const zeilen = buch.zeilen.map((z, i) => {
  const ab = (marken[z.ab] ?? 0) + (z.versatzMs ?? 0);
  return { ...z, abMs: Math.max(0, ab), index: i };
});
zeilen.sort((a, b) => a.abMs - b.abMs);
/**
 * Die Pille läuft in der Lücke **vor** der Schlusszeile; die rückt dafür nach
 * hinten. So steht nach dem Hinweis noch Inhalt und nicht gleich der Abspann.
 */
const pilleVorIndex = buch.pilleVor ? zeilen.findIndex((z) => z.ab === buch.pilleVor) : undefined;
if (buch.pilleVor && (pilleVorIndex === undefined || pilleVorIndex < 1)) {
  throw new Error(`pilleVor „${buch.pilleVor}" findet keine passende Zeile.`);
}
const fenster = folgenFenster(zeilen.map((z) => z.abMs), pilleVorIndex);
if (fenster.verschiebeIndex !== null) zeilen[fenster.verschiebeIndex]!.abMs = fenster.verschiebeAufMs;
const letzteZeile = zeilen[zeilen.length - 1]!;
const folgenStart = fenster.startMs;
const folgenEnde = fenster.endMs;
const letzteZeileEnde = (letzteZeile.bisMs || letzteZeile.abMs + 2600) - 120;
const animMs = Math.max(uhr, letzteZeileEnde + TAKT.nachlauf);
// Die letzte Szene steht so lange, wie das Stück insgesamt braucht.
szenen[szenen.length - 1]!.standMs += Math.max(0, animMs - uhr);

console.log(`\n${buch.titel}: ${szenen.length} Szenen, ${(animMs / 1000).toFixed(1)} s`);
console.log(`  Marken: ${Object.entries(marken).map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}s`).join("  ")}`);

if (flagge("--nur-html")) {
  szenen.forEach((s, i) => { const f = path.join(arbeit, `szene-${i}.html`); fs.writeFileSync(f, s.html); console.log(f); });
  daten.close(); process.exit(0);
}

// --- Einzelbilder je Szene ---------------------------------------------------

const browser = await chromium.launch({ args: ["--hide-scrollbars", "--force-device-scale-factor=1"] });
const teile: string[] = [];
for (const [i, szene] of szenen.entries()) {
  const htmlDatei = path.join(arbeit, `szene-${i}.html`);
  fs.writeFileSync(htmlDatei, szene.html);
  const bilder = path.join(arbeit, `bilder-${i}`);
  fs.rmSync(bilder, { recursive: true, force: true });
  fs.mkdirSync(bilder, { recursive: true });

  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`file://${htmlDatei}`);
  await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready).catch(() => undefined);
  await page.waitForTimeout(400);
  const starts = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".karte")).map((el) => parseFloat(el.style.animationDelay) || 0));
  const anzahl = Math.ceil((szene.bewegtMs / 1000) * OUTPUT_FPS);
  for (let k = 0; k < anzahl; k++) {
    const tMs = (k / OUTPUT_FPS) * 1000;
    await page.evaluate(([zeit, st]) => {
      document.querySelectorAll<HTMLElement>(".karte").forEach((el, j) => {
        el.style.animationDelay = `${(st as number[])[j]! - (zeit as number)}ms`;
      });
    }, [tMs, starts] as [number, number[]]);
    await page.screenshot({ path: path.join(bilder, `f${String(k).padStart(4, "0")}.png`), type: "png" });
    if (k % 25 === 0) process.stdout.write(`  Szene ${i + 1}/${szenen.length}: ${k}/${anzahl}\r`);
  }
  await page.close();

  const standbild = path.join(bilder, `f${String(anzahl - 1).padStart(4, "0")}.png`);
  const teil = path.join(arbeit, `szene-${i}.mp4`);
  await runFfmpeg([
    "-framerate", String(OUTPUT_FPS), "-i", path.join(bilder, "f%04d.png"),
    "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(szene.standMs), "-i", standbild,
    "-filter_complex", "[0:v]setsar=1[a];[1:v]setsar=1[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]",
    "-map", "[v]", "-r", String(OUTPUT_FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-an", "-y", teil,
  ]);
  fs.rmSync(bilder, { recursive: true, force: true });
  teile.push(teil);
  console.log(`  Szene ${i + 1}/${szenen.length}: ${anzahl} Einzelbilder + ${(szene.standMs / 1000).toFixed(1)} s Standbild`);
}
await browser.close();

// --- Montage -----------------------------------------------------------------

const liste2 = path.join(arbeit, "szenen.txt");
fs.writeFileSync(liste2, teile.map((f) => `file '${f}'`).join("\n"));
const roh = path.join(arbeit, "roh.mp4");
await runFfmpeg(["-f", "concat", "-safe", "0", "-i", liste2, "-c", "copy", "-y", roh]);

const jobs: RenderJob[] = [];
const einblendungen = zeilen.map((z, i) => {
  const datei = path.join(arbeit, `text-${i}.png`);
  jobs.push({ html: textHtml(setzen(z.text), akzent), width: W, height: H, transparent: true, file: datei });
  // Die vorletzte Zeile endet, wenn die Pille kommt — beide sitzen an derselben
  // Stelle unter der Seite.
  const bis = i === fenster.kuerzeIndex ? fenster.kuerzeEndeMs + 120
    : z.bisMs || zeilen[i + 1]?.abMs || z.abMs + 2600;
  return { datei, startMs: z.abMs, endMs: bis - 120 };
});
const folgen = path.join(arbeit, "folgen.png");
/** Die Pille sitzt dort, wo auch der Text steht: unter der Binderseite. */
const folgenVersatz = Math.max(0, Math.round(TEXT_OBEN - 1318));
if (!ohneFolgen) jobs.push({ html: folgenHtml(akzent, plattform, folgenVersatz), width: W, height: H, transparent: true, file: folgen });
await playwrightRenderer(jobs);
if (!ohneFolgen) einblendungen.push({ datei: folgen, startMs: folgenStart, endMs: folgenEnde });

const eingang: string[] = ["-i", roh];
let n = 1;
const ein = einblendungen.map((c) => {
  eingang.push("-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(Math.max(200, c.endMs - c.startMs)),
    "-itsoffset", s3(c.startMs), "-i", c.datei);
  return { ...c, idx: n++ };
});
const f: string[] = ["[0:v]setsar=1[bild]"];
let letzte = "[bild]";
ein.forEach((c, k) => {
  f.push(`[${c.idx}:v]format=rgba,setsar=1[o${k}]`);
  f.push(`${letzte}[o${k}]overlay=0:0:eof_action=pass:enable='between(t,${s3(c.startMs)},${s3(c.endMs)})'[e${k}]`);
  letzte = `[e${k}]`;
});
f.push(`${letzte}fade=t=in:st=0:d=0.3,format=yuv420p[vout]`);

const koerper = path.join(arbeit, "koerper.mp4");
await runFfmpeg([...eingang, "-filter_complex", f.join(";"), "-map", "[vout]",
  "-r", String(OUTPUT_FPS), "-t", s3(animMs),
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-an", "-y", koerper]);

const abspann = await abspannClip(env.MP_DATA_DIR);
const gesamtMs = animMs + ABSPANN_MS;
const musik = flagge("--ohne-musik") ? null : path.join(ROOT, "assets", "music", arg("--musik") ?? buch.musik);
if (musik && !fs.existsSync(musik)) throw new Error(`Musik fehlt: ${musik}`);
const reel = path.join(outDir, "reel.mp4");
const ton = musik
  ? `[2:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${s3(gesamtMs)},` +
    `afade=t=in:st=0:d=1.0,afade=t=out:st=${s3(Math.max(0, gesamtMs - 2200))}:d=2.2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
  : `anullsrc=r=44100:cl=stereo,atrim=duration=${s3(gesamtMs)}[aout]`;
await runFfmpeg(["-i", koerper, "-i", abspann, ...(musik ? ["-i", musik] : []), "-filter_complex",
  `[0:v]setsar=1[a];[1:v]setsar=1[b];[a][b]concat=n=2:v=1:a=0,fade=t=out:st=${s3(gesamtMs - 500)}:d=0.5[v];${ton}`,
  "-map", "[v]", "-map", "[aout]", "-r", String(OUTPUT_FPS), "-t", s3(gesamtMs),
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
  "-metadata", `title=${buch.titel}`, "-y", reel]);
for (const teil of teile) fs.rmSync(teil, { force: true });
fs.rmSync(roh, { force: true });

const thumb = path.join(outDir, "reel-thumb.jpg");
await runFfmpeg(["-ss", s3((marken.eins ?? 0) + 1400), "-i", reel, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", "-y", thumb]);

const caption = setzen(plattform === "instagram" ? buch.caption : buch.captionKurz);
const hashtags = plattform === "instagram" ? buch.hashtags : buch.hashtags.slice(0, 3);
const ts = nowIso();
const assetId = newId(), thumbId = newId();
db.insert(t.mpContentPieces).values({
  id: pieceId, projectId: PROJEKT, taskId: null, channel: KANAL[plattform], format: "artwork_reel",
  title: `${buch.titel} · ${plattform}`,
  body: `${caption}\n\n${hashtags.join(" ")}`,
  assets: toJson([assetId, thumbId]), status: ohneFolgen ? "draft" : "review",
  humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}",
  meta: toJson({ platform: plattform, language: "de", size: `${W}x${H}`, linkRule: "bio",
    caption, captionLang: setzen(buch.caption), captionKurz: setzen(buch.captionKurz), hashtags, hashtagsAlle: buch.hashtags,
    drehbuch: `preis-${name}`, art: "werbung", ohneStimme: true, dauerMs: gesamtMs, abspannMs: ABSPANN_MS,
    folgenZeit: { startMs: folgenStart, endMs: folgenEnde }, folgenVersatz, basis: ohneFolgen,
    // Was gebaut wurde, bleibt nachvollziehbar: Preise ändern sich täglich.
    rangliste: karten.map((k) => ({ rang: k.rang, name: k.name, eur: Math.round(k.preisEur) })),
    preisStand: liste.priceStand, summeEur: Math.round(summe), bereich: buch.bereich, aufbau: buch.aufbau,
    kiBild: false }),
  aiTellScore: null, aiTellNotes: "Echte Kartenscans und Cardmarket-Preise, Texte von Hand.", rejectionReason: "",
  createdAt: ts, updatedAt: ts,
}).run();
db.insert(t.mpAssets).values({ id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video",
  path: path.relative(env.MP_DATA_DIR, reel),
  meta: toJson({ aiGenerated: false, provenance: "reel-preis", drehbuch: name, plattform, size: `${W}x${H}` }), createdAt: ts }).run();
db.insert(t.mpAssets).values({ id: thumbId, projectId: PROJEKT, contentPieceId: pieceId, kind: "image",
  path: path.relative(env.MP_DATA_DIR, thumb),
  meta: toJson({ aiGenerated: false, provenance: "reel-preis", role: "thumbnail", size: "540x960" }), createdAt: ts }).run();

daten.close();
console.log(`\nFertig: ${reel}`);
console.log(`Stück ${pieceId} steht auf „${ohneFolgen ? "draft" : "review"}".`);
