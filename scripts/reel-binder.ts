/**
 * Reels aus Binderplan-Kunstseiten — Bild, Text, Musik. **Ohne Stimme.**
 *
 * Der Vorläufer `reel-kunstseite-fahrt.ts` hängt seinen Takt an die Zeitmarken
 * von ElevenLabs. Seit dem 11.09.2026 laufen die Binderplan-Reels ohne
 * Sprecherin: 85 bis 92 % sehen Reels ohne Ton, und eine englische Stimme mit
 * deutschem Text schadet mehr, als sie trägt. Der Takt steht deshalb im
 * Drehbuch — jeder Clip bekommt seine Dauer nach Lesbarkeit, nicht nach
 * gesprochener Länge. Musik bleibt Pflicht: Reels über die Graph-API sind
 * stumm, wenn die Datei keinen Ton hat.
 *
 * Bilder kommen aus drei Bausteinen, alle aus derselben Kunstseite gerechnet:
 *
 * - `ganz`   — das Blatt am Stück, wie es aus dem Drucker kommt
 * - `binder` — dasselbe Blatt in neun Fächern mit den Hüllennähten dazwischen;
 *              `nur` lässt nur die Kartenfächer stehen, der Rest ist leer
 * - `drei`   — drei Blätter nebeneinander
 *
 * Dazu `fahrt`: ein 9:16-Fenster wandert über die Seite, von Fach zu Fach.
 *
 * Aufruf: `pnpm exec tsx scripts/reel-binder.ts --drehbuch starter [--ohne-musik]`
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
import { blattMasse } from "../src/server/agents/studio/blatt.js";
import { folgenHtml, SITZE, HANDLE, FOLGEN_MS, KANAL, type Plattform } from "../src/server/agents/video/folgen-pille.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const W = 1080, H = 1920;
const s3 = (ms: number) => (ms / 1000).toFixed(3);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const hatFlagge = (name: string) => process.argv.includes(name);

// --- Geometrie ---------------------------------------------------------------
//
// Eine 3×3-Seite ist bei Binderplan in Millimetern gerechnet: Karte 63 × 88,
// Hüllennaht 4 → 197 × 272 mm, im Bild 1472 × 2032 px. Ein Fach ist also
// **63 von 67 mm** breit, nicht ein Drittel der Seite. Wer stumpf drittelt,
// nimmt in jedes Fach eine halbe Naht mit; die Karte sitzt dann zu klein im
// Feld und ist um 1,2 % gestaucht (am 11.09. nachgemessen: 0,7244 statt 0,7159).

const QUELL_B = 1472, QUELL_H = 2032;
// Die Rechnung selbst steht in `studio/blatt.ts` — der Bildpost braucht dieselbe.


/** Das Fahrt-Fenster, 9:16 auf der Quelle — 720 × 1280 fasst ein ganzes Fach (491 × 677). */
const FENSTER_B = 720, FENSTER_H = 1280;
/**
 * Fensterposition, die ein Fach mittig zeigt. Die Ecken ergeben sich von
 * selbst: Fach 0 → (0,0), Fach 2 → (752,0), Fach 6 → (0,752), Fach 8 → (752,752).
 */
function fensterAufFach(fach: number): { x: number; y: number } {
  const { fachB, fuge, fachH } = blattMasse(QUELL_B);
  const mx = (fach % 3) * (fachB + fuge) + fachB / 2;
  const my = Math.floor(fach / 3) * (fachH + fuge) + fachH / 2;
  const grenze = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return { x: grenze(mx - FENSTER_B / 2, QUELL_B - FENSTER_B), y: grenze(my - FENSTER_H / 2, QUELL_H - FENSTER_H) };
}

// --- Drehbuch ----------------------------------------------------------------

type Stil = "hook" | "satz" | "schluss";
/** Ein Standbild: dasselbe Blatt, drei Betrachtungsweisen. */
type Bild =
  | { art: "ganz"; seite: string }
  | { art: "binder"; seite: string; nur?: number[] }
  | { art: "drei"; seiten: string[] }
  /**
   * Echte Kartenscans in einem Blatt — `sichtbar` fuellt von vorn auf.
   * Fuer eine Karte, die es noch nicht zu sehen gibt, steht `kartenrueckseite`
   * in `karten` — Rueckseiten sehen alle gleich aus, das liest jeder Sammler
   * sofort als „unbekannte Karte" — dann sagt `namen`, welche gemeint ist.
   * `preise` und `namen` sind gleich lang wie `karten`; `null` heisst
   * „kein Schild".
   */
  | { art: "karten"; karten: string[]; sichtbar: number; spalten?: number; zeilen?: number;
      preise?: (string | null)[]; namen?: (string | null)[];
      /** Nur für die Bildfolge einer Füllung: Startzeiten je Fach. */
      einschub?: { starts: number[]; dauerMs: number };
      /** Radius in px: das ganze Blatt samt Schildern unscharf — fuer den Teaser. */
      unscharf?: number;
      /** Dateiname unter assets/<projekt>/marke/ — liegt als Ebene ueber dem Blatt. */
      logo?: string }
  /**
   * Eine einzelne Karte auf farbigem Grund, ohne Binderseite — fuer Karten, von
   * denen es noch kein Bild gibt (RGB-Mew). `seite` sagt, welche Flaeche vorn
   * liegt: die echte Rueckseite oder die Platzhalter-Vorderseite.
   */
  | { art: "rgb"; farbe: RgbFarbe; seite: "rueck" | "vorn"; logo?: string; beleg?: string }
  /** Alle drei nebeneinander, leicht gefaechert — das Schlussbild. */
  | { art: "rgbdrei"; logo?: string }
  /**
   * Ein Beleg allein, gross auf Schwarz — der Blitz vor der Hook. Ein
   * Ausschnitt aus einem eBay-Screenshot (Datei unter assets/<projekt>/belege/),
   * nur die Textspalte: Datum, Titel, Preis, Herkunft. Keine Fremdfotos, keine
   * Namen.
   */
  | { art: "beleg"; datei: string };

type Clip =
  | { art: "fahrt"; seite: string; vonFach: number; bisFach: number; dauerMs: number; haltMs?: number; zeig?: string; stil?: Stil }
  | { art: "stand"; bild: Bild; dauerMs: number; zeig?: string; stil?: Stil }
  | { art: "wandel"; von: Bild; bis: Bild; haltMs: number; dauerMs: number; zeig?: string; stil?: Stil }
  /**
   * Eine Karte liegt mit der Rueckseite oben, wirbelt herum und bleibt auf der
   * Vorderseite stehen. `haltMs` steht die Rueckseite, `wirbelMs` dreht sie,
   * den Rest steht die Vorderseite.
   */
  | { art: "flip"; farbe: RgbFarbe; haltMs?: number; wirbelMs?: number;
      dauerMs: number; zeig?: string; stil?: Stil }
  /** Das Blatt fuellt sich Karte fuer Karte — ein Bild je Schritt. */
  | { art: "fuellung"; karten: string[]; bis: number; spalten?: number; zeilen?: number;
      preise?: (string | null)[]; namen?: (string | null)[];
      dauerMs: number; zeig?: string; stil?: Stil };

interface Drehbuch {
  titel: string;
  /** Kunstseiten-Ids in Binderplan, für die Herkunft im Stück. */
  artworks: string[];
  /**
   * Set-Logo, das über dem ganzen Stück steht (Dateiname unter `marke/`).
   *
   * Pflicht, sobald ein Beitrag über ein bestimmtes Set spricht — es beantwortet
   * die häufigste Kommentarfrage („aus welchem Set?") im Bild. Siehe Playbook,
   * Abschnitt 2. TCGdex liefert keine Set-Logos, die Datei kommt von Hand dazu.
   */
  setLogo?: string;
  clips: Clip[];
  caption: string;
  /**
   * Kurzfassung für TikTok, Threads und Shorts.
   *
   * Dort wird die Beschreibung nach rund 150 Zeichen abgeschnitten, und auf
   * Threads kostet ein langer Text Reichweite. Fehlt sie, nimmt der Bau die
   * ersten beiden Absätze der langen Fassung — besser ist eine eigene.
   */
  captionKurz?: string;
  hashtags: string[];
  /** Fester Track statt Zufall, damit ein zweiter Lauf dasselbe Reel ergibt. */
  musik: string;
  /**
   * Ab welchem Clip der Folgen-Hinweis oben im Bild steht. Standard ist der
   * **vorletzte** Clip; `null` schaltet ihn ab.
   *
   * Warum nicht im Abspann: Der Abspann ist der einzige Moment, in dem
   * `binderplan.app` im Bild steht, und zwei Aufforderungen in drei Sekunden
   * heben sich gegenseitig auf. Wer bis zum Abspann bleibt, ist ohnehin
   * angekommen — der Hinweis gehört an die Stelle, an der das Reel gerade
   * geliefert hat und noch alle zusehen.
   */
  folgenAbClip?: number | null;
}

const BLENDE_MS = 900;

/**
 * Die Jubiläumsreihe des 30th Celebration: dreißig Pikachu, Setnummer 023 bis
 * 052, auf der Karte selbst „01/30" bis „30/30". Die Scans liegen unter
 * `assets/<projekt>/karten/` (aus dem Bildcache des Produkts, auf 340 px
 * verkleinert — ein Fach ist im Reel höchstens 288 px breit).
 */
const PIKACHU = Array.from({ length: 30 }, (_, i) => `cel30-${String(23 + i).padStart(3, "0")}`);

// --- RGB-Mew: drei Karten, die noch niemand gesehen hat -----------------------
//
// Im 30th Celebration stecken drei Mew in Rot, Grün und Blau — die Farben der
// Spiele von 1996. Sie standen in keiner Ankündigung und in keinem ETB-Guide,
// und es gibt **keinen Scan**: weder bei TCGdex noch bei Serebii, und im
// Produkt tragen `cel30-RGB1..RGB3` seit dem 16.09.2026 einen Eintrag ohne Bild.
//
// Genau das trägt das Reel. Die Karte liegt mit der Rückseite oben, wirbelt
// herum — und was zum Vorschein kommt, ist eine Silhouette auf farbigem Grund,
// sichtbar als Platzhalter („noch kein Bild"), nicht als Karte.
//
// **Ein erfundenes Kartenbild wäre hier der einzige echte Fehler.** Wer eine
// gemalte Vorderseite zeigt, behauptet „so sieht sie aus"; die Nische prüft das
// in Minuten gegen die Kataloge, und der Fachlichkeits-Test im Playbook ist
// genau dafür da. Die Silhouette sagt dieselbe Sache ehrlich — und ist als
// Bildsprache in der Nische ohnehin besetzt: so sieht „noch nicht enthüllt" aus.
type RgbFarbe = "rot" | "gruen" | "blau";
/**
 * Die Scans liegen unter `assets/<projekt>/karten/` und kommen aus derselben
 * Quelle wie das ganze Vorab-Set: Serebii. Im Produkt stehen sie in
 * cards.image_alt — nicht in image_de/image_en, die sind fuer cel30 leer, weil
 * TCGdex das Set noch nicht fuehrt. Wer dort nachsieht, haelt die Karten
 * faelschlich fuer bildlos (am 16.09.2026 genau so passiert).
 *
 * `nr` ist das Seltenheitskuerzel von der Karte selbst; `hell` und `dunkel`
 * faerben ausserdem den Rauch hinter ihr.
 */
const RGB: Record<RgbFarbe, { hell: string; mitte: string; dunkel: string; wort: string; nr: string;
                              karte: string }> = {
  rot:   { hell: "#FF6A5A", mitte: "#C41E23", dunkel: "#2E050A", wort: "Rot",  nr: "R/RGB", karte: "cel30-rgb1" },
  gruen: { hell: "#5BE08E", mitte: "#128A4C", dunkel: "#042C18", wort: "Grün", nr: "G/RGB", karte: "cel30-rgb2" },
  blau:  { hell: "#6FA4FF", mitte: "#2450C4", dunkel: "#07153E", wort: "Blau", nr: "B/RGB", karte: "cel30-rgb3" },
};

/** Kartenmaß 63 × 88 mm, wie überall im Stück — hier als Einzelkarte. */
const KARTE_B = 640, KARTE_H = Math.round((KARTE_B * 88) / 63);
/**
 * 410 statt der ersten 370: Beim Wirbeln kippt und wächst die Karte, und ihre
 * obere Ecke lief dabei durch das Set-Logo. Mit 410 px bleibt bei 10° Neigung
 * und 10 % Zuwachs ein Rest Abstand — und das Logo liegt zusätzlich darüber.
 */
const KARTE_X = Math.round((W - KARTE_B) / 2), KARTE_Y = 410;

/**
 * Der Wirbel: anderthalb Umdrehungen, die auf der Vorderseite einrasten.
 *
 * Start ist 180° (Rückseite vorn), der Weg **540°** — Ziel also 720°, ein
 * Vielfaches von 360 und damit die Vorderseite.
 *
 * **Der Weg muss ein ungerades Vielfaches von 180° sein.** Am 16.09.2026 stand
 * hier 720°: Die Drehung endete rechnerisch wieder auf der Rückseite, und das
 * Standbild danach zeigte die Vorderseite — im Video sah das aus wie ein
 * Schnitt, nach dem die Karte plötzlich richtig herum liegt. Wer die Zahl
 * ändert, prüft (180 + Weg) mod 360 === 0.
 *
 * **Wie viel Drehung je Bild geht, ist eine gemessene Grenze.** Wir rendern
 * ohne Bewegungsunschärfe: Was sich zwischen zwei Bildern um mehr als etwa 45°
 * dreht, springt sichtbar, statt zu wirbeln. 540° auf 1,1 s (27 Bilder) liegen
 * am schnellsten Punkt bei rund 39°.
 *
 * Die Kurve ist `smootherstep` (6p⁵ − 15p⁴ + 10p³). Entscheidend ist ihr Ende:
 * Dort sind Geschwindigkeit **und** Beschleunigung null, die letzten Bilder
 * rücken also nur noch um Bruchteile eines Grades weiter — die Karte kommt zur
 * Ruhe, statt anzuhalten. Gemessen am 16.09.2026: Mit `smoothstep` lag der
 * letzte Schritt noch bei 6,3°, mit `smootherstep` bei 0,4°.
 *
 * Ihre Spitze liegt beim 1,875-fachen des Durchschnitts (37,5° je Bild) und
 * damit unter der 45°-Grenze. Eine kubische Ease-in-out-Kurve wäre dreimal so
 * schnell wie der Schnitt (57,8° je Bild) und würde in der Mitte springen; eine
 * reine Ease-out-Kurve legte zwei Drittel des Wegs im ersten Drittel der Zeit
 * zurück und stand danach fast still.
 *
 * Kippen und Wachsen laufen als **quadratischer** Sinus mit: Er geht am Ende
 * schneller auf null als ein einfacher, und genau darauf kommt es an — das
 * letzte gerechnete Bild liegt bei p = 26/27, und mit `sin` wäre die Karte dort
 * noch gut 1° gekippt, während das Standbild danach gerade steht. Sichtbar wäre
 * das als kleiner Ruck am Schluss. Quadriert bleiben davon 0,13°.
 */
const flipLage = (p: number) => {
  const e = p * p * p * (p * (6 * p - 15) + 10);
  const schwung = Math.sin(p * Math.PI) ** 2;
  return { drehung: 180 + 540 * e, neigung: schwung * 14, groesse: 1 + 0.14 * schwung };
};

/** Die beiden Flächen der Karte — beide echt: Rückseite und Scan. */
function rgbFlaechenHtml(farbe: RgbFarbe): string {
  return `<div class="flaeche rueck"></div>
    <div class="flaeche vorn" style="background-image:${kartenUrl(RGB[farbe].karte)}"></div>`;
}

/** Grund, Logo und die Karte(n) — eine Bühne ohne Binderseite. */
/**
 * Der Grund — Farbverlauf und Lichtkegel, ohne Karte.
 *
 * Er ist vom Vordergrund getrennt, weil der Rauch dazwischen liegt: ffmpeg legt
 * über diesen Grund zwei ziehende Rauchebenen und erst darüber die Karten
 * (siehe `rgbClipFilter`). Als ein Bild gerendert ginge das nicht — der Rauch
 * würde über der Karte liegen oder gar nicht ziehen.
 */
function rgbGrundHtml(farbe: RgbFarbe | "drei"): string {
  const f = farbe === "drei" ? RGB.rot : RGB[farbe];
  const grund = farbe === "drei"
    // Alle drei Farben: Auf einem roten Grund sähe die blaue Karte aus, als
    // gehörte sie nicht dazu.
    ? `radial-gradient(circle at 18% 44%,${RGB.rot.mitte}dd 0%,transparent 48%),`
      + `radial-gradient(circle at 50% 38%,${RGB.gruen.mitte}dd 0%,transparent 46%),`
      + `radial-gradient(circle at 82% 44%,${RGB.blau.mitte}dd 0%,transparent 48%),`
      + `radial-gradient(circle at 50% 52%,#15192480 0%,#05060A 78%)`
    : `radial-gradient(circle at 50% 38%,${f.mitte} 0%,${f.dunkel} 54%,#05060A 100%)`;
  const schein = farbe === "drei" ? "" :
    `<div class="schein" style="background:radial-gradient(ellipse at center,${f.hell}66 0%,transparent 66%)"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:#05060A;overflow:hidden}
    .grund{position:absolute;inset:0;background:${grund}}
    .schein{position:absolute;left:50%;top:${KARTE_Y - 80}px;width:960px;height:1080px;margin-left:-480px;
            filter:blur(30px)}
  </style></head><body><div class="grund"></div>${schein}</body></html>`;
}

/**
 * Karten und Set-Logo — auf durchsichtigem Grund, damit der Rauch darunter zieht.
 */
function rgbBuehneHtml(inhalt: string, logo?: string): string {
  const logoEbene = logo ? `<div class="setlogo" style="background-image:${markeUrl(logo)}"></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden}
    /* Das Logo liegt über der Bühne: eine wirbelnde Karte darf davor nicht
       herlaufen — es ist die Auskunft, um welches Set es geht. */
    .setlogo{position:absolute;z-index:5;left:50%;transform:translateX(-50%);top:60px;width:44%;
             aspect-ratio:2173/1200;background-size:contain;background-repeat:no-repeat;background-position:center;
             filter:drop-shadow(0 10px 26px rgba(0,0,0,.75)) drop-shadow(0 2px 5px rgba(0,0,0,.6))}
    .buehne{position:absolute;inset:0;perspective:1800px}
    /* Kein Filter auf der Karte: er würde preserve-3d aufheben und beide
       Flächen gleichzeitig zeigen. Der Schatten sitzt deshalb an der Fläche. */
    .karte{position:absolute;transform-style:preserve-3d}
    .flaeche{position:absolute;inset:0;backface-visibility:hidden;border-radius:26px;overflow:hidden;
             background-size:cover;background-position:center;
             box-shadow:0 34px 70px rgba(0,0,0,.65), 0 0 0 2px rgba(0,0,0,.45)}
    .rueck{transform:rotateY(180deg);background-image:${kartenUrl(RUECK)}}${BELEG_CSS}
  </style></head><body><div class="buehne">${inhalt}</div>${logoEbene}</body></html>`;
}

/**
 * Der Beleg: ein Screenshot-Ausschnitt wie ein angepinnter Kassenzettel — weisser
 * Rand, leicht schraeg, rechts ueber der Karte.
 *
 * Er sitzt rechts in der Mitte (x 520, y 700), nicht unten: Unten links steht
 * der Text, und der reicht bei zwei Zeilen bis etwa y 1270 hoch — ein Zettel
 * dort haette die Zeile verdeckt. So ueberlappt er die rechte Kartenhaelfte,
 * und genau das soll er: Beleg auf der Karte, nicht neben ihr.
 */
const BELEG_CSS = `
    .beleg{position:absolute;z-index:4;background:#fff;padding:10px;border-radius:16px;
           box-shadow:0 30px 60px rgba(0,0,0,.65), 0 4px 10px rgba(0,0,0,.4)}
    .beleg img{display:block;width:100%;height:auto;border-radius:8px}
    .beleg.klein{left:520px;top:700px;width:520px;transform:rotate(-3deg)}
    .beleg.gross{left:50%;top:50%;width:980px;transform:translate(-50%,-50%) rotate(-1.5deg)}`;
function belegHtml(datei: string, lage: "klein" | "gross"): string {
  return `<div class="beleg ${lage}"><img src="${belegUrl(datei)}"></div>`;
}

/** Ein Standbild: Rückseite oben oder Vorderseite oben, wahlweise mit Beleg. */
function rgbBildHtml(farbe: RgbFarbe, seite: "rueck" | "vorn", logo?: string, beleg?: string): string {
  const grad = seite === "rueck" ? 180 : 0;
  return rgbBuehneHtml(
    `<div class="karte" style="left:${KARTE_X}px;top:${KARTE_Y}px;width:${KARTE_B}px;height:${KARTE_H}px;
        transform:rotateY(${grad}deg)">${rgbFlaechenHtml(farbe)}</div>` +
    (beleg ? belegHtml(beleg, "klein") : ""), logo);
}

/** Der Blitz: nur der Beleg, gross, auf Schwarz — kein Logo, kein Rauch. */
function blitzHtml(datei: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:#050609;overflow:hidden}${BELEG_CSS}
  </style></head><body>${belegHtml(datei, "gross")}</body></html>`;
}

/** Ein einzelnes Bild des Wirbels. */
function rgbFlipHtml(farbe: RgbFarbe, p: number, logo?: string): string {
  const l = flipLage(p);
  return rgbBuehneHtml(
    `<div class="karte" style="left:${KARTE_X}px;top:${KARTE_Y}px;width:${KARTE_B}px;height:${KARTE_H}px;
        transform:rotateY(${l.drehung.toFixed(2)}deg) rotateZ(${l.neigung.toFixed(2)}deg) scale(${l.groesse.toFixed(4)})">
        ${rgbFlaechenHtml(farbe)}</div>`, logo);
}

/** Das Schlussbild: alle drei nebeneinander, leicht gefächert. */
function rgbDreiHtml(logo?: string): string {
  const B = 320, HK = Math.round((B * 88) / 63), Y = 700, LUECKE = 22;
  const gesamt = 3 * B + 2 * LUECKE, x0 = Math.round((W - gesamt) / 2);
  const karten = (["rot", "gruen", "blau"] as RgbFarbe[]).map((farbe, i) =>
    `<div class="karte" style="left:${x0 + i * (B + LUECKE)}px;top:${Y + (i === 1 ? -34 : 0)}px;width:${B}px;height:${HK}px;
        transform:rotateZ(${[-8, 0, 8][i]}deg)">${rgbFlaechenHtml(farbe)}</div>`).join("");
  return rgbBuehneHtml(karten, logo);
}

/**
 * Die Rauchtextur: einmal gerendert, dann von ffmpeg bewegt.
 *
 * `feTurbulence` erzeugt Perlin-Rauschen — dasselbe, woraus jedes Wolkenbild
 * gemacht ist. Die Werte sind am 16.09.2026 aus drei Proben gewählt: Bei
 * `baseFrequency` 0.0016 blieb ein weicher Farbnebel ohne erkennbare Schwaden,
 * bei 0.0070 wurde er körnig und unruhig. 0.0040/0.0055 mit vier Oktaven gibt
 * große Ballen mit Rand; der Kontrast dazwischen kommt aus der Gammakurve.
 *
 * Sie ist deutlich größer als das Bild (2040 × 3000 gegen 1080 × 1920): ffmpeg
 * schneidet daraus ein wanderndes Fenster, und der Weg darf nie über den Rand
 * laufen. Die erste Fassung war 1560 × 2480 und ließ nur ±180 px Weg zu — der
 * Rauch bewegte sich dann so wenig, dass zwischen zwei Bildern kaum 8.000 Pixel
 * überhaupt eine andere Helligkeit hatten. Sichtbar ist das nicht.
 */
const RAUCH_B = 2040, RAUCH_H = 3000;
function rauchHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0} html,body{width:${RAUCH_B}px;height:${RAUCH_H}px;background:#000;overflow:hidden}
  </style></head><body>
    <svg width="${RAUCH_B}" height="${RAUCH_H}" xmlns="http://www.w3.org/2000/svg">
      <filter id="rauch" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.0040 0.0055" numOctaves="4" seed="30"/>
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0"/>
        <feComponentTransfer><feFuncA type="gamma" exponent="2.6" amplitude="1.7"/></feComponentTransfer>
      </filter>
      <rect width="100%" height="100%" fill="#000"/>
      <rect width="100%" height="100%" filter="url(#rauch)"/>
    </svg>
  </body></html>`;
}

/**
 * Die neun teuersten Karten des Sets am 13.09.2026, in Leserichtung des
 * 3×3-Blatts. Zwei leere Einträge sind Absicht: 151 (Mewtu ex, 349 €) und
 * 152 (Mew ex, 299 €) sind noch nicht enthüllt und haben keinen Scan — sie
 * stehen als leere Hülle mit Schild. Zusammen 2.022 €.
 */
const RUECK = "kartenrueckseite";
/**
 * Die Top 20 des Sets am Abend des 13.09.2026, Platz 1 zuerst.
 *
 * **Die Zahlen stammen von der Cardmarket-Seite, nicht aus `card_prices`.** Der
 * Preisführer, den wir täglich ziehen, ist eine Momentaufnahme von 02:47 Uhr —
 * vor Erscheinen eines Sets hinkt er der Seite um bis zu einen Tag hinterher.
 * An diesem Abend trugen dort 29 Karten einen Ab-Preis, bei uns nur 7; die
 * sieben stimmten auf den Cent überein, die anderen 22 waren tagsüber neu
 * eingestellt worden. Für ein Stück über Preise zählt der Stand, den der
 * Zuschauer selbst sieht.
 *
 * Auffällig und der Aufhänger des Schlusses: **Platz 1 ist ein Nachdruck** —
 * die Crystal-Lugia aus Aquapolis von 2002, hier mit Jubiläumsstempel. Sie
 * steht über allem, was für das Set neu gezeichnet wurde. Überhaupt sind neun
 * der zwanzig Klassik-Nachdrucke (H-Nummern).
 *
 * Drei Karten sind noch nicht enthüllt und stehen als Rückseite mit Namen:
 * Gengar ex 154, Mewtu ex 151, Mew ex 152.
 */
const TOP20: [string, string, string | null][] = [
  ["cel30-h7",   "899 €", null],            // 1  Lugia (Aquapolis 149)
  ["cel30-150",  "599 €", null],            // 2  Pikachu ex
  [RUECK,        "400 €", "Gengar ex 154"], // 3
  ["cel30-157",  "399 €", null],            // 4  Mewtu ex, Futuristic Rare
  ["cel30-149",  "389 €", null],            // 5  Pikachu ex
  [RUECK,        "349 €", "Mewtu ex 151"],  // 6
  [RUECK,        "299 €", "Mew ex 152"],    // 7
  ["cel30-h30",  "299 €", null],            // 8  Karpador (Paldea Evolved 203)
  ["cel30-155",  "279 €", null],            // 9  Jirachi ex
  ["cel30-153",  "239 €", null],            // 10 Feelinara ex
  ["cel30-h6",   "229 €", null],            // 11 Schimmerndes Celebi (Neo Destiny 106)
  ["cel30-158",  "199 €", null],            // 12 Mew ex, Futuristic Rare
  ["cel30-h25",  "199 €", null],            // 13 Pikachu & Zekrom GX (Team Up 33)
  ["cel30-h21",  "159 €", null],            // 14 M Guardevoir EX (Primal Clash 106)
  ["cel30-h9",   "159 €", null],            // 15 Dunkles Despotar (Team Rocket Returns 19)
  ["cel30-148",  "150 €", null],            // 16 Quajutsu ex
  ["cel30-h22",  "150 €", null],            // 17 Quajutsu BREAK (BREAKpoint 41)
  ["cel30-h11",  "145 €", null],            // 18 Metagross δ (Delta Species 11)
  ["cel30-h1",   "139 €", null],            // 19 Pikachu (Base Set 58)
  ["cel30-h4",   "125 €", null],            // 20 Erikas Pummeluff (Gym Challenge 69)
];
/** Ein Blatt aus den Plätzen `von`..`bis` (1-basiert), aufsteigend gelesen: 20 → 12. */
const blatt20 = (von: number, bis: number) => {
  const teil = TOP20.slice(bis - 1, von).reverse();
  return { karten: teil.map((t) => t[0]), preise: teil.map((t) => t[1]), namen: teil.map((t) => t[2]) };
};
const BLATT_A = blatt20(20, 12);   // Plätze 20 bis 12
const BLATT_B = blatt20(11, 3);    // Plätze 11 bis 3


/**
 * Ranglisten aus dem Produktkatalog — geholt mit `scripts/reel-daten.ts`,
 * Preisstand 14.09.2026, Grundlage ist der 30-Tage-Schnitt von Cardmarket.
 * Die Bilder liegen unter `assets/<projekt>/karten/<id>.jpg`.
 */
const KLASSIK = {
  karten: ["ecard3-146", "ecard2-149", "ecard3-10", "neo4-107", "neo4-109", "ecard2-150", "ecard3-145", "neo3-65", "neo4-113"],
  preise: ["3.398 €", "3.005 €", "1.924 €", "1.664 €", "1.379 €", "1.000 €", "917 €", "911 €", "784 €"],
  namen: ["Glurak", "Lugia", "Gengar", "Schimm. Glurak", "Schimm. Mewtu", "Nidoking", "Celebi", "Schimm. Garados", "Schimm. Despotar"],
};
const ARITA = {
  karten: ["ex6-108", "ex7-99", "ecard3-145", "ecard2-41", "base1-4", "ex7-104", "ecard3-148", "ex3-100", "ecard3-28"],
  preise: ["1.431 €", "1.337 €", "917 €", "766 €", "553 €", "461 €", "444 €", "432 €", "379 €"],
  namen: ["Gengar ex", "Rocket's Mewtwo ex", "Celebi", "Nachtara", "Glurak", "Rocket's Relaxo ex", "Geowaz", "Glurak", "Raikou"],
};
const S151 = {
  karten: ["sv03.5-199", "sv03.5-200", "sv03.5-202", "sv03.5-198", "sv03.5-168", "sv03.5-170", "sv03.5-173", "sv03.5-201", "sv03.5-169"],
  preise: ["356 €", "153 €", "124 €", "116 €", "96 €", "87 €", "80 €", "76 €", "70 €"],
  namen: ["Glurak-ex", "Turtok-ex", "Zapdos-ex", "Bisaflor-ex", "Glumanda", "Schiggy", "Pikachu", "Simsala-ex", "Glutexo"],
};

/**
 * Eine Rangliste für die Füllung umdrehen: **Platz 9 zuerst, Platz 1 zuletzt.**
 *
 * Das ist die Dramaturgie aller Preis-Stücke und keine Geschmacksfrage. Wer die
 * teuerste Karte zuerst legt, hat nach zwei Sekunden nichts mehr zu erzählen —
 * der Rest des Reels ist dann ein Abstieg. Füllt sich das Blatt von unten, wird
 * jedes Fach eine kleine Steigerung, und die Spitze steht am Schluss allein im
 * Bild. Das Drehbuch `preise` macht es seit dem 13.09. so; am 14.09. war es in
 * den neuen Ranglisten versehentlich andersherum.
 */
const aufsteigend = (r: { karten: string[]; preise: string[]; namen: string[] }) =>
  ({ karten: [...r.karten].reverse(), preise: [...r.preise].reverse(), namen: [...r.namen].reverse() });

/** Die Ränge 9 bis 2 — für Blätter, deren Spitze einzeln aufgelöst wird. */
const ohneSpitze = (r: { karten: string[]; preise: string[]; namen: string[] }) =>
  ({ karten: r.karten.slice(0, -1), preise: r.preise.slice(0, -1), namen: r.namen.slice(0, -1) });

/**
 * Bewegungen der letzten sieben Tage, aufsteigend nach Prozent — die Spitze
 * steht am Ende. Nur Karten mit mindestens fünf Messpunkten im Fenster.
 */
const RAKETEN = {
  karten: ["sv08.5-161", "sv04.5-232", "swsh7-194", "xyp-XY121", "me02.5-281", "base1-4", "smp-SM210", "ex11-4"],
  preise: ["+2 %", "+4 %", "+9 %", "+30 %", "+30 %", "+34 %", "+35 %", "+360 %"],
  namen: ["Nachtara-ex", "Mew-ex", "Rayquaza V", "Charizard EX", "Team Rockets Mewtu-ex", "Glurak", "Lavados & Zapdos & Arktos GX", "Psiana"],
};
/** EX-Ära, Top 9 — acht davon von Masakazu Fukuda. */
const EXAERA = {
  karten: ["ex8-107", "ex7-107", "pop5-17", "ex15-100", "pop5-16", "ex7-108", "ex15-101", "np-28", "ex7-109"],
  preise: ["4.162 €", "3.611 €", "3.445 €", "3.166 €", "3.089 €", "3.087 €", "2.889 €", "2.625 €", "1.832 €"],
  namen: ["Rayquaza ☆", "Hydropi ☆", "Nachtara ☆", "Glurak ☆ δ", "Psiana ☆", "Flemmli ☆", "Mew ☆ δ", "Championship Arena", "Geckarbor ☆"],
};
/** Ken Sugimori, Top 9 — sechs davon Schimmernde aus der Neo-Zeit. */
const SUGIMORI = {
  karten: ["neo3-65", "neo4-113", "gym2-2", "gym1-14", "neo3-66", "neo4-112", "gym2-29", "neo4-110", "base1-2"],
  preise: ["911 €", "784 €", "447 €", "365 €", "365 €", "345 €", "318 €", "288 €", "224 €"],
  namen: ["Schimm. Garados", "Schimm. Despotar", "Blaines Glurak", "Sabrinas Gengar", "Schimm. Karpador", "Schimm. Stahlos", "Sabrinas Gengar", "Schimm. Noctuh", "Turtok"],
};
/** Neun Illustration Rares unter zwölf Euro — das Gegenstück zu den Teuer-Ranglisten. */
const BILLIG = {
  karten: ["sv10.5w-155", "sv05-182", "sv10.5b-107", "sv10.5b-095", "sv10.5w-111", "sv10.5b-099", "sv01-246", "sv02-260", "sv01-221"],
  preise: ["12 €", "12 €", "12 €", "12 €", "12 €", "12 €", "12 €", "12 €", "11 €"],
  namen: ["Terribark", "Picochilla", "Karippas", "Tarnpignon", "Gelatini", "Ignivor", "Riesenzahn-ex", "Bailonda-ex", "Staralili"],
};

/**
 * Farblich passende Seiten — zusammengestellt mit `scripts/reel-farbseite.ts`
 * aus der Bildmotiv-Analyse des Produkts (`card_art_tags`: drei dominante
 * Farben je Karte). Ausgewählt wird nach Farbton **und** Sättigung und
 * Helligkeit; nur Seltenheiten mit vollflächiger Illustration, jedes Pokémon
 * einmal, und die Reihenfolge geht von dunkel nach hell.
 */
const BLAUE_SEITE = {
  karten: ["swsh9-156", "xy5-54", "sm2-133", "sm1-155", "sv04-192", "swsh2-183", "sm11-219", "sv10.5w-127", "me04-094"],
  preise: ["16 €", "15 €", "4 €", "16 €", "6 €", "6 €", "12 €", "7 €", "3 €"],
  namen: ["Lumineon V", "Kyogre EX", "Lusardin GX", "Solgaleo GX", "Agiluza", "Katapuldra V", "Keldeo GX", "Kiesling", "Metang"],
};
const GRUENE_SEITE = {
  karten: ["g1-2", "me04-102", "sv08.5-152", "sm7-109", "me01-185", "sv01-208", "sm8-34", "swsh12-183", "sv04-217"],
  preise: ["23 €", "1 €", "19 €", "18 €", "18 €", "10 €", "3 €", "3 €", "2 €"],
  namen: ["M-Bisaflor EX", "Pumpdjinn-ex", "Ogerpon-ex", "Rayquaza GX", "Major Bobs Abmachung", "Pachirisu", "Viridium GX", "Regidrago V", "Frosdedje-ex"],
};
/**
 * Feelinara ex (30th Celebration) in der Mitte — **Seite 6 aus dem Binder
 * „ART 151"**, von Hand gelegt, nicht gerechnet.
 *
 * Die algorithmische Fassung vom selben Tag war stimmig, aber die gebaute ist
 * besser: Psiana V und Mega-Dragoran-ex tragen dasselbe Rosa in zwei Stärken,
 * und die vier kleinen Illustration Rares aus Stellarkrone halten die Seite
 * ruhig. Eine Karte hatten beide Wege gemeinsam — Owei aus Stürmische Funken.
 *
 * Reihenfolge wie im Binder: Fach 1 bis 9 in Leserichtung.
 */
const FEELINARA_SEITE = {
  karten: ["swsh7-180", "sv07-145", "sm9-173", "me02.5-290", "cel30-153", "sv07-172", "sv08-192", "sv01-251", "sv07-152"],
  preise: ["159 €", "5 €", "57 €", "415 €", "", "17 €", "7 €", "14 €", "7 €"],
  namen: ["Psiana V", "Liliep", "Journée", "Mega-Dragoran-ex", "Feelinara ex", "Tara", "Owei", "Mimi", "Hokumil"],
};


/**
 * Die neun Schimmernden aus Neo Revelation (Garados, Karpador) und Neo Destiny,
 * Platz 1 zuerst — avg30 vom 20.09.2026, Summe 6.916 €.
 */
const SCHIMMERND = {
  karten: ["neo4-107", "neo4-109", "neo3-65", "neo4-113", "neo4-111", "neo4-108", "neo3-66", "neo4-112", "neo4-106"],
  preise: ["1.664 €", "1.393 €", "913 €", "808 €", "599 €", "534 €", "365 €", "336 €", "304 €"],
  namen: ["Schimm. Glurak", "Schimm. Mewtu", "Schimm. Garados", "Schimm. Despotar", "Schimm. Raichu", "Schimm. Kabutops", "Schimm. Karpador", "Schimm. Stahlos", "Schimm. Celebi"],
};

const DREHBUECHER: Record<string, Drehbuch> = {
  /**
   * „Das Set kommt erst — deine Seiten nicht." Der Hype-Beitrag zum
   * 30th Celebration (cel30), das am **16.09.2026** erscheint.
   *
   * Der Dreh ist der Vorsprung: Binderplan führt das Set seit dem 11.09. im
   * Katalog (184 der 199 Karten mit Scan, von Hand aus der Serebii-Setliste —
   * TCGdex und pokemontcg.io führen neue Sets erst zum Erscheinungstag).
   * Deshalb steht am Anfang eine **leere** Seite: das Set gibt es noch nicht,
   * die Planung schon.
   *
   * Die drei Kunstseiten stammen aus der Vitrine: Lavados/Arktos/Zapdos in der
   * mittleren Reihe (Fächer 3–5), die drei Mauzi über Eck (2/4/6), Feelinara
   * allein in der Mitte (4).
   */
  dreissig: {
    titel: "30 Jahre — plan schon mal",
    artworks: ["fSq9nqKj0Q-5", "oGTiqnIKyVjU", "LKaRP0k2qY_S"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "binder", seite: "fSq9nqKj0Q-5", nur: [] }, dauerMs: 2600, stil: "hook", zeig: "Das 30-Jahre-Set\nkommt am 16.9." },
      { art: "wandel", von: { art: "binder", seite: "fSq9nqKj0Q-5", nur: [] }, bis: { art: "binder", seite: "fSq9nqKj0Q-5" }, haltMs: 700, dauerMs: 3600, zeig: "Deine Seite\nkannst du jetzt bauen." },
      { art: "fahrt", seite: "fSq9nqKj0Q-5", vonFach: 3, bisFach: 5, dauerMs: 3800, zeig: "Lavados, Arktos, Zapdos.\nEine Reihe, eine Seite." },
      { art: "stand", bild: { art: "binder", seite: "oGTiqnIKyVjU" }, dauerMs: 3400, zeig: "Drei Mauzi,\neine Gasse." },
      { art: "stand", bild: { art: "binder", seite: "LKaRP0k2qY_S" }, dauerMs: 3200, zeig: "Oder eine Karte,\ndie die ganze Seite kriegt." },
      { art: "stand", bild: { art: "drei", seiten: ["fSq9nqKj0Q-5", "oGTiqnIKyVjU", "LKaRP0k2qY_S"] }, dauerMs: 3600, stil: "schluss", zeig: "16. September.\nDein Plan steht vorher." },
    ],
    caption: `Das 30-Jahre-Set kommt am 16. September. Deine Seiten kannst du jetzt schon bauen.

Vorbestellen halte ich für verlorenes Geld — am Erscheinungstag steht die Ware ohnehin im Regal, und die Preise geben nach. Die Seite zu planen kostet dagegen nichts, und genau das ist der Teil, den alle erst machen, wenn der Ordner schon voll ist.

30th Celebration steht bei uns seit dieser Woche im Katalog, vorab, aus der veröffentlichten Setliste, mit Scans. Welche Karte in welches Fach, wie viele Seiten du brauchst, was am Ende noch fehlt.

Die drei Seiten hier sind so entstanden: Lavados, Arktos und Zapdos in einer Reihe. Drei Mauzi über Eck. Feelinara allein in der Mitte, mit der ganzen Seite als Rahmen. Ausgedruckt in 63 × 88 mm, die Kartenfächer bleiben frei.

Welche Karte aus dem Set willst du als Erstes einsortieren?`,
    captionKurz: `Das 30-Jahre-Set kommt am 16. September. Vorbestellen halte ich für verlorenes Geld — die Seite vorher zu planen kostet dagegen nichts.

Welche Karte sortierst du zuerst ein?`,
    hashtags: ["#30thcelebration", "#pokemon30", "#binderart", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „30 Jahre, 30 Pikachu." Das Blatt füllt sich Karte für Karte.
   *
   * Im Set tragen **genau 30** Karten die eigene Seltenheit „Pikachu Rare"
   * (Nummern 023 bis 052, lückenlos) und sind auf der Karte selbst mit
   * „01/30" bis „30/30" durchnummeriert. Die übrigen sechs Pikachu des Sets
   * (2× ex, 2× Illustration Rare, 2 aus der Klassik-Abteilung) gehören nicht
   * zur Reihe — deshalb steht hier nirgends eine andere Zahl als dreißig.
   *
   * Der Schluss ist der eigentliche Nutzwert: dreißig Karten gehen in einem
   * Neuner-Album nicht auf (drei Seiten und ein Rest), im Sechzehner schon
   * (zwei Seiten, zwei Fächer frei). Beide Raster kann das Produkt.
   */
  pikachu: {
    titel: "30 Jahre, 30 Pikachu",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    // Hier liegen nur echte Kartenscans im Blatt, kein einziges erzeugtes Bild.
    clips: [
      { art: "stand", bild: { art: "karten", karten: PIKACHU, sichtbar: 1 }, dauerMs: 2600, stil: "hook", zeig: "30 Jahre.\n30 Pikachu." },
      // Die Nummerierung ist die Pointe der Reihe — im Raster ist sie aber nur
      // ein paar Pixel groß. Deshalb einmal eine einzelne Karte über die volle
      // Breite: ein 1×1-Blatt ist 900 × 1257 px, da steht „01/30" lesbar.
      { art: "stand", bild: { art: "karten", karten: [PIKACHU[0]!], sichtbar: 1, spalten: 1, zeilen: 1 }, dauerMs: 2800, zeig: "Jede ist nummeriert.\n01 von 30." },
      { art: "fuellung", karten: PIKACHU.slice(0, 9), bis: 9, dauerMs: 3400, zeig: "Eine Karte für jedes Jahr." },
      { art: "fuellung", karten: PIKACHU.slice(9, 18), bis: 9, dauerMs: 3200, zeig: "Dreißig Illustrationen,\njede anders." },
      { art: "fuellung", karten: PIKACHU.slice(18, 27), bis: 9, dauerMs: 3200, zeig: "Das Set kommt am 16.9.\nPlanen kannst du jetzt schon." },
      { art: "fuellung", karten: PIKACHU.slice(27, 30), bis: 3, dauerMs: 2400, zeig: "Drei Seiten voll.\nUnd drei, die überstehen." },
      { art: "stand", bild: { art: "karten", karten: PIKACHU.slice(0, 16), sichtbar: 16, spalten: 4, zeilen: 4 }, dauerMs: 3200, zeig: "Im Sechzehner-Album:\nzwei Seiten, zwei Fächer frei." },
      { art: "stand", bild: { art: "karten", karten: PIKACHU.slice(0, 16), sichtbar: 16, spalten: 4, zeilen: 4 }, dauerMs: 2800, stil: "schluss", zeig: "Plan deinen 30-Jahre-Binder.\nJetzt, nicht am 16." },
    ],
    caption: `30 Jahre Pokémon, 30 Pikachu-Karten. Eine für jedes Jahr, auf der Karte durchnummeriert von 01/30 bis 30/30.

Und damit eine Zumutung für jeden, der ein normales Neuner-Album benutzt: Dreißig Karten sind drei volle Seiten — und drei, die überstehen. Im Sechzehner passen sie auf zwei Seiten, zwei Fächer bleiben frei. Es gibt keine Aufteilung, bei der die Reihe sauber aufgeht, und ich bin ziemlich sicher, dass darüber niemand nachgedacht hat.

Das Set erscheint am 16. September, bei uns steht es schon im Katalog. Heißt: Du kannst durchspielen, welche Fassung dich weniger stört, bevor die Karten da sind.

Übrigens hat das Set 36 Karten mit Pikachu. Zur Jubiläumsreihe gehören nur die 30 mit der eigenen Seltenheitsstufe — der Rest sind zwei ex, zwei Illustration Rares und zwei aus der Klassik-Abteilung.

Neuner oder Sechzehner: Wie legst du die dreißig ab?`,
    captionKurz: `30 Jahre, 30 Pikachu — und keine Aufteilung, bei der die Reihe sauber aufgeht. Im Neuner bleiben drei übrig, im Sechzehner zwei Fächer frei.

Wie legst du die dreißig ab?`,
    hashtags: ["#pikachu", "#30thcelebration", "#pokemon30", "#pokemonsammeln", "#binderplan"],
  },


  /**
   * „Set kommt Mittwoch, Preise stehen schon." — alles, was am 13.09.2026 auf
   * Cardmarket schon einen Preis trägt, mit Schild am Fach.
   *
   * Die Zahlen stammen aus `card_prices` (Preisführer vom 13.09., drei Tage vor
   * Erscheinen). 93 der 188 Karten haben einen Wert, und die Verteilung ist die
   * eigentliche Geschichte: neun Karten tragen den ganzen Wert, der Rest liegt
   * bei 50 Cent. Gezeigt werden nur diese neun — der Bulk sagt im Bild nichts,
   * was der Satz in der Beschreibung nicht besser sagt.
   *
   * Zwei der neun — Mewtu ex (349 €) und Mew ex (299 €), beide Special
   * Illustration Rare — sind noch **nicht enthüllt**: es gibt keinen Scan, auch
   * nicht bei Serebii. Sie stehen deshalb als leere Hülle im Raster und tragen
   * trotzdem ihr Schild. Das ist kein Mangel der Aufnahme, sondern der Beleg
   * für die Aussage: Hier wird etwas bepreist, das noch keiner gesehen hat.
   *
   * Der Tipp am Schluss ist Meinung und soll es sein — vor Erscheinen gibt es
   * keinen Verkauf, auf dem ein Trendpreis stehen könnte; sobald die ersten
   * Displays aufgehen, drückt die Menge die Preise. Widerspruch in den
   * Kommentaren ist hier erwünscht.
   *
   * Der Hook trägt **eine** Zeile, nicht zwei: die große Schrift wächst vom
   * Textrand nach oben, und ab der zweiten Zeile liegt sie über der untersten
   * Fachreihe — also genau über den Preisschildern, um die es geht. Eine Zeile
   * endet 46 px darunter. Der Aufhänger ist ohnehin das Bild: ein Raster voller
   * Preisschilder, dazu „Noch nicht raus."
   */
  preise: {
    titel: "Set kommt Mittwoch, Preise stehen schon",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    // Nur echte Scans und leere Fächer — kein erzeugtes Bild.
    clips: [
      // Der Einstieg muss eine Frage stellen, keine Feststellung: die Zahl steht
      // gross da, die Karte ist unkenntlich. Wer wissen will, was 899 € wert
      // ist, bleibt — aufgeloest wird es erst in der vorletzten Einstellung.
      // Kein Preisschild auf dem Blatt: die Ansage rundet auf „knapp 1.000 €",
      // das Schild wuerde 899 € zeigen und ihr widersprechen.
      { art: "stand", bild: { art: "karten", karten: ["cel30-h7"], sichtbar: 1, spalten: 1, zeilen: 1,
        unscharf: 42, logo: "cel30-setlogo.png" }, dauerMs: 2700, stil: "hook",
        zeig: "Top-Chase-Hit\nschon bei\nknapp 1.000 €!" },
      // Die beiden Seiten fuellen sich Fach fuer Fach — derselbe Zug wie im
      // Pikachu-Stueck. Ein fertiges Raster ist nach zwei Sekunden gelesen und
      // steht dann still; so kommt mit jedem Fach eine Zahl dazu und das Auge
      // hat einen Grund zu bleiben. Die Reihenfolge steigt, Platz 20 zuerst.
      { art: "fuellung", karten: BLATT_A.karten, bis: 9, preise: BLATT_A.preise, namen: BLATT_A.namen,
        dauerMs: 4200, zeig: "Die ersten Preise sind da.\nHier die Top 20." },
      { art: "fuellung", karten: BLATT_B.karten, bis: 9, preise: BLATT_B.preise, namen: BLATT_B.namen,
        dauerMs: 4200, zeig: "Platz 11 bis 3.\nAlle über 200 €." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-150"], sichtbar: 1, spalten: 1, zeilen: 1,
        preise: ["599 €"] }, dauerMs: 2700, zeig: "Platz 2: Pikachu ex.\n599 €." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-h7"], sichtbar: 1, spalten: 1, zeilen: 1,
        preise: ["899 €"] }, dauerMs: 3100, zeig: "Platz 1: Lugia, 899 €.\nEin Nachdruck von 2002." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-h7"], sichtbar: 1, spalten: 1, zeilen: 1,
        preise: ["899 €"] }, dauerMs: 2800, zeig: "Tipp: wartet ab.\nNach Mittwoch fallen sie." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-h7"], sichtbar: 1, spalten: 1, zeilen: 1,
        preise: ["899 €"] }, dauerMs: 3000, stil: "schluss", zeig: "Was haltet ihr\nvon den Preisen?" },
    ],
    caption: `Die ersten Preise fürs 30-Jahre-Set stehen — und das Set kommt erst Mittwoch. Hier die Top 20.

Ganz oben sitzt ausgerechnet kein neues Bild, sondern ein Nachdruck: die Crystal-Lugia aus Aquapolis von 2002, jetzt mit Jubiläumsstempel. 899 €, und damit teurer als alles, was für dieses Set neu gezeichnet wurde. Überhaupt sind neun der zwanzig Klassik-Nachdrucke — Base-Set-Pikachu, Dunkles Despotar, Metagross δ, die Darkrai-&-Cresselia-LEGENDE.

Platz 2 ist die Pikachu ex als Special Illustration Rare mit 599 €.

Drei Karten stehen im Video als Rückseite: Gengar ex 154, Mewtu ex 151 und Mew ex 152. Nicht weil sie geheim wären — sondern weil in den Katalogen noch kein Scan liegt. Die Preise stehen trotzdem: 400 €, 349 € und 299 €.

Alles davon sind Ab-Preise. Kein Trend, kein einziger Verkauf — den kann es vor Release gar nicht geben.

Mein Tipp: wartet, bis das Set draußen ist. Sobald die ersten Displays aufgehen, kommt Ware rein und die Preise geben nach. War bei jedem Set so.

Was haltet ihr von den Preisen?

Stand: Sonntag, 13.09., abends. Die Preise ändern sich täglich.`,
    captionKurz: `Die ersten Preise fürs 30-Jahre-Set — und ganz oben steht ein Nachdruck von 2002, nicht ein neues Bild. Mein Tipp: wartet bis nach Mittwoch, dann geben sie nach.

Was haltet ihr von den Preisen?`,
    hashtags: ["#30thcelebration", "#pokemon30", "#cardmarket", "#pokemonsammeln", "#chasecards", "#binderplan"],
  },

  /**
   * „Das Set ist noch nicht mal raus." — die beiden Futuristic Rare mit ihrem
   * Stand auf Cardmarket, als Frage an die Kommentare.
   *
   * Futuristic Rare ist die neue Seltenheit des 30th Celebration und kommt im
   * ganzen Set **genau zweimal** vor: Mewtwo ex als 157/128 und Mew ex als
   * 158/128 — beide über der Setnummer, beide von YOSHIROTTEN, beide im selben
   * Chrom-Druck.
   *
   * Der Stand am 13.09.2026, drei Tage vor Erscheinen (aus dem Preisführer,
   * `card_prices`): für die Mew ex steht ein Angebot über 199 € drin, für die
   * Mewtwo ex **keines**. Genau diese Schieflage ist der Beitrag — nicht „teure
   * Karte", sondern „eine kannst du kaufen, die andere will keiner hergeben".
   *
   * Wichtig und bewusst im Stück, nicht nur in der Beschreibung: Die 199 € sind
   * ein **Ab-Preis**, kein Trend. Vor Erscheinen gibt es keinen einzigen
   * Verkauf, auf dem ein Trendpreis stehen könnte. Wer das weglässt, macht
   * Hype; wer es dazusagt, klingt wie jemand, der Cardmarket kennt.
   *
   * Die Zahl steht fest im Drehbuch. Sie ändert sich täglich — deshalb nennt
   * die Beschreibung ihren Stand, und das Reel gehört vor den 16.09.
   */
  futuristic: {
    titel: "Zwei Karten, ein Preis",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["cel30-158"], sichtbar: 1, spalten: 1, zeilen: 1 }, dauerMs: 2600, stil: "hook", zeig: "Noch nicht raus.\nSchon zu kaufen." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-158"], sichtbar: 1, spalten: 1, zeilen: 1 }, dauerMs: 2900, zeig: "Mew ex, 158/128.\nAb 199 €." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-157"], sichtbar: 1, spalten: 1, zeilen: 1 }, dauerMs: 2900, zeig: "Mewtwo ex, 157/128.\nNoch kein einziges Angebot." },
      { art: "fuellung", karten: ["cel30-157", "cel30-158"], bis: 2, spalten: 2, zeilen: 1, dauerMs: 3000, zeig: "Futuristic Rare — neu im Set.\nUnd es gibt nur diese zwei." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-158"], sichtbar: 1, spalten: 1, zeilen: 1 }, dauerMs: 2900, zeig: "199 € ist ein Ab-Preis.\nKein Trend, kein Verkauf." },
      { art: "stand", bild: { art: "karten", karten: ["cel30-157", "cel30-158"], sichtbar: 2, spalten: 2, zeilen: 1 }, dauerMs: 3400, stil: "schluss", zeig: "Das Set kommt Mittwoch.\nWas haltet ihr vom Preis?" },
    ],
    caption: `Mittwoch kommt 30th Celebration. Auf Cardmarket kannst du jetzt schon kaufen.

Futuristic Rare ist die neue Seltenheit im Set, und es gibt sie genau zweimal: Mewtwo ex als 157/128 und Mew ex als 158/128. Beide über der Setnummer, beide von YOSHIROTTEN, beide in diesem Chrom-Druck.

Für die Mew ex will gerade jemand 199 €. Für die Mewtwo ex steht noch gar kein Angebot drin.

Einordnung, damit die Zahl nicht falsch rüberkommt: Die 199 € sind der Ab-Preis von einem Anbieter. Kein Trendpreis, kein einziger Verkauf — vor Release gibt es so etwas nicht. Das ist eine Hausnummer, keine Bewertung.

Was haltet ihr davon? Zu teuer, oder greift ihr zu?

Stand: Sonntag, 13.09. Die Preise ändern sich täglich.`,
    captionKurz: `Das Set ist noch nicht mal raus, und die erste Futuristic Rare steht bei 199 €. Das ist ein Ab-Preis von einem Anbieter — kein Verkauf, keine Bewertung.

Zu teuer, oder greift ihr zu?`,
    hashtags: ["#30thcelebration", "#pokemon30", "#futuristicrare", "#cardmarket", "#pokemonsammeln", "#binderplan"],
  },


  /**
   * „Die seltensten Karten aller Zeiten sind da!" — die drei RGB-Mew.
   *
   * Aufbau: drei Karten, sonst nichts. Jede liegt erst mit der Rückseite oben,
   * wirbelt dann herum und bleibt auf ihrem Scan stehen; unter ihr zieht Rauch
   * in der Farbe der Karte. Am Ende stehen alle drei nebeneinander, das
   * Set-Logo läuft durchgehend mit.
   *
   * **Die Scans liegen in `cards.image_alt`, nicht in `image_de`/`image_en`.**
   * Für cel30 sind die beiden TCGdex-Spalten leer, weil das Set dort noch nicht
   * geführt wird — am 16.09.2026 hielt ich die drei Karten deshalb erst für
   * bildlos und baute eine Silhouette. Die Bilder gibt es längst (Serebii,
   * `…/card/30thcelebration/rgb1..3.jpg`), und es sind die einzigen, die das
   * Stück zeigt.
   *
   * Was auf den Karten steht und das Stück trägt: dasselbe Motiv dreimal, nur
   * die beiden Druckfarben tauschen (rot/blau, grün/rot, blau/grün), alle drei
   * von YOSHIROTTEN, Nummer 30C statt einer Setnummer, Seltenheitskürzel
   * R/RGB, G/RGB und B/RGB.
   *
   * **Zur Zahl:** Was kursiert, ist eine Pull-Rate — eine RGB-Mew auf rund
   * 20.000 Boosterpacks —, nicht eine Auflage von 20.000 Stück. Beides zu
   * verwechseln wäre der Fehler, den die Nische in den Kommentaren zerlegt;
   * „Gerücht" steht deshalb in derselben Zeile wie die Zahl.
   */
  rgbmew: {
    titel: "Die seltensten Karten aller Zeiten",
    artworks: [],
    setLogo: "cel30-setlogo.png",
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "rgb", farbe: "rot", seite: "rueck", logo: "cel30-setlogo.png" },
        dauerMs: 2200, stil: "hook", zeig: "DIE SELTENSTEN\nKARTEN ALLER\nZEITEN SIND DA!" },
      // Die rote Rückseite stand schon im Hook — hier dreht sie früher.
      { art: "flip", farbe: "rot", haltMs: 300, dauerMs: 2600,
        zeig: "Mew in Rot.\nSeltenheit: R/RGB." },
      { art: "flip", farbe: "gruen", haltMs: 400, dauerMs: 2400,
        zeig: "Designs von YOSHIROTTEN,\nangelehnt an die Spiele 1996." },
      { art: "flip", farbe: "blau", haltMs: 400, dauerMs: 2400,
        zeig: "Dasselbe Bild, dreimal.\nNur die Farben tauschen." },
      // Eine Zeile, nicht zwei: Bei 2,0 s liest niemand zwei Zeilen zu Ende.
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2000,
        zeig: "Gerücht: 1 auf 20.000 Packs." },
      // Der Clip für die Folgen-Pille trägt bewusst **keinen** Text: Im
      // Pillenclip endet jede Zeile nach 90 ms (siehe Warnung weiter unten).
      // Er zeigt dasselbe Schlussbild — eine eigene Einstellung dafür hat das
      // Stück am 16.09. nur verlängert, ohne etwas zu erzählen.
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2800 },
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2200, stil: "schluss",
        zeig: "Was denkt ihr,\nwas die drei kosten?" },
    ],
    folgenAbClip: 5,
    caption: `Die seltensten Karten, die Pokémon je gedruckt hat — und die meisten wissen noch nicht mal, dass es sie gibt.

Drei Mew im 30th Celebration: rot, grün, blau. Die Designs von YOSHIROTTEN sind an die Spiele von 1996 angelehnt — dreimal dasselbe Motiv, nur die beiden Druckfarben tauschen. Und statt einer Setnummer steht 30C auf der Karte, dazu R/RGB, G/RGB, B/RGB.

Im Kartentext steht, Mew sei so selten, dass viele es für eine Fata Morgana halten. Passend dazu das Gerücht, das gerade kursiert: eine auf 20.000 Boosterpacks. Bestätigt ist nichts.

Was denkt ihr, was die drei kosten werden — und was haltet ihr von ihnen?`,
    captionKurz: `Drei Mew in Rot, Grün und Blau — dasselbe Motiv, nur die Druckfarben tauschen. Gerücht: eine auf 20.000 Packs.

Was denkt ihr, was die kosten?`,
    hashtags: ["#30thcelebration", "#rgbmew", "#pokemon30", "#chasecards", "#pokemonsammeln", "#binderplan"],
  },


  /**
   * „Die hässlichste Karte des Jahres ist die teuerste." — Meinung zur RGB-Mew.
   *
   * Zweiter Beitrag zu den drei Karten, einen Tag nach dem Wirbel-Reel: kein
   * Umdrehen mehr, die Scans stehen von Anfang an offen da. Der Beitrag nimmt
   * Partei — über Geschmack, das ist laut Playbook das einzige Feld dafür —
   * und legt die Zahlen daneben, die keiner sonst hat: Sofortkauf-Forderungen
   * gegen die laufenden Auktionen mit echten Geboten (eBay Browse API,
   * 17.09.2026 01:20: höchste Forderung 53.490 $, höchstes Gebot 3.209 $ bei
   * 45 Geboten, Auktionsende 19.09.).
   *
   * Der Vergleich ist bewusst so benannt: „verlangt" gegen „geboten". Ein
   * Verkauf zu 20.000 $ ist gemeldet, aber mit Preisvorschlag — was gezahlt
   * wurde, weiß niemand. Wir zeigen deshalb nur, was messbar ist.
   */
  haesslich: {
    titel: "Die hässlichste Karte des Jahres",
    artworks: [],
    setLogo: "cel30-setlogo.png",
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "rgb", farbe: "rot", seite: "vorn", logo: "cel30-setlogo.png" },
        dauerMs: 2200, stil: "hook", zeig: "DIE HÄSSLICHSTE\nKARTE DES JAHRES\nIST DIE TEUERSTE" },
      { art: "stand", bild: { art: "rgb", farbe: "gruen", seite: "vorn", logo: "cel30-setlogo.png" },
        dauerMs: 2200, zeig: "Deep-Fried-Look.\nDrei Druckfarben, mehr nicht." },
      { art: "stand", bild: { art: "rgb", farbe: "blau", seite: "vorn", logo: "cel30-setlogo.png" },
        dauerMs: 2600, zeig: "Verlangt: bis 53.490 $.\nGeboten: 3.209 $." },
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2400,
        zeig: "Hässlich ist Geschmack.\nSelten ist Mathematik." },
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2000,
        zeig: "Ich find sie großartig.\nGerade deshalb." },
      // Pillenclip ohne Text (siehe Warnung weiter unten).
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2800 },
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2400, stil: "schluss",
        zeig: "Sag mir, dass ich\nfalsch liege." },
    ],
    folgenAbClip: 5,
    caption: `Die hässlichste Karte des Jahres ist die teuerste.

Drei Druckfarben, Deep-Fried-Look, keine Feinheit — die RGB-Mew sieht aus wie ein Druckfehler von 1996. Und genau das ist der Punkt: Sie zitiert die Spiele Rot, Grün und Blau, nicht die Kartenkunst von heute.

Auf eBay werden bis zu 53.490 $ verlangt. Die Auktionen mit echten Geboten stehen bei 3.209 $, 45 Gebote, Ende Samstag. Hässlich ist Geschmack. Selten ist Mathematik.

Ich find sie großartig. Sag mir, dass ich falsch liege.

Stand: 17.09., nachts. Gebote ändern sich stündlich.`,
    captionKurz: `Deep-Fried-Look, drei Druckfarben — und die teuerste Karte des Jahres. Verlangt: 53.490 $. Geboten: 3.209 $.

Sag mir, dass ich falsch liege.`,
    hashtags: ["#30thcelebration", "#rgbmew", "#pokemon30", "#chasecards", "#pokemonsammeln", "#binderplan"],
  },


  /**
   * „8.229 Euro. Für ein Mew. Verkauft." — die ersten sechs Verkäufe der RGB-Mew.
   *
   * Nachfolger von `haesslich`: Marcel wollte keine Forderungen und Gebote
   * („klingt generisch"), sondern **echte Verkäufe**. Die Zahlen kommen aus
   * seinen Screenshots der eBay-Verkaufsliste vom 17.09.2026, 00:03 und 01:49
   * Uhr — die API gibt uns Verkäufe nicht (Insights: 403). Die Ausschnitte
   * liegen unter `belege/` und zeigen nur die Textspalte.
   *
   *   Englisch:  Rot 8.229 € (USA, Preisvorschlag) · Grün 3.577 € (AU, 1 Gebot)
   *              · Grün 2.968 € (GB, Preisvorschlag, +142 € Versand)
   *   Japanisch: Rot 6.384 € · Blau 5.180 € · Grün 4.747 € (alle Händler, JP)
   *
   * Der Blitz vorneweg (0,8 s, nur der 8.229-€-Beleg auf Schwarz) ist der
   * Beweis vor der Behauptung: erst der Zettel, dann die Karte. Die Hook nennt
   * die krumme Zahl, nicht „fast 10.000" — die Nische rechnet nach, und 8.229
   * klingt nach Beleg, 10.000 nach Hype.
   */
  verkauft: {
    titel: "8.229 Euro. Für ein Mew. Verkauft.",
    artworks: [],
    setLogo: "cel30-setlogo.png",
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "beleg", datei: "en-rot-us.png" }, dauerMs: 800 },
      { art: "stand", bild: { art: "rgb", farbe: "rot", seite: "vorn", logo: "cel30-setlogo.png" },
        dauerMs: 2200, stil: "hook", zeig: "8.229 EURO.\nFÜR EIN MEW.\nVERKAUFT." },
      { art: "stand", bild: { art: "rgb", farbe: "rot", seite: "vorn", logo: "cel30-setlogo.png", beleg: "en-rot-us.png" },
        dauerMs: 2200, zeig: "Englisch, Rot, aus den USA.\nVerkauft am 17. September." },
      { art: "stand", bild: { art: "rgb", farbe: "gruen", seite: "vorn", logo: "cel30-setlogo.png", beleg: "en-gruen-au.png" },
        dauerMs: 2200, zeig: "Grün: 3.577 € und 2.968 €.\nZwei Verkäufe, ein Tag." },
      { art: "stand", bild: { art: "rgb", farbe: "blau", seite: "vorn", logo: "cel30-setlogo.png", beleg: "jp-blau.png" },
        dauerMs: 2200, zeig: "Japanisch, Blau: 5.180 €.\nRot 6.384 €, Grün 4.747 €." },
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2200,
        zeig: "Sechs Verkäufe in 24 Stunden.\nRot ist überall die teuerste." },
      // Pillenclip ohne Text (siehe Warnung weiter unten).
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2800 },
      { art: "stand", bild: { art: "rgbdrei", logo: "cel30-setlogo.png" }, dauerMs: 2200, stil: "schluss",
        zeig: "Kaufen, halten,\noder Finger weg?" },
    ],
    folgenAbClip: 6,
    caption: `8.229 Euro. Für ein Mew. Verkauft.

Sechs RGB-Mew haben in den ersten 24 Stunden den Besitzer gewechselt — eBay-Verkaufsliste, nicht Forderungen. Englisch: Rot 8.229 €, Grün 3.577 € und 2.968 €. Japanisch: Rot 6.384 €, Blau 5.180 €, Grün 4.747 €.

Rot ist in beiden Sprachen die teuerste Farbe, Grün die günstigste. Die blaue englische — die mit dem 20.000-$-Gerücht — taucht in der Liste noch gar nicht auf.

Hässlich? Vielleicht. Der Markt hat abgestimmt. Kaufen, halten oder Finger weg?

Stand: 17.09., 1 Uhr, eBay-Verkaufsliste. Teils per Preisvorschlag, Versand nicht eingerechnet.`,
    captionKurz: `Sechs RGB-Mew in 24 Stunden verkauft: 2.968 bis 8.229 €. Rot ist überall die teuerste, Grün die günstigste. Kaufen, halten oder Finger weg?`,
    hashtags: ["#30thcelebration", "#rgbmew", "#pokemon30", "#chasecards", "#pokemonsammeln", "#binderplan"],
  },


  /**
   * „Welcher war deiner?" — die drei 151er-Starterreihen, je eine Seite.
   *
   * Der Hook ist das ungewöhnliche Bild plus die Frage, die jeder sofort
   * beantworten kann. Die Zuschreibungen in der Mitte sind bewusst Meinung:
   * Widerspruch in den Kommentaren ist hier das Ziel, und der Schlusssatz
   * zielt auf die Weiterleitung per DM — Sends wiegen bei Instagram schwerer
   * als Kommentare.
   *
   * Fahrtrichtung folgt der Entwicklung, und die steht auf jeder Seite woanders:
   * Bisasam unten links (Fach 6) → Bisaflor oben rechts (2); Schiggy oben links
   * (0) → Turtok unten rechts (8); Glumanda unten rechts (8) → Glurak oben
   * links (0).
   */
  starter: {
    titel: "Welcher war deiner?",
    artworks: ["luFp3Ss3iCi_", "oW6p_fCa7CgP", "_JoY2MluG11O"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "drei", seiten: ["luFp3Ss3iCi_", "oW6p_fCa7CgP", "_JoY2MluG11O"] }, dauerMs: 3000, stil: "hook", zeig: "Welcher war\ndeiner?" },
      { art: "fahrt", seite: "luFp3Ss3iCi_", vonFach: 6, bisFach: 2, dauerMs: 4600, zeig: "Bisasam.\nDie vernünftige Wahl." },
      { art: "fahrt", seite: "oW6p_fCa7CgP", vonFach: 0, bisFach: 8, dauerMs: 4600, zeig: "Schiggy.\nDie sichere Bank." },
      { art: "fahrt", seite: "_JoY2MluG11O", vonFach: 8, bisFach: 0, dauerMs: 4600, zeig: "Glumanda.\nDu weißt, warum." },
      { art: "wandel", von: { art: "ganz", seite: "_JoY2MluG11O" }, bis: { art: "binder", seite: "_JoY2MluG11O" }, haltMs: 1100, dauerMs: 4000, zeig: "Eine Entwicklung,\neine Seite." },
      { art: "stand", bild: { art: "drei", seiten: ["luFp3Ss3iCi_", "oW6p_fCa7CgP", "_JoY2MluG11O"] }, dauerMs: 3800, stil: "schluss", zeig: "Schick das dem,\nder Schiggy genommen hat." },
    ],
    caption: `Welcher war deiner?

Bisasam war die vernünftige Wahl, Schiggy die sichere — und Glumanda die, bei der man wusste, dass die ersten zwei Orden wehtun würden. Ich habe trotzdem immer Glumanda genommen, und ich behaupte: die meisten, die etwas anderes sagen, haben beim zweiten Durchgang gewechselt.

Hier liegt jede Entwicklungsreihe auf einer eigenen Seite. Die drei echten Karten sitzen in ihren Fächern, dazwischen läuft das Bild weiter: Bisasam im Dschungel, Schiggy im Meer, Glumanda in der Schlucht. Ein Motiv über alle neun Fächer, ausgedruckt in 63 × 88 mm, die Kartenfächer bleiben frei.

Schreib deinen in die Kommentare — und sei ehrlich.`,
    captionKurz: `Bisasam war vernünftig, Schiggy sicher, Glumanda die Entscheidung fürs Gefühl. Jede Reihe auf einer eigenen Seite.

Welcher war deiner — ehrlich?`,
    hashtags: ["#pokemon151", "#kantostarter", "#binderart", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Drei Slabs. Oder eine Seite." — der zweite Anlauf auf das Slab-Thema.
   *
   * Die Fassung vom 11.09. hatte eine vorgelesene Stimme, keinen Abspann und
   * eine Fahrt, die dem Text davonlief. Geblieben ist die Haltung, die auf
   * Threads als einziger Beitrag Reichweite hatte („Die schönste Karte gehört
   * in den Binder, nicht in den Slab", 92 Aufrufe gegen 1 bis 17 auf
   * Instagram): keine Preise, keine Zahlen, kein Streit über Wertanlagen.
   *
   * **Was hier nicht mehr behauptet wird:** dass man die Rückseite im Slab nie
   * wiedersieht. Das ist genau verkehrt herum — ein Slab ist auf beiden Seiten
   * durchsichtig, im Binder liegt die Rückseite an. Der Satz stand am 10.09.
   * schon im Skript und ist die Sorte Fehler, die in dieser Nische auffliegt.
   */
  slab: {
    titel: "Drei Slabs. Oder eine Seite.",
    artworks: ["_JoY2MluG11O"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "binder", seite: "_JoY2MluG11O" }, dauerMs: 3000, stil: "hook", zeig: "Drei Slabs.\nOder eine Seite." },
      { art: "fahrt", seite: "_JoY2MluG11O", vonFach: 8, bisFach: 4, dauerMs: 3800, zeig: "Unten Glumanda.\nDa hat es angefangen." },
      { art: "fahrt", seite: "_JoY2MluG11O", vonFach: 4, bisFach: 0, dauerMs: 3800, haltMs: 900, zeig: "Oben Glurak.\nÜber dem Vulkan." },
      { art: "stand", bild: { art: "ganz", seite: "_JoY2MluG11O" }, dauerMs: 3400, zeig: "Eine Schlucht,\ndrei echte Karten." },
      { art: "wandel", von: { art: "ganz", seite: "_JoY2MluG11O" }, bis: { art: "binder", seite: "_JoY2MluG11O" }, haltMs: 600, dauerMs: 3600, zeig: "Im Slab liegt jede\neinzeln in ihrer Box." },
      { art: "stand", bild: { art: "binder", seite: "_JoY2MluG11O" }, dauerMs: 3200, stil: "schluss", zeig: "Im Binder\nschlägst du sie auf." },
    ],
    caption: `Drei Slabs. Oder eine Seite.

Ich verstehe Grading. Wirklich. Aber eine Karte, die in einer Box im Schrank liegt, macht niemandem Freude — auch dir nicht.

Glumanda unten in der Schlucht, da hat es bei den meisten angefangen. Glutexo auf halber Höhe. Oben Glurak über dem Vulkan. Dieselbe Reihe, die du als Kind durchgespielt hast, auf einer Seite, in einem Bild.

Eingesperrt ist jede Karte für sich. Nebeneinander ergeben sie etwas, das keine einzeln kann: eine Seite, die man aufschlägt.

Sagt mir, warum ich falsch liege.`,
    captionKurz: `Ich verstehe Grading. Aber eine Karte in einer Box im Schrank macht niemandem Freude — auch dir nicht.

Binder oder Slab: Sagt mir, warum ich falsch liege.`,
    hashtags: ["#glurak", "#pokemon151", "#binderart", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Neun Fächer, ein Bild" — die Antwort auf die Michi Method.
   *
   * In der Szene (@michimaybe_, 36K auf TikTok) werden leere Binderfächer von
   * Hand mit Kunst gefüllt: Bild suchen, in Canva zuschneiden, in Zentimetern
   * abmessen, ausdrucken. Genau diesen Ablauf nimmt Binderplan ab — deshalb
   * steht der Wandel von den sechs leeren Fächern zum durchgehenden Motiv
   * schon nach fünf Sekunden. Nutzwert ist das send-stärkste Format, und Sends
   * sind der stärkste Reichweitenhebel außerhalb der eigenen Follower.
   *
   * Die Kinderzimmer-Seite trägt drei echte Karten in den Fächern 3, 5 und 7.
   */
  neunfaecher: {
    titel: "Neun Fächer, ein Bild",
    artworks: ["8TJzioLxjwP1"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "binder", seite: "8TJzioLxjwP1", nur: [3, 5, 7] }, dauerMs: 2800, stil: "hook", zeig: "Sechs Fächer\nsind leer." },
      { art: "stand", bild: { art: "binder", seite: "8TJzioLxjwP1", nur: [3, 5, 7] }, dauerMs: 3000, zeig: "Von Hand: zuschneiden,\nabmessen, hoffen." },
      { art: "wandel", von: { art: "binder", seite: "8TJzioLxjwP1", nur: [3, 5, 7] }, bis: { art: "binder", seite: "8TJzioLxjwP1" }, haltMs: 700, dauerMs: 4200, zeig: "Oder die Seite entsteht\nin einem Stück." },
      { art: "fahrt", seite: "8TJzioLxjwP1", vonFach: 7, bisFach: 3, dauerMs: 3800, zeig: "Deine Karten bleiben echt.\nDas Bild wächst drumherum." },
      { art: "stand", bild: { art: "ganz", seite: "8TJzioLxjwP1" }, dauerMs: 3400, zeig: "Ausdrucken: 63 × 88 mm.\nGenau ein Fach." },
      { art: "stand", bild: { art: "binder", seite: "8TJzioLxjwP1" }, dauerMs: 3200, stil: "schluss", zeig: "Zuschneiden.\nEinstecken. Fertig." },
    ],
    caption: `Sechs Fächer sind leer — und genau da fängt bei den meisten das Basteln an.

Motiv suchen, in Canva zuschneiden, in Zentimetern abmessen, ausdrucken, feststellen dass es zwei Millimeter zu breit ist. Ich halte das für verlorene Zeit, und zwar ohne jeden Charme: Am Ende sieht man dem Blatt an, dass es aus drei Teilen besteht.

Eine Seite gehört in einem Stück gedacht. Ein Motiv über alle neun Fächer, die Fächer mit echten Karten bleiben frei, der Druck kommt in 63 × 88 mm — genau ein Fach. Zuschneiden, einstecken, fertig.

Welches Motiv würdest du über deine Lieblingsseite legen?`,
    captionKurz: `Zuschneiden, abmessen, hoffen — ich halte das für verlorene Zeit. Eine Seite gehört in einem Stück gedacht: ein Motiv über alle neun Fächer.

Welches Motiv käme auf deine Lieblingsseite?`,
    hashtags: ["#pokemonbinder", "#binderart", "#michimethod", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „1999 bis 2003" — die teuersten neun der WotC-Zeit.
   *
   * Post-Art C aus dem Playbook: eine ganze Ära statt eines Sets. Der Reiz
   * liegt in der Zugehörigkeit — wer damals gesammelt hat, erkennt jede dieser
   * Karten, auch ohne das Set zu kennen. Die Zahlen kommen aus dem Katalog
   * (Stand 14.09.2026, 30-Tage-Schnitt), die Abdeckung lag bei 1.577 von 1.794
   * Karten der Ära; unter 80 % würde die Rangliste nicht gepostet.
   *
   * Ganz oben stehen zwei Karten aus der e-Card-Zeit (Skyridge, Aquapolis) —
   * die letzten Sets, die Wizards of the Coast gedruckt hat.
   */
  aera: {
    titel: "Die neun teuersten der WotC-Zeit",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: [KLASSIK.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, unscharf: 40 },
        dauerMs: 2700, stil: "hook", zeig: "1999 bis 2003.\nDas war teuer." },
      // Platz 9 zuerst, die Spitze bleibt draußen und kommt einzeln.
      { art: "fuellung", karten: aufsteigend(KLASSIK).karten, bis: 8, preise: aufsteigend(KLASSIK).preise,
        dauerMs: 5200, zeig: "Platz 9 bis 2." },
      { art: "stand", bild: { art: "karten", karten: [KLASSIK.karten[1]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["3.005 €"] },
        dauerMs: 2900, zeig: "Knapp davor: Lugia,\nAquapolis 2002." },
      { art: "stand", bild: { art: "karten", karten: [KLASSIK.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["3.398 €"] },
        dauerMs: 3400, zeig: "Platz 1: Glurak,\nSkyridge 2003." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(KLASSIK).karten, sichtbar: 9, preise: aufsteigend(KLASSIK).preise },
        dauerMs: 3400, stil: "schluss", zeig: "Welche lag bei dir\nim Ordner?" },
    ],
    caption: `1999 bis 2003. Das war teuer.

Oben stehen Skyridge und Aquapolis — die zwei Sets, die damals kaum jemand ernst genommen hat. Das Base-Set ist überbewertet, die e-Card-Zeit unterbewertet: Von Skyridge liegt schlicht nichts mehr herum.

Neun Karten, zusammen 14.982 €. Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Welche lag bei dir im Ordner?`,
    captionKurz: `Die neun teuersten der WotC-Zeit — und oben steht nicht das Base-Set, sondern Skyridge.

Welche lag bei dir im Ordner?`,
    hashtags: ["#wotc", "#pokemonvintage", "#skyridge", "#pokemonsammeln", "#chasecards", "#binderplan"],
  },

  illustrator: {
    titel: "Neun Karten, ein Zeichner",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ARITA.karten, sichtbar: 9 },
        dauerMs: 2800, stil: "hook", zeig: "Neun Karten.\nEin Zeichner." },
      { art: "fuellung", karten: aufsteigend(ARITA).karten, bis: 8, preise: aufsteigend(ARITA).preise,
        dauerMs: 5000, zeig: "Alle von Mitsuhiro Arita." },
      { art: "stand", bild: { art: "karten", karten: ["base1-4"], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["553 €"] },
        dauerMs: 3200, zeig: "Die bekannteste:\nPlatz fünf." },
      { art: "stand", bild: { art: "karten", karten: [ARITA.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["1.431 €"] },
        dauerMs: 3200, zeig: "Teuerste: Gengar ex.\n1.431 €." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(ARITA).karten, sichtbar: 9 },
        dauerMs: 3400, stil: "schluss", zeig: "Wessen Seite\nals Nächstes?" },
    ],
    caption: `Neun Karten, ein Zeichner.

Alles Mitsuhiro Arita — und die berühmteste steht nur auf Platz fünf. Der Base-Set-Glurak kostet 553 €, das Gengar ex aus Feuerrot & Blattgrün fast das Dreifache.

Wer eine Seite nach Handschrift baut statt nach Set, bekommt den schöneren Ordner und zahlt meistens weniger.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Wessen Seite sollen wir als Nächstes bauen?`,
    captionKurz: `Neun Karten, ein Zeichner: alles Arita. Der berühmte Base-Glurak steht nur auf Platz fünf.

Wessen Seite als Nächstes?`,
    hashtags: ["#mitsuhiroarita", "#pokemonart", "#binderart", "#pokemonsammeln", "#pokemonvintage", "#binderplan"],
  },

  duell: {
    titel: "Welche ist teurer?",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["ecard3-10", "neo4-107"], sichtbar: 2, spalten: 2, zeilen: 1 },
        dauerMs: 2600, stil: "hook", zeig: "Welche ist teurer?" },
      { art: "stand", bild: { art: "karten", karten: ["ecard3-10", "neo4-107"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["Skyridge 2003", "Neo Destiny 2002"] },
        dauerMs: 3600, zeig: "Links Skyridge 2003,\nrechts Neo Destiny 2002." },
      { art: "stand", bild: { art: "karten", karten: ["ecard3-10", "neo4-107"], sichtbar: 2, spalten: 2, zeilen: 1 },
        dauerMs: 2600, zeig: "Denk kurz nach." },
      { art: "stand", bild: { art: "karten", karten: ["ecard3-10", "neo4-107"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["1.924 €", "1.664 €"] },
        dauerMs: 3400, zeig: "Gengar. Um 260 €." },
      { art: "stand", bild: { art: "karten", karten: ["ecard3-10", "neo4-107"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["1.924 €", "1.664 €"] },
        dauerMs: 3200, stil: "schluss", zeig: "Wie hast du\ngetippt?" },
    ],
    caption: `Welche ist teurer?

Links Gengar aus Skyridge, rechts das Schimmernde Glurak aus Neo Destiny. Fast jeder tippt Glurak — und liegt daneben: 1.924 € gegen 1.664 €.

Bekanntheit treibt den Preis nur so lange, bis jemand versucht, die Karte wirklich zu kaufen. Dann zählt die Auflage.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Wie hast du getippt?`,
    captionKurz: `Gengar aus Skyridge oder das Schimmernde Glurak — welche ist teurer? Fast jeder tippt falsch.

Wie hast du getippt?`,
    hashtags: ["#pokemonquiz", "#pokemonvintage", "#skyridge", "#cardmarket", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Was kostet diese Seite?" — neun Karten, eine Summe.
   *
   * Nimmt die Top 9 aus 151 und rechnet vor, was eine einzige volle Seite
   * kostet. Die Summe ist der Moment, für den man bleibt; das Werkzeug rechnet
   * sie im Produkt ohnehin aus, hier ist die Zahl selbst die Werbung.
   */
  seitenwert: {
    titel: "Was kostet diese Seite?",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: S151.karten, sichtbar: 9 },
        dauerMs: 2700, stil: "hook", zeig: "Was kostet\ndiese Seite?" },
      { art: "fuellung", karten: aufsteigend(S151).karten, bis: 8, preise: aufsteigend(S151).preise,
        dauerMs: 5400, zeig: "Die Top 9 aus 151." },
      { art: "stand", bild: { art: "karten", karten: [S151.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["356 €"] },
        dauerMs: 3000, zeig: "Und oben das Glurak-ex.\n356 €." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(S151).karten, sichtbar: 9, preise: aufsteigend(S151).preise },
        dauerMs: 3600, zeig: "1.158 €.\nFür eine Seite." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(S151).karten, sichtbar: 9 },
        dauerMs: 3400, stil: "schluss", zeig: "Rechne mal\ndeine nach." },
    ],
    caption: `Was kostet diese Seite?

Die neun teuersten Karten aus 151, in einer Seite: 1.158 €. Allein das Glurak-ex 356 €.

Der Punkt ist nicht der Preis. Der Punkt ist, dass die meisten nie zusammenrechnen, was im Ordner liegt — und dann eine Seite mit vierstelligem Wert in einem 8-€-Binder aufbewahren.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Was liegt auf deiner teuersten Seite?`,
    captionKurz: `Die neun teuersten Karten aus 151, auf einer Seite: 1.158 €.

Was liegt auf deiner teuersten Seite?`,
    hashtags: ["#pokemon151", "#cardmarket", "#pokemonbinder", "#pokemonsammeln", "#chasecards", "#binderplan"],
  },

  vintagemodern: {
    titel: "Team Vintage oder Team Modern?",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["ex8-102", "M6-113"], sichtbar: 2, spalten: 2, zeilen: 1, unscharf: 26 },
        dauerMs: 2700, stil: "hook", zeig: "Team Vintage\noder Modern?" },
      { art: "stand", bild: { art: "karten", karten: ["ex8-102", "M6-113"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["EX Deoxys, 2005", null] },
        dauerMs: 3400, zeig: "Links: Rayquaza ex,\nFebruar 2005." },
      { art: "stand", bild: { art: "karten", karten: ["ex8-102", "M6-113"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["EX Deoxys, 2005", "Storm Emeralda, 2026"] },
        dauerMs: 3400, zeig: "Rechts: Rayquaza,\nJuli 2026." },
      { art: "stand", bild: { art: "karten", karten: ["ex8-102", "M6-113"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["210 €", "676 €"] },
        dauerMs: 3600, zeig: "210 € gegen 676 €." },
      { art: "stand", bild: { art: "karten", karten: ["ex8-102", "M6-113"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["210 €", "676 €"] },
        dauerMs: 3400, stil: "schluss", zeig: "Welche kommt\nins Fach?" },
    ],
    caption: `Team Vintage oder Team Modern?

Zweimal Rayquaza, einundzwanzig Jahre dazwischen: EX Deoxys von 2005, Storm Emeralda von diesem Juli. Beide waren die Chase-Karte ihres Sets — nur so ist der Vergleich einer.

Und die neue gewinnt. 676 € gegen 210 €, nach zwei Monaten gegen einundzwanzig Jahre.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Welche kommt bei dir ins Fach?`,
    captionKurz: `Zweimal Rayquaza, 21 Jahre dazwischen: 2005 kostet 210 €, 2026 kostet 676 €. Die neue gewinnt.

Welche kommt bei dir ins Fach?`,
    hashtags: ["#rayquaza", "#pokemonvintage", "#stormemeralda", "#cardmarket", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Diese Karte ist diese Woche um 360 % gestiegen" — die Bewegungen der
   * letzten sieben Tage, aufsteigend gelegt.
   *
   * Zahlen aus `priceMovers` mit **fünf Messpunkten Mindestanforderung**: Zwei
   * Punkte ergeben rechnerisch eine Bewegung, aber keine Aussage. Im Fenster
   * lagen 3.467 Karten mit Verlauf.
   *
   * Die Spitze ist ausdrücklich **kein** Kaufsignal, und genau das sagt das
   * Stück auch. Bei einer dünn gehandelten Karte reicht ein einzelner Verkauf
   * für 360 % — wer das als Markt verkauft, hat die Nische nach zwei Wochen
   * gegen sich.
   */
  raketen: {
    titel: "Preis-Raketen der Woche",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: [RAKETEN.karten[7]!], sichtbar: 1, spalten: 1, zeilen: 1, unscharf: 44 },
        dauerMs: 2700, stil: "hook", zeig: "Eine Karte machte\ndiese Woche 360 %." },
      { art: "fuellung", karten: RAKETEN.karten, bis: 7, preise: RAKETEN.preise,
        dauerMs: 5400, zeig: "Sieben Tage,\nacht Bewegungen." },
      { art: "stand", bild: { art: "karten", karten: ["base1-4"], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["+34 %"] },
        dauerMs: 2900, zeig: "Der Base-Glurak:\n446 auf 599 €." },
      { art: "stand", bild: { art: "karten", karten: [RAKETEN.karten[7]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["+360 %"] },
        dauerMs: 3400, zeig: "Und Psiana:\n142 auf 652 €." },
      { art: "stand", bild: { art: "karten", karten: RAKETEN.karten, sichtbar: 8, preise: RAKETEN.preise },
        dauerMs: 3400, stil: "schluss", zeig: "Kaufsignal?\nEher nicht." },
    ],
    caption: `Eine Karte machte diese Woche 360 %.

Psiana aus Delta Species, von 142 auf 652 €. Und nein, das ist kein Markt — das sind ein paar Verkäufe bei einer Karte, die sonst wochenlang niemand anfasst. Bei so dünnem Handel reicht ein einziger Käufer.

Interessanter ist der Base-Glurak: 446 auf 599 €, und der wird jeden Tag gehandelt. Das ist eine Bewegung, die etwas heißt.

Sieben Tage, nur Karten mit fast täglichem Preis. Cardmarket, Stand 13.09.

Kauft ihr in sowas rein?`,
    captionKurz: `Psiana +360 % in sieben Tagen — aber das ist kein Markt, das sind drei Verkäufe. Der Base-Glurak mit +34 % sagt mehr.

Kauft ihr in sowas rein?`,
    hashtags: ["#pokemoninvesting", "#cardmarket", "#pokemonvintage", "#pokemonsammeln", "#chasecards", "#binderplan"],
  },

  /**
   * „Die teuerste Ära heißt EX" — und acht der neun Spitzenkarten hat derselbe
   * Mann gezeichnet: Masakazu Fukuda, die Gold Stars von 2005.
   *
   * Das ist die Beobachtung, die das Stück trägt. Eine Rangliste allein ist
   * eine Liste; erst die Verbindung zwischen den Karten macht sie zu etwas,
   * das man weitererzählt.
   */
  exaera: {
    titel: "Acht davon hat ein Mann gezeichnet",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: [EXAERA.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, unscharf: 40 },
        dauerMs: 2700, stil: "hook", zeig: "Die teuerste Ära\nheißt EX." },
      { art: "fuellung", karten: aufsteigend(EXAERA).karten, bis: 8, preise: aufsteigend(EXAERA).preise,
        dauerMs: 5400, zeig: "Platz 9 bis 2.\nAlle über 1.800 €." },
      { art: "stand", bild: { art: "karten", karten: [EXAERA.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["4.162 €"] },
        dauerMs: 3200, zeig: "Platz 1: Rayquaza ☆.\n4.162 €." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(EXAERA).karten, sichtbar: 9, preise: aufsteigend(EXAERA).preise },
        dauerMs: 3400, zeig: "Acht davon hat\nein Mann gezeichnet." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(EXAERA).karten, sichtbar: 9 },
        dauerMs: 3200, stil: "schluss", zeig: "Kennt ihr\nseinen Namen?" },
    ],
    caption: `Die teuerste Ära heißt EX.

Neun Karten, zusammen 27.906 €, und acht davon hat derselbe Mann gezeichnet: Masakazu Fukuda, die Gold Stars von 2005. Rayquaza, Hydropi, Nachtara, Psiana, Geckarbor, Flemmli — alles seine.

Für mich sind die Gold Stars die schönste Idee, die es je im TCG gab: ein goldener Stern neben dem Namen, sonst nichts, und die Karte war eine von etwa 200 im Umlauf.

Cardmarket, 30-Tage-Schnitt, Stand 14.09. 1.822 der 1.896 Karten der Ära bepreist.

Kennt ihr seinen Namen?`,
    captionKurz: `Neun Karten, 27.906 € — und acht davon hat derselbe Mann gezeichnet: Masakazu Fukuda, die Gold Stars von 2005.

Kennt ihr seinen Namen?`,
    hashtags: ["#goldstar", "#pokemonvintage", "#exera", "#pokemonsammeln", "#chasecards", "#binderplan"],
  },

  /**
   * „1999 gegen 2025" — der zweite Vintage-gegen-Modern-Vergleich, diesmal mit
   * der Karte, die jeder kennt.
   *
   * Base-Set-Glurak gegen Mega-Glurak X-ex aus Fatale Flammen. Auch hier gilt:
   * keine Partei. Dass die neue teurer ist, ist die Nachricht; wer sie schöner
   * findet, ist die Diskussion.
   */
  glurakduell: {
    titel: "1999 gegen 2025",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["base1-4", "me02-125"], sichtbar: 2, spalten: 2, zeilen: 1, unscharf: 26 },
        dauerMs: 2700, stil: "hook", zeig: "1999 gegen 2025." },
      { art: "stand", bild: { art: "karten", karten: ["base1-4", "me02-125"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["Basis-Set 1999", null] },
        dauerMs: 3400, zeig: "Links die Karte,\ndie alles angefangen hat." },
      { art: "stand", bild: { art: "karten", karten: ["base1-4", "me02-125"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["Basis-Set 1999", "Fatale Flammen 2025"] },
        dauerMs: 3400, zeig: "Rechts die,\ndie gerade alle wollen." },
      { art: "stand", bild: { art: "karten", karten: ["base1-4", "me02-125"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["553 €", "803 €"] },
        dauerMs: 3600, zeig: "553 € gegen 803 €." },
      { art: "stand", bild: { art: "karten", karten: ["base1-4", "me02-125"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["553 €", "803 €"] },
        dauerMs: 3400, stil: "schluss", zeig: "Welche hängst du\nauf die erste Seite?" },
    ],
    caption: `1999 gegen 2025.

Links der Base-Set-Glurak, die Karte, mit der für die meisten alles angefangen hat. Rechts Mega-Glurak X-ex aus Fatale Flammen, sechsundzwanzig Jahre später.

553 € gegen 803 €. Die neue ist teurer — nach zehn Monaten gegen sechsundzwanzig Jahre.

Was daraus folgt, hängt davon ab, wen man fragt: Für die einen ist das ein Beweis, dass Moderne unterschätzt wird. Für die anderen, dass sie überhitzt ist. Ich halte mich raus.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Welche hängst du auf die erste Seite?`,
    captionKurz: `Base-Set-Glurak von 1999: 553 €. Mega-Glurak X-ex von 2025: 803 €. Die neue ist teurer.

Welche kommt auf deine erste Seite?`,
    hashtags: ["#glurak", "#charizard", "#pokemonvintage", "#cardmarket", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Der Mann, der Pokémon gezeichnet hat" — Ken Sugimori.
   *
   * Anders als beim Arita-Stück geht es hier nicht um Handschrift, sondern um
   * Herkunft: Sugimori hat die Originaldesigns gemacht. Seine teuersten Karten
   * sind fast alle Schimmernde aus Neo — die Reihe, die heute kaum jemand
   * vollständig hat.
   */
  sugimori: {
    titel: "Der Mann, der die Originale gezeichnet hat",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: SUGIMORI.karten, sichtbar: 9 },
        dauerMs: 2800, stil: "hook", zeig: "Er hat Pokémon\ngezeichnet." },
      { art: "fuellung", karten: aufsteigend(SUGIMORI).karten, bis: 8, preise: aufsteigend(SUGIMORI).preise,
        dauerMs: 5200, zeig: "Ken Sugimori,\nseine teuersten neun." },
      { art: "stand", bild: { art: "karten", karten: [SUGIMORI.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["911 €"] },
        dauerMs: 3200, zeig: "Oben: Schimmerndes\nGarados, 911 €." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(SUGIMORI).karten, sichtbar: 9, preise: aufsteigend(SUGIMORI).preise },
        dauerMs: 3400, stil: "schluss", zeig: "Sechs davon\nsind Schimmernde." },
    ],
    caption: `Er hat Pokémon gezeichnet.

Ken Sugimori — die Originaldesigns, die roten und blauen Editionen, alles. Seine teuersten neun Karten sind trotzdem keine Klassiker aus dem Base-Set, sondern fast alle Schimmernde aus der Neo-Zeit.

Sechs von neun. Das Schimmernde Garados steht bei 911 €, und die ganze Reihe hat heute kaum jemand vollständig — weil damals niemand darauf geachtet hat.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Hat jemand die Schimmernden komplett?`,
    captionKurz: `Ken Sugimori hat die Originale gezeichnet — seine teuersten Karten sind trotzdem die Schimmernden aus der Neo-Zeit.

Hat die jemand komplett?`,
    hashtags: ["#kensugimori", "#shiningpokemon", "#pokemonvintage", "#pokemonart", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Eine volle Seite für 106 €" — das Gegenstück zu den Teuer-Ranglisten.
   *
   * Neun Illustration Rares, keine über zwölf Euro, alle aus aktuellen Sets.
   * Das Format ist der Einstiegspunkt für alle, die bei 1.158-€-Seiten
   * abschalten — und es ist das ehrlichere Werbeargument: Eine schöne Seite
   * kostet weniger als ein Display.
   */
  billigseite: {
    titel: "Eine volle Seite für 106 €",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: BILLIG.karten, sichtbar: 9 },
        dauerMs: 2700, stil: "hook", zeig: "Neun Karten.\n106 Euro." },
      { art: "fuellung", karten: BILLIG.karten, bis: 9, preise: BILLIG.preise,
        dauerMs: 5400, zeig: "Keine über zwölf Euro." },
      { art: "stand", bild: { art: "karten", karten: BILLIG.karten, sichtbar: 9, preise: BILLIG.preise },
        dauerMs: 3400, zeig: "Alles Illustration Rares.\nAlles aktuelle Sets." },
      { art: "stand", bild: { art: "karten", karten: BILLIG.karten, sichtbar: 9 },
        dauerMs: 3400, stil: "schluss", zeig: "Schöner als\nein Display." },
    ],
    caption: `Neun Karten. 106 Euro.

Alles Illustration Rares aus aktuellen Sets, keine über zwölf Euro — und zusammen sehen sie besser aus als die meisten Seiten, für die Leute das Zehnfache ausgeben.

Meine Meinung: Wer mit Sammeln anfängt, sollte genau hier anfangen und nicht bei der Chase-Karte. Eine volle, schöne Seite macht mehr Freude als eine teure Karte zwischen acht leeren Fächern.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Was war die schönste günstige Karte, die du gezogen hast?`,
    captionKurz: `Neun Illustration Rares, keine über zwölf Euro, zusammen 106 €. Schöner als die meisten Seiten für das Zehnfache.

Womit habt ihr angefangen?`,
    hashtags: ["#illustrationrare", "#pokemonbinder", "#pokemonsammeln", "#binderart", "#pokemontcg", "#binderplan"],
  },

  /**
   * „Neun Karten, ein Blau" — die erste Seite, die nach Farbe statt nach Set
   * gebaut ist.
   *
   * Die Auswahl kommt aus der Bildmotiv-Analyse: Karten, deren dominante Farbe
   * um 210° liegt, mit ähnlicher Sättigung und Helligkeit. Preisdeckel für die
   * ganze Seite waren 100 €, herausgekommen sind 86.
   */
  farbblau: {
    titel: "Neun Karten, ein Blau",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: BLAUE_SEITE.karten, sichtbar: 9 },
        dauerMs: 2700, stil: "hook", zeig: "Neun Karten.\nEin Blau." },
      { art: "fuellung", karten: BLAUE_SEITE.karten, bis: 9, preise: BLAUE_SEITE.preise,
        dauerMs: 5400, zeig: "Keine über 16 Euro." },
      { art: "stand", bild: { art: "karten", karten: BLAUE_SEITE.karten, sichtbar: 9, preise: BLAUE_SEITE.preise },
        dauerMs: 3400, zeig: "86 € für die\nganze Seite." },
      { art: "stand", bild: { art: "karten", karten: BLAUE_SEITE.karten, sichtbar: 9 },
        dauerMs: 3400, stil: "schluss", zeig: "Nach Farbe,\nnicht nach Set." },
    ],
    caption: `Neun Karten, ein Blau.

Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen — am Ende liegt ein Glurak neben einem Trainer neben einer Energie, und keine Seite sieht nach irgendetwas aus.

Diese hier ist nach Farbe gebaut: alles im selben Blau, von dunkel oben nach hell unten. Neun Karten, keine über 16 €, zusammen 86 €.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Sortiert ihr nach Set oder nach Gefühl?`,
    captionKurz: `Nach Setnummer zu sortieren ist die langweiligste Art, einen Binder zu füllen. Diese Seite ist nach Farbe gebaut — neun Karten, 86 €.

Set oder Gefühl?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#pokemontcg", "#illustrationrare", "#binderplan"],
  },

  /**
   * „Dieselbe Idee in Grün" — der Gegenbeweis, dass es nicht am Blau lag.
   *
   * M-Bisaflor EX von 2016 neben Ogerpon-ex von 2025: neun Jahre und acht
   * Sets liegen dazwischen, auf der Seite sieht man davon nichts.
   */
  farbgruen: {
    titel: "Dieselbe Idee in Grün",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: GRUENE_SEITE.karten, sichtbar: 9 },
        dauerMs: 2700, stil: "hook", zeig: "Neun Karten.\nEin Grün." },
      { art: "fuellung", karten: GRUENE_SEITE.karten, bis: 9, preise: GRUENE_SEITE.preise,
        dauerMs: 5400, zeig: "Aus neun Jahren\nund acht Sets." },
      { art: "stand", bild: { art: "karten", karten: GRUENE_SEITE.karten, sichtbar: 9, preise: GRUENE_SEITE.preise },
        dauerMs: 3400, zeig: "97 € zusammen." },
      { art: "stand", bild: { art: "karten", karten: GRUENE_SEITE.karten, sichtbar: 9 },
        dauerMs: 3400, stil: "schluss", zeig: "Welche Farbe\nals Nächstes?" },
    ],
    caption: `Neun Karten, ein Grün.

M-Bisaflor EX ist von 2016, Ogerpon-ex von 2025 — neun Jahre und acht verschiedene Sets liegen dazwischen, und auf der Seite sieht man davon nichts. Weil die Farbe passt.

Genau das kann ein Binder, was eine Vitrine nicht kann: Karten zusammenbringen, die sonst nie nebeneinanderliegen würden. 97 € für alle neun.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Welche Farbe sollen wir als Nächstes bauen?`,
    captionKurz: `M-Bisaflor EX von 2016 neben Ogerpon-ex von 2025 — neun Jahre dazwischen, und auf der Seite sieht man davon nichts. 97 € für neun Karten.

Welche Farbe als Nächstes?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#ogerpon", "#pokemontcg", "#binderplan"],
  },

  /**
   * „Eine Karte, und die Seite drumherum" — Feelinara ex aus dem 30-Jahre-Set
   * in der Mitte, acht Karten im selben Rosa außen.
   *
   * Der Anker ist so neu, dass die Bildanalyse ihn noch nicht kennt; die
   * Farben stammen deshalb aus dem Scan selbst (#d0879d, #d6a490, #c38489).
   * Hier zählt nur die Passung, nicht der Preis — dass die acht zusammen
   * trotzdem 92 € kosten, ist ein Nebenbefund und steht in der Caption.
   */
  /**
   * „Bisasam bleibt im Dschungel." Die Entwicklungsreihe als Post-Art A.
   *
   * Die Seite aus der Vitrine trägt Bisasam, Bisaknosp und Bisaflor; das Grün
   * wird von oben nach unten dichter, die Entwicklung läuft mit dem Bild. Der
   * Nutzwert steht im Schluss: Nach Setnummer sortiert stehen die drei auf drei
   * verschiedenen Seiten — der häufigste Fehler im Ordner und der einzige, der
   * nichts kostet außer einem Abend.
   */
  bisaflor: {
    titel: "Bisasam bleibt im Dschungel",
    artworks: ["luFp3Ss3iCi_"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "binder", seite: "luFp3Ss3iCi_", nur: [2] }, dauerMs: 2800, stil: "hook", zeig: "Eine Karte,\nacht Lücken." },
      { art: "wandel", von: { art: "binder", seite: "luFp3Ss3iCi_", nur: [2] }, bis: { art: "binder", seite: "luFp3Ss3iCi_" }, haltMs: 700, dauerMs: 4000, zeig: "Oder die Seite\nwächst drumherum." },
      { art: "fahrt", seite: "luFp3Ss3iCi_", vonFach: 6, bisFach: 2, dauerMs: 4000, zeig: "Bisasam, Bisaknosp,\nBisaflor." },
      { art: "stand", bild: { art: "ganz", seite: "luFp3Ss3iCi_" }, dauerMs: 3400, zeig: "Ein Motiv,\nneun Fächer." },
      { art: "stand", bild: { art: "binder", seite: "luFp3Ss3iCi_" }, dauerMs: 3200, stil: "schluss", zeig: "Welche Reihe\nliegt bei dir?" },
    ],
    caption: `Eine Karte, acht Lücken — so fängt jede Seite an.

Drei Stufen, ein Motiv: oben das lichte Grün, unten das dichte Unterholz. Die Entwicklung läuft mit dem Bild, man liest sie, ohne die Nummern zu prüfen.

Nach Setnummer sortiert stehen Bisasam, Bisaknosp und Bisaflor auf drei verschiedenen Seiten. Das halte ich für den häufigsten Fehler im Ordner — und für den einzigen, der nichts kostet außer einem Abend.

Ausgedruckt in 63 × 88 mm, die Kartenfächer bleiben frei.

Welche Entwicklungsreihe liegt bei dir zusammen?`,
    captionKurz: `Drei Stufen, ein Motiv über neun Fächer. Nach Setnummer sortiert stünden sie auf drei Seiten.

Welche Reihe liegt bei dir zusammen?`,
    hashtags: ["#bisaflor", "#pokemon151", "#binderart", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Drei Mauzi, eine Gasse." Regionalformen auf einer Seite.
   *
   * Kanto, Alola und Galar tragen dasselbe Pokémon in drei Fassungen — im
   * Katalog liegen sie Jahrzehnte auseinander, im Ordner deshalb auf drei
   * Seiten. Die Vitrine-Seite legt sie über Eck in eine einzige Gasse. Der
   * Beitrag ist der Beleg dafür, dass Zugehörigkeit nichts mit Setnummern zu
   * tun hat.
   */
  mauzigasse: {
    titel: "Drei Mauzi, eine Gasse",
    artworks: ["oGTiqnIKyVjU"],
    musik: "prettyjohn1-pop-pop-music-503314.mp3",
    clips: [
      { art: "stand", bild: { art: "binder", seite: "oGTiqnIKyVjU" }, dauerMs: 2800, stil: "hook", zeig: "Ein Pokémon.\nDrei Regionen." },
      { art: "fahrt", seite: "oGTiqnIKyVjU", vonFach: 6, bisFach: 2, dauerMs: 4200, zeig: "Über Eck gelegt,\nnicht nach Nummer." },
      { art: "stand", bild: { art: "ganz", seite: "oGTiqnIKyVjU" }, dauerMs: 3400, zeig: "Dazwischen läuft\neine ganze Gasse." },
      { art: "wandel", von: { art: "ganz", seite: "oGTiqnIKyVjU" }, bis: { art: "binder", seite: "oGTiqnIKyVjU" }, haltMs: 600, dauerMs: 3800, zeig: "Sechs Fächer\nbleiben frei." },
      { art: "stand", bild: { art: "binder", seite: "oGTiqnIKyVjU" }, dauerMs: 3200, stil: "schluss", zeig: "Welche drei\ngehören zusammen?" },
    ],
    caption: `Ein Pokémon. Drei Regionen.

Kanto, Alola, Galar — im Katalog liegen die drei Mauzi Jahrzehnte auseinander, im Ordner deshalb meistens auf drei Seiten. Hier stehen sie über Eck in einer einzigen Gasse: Wäscheleinen, Treppen, Blumentöpfe dazwischen.

Zugehörigkeit hat nichts mit Setnummern zu tun. Das ist der ganze Punkt einer geplanten Seite — du entscheidest vorher, welche Karten nebeneinander liegen, und lässt die restlichen Fächer frei.

Welche drei Karten gehören bei dir zusammen, obwohl die Nummern es nicht sagen?`,
    captionKurz: `Kanto, Alola, Galar — dasselbe Pokémon, im Ordner meistens auf drei Seiten. Hier über Eck in einer Gasse.

Welche drei gehören bei dir zusammen?`,
    hashtags: ["#mauzi", "#meowth", "#binderart", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Schiggy geht ins Wasser." Die dritte Starter-Seite als Post-Art A.
   *
   * Oben der Strand, in der Mitte flaches Wasser, unten das Riff: Das Motiv
   * wird von oben nach unten dunkler, und die Entwicklung läuft mit. Man liest
   * die Reihenfolge am Bild, nicht an den Nummern — genau der Punkt, den eine
   * geplante Seite gegenüber der Sortierung nach Setnummer hat.
   */
  turtok: {
    titel: "Schiggy geht ins Wasser",
    artworks: ["oW6p_fCa7CgP"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "binder", seite: "oW6p_fCa7CgP" }, dauerMs: 2800, stil: "hook", zeig: "Oben Strand.\nUnten Riff." },
      { art: "fahrt", seite: "oW6p_fCa7CgP", vonFach: 0, bisFach: 8, dauerMs: 4200, zeig: "Dazwischen läuft\ndie Entwicklung." },
      { art: "stand", bild: { art: "ganz", seite: "oW6p_fCa7CgP" }, dauerMs: 3400, zeig: "Hell nach dunkel,\nvon selbst lesbar." },
      { art: "wandel", von: { art: "ganz", seite: "oW6p_fCa7CgP" }, bis: { art: "binder", seite: "oW6p_fCa7CgP" }, haltMs: 600, dauerMs: 3800, zeig: "Drei Stufen,\neine Seite." },
      { art: "stand", bild: { art: "binder", seite: "oW6p_fCa7CgP" }, dauerMs: 3200, stil: "schluss", zeig: "Welcher Starter\nliegt vorn?" },
    ],
    caption: `Oben Strand. Unten Riff.

Drei Stufen, ein Motiv: Schiggy am flachen Ufer, Schillok im offenen Wasser, Turtok unten am Riff. Das Bild wird von oben nach unten dunkler, und die Entwicklung läuft mit. Die Reihenfolge liest man, ohne eine einzige Nummer zu prüfen.

Genau das kann eine Setliste nicht. Nach Nummer sortiert stehen die drei irgendwo, und die Seite erzählt nichts.

Ausgedruckt in 63 × 88 mm, die Kartenfächer bleiben frei.

Welcher Starter liegt bei dir auf Seite eins?`,
    captionKurz: `Schiggy am Ufer, Schillok im Wasser, Turtok am Riff — die Reihenfolge liest man am Bild, nicht an den Nummern.

Welcher Starter liegt bei dir vorn?`,
    hashtags: ["#turtok", "#pokemon151", "#binderart", "#pokemonsammeln", "#binderplan"],
  },

  feelinara: {
    titel: "Eine Karte, und die Seite drumherum",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["cel30-153"], sichtbar: 1, spalten: 1, zeilen: 1 },
        dauerMs: 3000, stil: "hook", zeig: "Diese Karte kommt\nerst am Mittwoch." },
      { art: "fuellung", karten: FEELINARA_SEITE.karten, bis: 9,
        dauerMs: 5600, zeig: "Die Seite steht\nschon." },
      { art: "stand", bild: { art: "karten", karten: FEELINARA_SEITE.karten, sichtbar: 9 },
        dauerMs: 3400, zeig: "Acht Karten,\ndasselbe Rosa." },
      { art: "stand", bild: { art: "karten", karten: FEELINARA_SEITE.karten, sichtbar: 9 },
        dauerMs: 3400, stil: "schluss", zeig: "Wer legt sie\neinzeln ab?" },
    ],
    caption: `Diese Karte kommt erst am Mittwoch.

Die Seite steht trotzdem schon. Feelinara ex aus dem 30-Jahre-Set in der Mitte, acht Karten im selben Rosa drumherum: Psiana V und Mega-Dragoran-ex als kräftige Ecken, dazu vier ruhige Illustration Rares aus Stellarkrone.

Genau dafür plane ich Seiten vorher. Wer erst sortiert, wenn die Karte da ist, legt sie irgendwohin, wo Platz ist — und da bleibt sie dann.

Cardmarket, 30-Tage-Schnitt, Stand 14.09.

Wer legt seine Lieblingskarte wirklich einzeln ab?`,
    captionKurz: `Feelinara ex kommt erst Mittwoch — die Seite steht schon: acht Karten im selben Rosa drumherum.

Wer legt seine Lieblingskarte einzeln ab?`,
    hashtags: ["#feelinara", "#sylveon", "#30thcelebration", "#binderart", "#pokemonsammeln", "#binderplan"],
  },
  // --- Content-Plan 21.09.–04.10.2026 (docs/CONTENT_PLAN_2026-09-21.md) ------

  /**
   * „Gleiches Bild. 12× der Preis." Dieselbe Crystal-Lugia zweimal: das
   * Original aus Aquapolis (2002) und der Nachdruck im 30th Celebration mit
   * Jubiläumsstempel. Preise avg30 vom 20.09.2026: 3.002 € gegen 254 €.
   */
  "duell-lugia": {
    titel: "Gleiches Bild. 12× der Preis.",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["ecard2-149", "cel30-h7"], sichtbar: 2, spalten: 2, zeilen: 1 },
        dauerMs: 2600, stil: "hook", zeig: "Gleiches Bild.\n12× der Preis." },
      { art: "stand", bild: { art: "karten", karten: ["ecard2-149", "cel30-h7"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["Aquapolis 2002", "30 Jahre 2026"] },
        dauerMs: 3600, zeig: "Links das Original,\nrechts der Nachdruck." },
      { art: "stand", bild: { art: "karten", karten: ["ecard2-149", "cel30-h7"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["Aquapolis 2002", "30 Jahre 2026"] },
        dauerMs: 2600, zeig: "Was ist der Stempel wert?" },
      { art: "stand", bild: { art: "karten", karten: ["ecard2-149", "cel30-h7"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["3.002 €", "254 €"] },
        dauerMs: 3400, zeig: "2.748 €.\nFür ein Jahr auf der Karte." },
      { art: "stand", bild: { art: "karten", karten: ["ecard2-149", "cel30-h7"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["3.002 €", "254 €"] },
        dauerMs: 3200, stil: "schluss", zeig: "Original oder Nachdruck —\nwas kommt ins Fach?" },
    ],
    caption: `Gleiches Bild. 12× der Preis.

Links die Crystal-Lugia aus Aquapolis von 2002, rechts dieselbe Karte als Nachdruck im 30-Jahre-Set — mit Jubiläumsstempel, sonst identisch. 3.002 € gegen 254 €.

Ich hab den Nachdruck ins Fach gelegt und bereue nichts. Die Seite sieht exakt gleich aus, und für die Differenz bekomme ich den Rest des Binders.

Cardmarket, 30-Tage-Schnitt, Stand 20.09.

Original oder Nachdruck — was kommt bei dir ins Fach?`,
    captionKurz: `Dieselbe Lugia: Aquapolis 2002 für 3.002 €, Nachdruck im 30-Jahre-Set für 254 €. Original oder Nachdruck?`,
    hashtags: ["#lugia", "#aquapolis", "#30thcelebration", "#pokemonvintage", "#pokemonsammeln", "#binderplan"],
  },

  /** „Welche ist teurer?" — Nachtara VMAX Alt Art (2021) gegen Nachtara Skyridge (2003). Fast jeder tippt Skyridge. */
  "duell-nachtara": {
    titel: "Welche ist teurer? Nachtara 2021 gegen 2003",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["swsh7-215", "ecard3-32"], sichtbar: 2, spalten: 2, zeilen: 1 },
        dauerMs: 2600, stil: "hook", zeig: "Welche ist\nteurer?" },
      { art: "stand", bild: { art: "karten", karten: ["swsh7-215", "ecard3-32"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["Evolving Skies 2021", "Skyridge 2003"] },
        dauerMs: 3600, zeig: "Links 2021,\nrechts 2003." },
      { art: "stand", bild: { art: "karten", karten: ["swsh7-215", "ecard3-32"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["Evolving Skies 2021", "Skyridge 2003"] },
        dauerMs: 2600, zeig: "Denk kurz nach." },
      { art: "stand", bild: { art: "karten", karten: ["swsh7-215", "ecard3-32"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["1.812 €", "1.531 €"] },
        dauerMs: 3400, zeig: "Die neue.\nUm 281 €." },
      { art: "stand", bild: { art: "karten", karten: ["swsh7-215", "ecard3-32"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["1.812 €", "1.531 €"] },
        dauerMs: 3200, stil: "schluss", zeig: "Wie hast du\ngetippt?" },
    ],
    caption: `Welche ist teurer?

Links das Nachtara VMAX Alt Art aus Evolving Skies, 2021. Rechts Nachtara aus Skyridge, 2003 — eines der seltensten Sets der WotC-Zeit. Fast jeder tippt rechts.

1.812 € gegen 1.531 €. Die neue gewinnt. Nicht weil sie seltener wäre, sondern weil zehntausend Leute genau diese Illustration wollen und nicht irgendein Nachtara.

Cardmarket, 30-Tage-Schnitt, Stand 20.09.

Wie hast du getippt?`,
    captionKurz: `Nachtara VMAX Alt Art (2021) oder Nachtara Skyridge (2003) — welche ist teurer? Fast jeder tippt falsch. Wie hast du getippt?`,
    hashtags: ["#nachtara", "#pokemonquiz", "#evolvingskies", "#skyridge", "#pokemonsammeln", "#binderplan"],
  },

  /** Reserve: Mew-ex SIR aus 151 gegen das Schimmernde Mew von 2017. */
  "duell-mew": {
    titel: "Welche ist teurer? Mew 2023 gegen 2017",
    artworks: [],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: ["sv04.5-232", "sm3.5-40"], sichtbar: 2, spalten: 2, zeilen: 1 },
        dauerMs: 2600, stil: "hook", zeig: "Welche ist\nteurer?" },
      { art: "stand", bild: { art: "karten", karten: ["sv04.5-232", "sm3.5-40"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["151 · 2023", "Shining Legends 2017"] },
        dauerMs: 3600, zeig: "Links 151,\nrechts das Schimmernde." },
      { art: "stand", bild: { art: "karten", karten: ["sv04.5-232", "sm3.5-40"], sichtbar: 2, spalten: 2, zeilen: 1,
        namen: ["151 · 2023", "Shining Legends 2017"] },
        dauerMs: 2600, zeig: "Denk kurz nach." },
      { art: "stand", bild: { art: "karten", karten: ["sv04.5-232", "sm3.5-40"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["864 €", "205 €"] },
        dauerMs: 3400, zeig: "Mew-ex.\nUm 659 €." },
      { art: "stand", bild: { art: "karten", karten: ["sv04.5-232", "sm3.5-40"], sichtbar: 2, spalten: 2, zeilen: 1,
        preise: ["864 €", "205 €"] },
        dauerMs: 3200, stil: "schluss", zeig: "Wie hast du\ngetippt?" },
    ],
    caption: `Welche ist teurer?

Links die Mew-ex Special Illustration Rare aus 151, 2023. Rechts das Schimmernde Mew aus Shining Legends, 2017 — die Karte, die damals jeder wollte.

864 € gegen 205 €. Die 151er-Illustration kostet das Vierfache. Sechs Jahre reichen, und der Chase von damals ist die zweite Wahl.

Cardmarket, 30-Tage-Schnitt, Stand 20.09.

Wie hast du getippt?`,
    captionKurz: `Mew-ex aus 151 oder das Schimmernde Mew von 2017 — welche ist teurer? Die Antwort überrascht die meisten. Wie hast du getippt?`,
    hashtags: ["#mew", "#pokemon151", "#pokemonquiz", "#shiningpokemon", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „9 Schimmernde. Eine Seite." Die ersten Shinys des Spiels — Neo Revelation
   * und Neo Destiny, 2001/2002 — auf einer Seite, Summe 6.916 € (avg30, 20.09.2026).
   * Kein Set-Logo: Zwei Sets, und TCGdex liefert für beide nur 200 px.
   */
  "seitenwert-schimmernd": {
    titel: "9 Schimmernde. Eine Seite. 6.916 €.",
    artworks: [],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "karten", karten: SCHIMMERND.karten, sichtbar: 9 },
        dauerMs: 2700, stil: "hook", zeig: "9 Schimmernde.\nEine Seite." },
      { art: "fuellung", karten: aufsteigend(SCHIMMERND).karten, bis: 8, preise: aufsteigend(SCHIMMERND).preise,
        dauerMs: 5400, zeig: "Neo Revelation, Neo Destiny.\n2001 bis 2002." },
      { art: "stand", bild: { art: "karten", karten: [SCHIMMERND.karten[0]!], sichtbar: 1, spalten: 1, zeilen: 1, preise: ["1.664 €"] },
        dauerMs: 3000, zeig: "Glurak allein:\n1.664 €." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(SCHIMMERND).karten, sichtbar: 9, preise: aufsteigend(SCHIMMERND).preise },
        dauerMs: 3600, zeig: "6.916 €.\nEine Seite." },
      { art: "stand", bild: { art: "karten", karten: aufsteigend(SCHIMMERND).karten, sichtbar: 9 },
        dauerMs: 3400, stil: "schluss", zeig: "Was liegt auf deiner\nteuersten Seite?" },
    ],
    caption: `9 Schimmernde. Eine Seite.

Die Schimmernden aus Neo Revelation und Neo Destiny waren die ersten Shinys im Spiel — 2001, bevor es das Wort gab. Neun davon auf einer Seite: 6.916 €.

Das billigste Fach ist das Karpador mit 365 €. Das teuerste Glurak mit 1.664 €. Und ganz ehrlich: das Garados ist die schönste Karte der Seite, und sie steht nur auf Platz drei.

Cardmarket, 30-Tage-Schnitt, Stand 20.09.

Was liegt auf deiner teuersten Seite?`,
    captionKurz: `Neun Schimmernde aus Neo Revelation und Neo Destiny auf einer Seite: 6.916 €. Das Karpador ist das billigste Fach. Was liegt auf deiner teuersten Seite?`,
    hashtags: ["#shiningpokemon", "#neodestiny", "#pokemonvintage", "#wotc", "#pokemonsammeln", "#binderplan"],
  },

  /**
   * „Ein Mew. Eine Seite." Vitrine-Seite „30th Mew" (Binder EnMd-5TPGuQ,
   * Seite 14): **eine** Ankerkarte — Mew ex 152 aus dem 30th Celebration in
   * der Mitte, der Wald drumherum gemalt. Der Plan sprach von drei RGB-Mew;
   * das gibt die Seite nicht her (am 21.09. am Bild geprüft).
   */
  "kunst-mew30": {
    titel: "Ein Mew. Eine Seite.",
    artworks: ["6Wb7ebbU-H7B"],
    setLogo: "cel30-setlogo.png",
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "ganz", seite: "6Wb7ebbU-H7B" }, dauerMs: 2800, stil: "hook", zeig: "Ein Mew.\nEine Seite." },
      { art: "wandel", von: { art: "ganz", seite: "6Wb7ebbU-H7B" }, bis: { art: "binder", seite: "6Wb7ebbU-H7B" }, haltMs: 700, dauerMs: 4000, zeig: "Die Karte ist echt,\nder Wald ist gemalt." },
      { art: "fahrt", seite: "6Wb7ebbU-H7B", vonFach: 0, bisFach: 8, dauerMs: 4000, zeig: "Mew ex aus dem 30-Jahre-Set,\nSpecial Illustration Rare." },
      { art: "stand", bild: { art: "ganz", seite: "6Wb7ebbU-H7B" }, dauerMs: 3400, zeig: "Ein Motiv,\nneun Fächer." },
      { art: "stand", bild: { art: "binder", seite: "6Wb7ebbU-H7B" }, dauerMs: 3200, stil: "schluss", zeig: "Schick das dem,\nder eins gezogen hat." },
    ],
    caption: `Ein Mew. Eine Seite.

Das Mew ex aus dem 30-Jahre-Set, allein in der Mitte — der Wald drumherum ist gemalt und führt das Kartenbild über alle neun Fächer weiter. Im Binder sieht man die Fächer kaum noch.

Ein Motiv über neun Fächer, gedruckt in 63 × 88 mm, das Kartenfach in der Mitte bleibt frei für die echte. Wer die Karte hat, hat die Seite.

Schick das dem, der eins gezogen hat.`,
    captionKurz: `Mew ex aus dem 30-Jahre-Set in der Mitte, der Wald über neun Fächer gemalt. Schick das dem, der eins gezogen hat.`,
    hashtags: ["#mew", "#30thcelebration", "#pokemon30", "#binderart", "#pokemonbinder", "#binderplan"],
  },

  /**
   * „Nicht meine Seite." Vitrine-Seite „Lucia Flower Garden" (Konto 97,
   * öffentlich): Lucia oben rechts, Imantis in der Mitte, Mantirps unten
   * links, dazwischen ein gemalter Garten am See mit Togekiss. Eine
   * **Nutzerseite** — der Beitrag sagt das offen, kein Name.
   */
  "kunst-nutzer": {
    titel: "Nicht meine Seite.",
    artworks: ["PuXX18XATHs5"],
    musik: "prettyjohn1-pop-pop-music-503314.mp3",
    clips: [
      { art: "stand", bild: { art: "ganz", seite: "PuXX18XATHs5" }, dauerMs: 2800, stil: "hook", zeig: "Nicht meine\nSeite." },
      { art: "wandel", von: { art: "ganz", seite: "PuXX18XATHs5" }, bis: { art: "binder", seite: "PuXX18XATHs5" }, haltMs: 700, dauerMs: 4000, zeig: "Die hat jemand\nin der Vitrine gebaut." },
      { art: "fahrt", seite: "PuXX18XATHs5", vonFach: 6, bisFach: 2, dauerMs: 4200, zeig: "Mantirps, Imantis, Lucia —\nein Garten über neun Fächer." },
      { art: "stand", bild: { art: "ganz", seite: "PuXX18XATHs5" }, dauerMs: 3400, zeig: "Ich hätte die drei\nnie zusammengelegt." },
      { art: "stand", bild: { art: "binder", seite: "PuXX18XATHs5" }, dauerMs: 3200, stil: "schluss", zeig: "Welche drei würdest du\nin einen Garten setzen?" },
    ],
    caption: `Nicht meine Seite.

Die hat jemand anderes in der Vitrine gebaut: Mantirps, Imantis und Lucia in einem Blumengarten am See, der über alle neun Fächer geht — dazwischen ein gemaltes Togekiss. Drei Karten, die in keinem Set nebeneinander liegen; hier gehören sie zusammen.

Das ist der Teil, den ich am liebsten mag: Seiten, auf die ich selbst nie gekommen wäre. Die Vitrine ist voll davon, und jede lässt sich als Vorlage nehmen.

Welche drei würdest du in einen Garten setzen?`,
    captionKurz: `Nicht meine Seite — die hat jemand in der Vitrine gebaut. Mantirps, Imantis, Lucia in einem Garten. Welche drei würdest du zusammenlegen?`,
    hashtags: ["#binderart", "#pokemonbinder", "#imantis", "#pokemonsammeln", "#binderplan", "#tcgbinder"],
  },

  /**
   * „Schwarz. Weiß. Eine Seite." Vitrine „N's Reshiram & Zekrom": Ns Reshiram
   * (Reisegefährten) oben in der Mitte, Ns Zekrom (Promo) unten in der Mitte,
   * dazwischen eine gemalte Treppe aus Stein, Licht und Blitz.
   */
  "kunst-reshizek": {
    titel: "Schwarz. Weiß. Eine Seite.",
    artworks: ["rZ2MM1TdFyP9"],
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    clips: [
      { art: "stand", bild: { art: "ganz", seite: "rZ2MM1TdFyP9" }, dauerMs: 2800, stil: "hook", zeig: "Schwarz. Weiß.\nEine Seite." },
      { art: "wandel", von: { art: "ganz", seite: "rZ2MM1TdFyP9" }, bis: { art: "binder", seite: "rZ2MM1TdFyP9" }, haltMs: 700, dauerMs: 4000, zeig: "Reshiram oben,\nZekrom unten." },
      { art: "fahrt", seite: "rZ2MM1TdFyP9", vonFach: 1, bisFach: 7, dauerMs: 4200, zeig: "Die Karten sind echt,\ndie Treppe ist gemalt." },
      { art: "stand", bild: { art: "ganz", seite: "rZ2MM1TdFyP9" }, dauerMs: 3400, zeig: "Ein Motiv,\nneun Fächer." },
      { art: "stand", bild: { art: "binder", seite: "rZ2MM1TdFyP9" }, dauerMs: 3200, stil: "schluss", zeig: "Team Schwarz oder\nTeam Weiß?" },
    ],
    caption: `Schwarz. Weiß. Eine Seite.

Ns Reshiram aus Reisegefährten oben, Ns Zekrom als Promo unten — und dazwischen eine gemalte Treppe aus Stein, Licht und Blitz, die beide Drachen auf eine Seite zwingt. Im Set liegen sie nie nebeneinander.

Ein Motiv über neun Fächer, gedruckt in 63 × 88 mm, die beiden Kartenfächer bleiben frei für die echten.

Team Schwarz oder Team Weiß?`,
    captionKurz: `Ns Reshiram oben, Ns Zekrom unten, dazwischen eine gemalte Treppe über sieben Fächer. Team Schwarz oder Team Weiß?`,
    hashtags: ["#reshiram", "#zekrom", "#pokemonblackwhite", "#binderart", "#pokemonbinder", "#binderplan"],
  },

  /** Reserve: „Neun Fächer. Ein Baum." Vitrine „Beatori Cherry Trees" — Beatori-ex (Erhabene Helden) in der Mitte. */
  "kunst-kirsch": {
    titel: "Neun Fächer. Ein Baum.",
    artworks: ["aM86Tvkh0cB5"],
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    clips: [
      { art: "stand", bild: { art: "ganz", seite: "aM86Tvkh0cB5" }, dauerMs: 2800, stil: "hook", zeig: "Neun Fächer.\nEin Baum." },
      { art: "wandel", von: { art: "ganz", seite: "aM86Tvkh0cB5" }, bis: { art: "binder", seite: "aM86Tvkh0cB5" }, haltMs: 700, dauerMs: 4000, zeig: "Beatori-ex in der Mitte,\nder Baum drumherum." },
      { art: "fahrt", seite: "aM86Tvkh0cB5", vonFach: 0, bisFach: 8, dauerMs: 4000, zeig: "Die Karte ist echt,\ndie Blüten sind gemalt." },
      { art: "stand", bild: { art: "ganz", seite: "aM86Tvkh0cB5" }, dauerMs: 3400, zeig: "Ein Motiv,\nneun Fächer." },
      { art: "stand", bild: { art: "binder", seite: "aM86Tvkh0cB5" }, dauerMs: 3200, stil: "schluss", zeig: "Welche Karte würdest du\nunter den Baum legen?" },
    ],
    caption: `Neun Fächer. Ein Baum.

Beatori-ex aus Erhabene Helden in der Mitte, und der Kirschbaum von der Karte wächst über alle neun Fächer weiter. Ein Rosa, das im Binder sonst nirgends vorkommt.

Ein Motiv über neun Fächer, gedruckt in 63 × 88 mm, das Kartenfach in der Mitte bleibt frei.

Welche Karte würdest du unter den Baum legen?`,
    captionKurz: `Beatori-ex in der Mitte, der Kirschbaum über neun Fächer gemalt. Welche Karte würdest du unter den Baum legen?`,
    hashtags: ["#beatori", "#binderart", "#pokemonbinder", "#pokemonsammeln", "#binderplan", "#tcgbinder"],
  },

};

// --- Bildbausteine -----------------------------------------------------------

/** Ein Blatt als HTML-Schnipsel: Fächer mit Nähten, oder das Bild am Stück. */
function blattHtml(quellVar: string, breite: number, x: number, y: number, mitFaechern: boolean, nur?: number[]): string {
  const m = blattMasse(breite);
  const px = (n: number) => `${n.toFixed(2)}px`;
  const rahmen = `position:absolute;left:${px(x)};top:${px(y)};width:${px(breite)};height:${px(m.hoehe)}`;
  if (!mitFaechern) return `<div class="ganz" style="${rahmen};background-image:var(${quellVar});background-size:100% 100%"></div>`;
  const felder = Array.from({ length: 9 }, (_, i) => {
    const leer = nur ? !nur.includes(i) : false;
    const spalte = i % 3, zeile = Math.floor(i / 3);
    const versatz = `background-image:var(${quellVar});background-position:-${px(spalte * (m.fachB + m.fuge))} -${px(zeile * (m.fachH + m.fuge))};background-size:${px(breite)} ${px(m.hoehe)}`;
    return `<div class="fach${leer ? " leer" : ""}" style="${leer ? "" : versatz}"></div>`;
  }).join("");
  return `<div class="blatt" style="${rahmen};grid-template-columns:repeat(3,${px(m.fachB)});grid-template-rows:repeat(3,${px(m.fachH)});gap:${px(m.fuge)}">${felder}</div>`;
}

/**
 * Ein Blatt mit echten Kartenscans — dieselben Hüllen, aber jedes Fach trägt
 * ein eigenes Bild. Gefüllt wird von vorn; was fehlt, bleibt leere Hülle.
 *
 * Das Seitenverhältnis der Scans (660 × 920 = 0,7174) trifft die echte Karte
 * (63 / 88 = 0,7159) auf 0,2 % genau, der Scan füllt sein Fach also randlos.
 */
function kartenBlattHtml(vars: (i: number) => string, anzahl: number, sichtbar: number,
                         breite: number, x: number, y: number, spalten: number, zeilen: number,
                         preise?: (string | null)[], namen?: (string | null)[],
                         unscharf?: number,
                         /** Gesetzt heißt: die Karten fahren ein, jede zu ihrer Zeit. */
                         einschub?: { starts: number[]; dauerMs: number }): string {
  const m = blattMasse(breite, spalten, zeilen);
  const px = (n: number) => `${n.toFixed(2)}px`;
  // Die Unschaerfe liegt auf dem Blatt, nicht auf den einzelnen Faechern: so
  // verwischen Karte und Preisschild gemeinsam und die Kanten bleiben weich.
  const rahmen = `position:absolute;left:${px(x)};top:${px(y)};width:${px(breite)};height:${px(m.hoehe)}`
    + (unscharf ? `;filter:blur(${unscharf}px)` : "");
  // Das Schild skaliert mit dem Fach, sonst ist es im 3×3 winzig und im 1×1 plump.
  const schildPx = Math.min(54, Math.max(17, Math.round(m.fachB * 0.125)));
  const schild = (i: number) => {
    const t = preise?.[i];
    return t ? `<span class="preis" style="font-size:${schildPx}px">${t}</span>` : "";
  };
  // Das Namensschild sitzt oben und ist kleiner als der Preis: es beantwortet nur
  // „welche Karte ist das", wo die Vorderseite es nicht selbst tut.
  const namensschild = (i: number) => {
    const t = namen?.[i];
    return t ? `<span class="kname" style="font-size:${Math.round(schildPx * 0.66)}px">${t}</span>` : "";
  };
  const felder = Array.from({ length: spalten * zeilen }, (_, i) => {
    if (i >= anzahl) return `<div class="fach leer"></div>`;
    // Karte ohne Scan: leere Huelle, aber mit Schild — das ist die Aussage.
    if (i >= sichtbar) return `<div class="fach leer"></div>`;
    const neu = i === sichtbar - 1 && sichtbar < anzahl && !einschub ? " neu" : "";
    // Richtung wie in `binderbuehne.OEFFNUNG`: die letzte Spalte von links,
    // alle anderen von rechts. Bei zwei Karten (Duell) heißt das: außen nach innen.
    const richtung = (i % spalten) === spalten - 1 && spalten > 1 ? "links" : "rechts";
    const lauf = einschub
      ? ` rein ${richtung}" style="background-image:var(${vars(i)});animation-delay:${einschub.starts[i] ?? 0}ms;--dauer:${einschub.dauerMs}ms`
      : `" style="background-image:var(${vars(i)})`;
    return `<div class="fach voll${neu}">${namensschild(i)}${schild(i)}<div class="karte${lauf}"></div></div>`;
  }).join("");
  return `<div class="blatt" style="${rahmen};grid-template-columns:repeat(${spalten},${px(m.fachB)});grid-template-rows:repeat(${zeilen},${px(m.fachH)});gap:${px(m.fuge)}">${felder}</div>`;
}

/**
 * Die Bühne: unscharfer Grund aus der Seite, darauf ein oder drei Blätter.
 *
 * Die Kunstseiten stehen als CSS-Variablen im Kopf, **einmal je Seite**. Beim
 * ersten Versuch trug jedes der neun Fächer seine eigene `data:`-URL im
 * Stil-Attribut — bei drei Blättern waren das 27 Kopien eines mehrere Megabyte
 * großen Bildes, und der Renderer starb wortlos („Target page … has been
 * closed"). Dazu laufen die Seiten verkleinert auf 1000 px Breite ins HTML;
 * das Blatt ist im Reel höchstens 900 px breit, die Fahrt nimmt ohnehin das
 * Original.
 */
/**
 * Die Marke, wie sie in tokens.css des Produkts steht — nicht nachempfunden.
 * `--marke-blau`, `--marke-gelb`, `--kontur`, `--seite-dunkel` und der dunkle
 * Grund `--bg` des dunklen Themas. Gelb taucht hier bewusst nicht als Flaeche
 * auf: in app.css steht „Besitz ist der einzige gelbe Zustand"; im Produkt
 * heisst Gelb „hab ich". Der gelbe Strich ueber dem Text kommt aus dem
 * Brandkit und bleibt der einzige gelbe Akzent.
 */
const MARKE = { blau: "#2A4B9B", kontur: "#14161C", seiteDunkel: "#14161a", grund: "#12141A" };

function buehneHtml(vars: string, grundVar: string, blaetter: string, zusatz = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    :root{${vars}}
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:${MARKE.grund};overflow:hidden}
    .grund{position:absolute;inset:-60px;background-image:var(${grundVar});background-size:cover;background-position:center;
           filter:blur(46px) brightness(.44) saturate(.7)}
    .blatt{display:grid}
    .ganz{border-radius:8px;box-shadow:0 10px 34px rgba(0,0,0,.6)}
    /* Das Fach ist die **Tasche**, die Karte liegt darin — seit dem 21.09.2026,
       damit auch die Ranglisten- und Duell-Reels die Einschub-Bewegung zeigen.
       overflow:hidden ist der ganze Trick: die Karte startet außerhalb und
       wird von der Tasche beschnitten, statt über das Blatt zu ragen. */
    .fach{position:relative;border-radius:6px;overflow:hidden;
          box-shadow:0 6px 22px rgba(0,0,0,.55), inset 0 0 0 1.5px rgba(255,255,255,.16)}
    .fach > .karte{position:absolute;inset:0;border-radius:6px;background-repeat:no-repeat;
          background-size:100% 100%;background-position:center}
    /* Linke und mittlere Spalte von rechts, rechte von links — die Öffnungen
       zeigen zur Seitenmitte, wie bei den Einschub-Reels (binderbuehne.ts). */
    /* Angehalten: gerendert wird Bild für Bild, und der Zustand wird über ein
       negatives animation-delay angesprungen. Ohne den Halt liefe die Animation
       in Echtzeit weiter, und nach dem ersten Screenshot wären alle Karten drin
       (21.09.2026 genau so passiert). */
    .fach > .karte.rein{animation:var(--rein) var(--dauer,620ms) cubic-bezier(.22,.9,.24,1.06) forwards;
          animation-play-state:paused}
    .fach > .karte.rein.links{--rein:reinLinks;transform:translateX(-116%)}
    .fach > .karte.rein.rechts{--rein:reinRechts;transform:translateX(116%)}
    @keyframes reinLinks{from{transform:translateX(-116%)}to{transform:translateX(0)}}
    @keyframes reinRechts{from{transform:translateX(116%)}to{transform:translateX(0)}}
    /* Die zuletzt gelegte Karte bekommt einen hellen Saum. Eine CSS-Animation
       waere hier falsch: jedes Bild ist ein eigener Render und stuende bei 0 %,
       die Karte waere also in jedem Einzelbild unsichtbar. Der wandernde Saum
       macht beim Abspielen dasselbe sichtbar — welches Fach neu dazukam. */
    .fach.neu{box-shadow:0 6px 26px rgba(0,0,0,.6), inset 0 0 0 3px rgba(255,255,255,.85)}
    /* Ein leeres Fach ist kein Loch, sondern eine Hülle vor dem dunklen Blatt. */
    /* Leeres Fach: --seite-dunkel des Produkts, Rand wie .slot.frei im dunklen
       Thema (rgba(255,255,255,.18) in app.css). */
    .fach.leer{background:linear-gradient(150deg,#1c1f27 0%,${MARKE.seiteDunkel} 60%,#0f1116 100%);
               box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.18), inset 0 12px 30px rgba(0,0,0,.55)}
    /* Der Glanz der Hülle: eine schmale Diagonale, sonst wirkt es wie aufgeklebtes Papier. */
    /* Das Set-Logo als eigene Ebene ueber dem Blatt, oben mittig. Es ist
       freigestellt (PNG mit Alpha), deshalb traegt es einen Schlagschatten —
       auf einer hellen Karte verschwaende das Gold sonst im Untergrund. */
    .setlogo{position:absolute;left:50%;transform:translateX(-50%);top:3.5%;
             width:47%;aspect-ratio:2173/1200;background-size:contain;
             background-repeat:no-repeat;background-position:center;
             filter:drop-shadow(0 10px 26px rgba(0,0,0,.75)) drop-shadow(0 2px 5px rgba(0,0,0,.6))}
    /* Schilder am Fach — genau wie im Produkt.
       .slot .preis in app.css ist dort ein dunkles Schild (--kontur #14161C)
       mit weisser Schrift, 3 px Radius, unten rechts am Fach, und es ist nur so
       breit wie seine Zahl. Genau das steht hier.

       Kein gelbes Preisschild, auch wenn es knalliger waere: in app.css steht
       „Besitz ist der einzige gelbe Zustand — er soll auf einen Blick zaehlbar
       sein". Gelb heisst im Produkt „hab ich", nicht „kostet". Ein goldener
       Aufkleber haette die eigene Regel gebrochen.

       Schrift ist Archivo wie im Produkt (body in app.css), nicht die
       Condensed der uebrigen Reel-Bausteine. Gegenueber der App groesser und
       mit Schlagschatten — auf Video und ueber glaenzenden Karten traegt ein
       1-px-Schild sonst nicht. */
    .preis{position:absolute;z-index:3;right:3.5%;bottom:3.5%;
           font-family:Archivo,'Trebuchet MS',system-ui,sans-serif;font-weight:800;
           color:#fff;background:${MARKE.kontur};border-radius:3px;
           padding:.16em .42em;letter-spacing:.005em;line-height:1.18;
           box-shadow:0 3px 12px rgba(0,0,0,.55), inset 0 0 0 1.5px ${MARKE.blau}}
    /* Der Name steht nur dort, wo die Vorderseite ihn nicht selbst zeigt — also
       auf den Rueckseiten. Oben links, wie .rmark unten links im Produkt. */
    .kname{position:absolute;z-index:3;left:3.5%;top:3.5%;white-space:nowrap;
           font-family:Archivo,'Trebuchet MS',system-ui,sans-serif;font-weight:600;
           color:#fff;background:${MARKE.blau};border-radius:3px;
           padding:.14em .42em;letter-spacing:.005em;line-height:1.18;
           box-shadow:0 3px 12px rgba(0,0,0,.6), inset 0 0 0 1.5px rgba(255,255,255,.4)}
    .fach::after{content:"";position:absolute;inset:0;border-radius:6px;
                 background:linear-gradient(118deg,rgba(255,255,255,.17) 0%,rgba(255,255,255,.03) 26%,
                            rgba(255,255,255,0) 46%,rgba(255,255,255,.07) 84%,rgba(255,255,255,0) 100%)}
  </style></head><body><div class="grund"></div>${blaetter}${zusatz}</body></html>`;
}

/** Breite und oberer Rand eines einzelnen Blatts — unten bleibt Platz für den Text. */
const SEITE_B = 900, SEITE_Y = 148;
/**
 * Drei Blätter nebeneinander: die Reihe misst 1060 px und sitzt in der oberen
 * Bildhälfte, damit unten der Text Platz hat. Beim ersten Lauf war sie 1016 px
 * breit und begann schon bei 470 px — die Blätter wirkten verloren.
 */
const DREI_B = 340, DREI_LUECKE = 20, DREI_Y = 600;

function bildHtml(bild: Bild, varName: (seite: string) => string, vars: () => string,
                  kartenVars?: (karten: string[], sichtbar: number) => { def: string; name: (i: number) => string }): string {
  // Die RGB-Bühne kennt keine Kunstseite und kein Blatt — sie baut ihr Bild selbst.
  if (bild.art === "rgb") return rgbBildHtml(bild.farbe, bild.seite, bild.logo, bild.beleg);
  if (bild.art === "rgbdrei") return rgbDreiHtml(bild.logo);
  if (bild.art === "beleg") return blitzHtml(bild.datei);
  if (bild.art === "karten") {
    const spalten = bild.spalten ?? 3, zeilen = bild.zeilen ?? 3;
    const k = kartenVars!(bild.karten, bild.sichtbar);
    const m = blattMasse(SEITE_B, spalten, zeilen);
    // Das Blatt mittig stellen: ein 4×4-Raster ist hoeher als ein 3×3, ohne
    // Ausgleich rutscht es in den Textbereich.
    //
    // Ohne Deckel auf SEITE_Y: ein flaches Blatt (2×1) ist nur 609 px hoch und
    // klebte mit dem Deckel oben am Rand, darunter stand eine tote Lücke von
    // gut 500 px. Für die hohen Raster ändert der Wegfall nichts — deren
    // mittige Lage liegt ohnehin über SEITE_Y (3×3 und 4×4 bei 104, 1×1 bei 97).
    const y = Math.max(96, (H - 470 - m.hoehe) / 2);
    const blatt = kartenBlattHtml(k.name, Math.min(bild.karten.length, spalten * zeilen), bild.sichtbar,
      SEITE_B, (W - SEITE_B) / 2, y, spalten, zeilen,
      bild.preise, bild.namen, bild.unscharf, bild.einschub);
    const logo = bild.logo ? `<div class="setlogo" style="background-image:${markeUrl(bild.logo)}"></div>` : "";
    return buehneHtml(k.def, "--grund", blatt, logo);
  }
  if (bild.art === "drei") {
    const gesamt = 3 * DREI_B + 2 * DREI_LUECKE;
    const blaetter = bild.seiten.map((s, i) =>
      blattHtml(varName(s), DREI_B, (W - gesamt) / 2 + i * (DREI_B + DREI_LUECKE), DREI_Y, true)).join("");
    return buehneHtml(vars(), varName(bild.seiten[1] ?? bild.seiten[0]!), blaetter);
  }
  const mitte = (W - SEITE_B) / 2;
  const blatt = blattHtml(varName(bild.seite), SEITE_B, mitte, SEITE_Y, bild.art === "binder", bild.art === "binder" ? bild.nur : undefined);
  return buehneHtml(vars(), varName(bild.seite), blatt);
}

// --- Text --------------------------------------------------------------------

function textHtml(zeig: string, stil: Stil, akzent: string): string {
  const gross = stil === "hook";
  /**
   * Drei Groessen statt zwei. 54 px waren auf dem Handy im Feed zu klein — die
   * Zeile las sich erst, wenn der Daumen schon weiter war. 62 px ist die
   * Obergrenze, bei der die laengste Zeile des Stuecks („Die ersten Preise sind
   * da.", 26 Zeichen) noch in die 896 px Textbreite passt, ohne umzubrechen und
   * damit in die unterste Fachreihe zu wachsen.
   *
   * Der Schluss bekommt 72 px: die Frage am Ende ist der Aufruf, sie darf
   * groesser stehen als eine Zwischenzeile. Ihre Zeilen sind kurz genug dafuer.
   */
  const px = gross ? 86 : stil === "schluss" ? 72 : 62;
  const zeilen = zeig.split("\n").map((z) => `<span>${z}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .flaeche{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;
             padding:0 96px 470px 88px}
    /* Der Schleier trägt den Text auch über hellen Seiten. Die erste Rampe
       (960 px, 82→62→0) ließ bei der Kinderzimmer-Seite nur 35 % Schwärze unter
       der Textzeile stehen — weiße Schrift auf hellem Holzboden. */
    .schleier{position:absolute;left:0;right:0;bottom:0;height:1200px;
              background:linear-gradient(to top,rgba(0,0,0,.9) 0%,rgba(0,0,0,.78) 30%,
                         rgba(0,0,0,.45) 58%,rgba(0,0,0,0) 100%)}
    .text{position:relative;display:flex;flex-direction:column;gap:10px;
          font-family:${gross ? "'Bungee'" : "'Archivo'"},system-ui,sans-serif;
          font-weight:${gross ? 400 : 800};
          font-size:${px}px;
          line-height:${gross ? 1.06 : 1.18};
          letter-spacing:${gross ? "-.01em" : "0"};
          color:#fff;
          text-shadow:0 4px 26px rgba(0,0,0,.92), 0 2px 6px rgba(0,0,0,.8);
          text-transform:${gross ? "uppercase" : "none"}}
    .strich{position:relative;width:96px;height:9px;background:${akzent};margin-bottom:26px;
            box-shadow:0 2px 14px rgba(0,0,0,.6)}
  </style></head><body>
    <div class="schleier"></div>
    <div class="flaeche"><div class="strich"></div><div class="text">${zeilen}</div></div>
  </body></html>`;
}

const name = arg("--drehbuch") ?? "starter";
/**
 * Für welche App gebaut wird — der Folgen-Pfeil zeigt je App woanders hin
 * (`SITZE`). Ein Reel für drei Apps wird dreimal gebaut; nur diese eine Ebene
 * unterscheidet sich.
 */
const plattform = (arg("--plattform") ?? "instagram") as Plattform;
if (!SITZE[plattform]) throw new Error(`Keine Plattform „${plattform}". Bekannt: ${Object.keys(SITZE).join(", ")}`);
const buch = DREHBUECHER[name];
if (!buch) throw new Error(`Kein Drehbuch „${name}". Bekannt: ${Object.keys(DREHBUECHER).join(", ")}`);

/**
 * Zu lange Zeilen brechen im Bild um und verdecken dann mehr, als sie sagen.
 *
 * Im Renderer gemessen (Archivo 800, 54 px): rund **29,5 px je Zeichen**, und
 * zwischen den Rändern liegen 896 px — ab etwa 30 Zeichen bricht eine Zeile.
 * Am 11.09. stand deshalb „Das Set kommt am 16. September." dreizeilig im Reel.
 */
/**
 * Die Hook ist 86 px Bungee in Versalien und damit fast doppelt so breit wie
 * eine Zwischenzeile — sie war von der Prüfung ausgenommen und brach deshalb
 * unbemerkt um: am 14.09.2026 standen „ACHT LEERE FÄCHER." und „DASSELBE
 * POKÉMON." dreizeilig im Bild. Gemessen passen rund 16 Zeichen, nicht die
 * achtzehn aus dem Playbook.
 */
const ZEICHEN_PX = 29.5, HOOK_ZEICHEN_PX = 53, TEXT_PX = W - 88 - 96;
for (const [i, c] of buch.clips.entries()) {
  const breite = c.stil === "hook" ? HOOK_ZEICHEN_PX : ZEICHEN_PX;
  for (const zeile of (c.zeig ?? "").split("\n")) {
    if (zeile.length * breite > TEXT_PX) {
      console.warn(`  ! Clip ${i}: „${zeile}" ist zu lang (${zeile.length} Zeichen) und bricht um.`);
    }
  }
}

/**
 * Der Clip, in dem die Folgen-Pille steht, darf keinen Text tragen.
 *
 * Die Pille beginnt 400 ms nach dem Schnitt, der Text 160 ms danach und endet
 * 150 ms vor ihr — **er steht also 90 ms, egal wie lang der Clip ist**. Am
 * 16.09.2026 wäre so die stärkste Zeile des RGB-Stücks („eine auf 20.000
 * Boosterpacks") unsichtbar geblieben; im fertigen Video war an ihrer Stelle
 * nichts. Wer dort etwas sagen will, schiebt es einen Clip nach vorn und gibt
 * der Pille ein eigenes Bild.
 */
{
  const pillenClip = DREHBUECHER[name]?.folgenAbClip;
  const clips2 = DREHBUECHER[name]?.clips ?? [];
  const nr = pillenClip === null ? -1 : Math.min(pillenClip ?? clips2.length - 2, clips2.length - 1);
  if (nr >= 0 && clips2[nr]?.zeig) {
    console.warn(`  ! Clip ${nr} trägt die Folgen-Pille — sein Text steht nur 90 ms und ist praktisch unsichtbar.`);
  }
}

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const kit = loadBrandKit(db, PROJEKT);
// Das Binderplan-Gelb, nicht das Blau: über dunklen Bildern ist Blau unsichtbar.
const akzent = kit.accent2 ?? kit.colors?.[1] ?? "#F5C518";

const quelle = (seite: string) => path.join(env.MP_DATA_DIR, "assets", PROJEKT, `kunstseite-${seite}.png`);

/**
 * Der Text, der mit dem Stück gespeichert wird.
 *
 * Instagram bekommt die lange Fassung, TikTok und Shorts die kurze — dort
 * schneidet die App nach rund 150 Zeichen ab, und was danach steht, liest
 * niemand.
 */
const captionFuer = (p: Plattform): string =>
  p === "instagram" ? buch.caption
  : buch.captionKurz ?? buch.caption.split("\n\n").slice(0, 2).join("\n\n");

/** TikTok verträgt drei Schlagworte, nicht sechs. */
const tagsFuer = (p: Plattform): string[] =>
  p === "instagram" ? buch.hashtags : buch.hashtags.slice(0, 3);

const pieceId = newId();
const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
const arbeit = path.join(outDir, "arbeit");
fs.mkdirSync(arbeit, { recursive: true });

// Verkleinerte Arbeitskopien für die Standbilder — siehe `buehneHtml`.
const seitenVon = (b: Bild): string[] =>
  b.art === "drei" ? b.seiten : (b.art === "ganz" || b.art === "binder") ? [b.seite] : [];
const seitenImBuch = [...new Set(buch.clips.flatMap((c) =>
  c.art === "fahrt" ? [c.seite]
  : c.art === "stand" ? seitenVon(c.bild)
  : c.art === "fuellung" || c.art === "flip" ? []
  : [c.von, c.bis].flatMap(seitenVon)))];
const varNr = new Map(seitenImBuch.map((s, i) => [s, `--s${i}`]));
const varName = (seite: string) => varNr.get(seite) ?? "--s0";
const datenUrls = new Map<string, string>();
for (const seite of seitenImBuch) {
  const datei = quelle(seite);
  if (!fs.existsSync(datei)) throw new Error(`Kunstseite fehlt: ${datei}`);
  const klein = path.join(arbeit, `quelle-${seite}.jpg`);
  await runFfmpeg(["-i", datei, "-vf", "scale=1000:-1:flags=lanczos", "-q:v", "3", klein]);
  datenUrls.set(seite, `url('${dataUrlFor(klein) ?? ""}')`);
}
const vars = () => seitenImBuch.map((s) => `${varName(s)}:${datenUrls.get(s)}`).join(";");

/**
 * Kartenscans fuer ein Blatt — nur die sichtbaren wandern ins HTML.
 *
 * Ein Fuell-Clip rendert ein Bild je Karte; stuenden in jedem davon alle
 * dreissig Scans, waere jedes Dokument 1,7 MB gross. Der unscharfe Grund kommt
 * aus der ersten Karte, damit die Buehne nicht schwarz bleibt.
 */
const kartenDatei = (id: string) => path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten", `${id}.jpg`);
/** Markenbilder (Set-Logos u. ae.) liegen neben den Karten, aber in eigenem Ordner. */
const markeUrls = new Map<string, string>();
const markeUrl = (name: string) => {
  if (!markeUrls.has(name)) {
    const datei = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "marke", name);
    if (!fs.existsSync(datei)) throw new Error(`Markenbild fehlt: ${datei}`);
    markeUrls.set(name, `url('${dataUrlFor(datei) ?? ""}')`);
  }
  return markeUrls.get(name)!;
};
/** Belege (Screenshot-Ausschnitte) liegen in einem eigenen Ordner. */
const belegUrls = new Map<string, string>();
const belegUrl = (name: string) => {
  if (!belegUrls.has(name)) {
    const datei = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "belege", name);
    if (!fs.existsSync(datei)) throw new Error(`Beleg fehlt: ${datei}`);
    belegUrls.set(name, dataUrlFor(datei) ?? "");
  }
  return belegUrls.get(name)!;
};
const kartenUrls = new Map<string, string>();
const kartenUrl = (id: string) => {
  if (!kartenUrls.has(id)) {
    const datei = kartenDatei(id);
    if (!fs.existsSync(datei)) throw new Error(`Kartenscan fehlt: ${datei}`);
    kartenUrls.set(id, `url('${dataUrlFor(datei) ?? ""}')`);
  }
  return kartenUrls.get(id)!;
};
const kartenVars = (karten: string[], sichtbar: number) => {
  // Ein leerer Eintrag ist eine Karte ohne Scan — fuer die gibt es kein Bild
  // und darf auch keins angefordert werden (kartenUrl wirft sonst).
  const teile = karten.slice(0, sichtbar)
    .map((id, i) => (id ? `--k${i}:${kartenUrl(id)}` : null))
    .filter((z): z is string => z !== null);
  const grund = karten.find((id) => id);
  if (grund) teile.push(`--grund:${kartenUrl(grund)}`);
  return { def: teile.join(";"), name: (i: number) => `--k${i}` };
};

const gesamtMs = buch.clips.reduce((n, c) => n + c.dauerMs, 0) + ABSPANN_MS;
console.log(`${buch.titel}: ${buch.clips.length} Clips, ${(gesamtMs / 1000).toFixed(1)} s inkl. Abspann`);

// 1. Standbilder — jedes Bild nur einmal rendern, auch wenn zwei Clips es teilen.
const bildDateien = new Map<string, string>();
const bildJobs: RenderJob[] = [];
function merkeBild(bild: Bild): string {
  const schluessel = JSON.stringify(bild);
  if (!bildDateien.has(schluessel)) {
    const datei = path.join(arbeit, `bild-${bildDateien.size}.png`);
    bildDateien.set(schluessel, datei);
    // RGB-Bilder tragen nur Karten und Logo — Grund und Rauch legt ffmpeg darunter.
    const durchsichtig = bild.art === "rgb" || bild.art === "rgbdrei";
    bildJobs.push({ html: bildHtml(bild, varName, vars, kartenVars), width: W, height: H,
                    transparent: durchsichtig, file: datei });
  }
  return bildDateien.get(schluessel)!;
}
/**
 * Ein Wirbel ist eine Bildfolge, kein ffmpeg-Filter.
 *
 * Eine 3D-Drehung mit Perspektive kann ffmpeg nicht: `scale` und `rotate`
 * rechnen flach, und eine gestauchte Karte sieht aus wie eine gestauchte Karte,
 * nicht wie eine gedrehte. Der Browser kann es — also rendert er je Bild eine
 * Lage, und ffmpeg setzt die Bilder nur noch aneinander. Bei 25 fps sind das
 * rund 27 Bilder je Karte.
 */
const rgbBild = (farbe: RgbFarbe, seite: "rueck" | "vorn"): Bild =>
  ({ art: "rgb", farbe, seite, logo: buch.setLogo });

/**
 * Grund und Rauch — die beiden Ebenen unter den Karten.
 *
 * Je Farbe ein Grundbild, dazu **eine** Rauchtextur für das ganze Stück: Sie
 * wird je Clip anders eingefärbt und anders beschnitten, das reicht.
 */
const gruende = new Map<string, string>();
function grundDatei(welche: RgbFarbe | "drei"): string {
  if (!gruende.has(welche)) {
    const datei = path.join(arbeit, `grund-${welche}.png`);
    gruende.set(welche, datei);
    bildJobs.push({ html: rgbGrundHtml(welche), width: W, height: H, file: datei });
  }
  return gruende.get(welche)!;
}
/** Welchen Grund ein Clip braucht — oder `null`, wenn er keine RGB-Bühne ist. */
function rgbGrundVon(c: Clip): RgbFarbe | "drei" | null {
  if (c.art === "flip") return c.farbe;
  if (c.art === "stand" && c.bild.art === "rgb") return c.bild.farbe;
  if (c.art === "stand" && c.bild.art === "rgbdrei") return "drei";
  return null;
}
const brauchtRauch = buch.clips.some((c) => rgbGrundVon(c) !== null);
const rauchBild = path.join(arbeit, "rauch.png");
if (brauchtRauch) bildJobs.push({ html: rauchHtml(), width: RAUCH_B, height: RAUCH_H, file: rauchBild });

const flipFrames = new Map<number, string[]>();
for (const [i, c] of buch.clips.entries()) {
  // Gründe hier anmelden, nicht erst beim Schneiden: Gerendert wird einmal für
  // alle Bilder, und wer später dazukommt, fehlt auf der Platte.
  const welche = rgbGrundVon(c);
  if (welche !== null) grundDatei(welche);
  if (c.art === "flip") {
    merkeBild(rgbBild(c.farbe, "rueck"));
    merkeBild(rgbBild(c.farbe, "vorn"));
    const anzahl = Math.max(6, Math.round(((c.wirbelMs ?? 1100) / 1000) * OUTPUT_FPS));
    const dateien: string[] = [];
    for (let k = 1; k < anzahl; k++) {
      const datei = path.join(arbeit, `flip-${i}-${String(k).padStart(2, "0")}.png`);
      bildJobs.push({ html: rgbFlipHtml(c.farbe, k / anzahl, buch.setLogo), width: W, height: H,
                      transparent: true, file: datei });
      dateien.push(datei);
    }
    flipFrames.set(i, dateien);
  }
}
for (const c of buch.clips) {
  if (c.art === "stand") merkeBild(c.bild);
  if (c.art === "wandel") { merkeBild(c.von); merkeBild(c.bis); }
  // Füllungen werden als Bildfolge gerendert (siehe `fuellFrames`), nicht als
  // Einzelbilder je Karte.
}

// 2. Texte und Kennzeichnung.
const textDateien: (string | null)[] = [];
const textJobs: RenderJob[] = buch.clips.map((c, i) => {
  if (!c.zeig) { textDateien.push(null); return null; }
  const datei = path.join(arbeit, `text-${i}.png`);
  textDateien.push(datei);
  return { html: textHtml(c.zeig, c.stil ?? "satz", akzent), width: W, height: H, transparent: true, file: datei };
}).filter((j): j is RenderJob => j !== null);

// Der Folgen-Hinweis: Standard ist der vorletzte Clip, `null` schaltet ihn ab.
const folgenClip = buch.folgenAbClip === null ? null
  : Math.min(buch.folgenAbClip ?? buch.clips.length - 2, buch.clips.length - 1);
const folgen = path.join(arbeit, "folgen.png");
/**
 * `--ohne-folgen` baut die **Basis**: alles fertig, nur ohne Folgen-Pille.
 * Der Satz des Folgen-Clips weicht trotzdem — dadurch passt die Pille später
 * an dieselbe Stelle, und `reel-plattformen.ts` legt sie in Sekunden auf, statt
 * das ganze Reel je App neu zu rechnen.
 */
const ohneFolgen = hatFlagge("--ohne-folgen");
if (folgenClip !== null && folgenClip >= 0 && !ohneFolgen) {
  textJobs.push({ html: folgenHtml(akzent, plattform), width: W, height: H, transparent: true, file: folgen });
}

await playwrightRenderer([...bildJobs, ...textJobs]);

/**
 * Die Einschub-Bewegung einer Füllung Bild für Bild rendern.
 *
 * Nicht über `playwrightRenderer`: der baut je Bild eine eigene Seite auf, und
 * bei rund siebzig Einzelbildern je Clip wäre das ein Vielfaches der Zeit. Hier
 * bleibt **eine** Seite offen, und jedes Bild wird über ein negatives
 * `animation-delay` angesprungen — dasselbe Verfahren wie in `reel-einschub.ts`.
 */
const fuellFrames = new Map<number, string[]>();
{
  const fuellungen = buch.clips.map((c, i) => ({ c, i })).filter((x) => x.c.art === "fuellung");
  if (fuellungen.length) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const seite = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    /** Wie lange eine Karte in ihre Tasche fährt — wie in `binderbuehne.ts`. */
    const EINSCHUB_MS = 620;
    for (const { c, i } of fuellungen) {
      if (c.art !== "fuellung") continue;
      const n = c.bis;
      // Die Bewegung endet 700 ms vor dem Clip, damit die volle Seite kurz steht.
      const bewegtMs = Math.max(700, c.dauerMs - 700);
      const versatz = n > 1 ? Math.max(180, (bewegtMs - EINSCHUB_MS) / (n - 1)) : 0;
      const starts = Array.from({ length: n }, (_, k) => Math.round(k * versatz));
      const html = bildHtml({ art: "karten", karten: c.karten, sichtbar: n, spalten: c.spalten, zeilen: c.zeilen,
        preise: c.preise, namen: c.namen, einschub: { starts, dauerMs: EINSCHUB_MS } }, varName, vars, kartenVars);
      await seite.setContent(html, { waitUntil: "domcontentloaded" });
      await seite.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready).catch(() => undefined);
      await seite.waitForTimeout(300);
      const ordner = path.join(arbeit, `fuell-${i}`);
      fs.mkdirSync(ordner, { recursive: true });
      const anzahl = Math.ceil((((starts[n - 1] ?? 0) + EINSCHUB_MS + 120) / 1000) * OUTPUT_FPS);
      const dateien: string[] = [];
      for (let k = 0; k < anzahl; k++) {
        const tMs = (k / OUTPUT_FPS) * 1000;
        await seite.evaluate(([zeit, st]) => {
          document.querySelectorAll<HTMLElement>(".fach > .karte.rein").forEach((el, idx) => {
            el.style.animationDelay = `${(st as number[])[idx]! - (zeit as number)}ms`;
          });
        }, [tMs, starts] as [number, number[]]);
        const datei = path.join(ordner, `f${String(k).padStart(4, "0")}.png`);
        await seite.screenshot({ path: datei, type: "png" });
        dateien.push(datei);
      }
      fuellFrames.set(i, dateien);
      console.log(`  Füllung ${i}: ${anzahl} Einzelbilder (${n} Karten)`);
    }
    await seite.close();
    await browser.close();
  }
}

/**
 * Ziehender Rauch zwischen Grund und Karte.
 *
 * Zwei Fenster wandern über dieselbe Textur: Das erste wird zur Deckkraft einer
 * hellen Farbe (die Schwaden), das zweite umgekehrt zur Deckkraft eines fast
 * schwarzen Tons (die Schatten dazwischen). Erst der Gegenlauf macht daraus
 * Rauch — eine Ebene allein sieht aus wie ein verschobener Farbverlauf.
 *
 * **Die Farbe kommt aus einer Alphamaske, nicht aus `blend`.** Der erste Versuch
 * mischte graue Wolken per `screen`/`multiply` über den farbigen Grund: Das
 * Ergebnis war schmutziges Grau, weil `screen` mit Grau in Richtung Weiß zieht
 * und `multiply` die Sättigung frisst. Mit `alphamerge` liegt echte Farbe im
 * Bild, und die Wolkenhelligkeit steuert nur, wie dicht sie steht.
 *
 * **Die Wege sind Sinusbahnen, keine geraden Fahrten.** Eine gerade Fahrt läuft
 * nach wenigen Sekunden aus der Textur heraus; ein Sinus bleibt für immer
 * innerhalb und wiederholt sich trotzdem nicht sichtbar, weil die vier Perioden
 * (9, 13, 7, 11 s) teilerfremd liegen.
 *
 * **Geschwindigkeit ist Pflicht, nicht Geschmack:** Am schnellsten Punkt legen
 * die Ebenen 12 bzw. 12 px je Bild zurück. Mit den ersten 5 px war die Bewegung
 * messbar, aber nicht sichtbar: Eine weiche Wolke, um fünf Pixel verschoben,
 * ändert kaum eine Helligkeit. Und alles unter rund 2 px je Bild rundet der
 * Renderer ohnehin auf ganze Pixel — dann steht der Rauch und ruckelt nur
 * (dieselbe Grenze wie beim Abspann-Logo am 11.09.2026).
 *
 * `versatzMs` ist die Stelle des Clips im fertigen Stück: Ohne sie finge der
 * Rauch bei jedem Schnitt von vorn an und spränge sichtbar.
 */
function rauchFilter(versatzMs: number, dauerMs: number, farbe: RgbFarbe | "drei"): string {
  const off = (versatzMs / 1000).toFixed(3), d = s3(dauerMs);
  // Keine Kommas in den Ausdrücken — ffmpeg liest sie als Filtergrenze.
  const bahn = (mitte: number, weite: number, periode: number, phase: number) =>
    `${mitte}+${weite}*sin(2*PI*(t+${off})/${periode}+${phase})`;
  // Beim Schlussbild liegen alle drei Farben im Grund; farbige Schwaden würden
  // eine davon bevorzugen. Dort zieht heller Dunst, keine Farbe.
  const schwaden = farbe === "drei" ? "0xAEB8C8" : RGB[farbe].hell.replace("#", "0x");
  const schatten = farbe === "drei" ? "0x05060A" : RGB[farbe].dunkel.replace("#", "0x");
  const deckungHell = farbe === "drei" ? 0.30 : 0.48;
  const deckungDunkel = farbe === "drei" ? 0.46 : 0.42;
  return [
    `[1:v]split=2[ra][rb]`,
    `[ra]crop=${W}:${H}:x=${bahn(480, 380, 8, 0)}:y=${bahn(620, 420, 13, 1.1)},format=gray[m1]`,
    `[rb]crop=${W}:${H}:x=${bahn(480, -420, 9, 2.2)}:y=${bahn(620, -380, 11, 0.6)},format=gray,negate[m2]`,
    `color=c=${schwaden}:s=${W}x${H}:r=${OUTPUT_FPS}:d=${d},format=rgba[c1]`,
    `color=c=${schatten}:s=${W}x${H}:r=${OUTPUT_FPS}:d=${d},format=rgba[c2]`,
    `[c1][m1]alphamerge,colorchannelmixer=aa=${deckungHell}[s1]`,
    `[c2][m2]alphamerge,colorchannelmixer=aa=${deckungDunkel}[s2]`,
    `[0:v]format=rgba,setsar=1[g0]`,
    `[g0][s1]overlay=0:0[g1]`,
    `[g1][s2]overlay=0:0[g2]`,
    `[2:v]format=rgba,setsar=1[k]`,
    `[g2][k]overlay=0:0:eof_action=pass[v]`,
  ].join(";");
}

// 3. Bildspur: je Clip ein Schnipsel, am Ende der Abspann.
const clipDateien: string[] = [];
for (const [i, c] of buch.clips.entries()) {
  const datei = path.join(arbeit, `clip-${i}.mp4`);
  const schluss = ["-r", String(OUTPUT_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", datei];
  /** Wo dieser Clip im fertigen Stück beginnt — der Rauch läuft durch. */
  const beginntMs = buch.clips.slice(0, i).reduce((n, c2) => n + c2.dauerMs, 0);
  const grundArt = rgbGrundVon(c);
  const dauerEin = (d: string) => ["-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(c.dauerMs), "-i", d];

  if (c.art === "fahrt") {
    // Erst stehen bleiben, dann fahren, am Ziel wieder stehen.
    //
    // Beim ersten Lauf startete die Fahrt sofort: der Text nannte die Basiskarte,
    // im Bild stand nach anderthalb Sekunden schon die zweite Stufe („Glumanda"
    // ueber Glutexo). Text und Bild muessen sich zu Beginn decken, deshalb steht
    // die Kamera erst auf dem Startfach — und am Ziel lange genug, dass die
    // Endstufe nicht nur vorbeihuscht.
    const von = fensterAufFach(c.vonFach), bis = fensterAufFach(c.bisFach);
    const halt = c.haltMs ?? 1500, nachlauf = 600;
    const weg = Math.max(600, c.dauerMs - halt - nachlauf);
    const p = `min(1,max(0,(t-${s3(halt)})/${s3(weg)}))`;
    const e = `(${p})*(${p})*(3-2*(${p}))`;
    await runFfmpeg([
      "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(c.dauerMs), "-i", quelle(c.seite),
      "-vf", [
        `crop=${FENSTER_B}:${FENSTER_H}:x='${von.x}+(${bis.x}-${von.x})*(${e})':y='${von.y}+(${bis.y}-${von.y})*(${e})'`,
        `scale=${W}:${H}:flags=lanczos`, "setsar=1",
      ].join(","), ...schluss,
    ]);
  } else if (c.art === "fuellung") {
    /**
     * Die Karten **fahren in ihre Taschen**, seit dem 21.09.2026 auch hier.
     *
     * Vorher stand je Karte ein Standbild und die Seite füllte sich sprunghaft.
     * Das Einschieben ist das Erkennungszeichen der Marke — es gehört auf jede
     * Binderseite, nicht nur in die Matching-Cards- und Kunstseiten-Reels.
     * Gerendert wird wie dort: eine Seite, je Einzelbild über ein negatives
     * `animation-delay` angesprungen, danach Standbild bis zum Clip-Ende.
     */
    const frames = fuellFrames.get(i) ?? [];
    const liste = path.join(arbeit, `fuellung-${i}.txt`);
    const bildMs = 1000 / OUTPUT_FPS;
    const standMs = Math.max(0, c.dauerMs - frames.length * bildMs);
    const zeilen2 = frames.flatMap((d) => [`file '${d}'`, `duration ${s3(bildMs)}`]);
    const letztes = frames[frames.length - 1]!;
    zeilen2.push(`file '${letztes}'`, `duration ${s3(standMs)}`, `file '${letztes}'`);
    fs.writeFileSync(liste, zeilen2.join("\n") + "\n");
    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", liste, "-vf", "setsar=1", "-t", s3(c.dauerMs), ...schluss]);
  } else if (c.art === "flip") {
    // Rückseite steht, Karte wirbelt, Vorderseite steht. Die Standzeiten tragen
    // den Text — eine Drehung allein ist nach einer Sekunde vorbei und der Satz
    // darunter noch nicht gelesen.
    const bildMs = 1000 / OUTPUT_FPS;
    const frames = flipFrames.get(i) ?? [];
    const halt = c.haltMs ?? 1300;
    const wirbel = (frames.length + 1) * bildMs;
    const rest = Math.max(600, c.dauerMs - halt - wirbel);
    const liste = path.join(arbeit, `flip-${i}.txt`);
    const zeilen = [`file '${merkeBild(rgbBild(c.farbe, "rueck"))}'`, `duration ${s3(halt)}`];
    for (const datei2 of frames) zeilen.push(`file '${datei2}'`, `duration ${s3(bildMs)}`);
    const vorn = merkeBild(rgbBild(c.farbe, "vorn"));
    // Der letzte Eintrag steht ohne Dauer noch einmal da: der concat-Demuxer
    // schneidet die Dauer des letzten Bildes sonst auf null.
    zeilen.push(`file '${vorn}'`, `duration ${s3(rest)}`, `file '${vorn}'`);
    fs.writeFileSync(liste, zeilen.join("\n") + "\n");
    await runFfmpeg([
      ...dauerEin(grundDatei(c.farbe)), ...dauerEin(rauchBild),
      "-f", "concat", "-safe", "0", "-i", liste,
      "-filter_complex", rauchFilter(beginntMs, c.dauerMs, grundArt!), "-map", "[v]", "-t", s3(c.dauerMs), ...schluss]);
  } else if (c.art === "stand" && grundArt !== null) {
    // Standbild auf der RGB-Bühne: dieselben drei Ebenen, nur bewegt sich die
    // Karte nicht — der Rauch zieht trotzdem weiter.
    await runFfmpeg([
      ...dauerEin(grundDatei(grundArt)), ...dauerEin(rauchBild), ...dauerEin(merkeBild(c.bild)),
      "-filter_complex", rauchFilter(beginntMs, c.dauerMs, grundArt!), "-map", "[v]", "-t", s3(c.dauerMs), ...schluss]);
  } else if (c.art === "stand") {
    await runFfmpeg(["-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(c.dauerMs), "-i", merkeBild(c.bild), "-vf", "setsar=1", ...schluss]);
  } else {
    await runFfmpeg([
      "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(c.haltMs + BLENDE_MS), "-i", merkeBild(c.von),
      "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(c.dauerMs - c.haltMs), "-i", merkeBild(c.bis),
      "-filter_complex", `[0:v][1:v]xfade=transition=fade:duration=${s3(BLENDE_MS)}:offset=${s3(c.haltMs)},format=yuv420p,setsar=1[v]`,
      "-map", "[v]", "-t", s3(c.dauerMs), ...schluss,
    ]);
  }
  clipDateien.push(datei);
}

// Der Abspann kommt fertig aus `abspann-binderplan.ts` — Ebenen mit
// ffmpeg-Bewegung. Die frühere Bildfolge aus CSS-Renders ruckelte am Logo.
clipDateien.push(await abspannClip(env.MP_DATA_DIR));

// 4. Montage: Clips aneinander, Texte darüber, Musik darunter.
const einblendungen: { datei: string; startMs: number; endMs: number }[] = [];

/**
 * Wann die Folgen-Pille steht — wird vor den Texten gebraucht.
 *
 * Sie sitzt am Anfang ihres Clips und bleibt `FOLGEN_MS`, höchstens aber bis
 * 400 ms vor dessen Ende: Zwei Einblendungen, die sich über einen Schnitt
 * hinweg überlappen, lesen sich wie ein Fehler.
 */
const folgenZeit = folgenClip !== null && folgenClip >= 0 ? (() => {
  const start = buch.clips.slice(0, folgenClip).reduce((n, c) => n + c.dauerMs, 0) + 400;
  const grenze = start + buch.clips[folgenClip]!.dauerMs - 800;
  return { startMs: start, endMs: Math.min(start + FOLGEN_MS, grenze) };
})() : null;

let lauf = 0;
for (const [i, c] of buch.clips.entries()) {
  const datei = textDateien[i];
  if (datei) {
    // Bei Instagram und Shorts steht die Pille genau da, wo der Satz steht.
    // Statt beide übereinanderzulegen, weicht der Satz: erst der Text, dann
    // der Hinweis. Bei TikTok sitzt die Pille rechts oben und stört nicht.
    const weicht = folgenZeit && SITZE[plattform].untenLinks && i === folgenClip;
    const ende = weicht ? folgenZeit.startMs - 150 : lauf + c.dauerMs;
    einblendungen.push({ datei, startMs: i === 0 ? 200 : lauf + 160, endMs: ende });
  }
  lauf += c.dauerMs;
}
if (folgenZeit && !ohneFolgen) einblendungen.push({ datei: folgen, ...folgenZeit });

const musik = hatFlagge("--ohne-musik") ? null : path.join(ROOT, "assets", "music", arg("--musik") ?? buch.musik);
if (musik && !fs.existsSync(musik)) throw new Error(`Musik fehlt: ${musik}`);

const eingang: string[] = [];
let n = 0;
const add = (...a: string[]) => { eingang.push(...a); return n++; };
const clipIdx = clipDateien.map((d) => add("-i", d));
// Jede Einblendung als eigene Schleife mit Startversatz — ein Einzelbild ohne `-loop`
// liegt nach dem ersten Frame auf EOF und wäre im Video nie zu sehen.
const texte = einblendungen.map((c) => ({ ...c, idx: add("-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(c.endMs - c.startMs), "-itsoffset", s3(c.startMs), "-i", c.datei) }));
const MUSIK = musik ? add("-i", musik) : -1;

const f: string[] = [`${clipIdx.map((i) => `[${i}:v]`).join("")}concat=n=${clipIdx.length}:v=1:a=0[bild]`];
let letzte = "[bild]";
texte.forEach((c, k) => {
  f.push(`[${c.idx}:v]format=rgba,setsar=1[o${k}]`);
  f.push(`${letzte}[o${k}]overlay=0:0:eof_action=pass:enable='between(t,${s3(c.startMs)},${s3(c.endMs)})'[t${k}]`);
  letzte = `[t${k}]`;
});
f.push(`${letzte}fade=t=in:st=0:d=0.35,fade=t=out:st=${s3(gesamtMs - 500)}:d=0.5,format=yuv420p[vout]`);

// Ohne Sprecherin trägt die Musik den Ton allein — also auf Reel-Pegel, nicht gedämpft.
if (MUSIK >= 0) {
  f.push(`[${MUSIK}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${s3(gesamtMs)},` +
    `afade=t=in:st=0:d=1.2,afade=t=out:st=${s3(Math.max(0, gesamtMs - 2200))}:d=2.2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
} else {
  f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(gesamtMs)}[aout]`);
}

const reel = path.join(outDir, "reel.mp4");
await runFfmpeg([...eingang, "-filter_complex", f.join(";"),
  "-map", "[vout]", "-map", "[aout]", "-r", String(OUTPUT_FPS), "-t", s3(gesamtMs),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
  // Die Kennzeichnung gilt nur, wenn im Bild wirklich eine gemalte Seite steckt.
  // Eine Rangliste aus echten Kartenscans als „AI-generated" zu markieren wäre
  // falsch — und die Apps lesen das aus.
  ...(buch.artworks.length ? ["-metadata", "comment=AI-generated: true (Binderplan Kunstseite, Marketing Pilot)"] : []),
  "-metadata", `title=${buch.titel}`, reel]);

// 5. Als Stück eintragen, damit es durch Freigabe und Zeitplan laufen kann.
// Reihenfolge ist Pflicht: `mp_assets.content_piece_id` zeigt auf das Stück, also muss
// das Stück zuerst stehen — andersherum bricht der Fremdschlüssel.
const ts = nowIso();
const assetId = newId();
/**
 * Ein Drehbuch, ein Stueck in der Freigabe.
 *
 * Jeder Lauf legte bisher ein neues an. Beim Feilen an einem Reel sind das
 * schnell zwanzig: am 13.09.2026 standen nach vier Stunden 16 Fassungen
 * desselben Stuecks in der Warteschlange, und die Freigabe war unbrauchbar.
 * Ein Zwischenstand, den niemand freigegeben hat, ist mit dem naechsten Lauf
 * ueberholt — er wird deshalb abgelehnt statt liegengelassen. Die Dateien
 * raeumt `cleanup.ts` nach sieben Tagen weg; bis dahin ist es umkehrbar.
 * Freigegebene und veroeffentlichte Stuecke bleiben unangetastet.
 */
const ueberholt = db.select().from(t.mpContentPieces)
  .where(eq(t.mpContentPieces.projectId, PROJEKT)).all()
  .filter((r) => r.status === "review" && parseJson<Record<string, unknown>>(r.meta, {})["drehbuch"] === name);
for (const alt2 of ueberholt) {
  db.update(t.mpContentPieces).set({
    status: "rejected",
    rejectionReason: `Zwischenstand — überholt von einem neueren Lauf des Drehbuchs „${name}".`,
    updatedAt: ts,
  }).where(eq(t.mpContentPieces.id, alt2.id)).run();
}
if (ueberholt.length) console.log(`${ueberholt.length} ältere Fassung(en) dieses Drehbuchs abgelehnt.`);

db.insert(t.mpContentPieces).values({
  id: pieceId, projectId: PROJEKT, taskId: null, channel: KANAL[plattform], format: "artwork_reel",
  title: `${buch.titel} · ${plattform}`,
  body: `${captionFuer(plattform)}\n\n${tagsFuer(plattform).join(" ")}`,
  /**
   * Eine Basis (`--ohne-folgen`) ist ein Zwischenstand, kein Beitrag: Ihr fehlt
   * die Folgen-Pille, und veröffentlicht wird immer eine der App-Fassungen.
   * Als „review" stand sie in der Freigabe als viertes Stück je Thema.
   */
  assets: toJson([assetId]), status: ohneFolgen ? "draft" : "review",
  humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}",
  meta: toJson({
    platform: plattform, language: "de", size: `${W}x${H}`, linkRule: "bio",
    caption: captionFuer(plattform), hashtags: tagsFuer(plattform), artwork: buch.artworks[0], artworks: buch.artworks,
    // Beide Fassungen mitschreiben: `reel-plattformen.ts` baut daraus die
    // App-Stücke und braucht dafür die kurze Fassung und die volle Tag-Liste.
    captionLang: buch.caption, captionKurz: buch.captionKurz ?? null, hashtagsAlle: buch.hashtags,
    drehbuch: name, ohneStimme: true, dauerMs: gesamtMs, anheften: false,
    // Für den nachträglichen Abspann-Tausch: sonst weiß `reel-abspann.ts` nicht,
    // wie viel es hinten abschneiden darf, wenn sich `ABSPANN_MS` ändert.
    abspannMs: ABSPANN_MS,
    // Steckt eine gemalte Seite im Bild? Danach richtet sich die Kennzeichnung
    // in den Dateidaten, die `reel-plattformen.ts` setzt.
    kiBild: buch.artworks.length > 0,
    // Wann die Folgen-Pille steht — `reel-plattformen.ts` legt sie später an
    // genau diese Stelle, wenn die Basis ohne sie gebaut wurde.
    folgenZeit, basis: ohneFolgen,
  }),
  aiTellScore: null, aiTellNotes: "Kunstseiten-Reel ohne Stimme, Texte von Hand.", rejectionReason: "",
  createdAt: ts, updatedAt: ts,
}).run();
db.insert(t.mpAssets).values({
  id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video",
  path: path.relative(env.MP_DATA_DIR, reel),
  meta: toJson({ aiGenerated: true, provenance: "reel-binder", drehbuch: name, artworks: buch.artworks, size: `${W}x${H}` }),
  createdAt: ts,
}).run();

// Ein Standbild als Vorschau — ohne das zeigt die Mediathek nur das Wort „Reel"
// auf grauem Grund, und man sucht sein Stück zwischen lauter gleichen Kacheln.
const vorschau = path.join(outDir, "vorschau.jpg");
await runFfmpeg(["-ss", "1.6", "-i", reel, "-frames:v", "1", "-vf", "scale=540:-1", "-q:v", "4", "-y", vorschau]);
db.insert(t.mpAssets).values({
  id: newId(), projectId: PROJEKT, contentPieceId: pieceId, kind: "image",
  path: path.relative(env.MP_DATA_DIR, vorschau),
  meta: toJson({ role: "thumbnail", provenance: "reel-standbild" }),
  createdAt: ts,
}).run();

console.log(`\nFertig: ${reel}`);
console.log(`Stück ${pieceId} steht auf „review".`);
