/**
 * Hook-Reels: eine Zahl je Einstellung, riesig, und die Karte füllt das Bild.
 *
 * Das zweite Layout neben der Binderseiten-Bühne (`reel-binder.ts`). Dort
 * erklärt eine ruhige Zeile unter dem Blatt; hier gibt es keine Sätze im Bild —
 * nur Zahlen, Stempel und eine Frage, alles mittig und groß genug, dass es
 * auch als Vorschaubild trägt. Entstanden am 17.09.2026, nachdem das erste
 * RGB-Verkaufs-Reel im Handy-Kontaktbogen durchgefallen war: 62-px-Zeilen
 * unten links (3 % der Bildhöhe), sechs Zahlen in 20 s, 18 s Standbild.
 *
 * Fünf Regeln, die jedes Drehbuch hier einhält:
 *  1. Die Zahl ist das Bild — Bungee, gelb, schwarze Kontur, bis 250 px.
 *  2. Die Karte füllt das Bild (900 px) und zoomt in jeder Einstellung.
 *  3. Erste Sekunde: Karte und Zahl knallen rein. Der Beweis kommt danach.
 *  4. Höchstens vier Zahlen, steigender Takt (schnelle Serie in der Mitte).
 *  5. Die letzte Einstellung ist die erste — das Reel läuft in die Schleife.
 *
 * Aufruf wie gewohnt:
 *   pnpm exec tsx scripts/reel-hook.ts --drehbuch verkauft --ohne-folgen
 *   pnpm exec tsx scripts/reel-plattformen.ts --drehbuch verkauft-hook
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, ROOT } from "../src/server/env.js";
import { openDatabase, newId, nowIso, parseJson, toJson } from "../src/server/db/index.js";
import { eq } from "drizzle-orm";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { playwrightRenderer, dataUrlFor, type RenderJob } from "../src/server/agents/studio/render.js";
import { fontHead } from "../src/server/agents/studio/fonts.js";
import { runFfmpeg, OUTPUT_FPS } from "../src/server/agents/video/assemble.js";
import { abspannClip, ABSPANN_MS } from "../src/server/agents/video/abspann-binderplan.js";
import { folgenHtml, SITZE, FOLGEN_MS, KANAL, type Plattform } from "../src/server/agents/video/folgen-pille.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const W = 1080, H = 1920;
const s3 = (ms: number) => (ms / 1000).toFixed(3);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const hatFlagge = (name: string) => process.argv.includes(name);

// --- Drehbuch ----------------------------------------------------------------

type Farbe = "rot" | "gruen" | "blau" | "drei";
const GRUND: Record<Farbe, { mitte: string; dunkel: string }> = {
  rot:   { mitte: "#C41E23", dunkel: "#3A0608" },
  gruen: { mitte: "#128A4C", dunkel: "#052A16" },
  blau:  { mitte: "#2450C4", dunkel: "#07153E" },
  drei:  { mitte: "#2A2F45", dunkel: "#0A0C14" },
};

/** Der Beweis: die drei Zeilen einer eBay-Verkaufsliste, aus dem Screenshot abgetippt. */
interface Beleg { datum: string; titel: string; preis: string }

type Clip =
  /** Eine Karte, groß; darüber wahlweise Zahl, Unterzeile und Stempel. */
  | { art: "karte"; karte: string; farbe: Farbe; zahl?: string; sub?: string; stempel?: string; dauerMs: number }
  /** Karte klein oben, darunter der weiße Zettel mit der eBay-Zeile, unten ein Wort. */
  | { art: "beweis"; karte: string; farbe: Farbe; beleg: Beleg; zahl?: string; dauerMs: number }
  /** Alle drei gefächert, darüber Zahl und Unterzeile — oder drei große Zeilen (Teaser). */
  | { art: "drei"; karten: [string, string, string]; zahl?: string; sub?: string; zeilen?: [string, string, string]; dauerMs: number }
  /**
   * Eine ganze eBay-Zeile als Screenshot — mit dem Foto der Auktion, gross.
   * Marcel: „damit man schneller erkennt, dass es echt ist". Nur Zeilen ohne
   * Namen im Bild (die Australien-Zeile trägt einen, sie bleibt draussen).
   */
  | { art: "screenshot"; datei: string; farbe: Farbe; zahl?: string; sub?: string; unten?: string; dauerMs: number }
  /** Eine Karte, zwei Zeilen als Frage — die Schlusseinstellung. */
  | { art: "frage"; karte: string; farbe: Farbe; zeilen: [string, string]; dauerMs: number };

interface Drehbuch {
  titel: string;
  setLogo?: string;
  musik: string;
  clips: Clip[];
  caption: string;
  captionKurz?: string;
  hashtags: string[];
  /** Clip mit der Folgen-Pille — trägt keinen Text (gleiche Regel wie in reel-binder.ts). */
  folgenAbClip?: number | null;
}

const DREHBUECHER: Record<string, Drehbuch> = {
  /**
   * „8.229 €" — die ersten sechs Verkäufe der RGB-Mew, als Hook-Reel.
   *
   * Zahlen aus Marcels Screenshots der eBay-Verkaufsliste (17.09.2026, 00:03
   * und 01:49 Uhr): Englisch Rot 8.229 € (USA), Grün 3.577 € (AU) und 2.968 €
   * (GB); Japanisch Rot 6.384 €, Blau 5.180 €, Grün 4.747 €. Im Bild stehen
   * vier davon, der Rest in der Caption — mehr merkt sich niemand.
   */
  verkauft: {
    titel: "8.229 Euro. Für ein Mew. Verkauft.",
    setLogo: "cel30-setlogo.png",
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      // Reißerisch rein, wie Marcel es wollte — die Zahl kommt eine Sekunde später.
      { art: "drei", karten: ["cel30-rgb1", "cel30-rgb2", "cel30-rgb3"], zeilen: ["SO VIEL ZAHLEN", "KÄUFER GERADE", "FÜR RGB-MEW 🤯"], dauerMs: 1500 },
      { art: "karte", karte: "cel30-rgb1", farbe: "rot", zahl: "8.229 €", sub: "für EINE Karte", stempel: "VERKAUFT", dauerMs: 1600 },
      // Der Beweis: die eBay-Zeile samt Foto der Auktion, groß.
      { art: "screenshot", datei: "zeile-en-rot-us.png", farbe: "rot", unten: "ECHT.", dauerMs: 2000 },
      { art: "screenshot", datei: "zeile-en-gruen-gb.png", farbe: "gruen", zahl: "2.968 €", sub: "Grün · England", dauerMs: 1400 },
      { art: "screenshot", datei: "zeile-jp-blau.png", farbe: "blau", zahl: "5.180 €", sub: "Blau · Japan", dauerMs: 1400 },
      { art: "screenshot", datei: "zeile-jp-rot.png", farbe: "rot", zahl: "6.384 €", sub: "Rot · Japan", dauerMs: 1400 },
      // Keine Stückzahl im Bild: „6 in 24 Stunden" ist morgen falsch. Die
      // Beobachtung dagegen hält: Rot ist in beiden Sprachen die teuerste.
      { art: "drei", karten: ["cel30-rgb1", "cel30-rgb2", "cel30-rgb3"], zahl: "ROT GEWINNT.", sub: "in beiden Sprachen", dauerMs: 1800 },
      { art: "drei", karten: ["cel30-rgb1", "cel30-rgb2", "cel30-rgb3"], dauerMs: 3000 },
      { art: "frage", karte: "cel30-rgb1", farbe: "rot", zeilen: ["WAS HALTET IHR", "VON DEN PREISEN?"], dauerMs: 2600 },
    ],
    folgenAbClip: 7,
    caption: `Die hässlichste Pokémon-Karte aller Zeiten wird die teuerste?

Sechs RGB-Mew haben in den ersten 24 Stunden den Besitzer gewechselt — alles echte Verkäufe auf eBay. Englisch: Rot 8.229 €, Grün 3.577 € und 2.968 €. Japanisch: Rot 6.384 €, Blau 5.180 €, Grün 4.747 €.

Rot ist in beiden Sprachen die teuerste Farbe, Grün die günstigste. Deep-Fried-Look, drei Druckfarben — und trotzdem Preise wie für eine Vintage-Holo.

Was haltet ihr von den Preisen?

Stand 17.09., eBay, ohne Versand.`,
    captionKurz: `Die hässlichste Pokémon-Karte aller Zeiten wird die teuerste? Sechs RGB-Mew in 24 Stunden verkauft, 2.968 bis 8.229 €. Was haltet ihr von den Preisen?`,
    hashtags: ["#30thcelebration", "#rgbmew", "#pokemon30", "#chasecards", "#pokemonsammeln", "#binderplan"],
  },
  /**
   * „Von 899 auf 241 €. In einer Woche." Der Rückgriff auf das erfolgreichste
   * Reel: Am 14.09.2026 stand die Crystal-Lugia des 30th Celebration bei
   * 899 € (dokumentiert im Top-20-Reel), und wir sagten „wartet bis nach
   * Mittwoch". Tagespreis am 20.09.: 241 € (card_prices.eur), avg30 254 €.
   * Die 899 bleiben stehen — sie sind belegt; der zweite Wert wird beim
   * nächsten Bau gegen den Tagespreis geprüft.
   */
  "lugia-nachdruck": {
    titel: "Von 899 auf 241 €. In einer Woche.",
    setLogo: "cel30-setlogo.png",
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "karte", karte: "cel30-h7", farbe: "drei", zahl: "899 €", sub: "vor dem Release", stempel: "14.09.", dauerMs: 1600 },
      { art: "karte", karte: "cel30-h7", farbe: "drei", zahl: "241 €", sub: "heute", stempel: "−73 %", dauerMs: 1800 },
      { art: "karte", karte: "cel30-h7", farbe: "drei", zahl: "−658 €", sub: "in einer Woche", dauerMs: 1200 },
      { art: "karte", karte: "cel30-h7", farbe: "drei", zahl: "WARTEN LOHNT.", sub: "bei jedem neuen Set", dauerMs: 1800 },
      // Die Pille — ohne Text, wie das Playbook es verlangt.
      { art: "karte", karte: "cel30-h7", farbe: "drei", dauerMs: 3000 },
      { art: "frage", karte: "cel30-h7", farbe: "drei", zeilen: ["WER HAT FÜR 899", "GEKAUFT?"], dauerMs: 2400 },
    ],
    folgenAbClip: 4,
    caption: `Von 899 auf 241 €. In einer Woche.

Vor dem Release stand die Crystal-Lugia aus dem 30-Jahre-Set bei 899 € — ganz oben in der Liste, teurer als jede neue Karte des Sets. Ich hatte geschrieben: wartet bis nach Mittwoch. Heute kostet sie 241 €.

Das ist kein Sonderfall, das ist jeder Release. Die ersten Preise sind Ab-Preise von drei Anbietern, keine Verkäufe. Wer in der Woche vor Erscheinen kauft, zahlt für Ungeduld.

Cardmarket, Stand 20.09.

Schick das dem, der am Dienstag bestellt hat.`,
    captionKurz: `Crystal-Lugia, 30-Jahre-Set: 899 € vor dem Release, 241 € heute. Ich hatte gesagt: wartet bis nach Mittwoch. Wer hat für 899 gekauft?`,
    hashtags: ["#30thcelebration", "#lugia", "#pokemon30", "#cardmarket", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * Reserve: „297 €. Für ein Karpador." Die Illustration Rare aus Entwicklungen
   * in Paldea (sv02-203, avg30 297 €, 20.09.2026) gegen das Karpador aus dem
   * Grundset (base1-35, 3 €). Der Plan nannte 1 € für das Basis-Karpador — der
   * Katalog sagt 3 €, und die Zahl im Bild muss stimmen.
   */
  karpador: {
    titel: "297 €. Für ein Karpador.",
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "karte", karte: "sv02-203", farbe: "rot", zahl: "297 €", sub: "für ein Karpador", dauerMs: 1600 },
      { art: "karte", karte: "base1-35", farbe: "rot", zahl: "3 €", sub: "als Grundset-Karte", dauerMs: 1800 },
      { art: "karte", karte: "sv02-203", farbe: "rot", zahl: "×99", sub: "für die Illustration", dauerMs: 1800 },
      { art: "karte", karte: "sv02-203", farbe: "rot", dauerMs: 3000 },
      { art: "frage", karte: "sv02-203", farbe: "rot", zeilen: ["WIE VIEL WÄRE ES", "DIR WERT?"], dauerMs: 2400 },
    ],
    folgenAbClip: 3,
    caption: `297 €. Für ein Karpador.

Die Illustration Rare aus Entwicklungen in Paldea ist das teuerste Karpador, das es je gab — teurer als das Schimmernde von 2001. Das Karpador aus dem Grundset kostet 3 €.

Kein Shiny, keine Auflage von 1999, kein Stempel. Nur eine Illustration, die zehntausend Leute genau so wollen. Das ist der ganze Markt in einer Karte.

Cardmarket, 30-Tage-Schnitt, Stand 20.09.

Wie viel wäre es dir wert?`,
    captionKurz: `297 € für ein Karpador — die Illustration Rare aus Entwicklungen in Paldea, teurer als das Schimmernde von 2001. Wie viel wäre es dir wert?`,
    hashtags: ["#karpador", "#magikarp", "#illustrationrare", "#pokemonsammeln", "#cardmarket", "#binderplan"],
  },

  /**
   * „Eine Woche 30 Jahre. Keine einzige Karte ist gestiegen." — die
   * Preisentwicklung des laufenden Sets, am 21.09.2026 gemessen.
   *
   * Zahlen aus `price_history` des Produkts (Tagespreise, nicht der
   * 30-Tage-Schnitt — der hinkt bei einem frischen Set eine Woche hinterher):
   * Lugia H7 263 € (18.09.) → 190 € (21.09.), Glurak H2 207 € → 156 €.
   * Über alle 92 bepreisten Karten liegt der Tagespreis 28,6 % unter dem
   * Schnitt, und **keine** Karte über 20 € steht darüber. Genau das ist die
   * Aussage; einzelne Ausreißer gäbe es sonst immer.
   */
  "cel30-woche": {
    titel: "Eine Woche 30 Jahre. Alles gefallen.",
    setLogo: "cel30-setlogo.png",
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "karte", karte: "cel30-h7", farbe: "drei", zahl: "−28 %", sub: "das ganze Set", stempel: "21.09.", dauerMs: 1800 },
      { art: "karte", karte: "cel30-h7", farbe: "blau", zahl: "263 → 190 €", sub: "Crystal-Lugia", dauerMs: 1600 },
      { art: "karte", karte: "cel30-h2", farbe: "rot", zahl: "207 → 156 €", sub: "Glurak", dauerMs: 1600 },
      { art: "karte", karte: "cel30-154", farbe: "gruen", zahl: "176 → 126 €", sub: "Gengar ex", dauerMs: 1600 },
      { art: "karte", karte: "cel30-h7", farbe: "drei", zahl: "KEINE STEIGT.", sub: "keine über 20 €", dauerMs: 1800 },
      { art: "karte", karte: "cel30-h7", farbe: "drei", dauerMs: 3000 },
      { art: "frage", karte: "cel30-h7", farbe: "drei", zeilen: ["WARTEST DU NOCH", "ODER KAUFST DU?"], dauerMs: 2400 },
    ],
    folgenAbClip: 5,
    caption: `Eine Woche 30 Jahre. Alles gefallen.

Das Set ist seit Mittwoch letzter Woche draußen, und die Tagespreise liegen inzwischen 28 % unter dem 30-Tage-Schnitt. Die Crystal-Lugia ist von 263 auf 190 € gefallen, das Glurak von 207 auf 156 €, Gengar ex von 176 auf 126 €.

Was mir auffällt: Es ist keine Ausnahme, sondern die Regel. Von den 92 bepreisten Karten steht nicht eine über 20 € höher als ihr Schnitt. So sieht die zweite Woche nach jedem Release aus — die ersten Preise sind Ab-Preise, keine Verkäufe.

Cardmarket, Tagespreise, Stand 21.09.

Wartest du noch oder kaufst du?`,
    captionKurz: `30-Jahre-Set nach einer Woche: Lugia 263 → 190 €, Glurak 207 → 156 €. Keine Karte über 20 € steht über ihrem Schnitt. Wartest du noch?`,
    hashtags: ["#30thcelebration", "#pokemon30", "#cardmarket", "#pokemonpreise", "#pokemonsammeln", "#binderplan"],
  },

};

// --- Bühne -------------------------------------------------------------------

const name = arg("--drehbuch") ?? "verkauft";
const plattform = (arg("--plattform") ?? "instagram") as Plattform;
if (!SITZE[plattform]) throw new Error(`Keine Plattform „${plattform}"`);
const buch = DREHBUECHER[name];
if (!buch) throw new Error(`Kein Drehbuch „${name}". Bekannt: ${Object.keys(DREHBUECHER).join(", ")}`);
/** Der Stückname in der Datenbank — getrennt vom gleichnamigen Binder-Drehbuch. */
const stueckName = `${name}-hook`;

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const kit = loadBrandKit(db, PROJEKT);
const gelb = kit.accent2 ?? "#F5C518";

const assets = path.join(env.MP_DATA_DIR, "assets", PROJEKT);
const urlVon = new Map<string, string>();
const bildUrl = (rel: string) => {
  if (!urlVon.has(rel)) {
    const datei = path.join(assets, rel);
    if (!fs.existsSync(datei)) throw new Error(`Bild fehlt: ${datei}`);
    urlVon.set(rel, dataUrlFor(datei) ?? "");
  }
  return urlVon.get(rel)!;
};
const kartenUrl = (id: string) => bildUrl(`karten/${id}.jpg`);

/**
 * Bungee braucht rund 0,663 em je Zeichen (im Abspann gemessen); eine Zeile
 * soll 1.000 px nicht überschreiten. Mit 0,6 stand „KAUFEN?" am 17.09.2026
 * rechts über dem Rand. Jetzt: „8.229 €" (7 Zeichen) 215 px, „FINGER WEG?"
 * 137 px. Der Deckel liegt bei 250 — darüber wirkt ein kurzes Wort nur fett.
 */
const zahlGroesse = (text: string, deckel = 250) => Math.min(deckel, Math.floor(1000 / (Math.max(text.length, 3) * 0.663)));

const KARTE_B = 900;
const kopf = `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent}
  .grund{position:absolute;inset:0}
  .vignette{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 45%,rgba(0,0,0,.55) 100%)}
  .logo{position:absolute;left:40px;top:44px;width:300px;filter:drop-shadow(0 6px 16px rgba(0,0,0,.7))}
  .karte{position:absolute;left:50%;top:50%;border-radius:30px;
         box-shadow:0 60px 120px rgba(0,0,0,.7),0 0 0 3px rgba(255,255,255,.22)}
  /* Der Lichtstreifen: ein schräges Band, wie das Blitzen einer Holo-Karte. */
  .glanz{position:absolute;left:50%;top:50%;border-radius:30px;
         background:linear-gradient(115deg,transparent 36%,rgba(255,255,255,.26) 47%,transparent 58%)}
  .zahl{position:absolute;left:0;right:0;text-align:center;font-family:Bungee,system-ui;line-height:1;color:${gelb};
        -webkit-text-stroke:6px #000;paint-order:stroke fill;
        text-shadow:0 12px 0 #000,0 30px 60px rgba(0,0,0,.8);white-space:nowrap}
  .sub{position:absolute;left:0;right:0;text-align:center;font-family:Archivo,system-ui;font-weight:900;font-size:78px;
       color:#fff;text-shadow:0 4px 0 #000,0 10px 30px rgba(0,0,0,.8);white-space:nowrap}
  /* Weiss, nicht rot: Der rote Stempel stand auf der roten Karte und war kaum
     zu sehen (17.09.2026). Jetzt weiss auf halbdunklem Grund mit harter Kante. */
  .stempel{position:absolute;left:70px;top:280px;font-family:Bungee,system-ui;font-size:130px;color:#fff;
           border:16px solid #fff;border-radius:20px;padding:6px 34px;transform:rotate(-14deg);
           background:rgba(0,0,0,.42);text-shadow:0 5px 0 #000,0 0 30px rgba(0,0,0,.9);
           box-shadow:0 14px 40px rgba(0,0,0,.7),inset 0 0 0 4px rgba(0,0,0,.6);white-space:nowrap}
  .shot{position:absolute;left:40px;top:600px;width:1000px;background:#fff;padding:12px;border-radius:24px;
        transform:rotate(-2deg);box-shadow:0 40px 90px rgba(0,0,0,.75)}
  .shot img{display:block;width:100%;height:auto;border-radius:14px}
  .zettel{position:absolute;left:60px;right:60px;top:1130px;background:#fff;border-radius:28px;padding:40px 50px;
          transform:rotate(-2deg);box-shadow:0 40px 80px rgba(0,0,0,.7);font-family:Archivo,system-ui}
  .zettel .d{color:#1f8f3a;font-weight:800;font-size:54px} .zettel .t{color:#111;font-weight:800;font-size:56px;margin-top:8px}
  .zettel .p{color:#1f8f3a;font-weight:900;font-size:150px;line-height:1.05;margin-top:10px;letter-spacing:-.02em}
  .pop{position:absolute;inset:0;transform-origin:50% 62%}
</style></head><body>`;

function karteHtml(id: string, breite: number, hoch: number, neigung: number): string {
  const h = Math.round((breite * 88) / 63);
  const lage = `width:${breite}px;height:${h}px;transform:translate(-50%,${hoch}%) rotate(${neigung}deg)`;
  return `<img class="karte" src="${kartenUrl(id)}" style="${lage}"><div class="glanz" style="${lage}"></div>`;
}

/** Der Grund samt Karte(n) — wird in doppelter Größe gerendert, damit der Zoom weich bleibt. */
function grundHtml(c: Clip): string {
  const farbe = c.art === "drei" ? "drei" : c.farbe;
  const shot = c.art === "screenshot" ? `<div class="shot"><img src="${bildUrl(`belege/${c.datei}`)}"></div>` : "";
  const g = GRUND[farbe];
  const grund = farbe === "drei"
    ? `radial-gradient(circle at 18% 44%,${GRUND.rot.mitte}cc 0%,transparent 46%),radial-gradient(circle at 50% 38%,${GRUND.gruen.mitte}cc 0%,transparent 44%),`
      + `radial-gradient(circle at 82% 44%,${GRUND.blau.mitte}cc 0%,transparent 46%),radial-gradient(circle at 50% 50%,#15192480 0%,#05060A 78%)`
    : `radial-gradient(circle at 50% 42%,${g.mitte} 0%,${g.dunkel} 55%,#07060a 100%)`;
  let karten = "";
  if (c.art === "karte" || c.art === "frage") karten = karteHtml(c.karte, KARTE_B, -52, -4);
  if (c.art === "beweis") karten = karteHtml(c.karte, 720, -66, -4);
  if (c.art === "drei") {
    // Groß und überlappend: bei 360 px und Luft dazwischen blieb das obere
    // Drittel leer und die Karten wirkten wie Briefmarken.
    const B = 440, HK = Math.round((B * 88) / 63), Y = 470, L = -70, x0 = Math.round((W - 3 * B - 2 * L) / 2);
    karten = c.karten.map((id, i) => {
      const lage = `left:${x0 + i * (B + L)}px;top:${Y + (i === 1 ? -50 : 0)}px;width:${B}px;height:${HK}px;transform:rotate(${[-8, 0, 8][i]}deg);z-index:${i === 1 ? 3 : 2}`;
      return `<img class="karte" src="${kartenUrl(id)}" style="${lage}"><div class="glanz" style="${lage}"></div>`;
    }).join("");
  }
  const logo = buch.setLogo ? `<img class="logo" src="${bildUrl(`marke/${buch.setLogo}`)}">` : "";
  const zettel = c.art === "beweis"
    ? `<div class="zettel"><div class="d">${c.beleg.datum}</div><div class="t">${c.beleg.titel}</div><div class="p">${c.beleg.preis}</div></div>` : "";
  return `${kopf}<div class="grund" style="background:${grund}"></div>${karten}<div class="vignette"></div>${zettel}${shot}${logo}</body></html>`;
}

/**
 * Die Textebene — durchsichtig, in vier Größen für den Pop: 1,35 → 1,12 → 0,96 → 1.
 * Vier Bilder à 40 ms; das letzte bleibt stehen.
 */
const POP = [1.35, 1.12, 0.96, 1];
function textHtml(c: Clip, skala: number): string | null {
  let inhalt = "";
  if ((c.art === "karte" || c.art === "drei" || c.art === "beweis") && c.zahl) {
    const oben = c.art === "beweis" ? 1620 : c.art === "drei" ? 1240 : 1180;
    inhalt += `<div class="zahl" style="top:${oben}px;font-size:${zahlGroesse(c.zahl)}px;transform:rotate(-3deg)">${c.zahl}</div>`;
    if (c.art !== "beweis" && c.sub) inhalt += `<div class="sub" style="top:${oben + zahlGroesse(c.zahl) + 30}px">${c.sub}</div>`;
  }
  if (c.art === "karte" && c.stempel) inhalt += `<div class="stempel">${c.stempel}</div>`;
  if (c.art === "screenshot") {
    if (c.zahl) {
      inhalt += `<div class="zahl" style="top:300px;font-size:${zahlGroesse(c.zahl)}px;transform:rotate(-3deg)">${c.zahl}</div>`;
      if (c.sub) inhalt += `<div class="sub" style="top:${300 + zahlGroesse(c.zahl) + 24}px">${c.sub}</div>`;
    }
    if (c.unten) inhalt += `<div class="zahl" style="top:1240px;font-size:${zahlGroesse(c.unten)}px;transform:rotate(-3deg)">${c.unten}</div>`;
  }
  if (c.art === "drei" && c.zeilen) {
    // Drei Zeilen übereinander, gelb-weiß-gelb, jede so groß, wie sie in die Breite passt.
    let y = 1150;
    c.zeilen.forEach((z, k) => {
      const g = Math.min(zahlGroesse(z), 170);
      inhalt += `<div class="zahl" style="top:${y}px;font-size:${g}px;color:${k === 1 ? "#fff" : gelb};transform:rotate(-3deg)">${z}</div>`;
      y += g + 26;
    });
  }
  if (c.art === "frage") {
    const [a, b] = c.zeilen;
    inhalt += `<div class="zahl" style="top:1080px;font-size:${zahlGroesse(a)}px;transform:rotate(-3deg)">${a}</div>`
      + `<div class="zahl" style="top:1360px;font-size:${zahlGroesse(b)}px;color:#fff;transform:rotate(-3deg)">${b}</div>`;
  }
  if (!inhalt) return null;
  return `${kopf}<div class="pop" style="transform:scale(${skala})">${inhalt}</div></body></html>`;
}

// --- Rendern -----------------------------------------------------------------

const pieceId = newId();
const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
const arbeit = path.join(outDir, "arbeit");
fs.mkdirSync(arbeit, { recursive: true });

const jobs: RenderJob[] = [];
const grundDateien: string[] = [];
const textDateien: (string[] | null)[] = [];
buch.clips.forEach((c, i) => {
  const g = path.join(arbeit, `grund-${i}.png`);
  grundDateien.push(g);
  // Doppelte Größe: der Zoom rechnet dann mit halben Pixeln und ruckelt nicht.
  // Der Faktor liegt **nur auf body** — in der Regel `html,body{…}` stünde er
  // auf beiden Elementen, und das Bild wäre vierfach statt doppelt (so am
  // 17.09.2026 passiert: alles doppelt so groß, der Zettel außerhalb).
  jobs.push({ html: grundHtml(c).replace("</style>", "body{transform:scale(2);transform-origin:0 0}</style>"),
    width: W * 2, height: H * 2, file: g });
  const frames: string[] = [];
  POP.forEach((s, k) => {
    const html = textHtml(c, s);
    if (!html) return;
    const f = path.join(arbeit, `text-${i}-${k}.png`);
    jobs.push({ html, width: W, height: H, transparent: true, file: f });
    frames.push(f);
  });
  textDateien.push(frames.length ? frames : null);
});

const folgenClip = buch.folgenAbClip === null ? null : Math.min(buch.folgenAbClip ?? buch.clips.length - 2, buch.clips.length - 1);
const ohneFolgen = hatFlagge("--ohne-folgen");
const folgen = path.join(arbeit, "folgen.png");
if (folgenClip !== null && !ohneFolgen) jobs.push({ html: folgenHtml(gelb, plattform), width: W, height: H, transparent: true, file: folgen });
if (folgenClip !== null) {
  const c = buch.clips[folgenClip]!;
  const traegtText = c.art === "frage" || (c.art === "drei" && (c.zahl || c.zeilen)) || (c.art === "screenshot" && (c.zahl || c.unten))
    || ((c.art === "karte" || c.art === "beweis") && (c.zahl || (c.art === "karte" && c.stempel)));
  if (traegtText) {
    console.warn(`  ! Clip ${folgenClip} trägt die Pille und Text — der Text steht dann nur 90 ms.`);
  }
}

const gesamtMs = buch.clips.reduce((n, c) => n + c.dauerMs, 0) + ABSPANN_MS;
console.log(`${buch.titel}: ${buch.clips.length} Clips, ${(gesamtMs / 1000).toFixed(1)} s inkl. Abspann`);
await playwrightRenderer(jobs);

// --- Clips: Zoom auf den Grund -----------------------------------------------
//
// Ein Standbild ist tot. Jede Einstellung zoomt deshalb um 6 % heran — auf dem
// doppelt großen Render, damit die Bewegung in halben Pixeln läuft und nicht
// springt (dieselbe Grenze wie beim Abspann-Logo: was unter einem Pixel je Bild
// liegt, rundet der Renderer weg).
//
// Nicht mit `zoompan`: Der erste Lauf am 17.09.2026 zeigte damit alles doppelt
// so groß — zoompan nahm die 2160-px-Quelle als Ausschnitt statt als Ganzes,
// der Zettel lag außerhalb des Bildes. Jetzt skaliert `scale` je Bild
// (`eval=frame`) von 1080 auf 1145 px und `crop` nimmt die Mitte. Das ist
// dasselbe Ergebnis, nur ohne Überraschung.
const clipDateien: string[] = [];
for (const [i, c] of buch.clips.entries()) {
  const datei = path.join(arbeit, `clip-${i}.mp4`);
  const d = s3(c.dauerMs);
  const bilder = Math.max(1, Math.round((c.dauerMs / 1000) * OUTPUT_FPS));
  // Bildnummer statt Zeit: bei einem Standbild als Eingang ist `t` nicht verlässlich.
  const faktor = `(1+0.06*n/${bilder})`;
  await runFfmpeg([
    "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", d, "-i", grundDateien[i]!,
    "-vf", `scale=w='${W}*${faktor}':h='${H}*${faktor}':eval=frame:flags=lanczos,crop=${W}:${H},setsar=1`,
    "-t", s3(c.dauerMs), "-r", String(OUTPUT_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", datei]);
  clipDateien.push(datei);
}
clipDateien.push(await abspannClip(env.MP_DATA_DIR));

// --- Montage ---------------------------------------------------------------------

const einblendungen: { datei: string; startMs: number; endMs: number }[] = [];
const folgenZeit = folgenClip !== null ? (() => {
  const start = buch.clips.slice(0, folgenClip).reduce((n, c) => n + c.dauerMs, 0) + 400;
  const grenze = start + buch.clips[folgenClip]!.dauerMs - 600;
  return { startMs: start, endMs: Math.min(start + FOLGEN_MS, grenze) };
})() : null;

let lauf = 0;
const POP_MS = 40;
buch.clips.forEach((c, i) => {
  const frames = textDateien[i];
  if (frames) {
    // Der Pop: drei kurze Größen, dann die vierte bis zum Schnitt.
    const start = lauf + 80;
    frames.forEach((f, k) => {
      const von = start + k * POP_MS;
      const bis = k === frames.length - 1 ? lauf + c.dauerMs : von + POP_MS;
      einblendungen.push({ datei: f, startMs: von, endMs: bis });
    });
  }
  lauf += c.dauerMs;
});
if (folgenZeit && !ohneFolgen) einblendungen.push({ datei: folgen, ...folgenZeit });

const musik = hatFlagge("--ohne-musik") ? null : path.join(ROOT, "assets", "music", arg("--musik") ?? buch.musik);
if (musik && !fs.existsSync(musik)) throw new Error(`Musik fehlt: ${musik}`);

const eingang: string[] = [];
let n = 0;
const add = (...a: string[]) => { eingang.push(...a); return n++; };
const clipIdx = clipDateien.map((d) => add("-i", d));
const texte = einblendungen.map((e) => ({ ...e, idx: add("-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(e.endMs - e.startMs), "-itsoffset", s3(e.startMs), "-i", e.datei) }));
const MUSIK = musik ? add("-i", musik) : -1;

const f: string[] = [`${clipIdx.map((i) => `[${i}:v]`).join("")}concat=n=${clipIdx.length}:v=1:a=0[bild]`];
let letzte = "[bild]";
texte.forEach((e, k) => {
  f.push(`[${e.idx}:v]format=rgba,setsar=1[o${k}]`);
  f.push(`${letzte}[o${k}]overlay=0:0:eof_action=pass:enable='between(t,${s3(e.startMs)},${s3(e.endMs)})'[t${k}]`);
  letzte = `[t${k}]`;
});
// Kein Einblenden am Anfang: Die erste Sekunde muss knallen, nicht aufwachen.
f.push(`${letzte}fade=t=out:st=${s3(gesamtMs - 500)}:d=0.5,format=yuv420p[vout]`);
if (MUSIK >= 0) {
  f.push(`[${MUSIK}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${s3(gesamtMs)},` +
    `afade=t=in:st=0:d=0.3,afade=t=out:st=${s3(Math.max(0, gesamtMs - 2200))}:d=2.2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
} else f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(gesamtMs)}[aout]`);

const reel = path.join(outDir, "reel.mp4");
await runFfmpeg([...eingang, "-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]", "-r", String(OUTPUT_FPS), "-t", s3(gesamtMs),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
  "-metadata", `title=${buch.titel}`, reel]);

// --- Als Stück eintragen (gleiches Muster wie reel-binder.ts) ---------------------

const captionFuer = (p: Plattform) => p === "instagram" ? buch.caption : buch.captionKurz ?? buch.caption.split("\n\n").slice(0, 2).join("\n\n");
const tagsFuer = (p: Plattform) => p === "instagram" ? buch.hashtags : buch.hashtags.slice(0, 3);
const ts = nowIso();
const ueberholt = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, PROJEKT)).all()
  .filter((r) => r.status === "review" && parseJson<Record<string, unknown>>(r.meta, {})["drehbuch"] === stueckName);
for (const alt of ueberholt) {
  db.update(t.mpContentPieces).set({ status: "rejected", rejectionReason: `Zwischenstand — überholt von einem neueren Lauf des Drehbuchs „${stueckName}".`, updatedAt: ts })
    .where(eq(t.mpContentPieces.id, alt.id)).run();
}
const assetId = newId();
db.insert(t.mpContentPieces).values({
  id: pieceId, projectId: PROJEKT, taskId: null, channel: KANAL[plattform], format: "artwork_reel",
  title: `${buch.titel} · ${plattform}`, body: `${captionFuer(plattform)}\n\n${tagsFuer(plattform).join(" ")}`,
  assets: toJson([assetId]), status: ohneFolgen ? "draft" : "review", humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}",
  meta: toJson({ platform: plattform, language: "de", size: `${W}x${H}`, linkRule: "bio", caption: captionFuer(plattform), hashtags: tagsFuer(plattform),
    artworks: [], captionLang: buch.caption, captionKurz: buch.captionKurz ?? null, hashtagsAlle: buch.hashtags,
    drehbuch: stueckName, layout: "hook", ohneStimme: true, dauerMs: gesamtMs, anheften: false, abspannMs: ABSPANN_MS, kiBild: false,
    folgenZeit, basis: ohneFolgen }),
  aiTellScore: null, aiTellNotes: "Hook-Reel ohne Stimme, Texte von Hand.", rejectionReason: "", createdAt: ts, updatedAt: ts,
}).run();
db.insert(t.mpAssets).values({ id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video", path: path.relative(env.MP_DATA_DIR, reel),
  meta: toJson({ aiGenerated: false, provenance: "reel-hook", drehbuch: stueckName, size: `${W}x${H}` }), createdAt: ts }).run();
const vorschau = path.join(outDir, "vorschau.jpg");
await runFfmpeg(["-ss", "0.6", "-i", reel, "-frames:v", "1", "-vf", "scale=540:-1", "-q:v", "4", "-y", vorschau]);
db.insert(t.mpAssets).values({ id: newId(), projectId: PROJEKT, contentPieceId: pieceId, kind: "image", path: path.relative(env.MP_DATA_DIR, vorschau),
  meta: toJson({ role: "thumbnail", provenance: "reel-standbild" }), createdAt: ts }).run();
console.log(`\nFertig: ${reel}\nStück ${pieceId} (${stueckName}) steht auf „${ohneFolgen ? "draft" : "review"}".`);
