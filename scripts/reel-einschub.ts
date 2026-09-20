/**
 * „Die Karten wandern ins Fach" — eine Binderseite, die sich vor der Kamera füllt.
 *
 * Statt neun Karten auf einmal zu zeigen, gleitet jede einzeln in ihre Hülle.
 * Gebaut ist das als CSS-Animation und **abgefilmt**, nicht als Bildfolge
 * gerendert: Für eine flüssige Bewegung bräuchte es sonst über hundert
 * Einzelrenders, hier genügt ein Durchlauf im Browser.
 *
 * Zur Einschubrichtung: Binderhüllen sind **seitlich** offen, nicht oben — aus
 * oben offenen Taschen fallen die Karten heraus, sobald der Binder senkrecht
 * steht. Die Taschen öffnen sich zur Seitenmitte hin: linke und mittlere
 * Spalte von rechts, rechte Spalte von links (`OEFFNUNG`). Die Karte
 * fährt also waagerecht ein und wird am Fachrand beschnitten
 * (`overflow: hidden`) — das liest das Auge als „eingesteckt"; eine Karte, die
 * über der Seite schwebt und dann verschwindet, sieht aus wie ein Schnitt.
 *
 * Einen sichtbaren Streifen an der Öffnungsseite gab es kurzzeitig: Er lag nach
 * dem Einschieben über der Karte und verdeckte ihren Rand. Das Abschneiden
 * während der Fahrt leistet das Fach ohnehin allein.
 *
 *   pnpm exec tsx scripts/reel-einschub.ts --drehbuch coolshit --plattform instagram
 *   pnpm exec tsx scripts/reel-einschub.ts --drehbuch coolshit --nur-html
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadEnv, ROOT } from "../src/server/env.js";
import { openDatabase, newId, nowIso, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { playwrightRenderer, dataUrlFor, type RenderJob } from "../src/server/agents/studio/render.js";
import { fontHead } from "../src/server/agents/studio/fonts.js";
import { seiteHtml as buehneHtml, textHtml as buehneText, kunstAusschnitt,
  OEFFNUNG, SEITE_B, SEITE_Y, MASSE as m, TEXT_OBEN, W, H, type Fach } from "../src/server/agents/video/binderbuehne.js";
import { runFfmpeg, OUTPUT_FPS } from "../src/server/agents/video/assemble.js";
import { abspannClip, ABSPANN_MS } from "../src/server/agents/video/abspann-binderplan.js";
import { folgenHtml, SITZE, folgenFenster, KANAL, type Plattform } from "../src/server/agents/video/folgen-pille.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const s3 = (ms: number) => (ms / 1000).toFixed(3);
const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const flagge = (n: string) => process.argv.includes(n);


/** Takt der Animation — Werte in Millisekunden. */
const TAKT = {
  /** Wie lange das leere Blatt am Anfang steht. */
  vorlauf: 1600,
  /** Abstand zwischen zwei Karten. */
  versatz: 480,
  /** Wie lange eine Karte zum Einfahren braucht. */
  einschub: 620,
  /**
   * Wie lange die volle Seite am Ende steht.
   *
   * Muss die Schlusszeile **und** die Folgen-Pille nacheinander fassen: Zeile
   * bis 2,4 s nach dem letzten Einschub, dann 2,6 s Pille, dann Ausklang.
   */
  nachlauf: 6200,
};

interface EinschubBuch {
  titel: string;
  /**
   * Die neun Fächer in Leserichtung. Ein leerer Eintrag heißt: hier liegt keine
   * Karte, sondern der passende Ausschnitt von `kunstseite`.
   */
  karten: string[];
  /**
   * Kunstseite als Bildquelle für die Fächer ohne Karte (Dateiname unter
   * `assets/<projekt>/kunstseite-<id>.png`). Ist sie gesetzt, läuft die
   * Animation in **zwei Wellen**: erst die echten Karten, dann die Bildteile.
   */
  kunstseite?: string;
  preise?: string[];
  /** Reihenfolge des Einschubs — leer heißt zufällig, aber einmal fest gewürfelt. */
  reihenfolge?: number[];
  /** `bisMs` begrenzt eine Zeile ausdrücklich — sonst läuft sie bis zur nächsten. */
  zeilen: { abMs: number; text: string; stil?: "hook" | "satz" | "schluss"; bisMs?: number }[];
  caption: string;
  captionKurz: string;
  hashtags: string[];
  musik: string;
}

const DREHBUECHER: Record<string, EinschubBuch> = {
  /**
   * Seite 14 aus „Cool Shit" — im Reel als Seite 1 gezeigt, weil eine „Seite 14"
   * im Bild niemandem etwas sagt.
   *
   * Die Reihenfolge ist einmal gewürfelt und dann festgeschrieben: Ein zweiter
   * Lauf soll dasselbe Reel ergeben, sonst lässt sich nichts vergleichen.
   */
  coolshit: {
    titel: "So sieht eine geplante Seite aus",
    karten: ["sv10.5b-099", "sv02-218", "sv06.5-073", "me02.5-243", "sv03-205", "sv04-199", "sv04-203", "sv10.5b-100", "sv10-201"],
    reihenfolge: [4, 0, 7, 2, 8, 5, 1, 6, 3],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus sieben Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus sieben verschiedenen Sets, und im Binder sieht man davon nichts — weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen. Eine Seite, die als Bild funktioniert, ist mehr wert als neun Karten in der richtigen Reihenfolge.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus sieben Sets — und im Binder sieht man davon nichts, weil die Farben zusammenpassen. Zusammengestellt von Binderplan.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },

  /**
   * Kunstseite „151 Charizard Evos" — der erste Lauf des Formats mit zwei Wellen.
   *
   * Drei echte Karten, sechs gemalte Teile. Bewusst **nicht** auf drei Karten
   * festgelegt: Kunstseiten im Produkt haben zwischen einer und sieben
   * Ankerkarten, und genau das sagt der Text auch. Wer das Format nachbaut,
   * trägt nur `karten` (leere Felder = gemalt) und `kunstseite` neu ein.
   */
  kunstseite151: {
    titel: "Kunstseite: 151 Glurak",
    karten: ["sv03.5-199", "", "", "", "sv03.5-169", "", "", "", "sv03.5-168"],
    kunstseite: "_JoY2MluG11O",
    reihenfolge: [4, 0, 8, 2, 5, 7, 1, 6, 3],
    zeilen: [
      { abMs: 0, text: "So hebst du deine\nbesten Karten hervor.", stil: "hook" },
      { abMs: 2600, text: "Eine Karte, zwei\noder fünf." },
      { abMs: 4600, text: "Den Rest der Seite\nmalt Binderplan dazu." },
      { abMs: 7200, text: "Herunterladen.\nAusdrucken. Einstecken." },
      { abMs: 9600, text: "Nur auf binderplan.", stil: "schluss", bisMs: 12400 },
    ],
    caption: `So hebst du deine besten Karten hervor.

Hier sind es drei — Glurak, Glutexo, Glumanda aus 151. Es können genauso gut eine, zwei oder fünf sein. Der Rest der Seite wird passend dazu gemalt: dieselben Farben, dasselbe Licht, und die Karten sitzen mittendrin statt in einer Reihe.

Erstelle deine eigene oder nimm die besten von anderen Sammlern. Herunterladen, ausdrucken, in den echten Binder.

binderplan.app

Welche Karte hätte bei dir eine eigene Seite verdient?`,
    captionKurz: `Drei echte Karten, der Rest der Seite dazu gemalt. Können auch eine oder fünf sein. Ausdrucken und in den echten Binder.

Welche Karte hätte bei dir eine eigene Seite verdient?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemon151", "#glurak", "#binderplan", "#pokemontcg"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },

  harmonie1: {
    titel: "Harmonie, Seite 1",
    karten: ["sv02-256", "sv10.5w-094", "sv10.5b-089", "sv10.5b-112", "me02.5-276", "sv01-247", "sv08-206", "sv02-257", "me04-087"],
    reihenfolge: [5, 4, 8, 7, 6, 2, 0, 3, 1],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 7 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 7 verschiedenen Sets — Maskagato-ex, Pikachu-ex und Koraidon-ex. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 1.020 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 7 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },
  harmonie2: {
    titel: "Harmonie, Seite 2",
    karten: ["sv10.5b-165", "sv10.5w-111", "swsh6-205", "me01-140", "sv10.5b-111", "me02-098", "sv10.5b-110", "sv08-199", "sv10.5b-144"],
    reihenfolge: [6, 2, 3, 4, 0, 1, 5, 7, 8],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 6 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 6 verschiedenen Sets — Kyurem-ex neben Plinfa und Seemops. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 232 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 6 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
  },
  harmonie3: {
    titel: "Harmonie, Seite 3",
    karten: ["me05-119", "xy10-124", "sv05-211", "sv02-212", "me01-183", "swsh7-180", "sv02-222", "me02.5-246", "sv06.5-079"],
    reihenfolge: [7, 6, 1, 8, 2, 0, 5, 4, 3],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 8 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 8 verschiedenen Sets — Psiana V, Despotar und vier Trainerkarten. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 386 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 8 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },
  harmonie4: {
    titel: "Harmonie, Seite 4",
    karten: ["sv07-169", "sv10-192", "sv10.5w-097", "sv04-193", "sv10.5w-096", "sm12-22", "bw8-131", "sv10-229", "sv04-186"],
    reihenfolge: [0, 4, 6, 5, 8, 2, 3, 1, 7],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 6 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 6 verschiedenen Sets — Glurak & Rutena GX neben Magby. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 324 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 6 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
  },
  harmonie5: {
    titel: "Harmonie, Seite 5",
    karten: ["me02.5-272", "sv02-196", "swsh10-161", "sv05-165", "sv05-166", "sv03.5-198", "sv01-245", "sv08-237", "sv10-185"],
    reihenfolge: [5, 6, 7, 1, 3, 8, 0, 4, 2],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 8 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 8 verschiedenen Sets — Mega-Meganie-ex, Bisaflor-ex und Milotic-ex. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 529 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 8 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },
  harmonie6: {
    titel: "Harmonie, Seite 6",
    karten: ["sm3-88", "sv04-240", "sm5-153", "me02.5-287", "me05-117", "xy1-79", "sma-SV84", "smp-SM63", "me05-115"],
    reihenfolge: [5, 4, 3, 1, 7, 8, 6, 0, 2],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 8 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 8 verschiedenen Sets — Darkrai GX, Yveltal EX und Guzma. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 230 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 8 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
  },
  harmonie7: {
    titel: "Harmonie, Seite 7",
    karten: ["smp-SM169", "sv04-207", "sv02-209", "sv02-210", "sv10.5b-094", "swsh12.5gg-GG04", "sv01-210", "sv02-208", "swsh6-179"],
    reihenfolge: [3, 2, 0, 7, 5, 4, 6, 1, 8],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 7 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 7 verschiedenen Sets — Evoli & Relaxo GX als Anker. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 477 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 7 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
  },
  harmonie8: {
    titel: "Harmonie, Seite 8",
    karten: ["sv08.5-156", "me02.5-288", "me02.5-280", "me02.5-282", "me02.5-290", "sv07-152", "me02.5-236", "swsh7-212", "me03-119"],
    reihenfolge: [4, 0, 1, 5, 6, 7, 2, 3, 8],
    zeilen: [
      { abMs: 0, text: "So sieht eine\ngeplante Seite aus.", stil: "hook" },
      { abMs: 2400, text: "Farben, die harmonieren.\nAus 5 Sets." },
      { abMs: 5200, text: "Zusammengestellt\nvon Binderplan." },
      { abMs: 7600, text: "Bau deine eigene.", stil: "schluss", bisMs: 10400 },
    ],
    caption: `So sieht eine geplante Seite aus.

Neun Karten aus 5 verschiedenen Sets — Feelinara-ex, Mega-Diancie-ex und Mega-Dragoran-ex. Im Binder sieht man von der Herkunft nichts, weil die Farben zusammenpassen. Genau danach sucht Binderplan: Du gibst eine Richtung vor, das Tool findet die Karten, die dazu passen.

Zusammen 1.269 €. Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen.

Bau deine eigene: binderplan.app

Welche Farbe würdest du zuerst nehmen?`,
    captionKurz: `Neun Karten aus 5 Sets — im Binder sieht man davon nichts, weil die Farben zusammenpassen.

Welche Farbe nimmst du?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
  }
};

const name = arg("--drehbuch") ?? "coolshit";
const buch = DREHBUECHER[name];
if (!buch) throw new Error(`Kein Drehbuch „${name}". Bekannt: ${Object.keys(DREHBUECHER).join(", ")}`);
const plattform = (arg("--plattform") ?? "instagram") as Plattform;
if (!SITZE[plattform]) throw new Error(`Keine Plattform „${plattform}"`);

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const kit = loadBrandKit(db, PROJEKT);
const akzent = kit.accent2 ?? kit.colors?.[1] ?? "#F5C518";

const pieceId = newId();
const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
const arbeit = path.join(outDir, "arbeit");
fs.mkdirSync(arbeit, { recursive: true });

// --- Die Animation als Seite -------------------------------------------------


const kartenUrl = (id: string) => {
  const datei = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten", `${id}.jpg`);
  if (!fs.existsSync(datei)) throw new Error(`Kartenscan fehlt: ${datei}`);
  return dataUrlFor(datei) ?? "";
};

/**
 * Der Ausschnitt der Kunstseite, der in Fach `i` gehört.
 *
 * Die gespeicherte Datei zeigt genau die Blattfläche (`artwork.py: kachel()`
 * rechnet mit denselben 63 × 88 mm und 4 mm Naht wie `blattMasse`). Deshalb
 * genügt es, das Bild in Blattgröße hinter das Fach zu legen und um die
 * Fachposition zu verschieben — ein Zuschnitt in einem Bildwerkzeug wäre
 * dieselbe Rechnung mit mehr Schritten.
 */
const kunstUrl = (() => {
  if (!buch.kunstseite) return null;
  const datei = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "kunst", `${buch.kunstseite}.png`);
  if (!fs.existsSync(datei)) throw new Error(`Kunstseite fehlt: ${datei}`);
  return dataUrlFor(datei) ?? "";
})();

/** Wann Fach `i` seine Karte bekommt — aus der festgelegten Reihenfolge. */
const reihenfolge = buch.reihenfolge ?? buch.karten.map((_, i) => i);
/**
 * Wann Fach `i` seine Karte bekommt.
 *
 * Bei einer Kunstseite laufen zwei Wellen: erst die echten Karten, dann — nach
 * einer Atempause, in der die Lücken zu sehen sind — die Bildteile. Genau diese
 * Pause ist der Moment, den das Stück erzählt.
 */
const kartenFaecher = buch.karten.map((id, i) => (id ? i : -1)).filter((i) => i >= 0);
const PAUSE = 1400;
const startFuer = (fach: number) => {
  if (!buch.kunstseite) return TAKT.vorlauf + reihenfolge.indexOf(fach) * TAKT.versatz;
  const istKarte = kartenFaecher.includes(fach);
  const welle = reihenfolge.filter((f) => kartenFaecher.includes(f) === istKarte);
  const platz = welle.indexOf(fach);
  const versatz = istKarte ? TAKT.versatz : TAKT.versatz * 0.72;   // Bildteile folgen dichter
  const beginn = istKarte
    ? TAKT.vorlauf
    : TAKT.vorlauf + kartenFaecher.length * TAKT.versatz + PAUSE;
  return beginn + platz * versatz;
};
const ohneFolgen = flagge("--ohne-folgen");

/**
 * Der Zeitplan, in dieser Reihenfolge — sonst passt das Ende nicht.
 *
 * Erst steht fest, wann die letzte Textzeile endet; danach kommt die
 * Folgen-Pille, und **daraus** ergibt sich die Gesamtlänge. Andersherum lief
 * die Pille am 15.09.2026 über das Ende der Animation hinaus und stand noch im
 * Abspann.
 */
/**
 * Die Pille läuft in der Lücke **vor** der Schlusszeile; die rückt dafür nach
 * hinten. So steht nach dem Hinweis noch Inhalt und nicht gleich der Abspann.
 */
const fenster = folgenFenster(buch.zeilen.map((z) => z.abMs));
const letzteZeileNeu = fenster.verschiebeIndex !== null ? buch.zeilen[fenster.verschiebeIndex] : null;
if (letzteZeileNeu) {
  const rueck = fenster.verschiebeAufMs - letzteZeileNeu.abMs;
  letzteZeileNeu.abMs = fenster.verschiebeAufMs;
  if (letzteZeileNeu.bisMs) letzteZeileNeu.bisMs += rueck;
}
const folgenStart = fenster.startMs;
const folgenEnde = fenster.endMs;
const letzteZeileEnde = (() => {
  const l = buch.zeilen[buch.zeilen.length - 1];
  if (!l) return TAKT.vorlauf;
  return (l.bisMs ?? l.abMs + 2600) - 120;
})();
const einschubEnde = Math.max(...Array.from({ length: 9 }, (_, i) => startFuer(i))) + TAKT.einschub;
/**
 * Nach der Pille bleibt eine knappe Sekunde, bevor der Abspann übernimmt.
 *
 * Die Länge rechnet **immer** mit der Pille, auch wenn dieser Lauf keine baut:
 * Aus der Basis entstehen später die App-Fassungen, und die legen die Pille an
 * genau diese Stelle. Eine kürzere Basis hieße, dass die Pille über das Ende
 * hinausragt und im Abspann weiterläuft.
 */
const animMs = Math.max(einschubEnde + TAKT.nachlauf, letzteZeileEnde + 800);

/** Die neun Fächer für die Bühne — Kartenscan oder Ausschnitt der Kunstseite. */
function seiteHtml(): string {
  const faecher: Fach[] = buch.karten.map((id, i) => ({
    bild: id ? `background-image:url('${kartenUrl(id)}')` : kunstAusschnitt(kunstUrl ?? "", i),
    abMs: startFuer(i),
    preis: buch.preise?.[i],
    kunst: !id,
  }));
  return buehneHtml(faecher, { einschubMs: TAKT.einschub, akzent });
}

const html = path.join(arbeit, "seite.html");
fs.writeFileSync(html, seiteHtml());
if (flagge("--nur-html")) { console.log(html); process.exit(0); }

// --- Einzelbilder ------------------------------------------------------------

/**
 * Die Animation Bild für Bild rendern statt sie abzufilmen.
 *
 * Playwright zeichnet als VP8-Video auf; bei 1080 × 1920 blieben davon rund
 * 1,6 Mbit/s übrig, und das sieht man an den Kartentexten. Hier steht für jedes
 * Einzelbild dieselbe Seite still — der Zustand wird über ein negatives
 * `animation-delay` angesprungen —, und der Screenshot ist verlustfrei. Eine
 * einzige Browser-Seite bleibt dabei offen, sonst kostet jeder Frame einen
 * kompletten Seitenaufbau.
 */
console.log(`${buch.titel}: ${kartenFaecher.length} Karten${buch.kunstseite ? ` + ${9 - kartenFaecher.length} Bildteile` : ""}, ${(animMs / 1000).toFixed(1)} s`);
const bilder = path.join(arbeit, "bilder");
fs.rmSync(bilder, { recursive: true, force: true });
fs.mkdirSync(bilder, { recursive: true });

const browser = await chromium.launch({ args: ["--hide-scrollbars", "--force-device-scale-factor=1"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`file://${html}`);
await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready).catch(() => undefined);
await page.waitForTimeout(500);

/**
 * Gerendert wird nur die **Bewegung**, nicht der Stillstand.
 *
 * Nach dem letzten Einschub ändert sich im Bild nichts mehr — die Texte liegen
 * als eigene Ebenen darüber. Von 351 Einzelbildern waren so 215 identisch.
 * ffmpeg hängt stattdessen das letzte Bild als Standbild an; aus knapp sechs
 * Minuten Renderzeit werden zwei.
 */
const bewegtBis = einschubEnde + 120;
const anzahl = Math.ceil((bewegtBis / 1000) * OUTPUT_FPS);
const starts = buch.karten.map((_, i) => startFuer(i));
for (let k = 0; k < anzahl; k++) {
  const tMs = (k / OUTPUT_FPS) * 1000;
  await page.evaluate(([zeit, st]) => {
    document.querySelectorAll<HTMLElement>(".karte").forEach((el, i) => {
      el.style.animationDelay = `${(st as number[])[i]! - (zeit as number)}ms`;
    });
  }, [tMs, starts] as [number, number[]]);
  await page.screenshot({ path: path.join(bilder, `f${String(k).padStart(4, "0")}.png`), type: "png" });
  if (k % 25 === 0) process.stdout.write(`  ${k}/${anzahl}\r`);
}
await browser.close();
const standbild = path.join(bilder, `f${String(anzahl - 1).padStart(4, "0")}.png`);
const standMs = Math.max(0, animMs - bewegtBis);
console.log(`  ${anzahl} Einzelbilder (Bewegung) + ${(standMs / 1000).toFixed(1)} s Standbild   `);

// --- Montage -----------------------------------------------------------------

const textHtml = (zeig: string) => buehneText(zeig, akzent);

const jobs: RenderJob[] = [];
const zeilen = buch.zeilen.map((z, i) => {
  const datei = path.join(arbeit, `text-${i}.png`);
  jobs.push({ html: textHtml(z.text), width: W, height: H, transparent: true, file: datei });
  // Die vorletzte Zeile endet, wenn die Pille kommt — beide sitzen an derselben
  // Stelle unter der Seite.
  const bis = i === fenster.kuerzeIndex ? fenster.kuerzeEndeMs + 120
    : z.bisMs ?? buch.zeilen[i + 1]?.abMs ?? animMs;
  return { datei, startMs: z.abMs, endMs: bis - 120 };
});
const folgen = path.join(arbeit, "folgen.png");
/** Die Pille sitzt dort, wo auch der Text steht: unter der Binderseite. */
const folgenVersatz = Math.max(0, Math.round(TEXT_OBEN - 1318));
if (!ohneFolgen) jobs.push({ html: folgenHtml(akzent, plattform, folgenVersatz), width: W, height: H, transparent: true, file: folgen });
await playwrightRenderer(jobs);

const einblendungen = zeilen.map((z) => ({ ...z }));
if (!ohneFolgen) einblendungen.push({ datei: folgen, startMs: folgenStart, endMs: folgenEnde });

const eingang: string[] = [];
let n = 0;
const add = (...a: string[]) => { eingang.push(...a); return n++; };
const vid = add("-framerate", String(OUTPUT_FPS), "-i", path.join(bilder, "f%04d.png"));
const stand = add("-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(standMs), "-i", standbild);
const ein = einblendungen.map((c) => ({ ...c, idx: add("-loop", "1", "-framerate", String(OUTPUT_FPS),
  "-t", s3(Math.max(200, c.endMs - c.startMs)), "-itsoffset", s3(c.startMs), "-i", c.datei) }));

const f: string[] = [
  `[${vid}:v]setsar=1[bewegt]`,
  `[${stand}:v]setsar=1[still]`,
  `[bewegt][still]concat=n=2:v=1:a=0[bild]`,
];
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
// Die Einzelbilder sind groß und jederzeit neu zu rechnen.
fs.rmSync(bilder, { recursive: true, force: true });

const thumb = path.join(outDir, "reel-thumb.jpg");
await runFfmpeg(["-ss", s3(animMs - TAKT.nachlauf + 500), "-i", reel, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", "-y", thumb]);

const caption = plattform === "instagram" ? buch.caption : buch.captionKurz;
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
    caption, captionLang: buch.caption, captionKurz: buch.captionKurz, hashtags, hashtagsAlle: buch.hashtags,
    drehbuch: `einschub-${name}`, art: "werbung", ohneStimme: true, dauerMs: gesamtMs, abspannMs: ABSPANN_MS,
    folgenZeit: { startMs: folgenStart, endMs: folgenEnde }, folgenVersatz, basis: ohneFolgen,
    // Nur Kunstseiten enthalten ein gemaltes Bild; eine reine Kartenseite nicht.
    kiBild: Boolean(buch.kunstseite) }),
  aiTellScore: null, aiTellNotes: "Animation aus echten Kartenscans, Texte von Hand.", rejectionReason: "",
  createdAt: ts, updatedAt: ts,
}).run();
db.insert(t.mpAssets).values({ id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video",
  path: path.relative(env.MP_DATA_DIR, reel),
  meta: toJson({ aiGenerated: false, provenance: "reel-einschub", drehbuch: name, plattform, size: `${W}x${H}` }), createdAt: ts }).run();
db.insert(t.mpAssets).values({ id: thumbId, projectId: PROJEKT, contentPieceId: pieceId, kind: "image",
  path: path.relative(env.MP_DATA_DIR, thumb),
  meta: toJson({ aiGenerated: false, provenance: "reel-einschub", role: "thumbnail", size: "540x960" }), createdAt: ts }).run();

console.log(`\nFertig: ${reel}`);
console.log(`Stück ${pieceId} steht auf „${ohneFolgen ? "draft" : "review"}".`);
