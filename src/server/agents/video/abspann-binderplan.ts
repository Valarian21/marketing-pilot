/**
 * Der Abspann der Binderplan-Reels — Ebenen, von ffmpeg bewegt.
 *
 * Der Vorläufer `abspann.ts` rendert fünfzig Vollbilder, deren Bewegung in CSS
 * steckt und über `animation-delay: -t` angesprungen wird. Für die gezeichnete
 * Lehreule-Eule trägt das; das Binderplan-Zeichen ist aber ein eingebettetes
 * PNG, und daran ist die Sache am 11.09.2026 sichtbar gescheitert: Das „Atmen"
 * skaliert um 1,5 %, bei 25 Bildern je Sekunde also um **weniger als einen
 * halben Pixel je Bild**. Der Browser rundet auf ganze Pixel, das Logo springt
 * statt zu wachsen. Gemessen an den Bildunterschieden ab Bild 30:
 * 0,01 · 0,01 · 0,00 · 0,01 · **0,16** · 0,03 Mpx — genau das sieht man als
 * Ruckeln.
 *
 * Daraus die zwei Regeln hier:
 *
 * 1. **Keine Mikro-Bewegungen.** Was sich bewegt, bewegt sich schnell genug,
 *    dass die Pixelrundung nicht auffällt (Faustwert: mehr als 2 px je Bild) —
 *    sonst steht es still.
 * 2. **Ebenen statt Vollbilder.** Grund, Logo und die drei Textzeilen werden
 *    einmal gerendert; alles Weitere macht ffmpeg mit Alpha und Position.
 *
 * `abspannClip()` liefert den fertigen Clip und wird von zwei Seiten benutzt:
 * `scripts/reel-binder.ts` hängt ihn beim Bauen an, `scripts/reel-abspann.ts`
 * tauscht ihn in fertigen Reels aus.
 */
import fs from "node:fs";
import path from "node:path";
import { playwrightRenderer, dataUrlFor, type RenderJob } from "../studio/render.js";
import { fontHead } from "../studio/fonts.js";
import { runFfmpeg, OUTPUT_FPS } from "./assemble.js";

/** Binderplan im Pilot — der Abspann gilt nur fuer dieses Projekt. */
export const BINDERPLAN_PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const PROJEKT = BINDERPLAN_PROJEKT;
const W = 1080, H = 1920;
/**
 * Standzeit des Abspanns.
 *
 * Bis zum 14.09.2026 waren es 2000 ms — und darin lag ein Rechenfehler, der im
 * fertigen Reel sichtbar war: Das Ausblenden beginnt bei `ABSPANN_MS - 420`,
 * also bei 1580 ms, die Fußzeile war aber erst bei 1800 ms voll da. Der Abspann
 * verschwand, während er noch aufblendete; zum Lesen von `binderplan.app` blieb
 * kaum Zeit. 3200 ms geben dem fertigen Bild rund eine Sekunde Stand, bevor es
 * geht — bei einem 25-s-Reel sind das 4 % Laufzeit für den einzigen Moment, in
 * dem die Adresse im Bild steht.
 */
export const ABSPANN_MS = 3200;
/** Die Fassung, die in den Reels steckt — am 11.09.2026 ausgewählt. */
export const ABSPANN_VARIANTE = "d";
const s3 = (ms: number) => (ms / 1000).toFixed(3);

// --- Inhalt und Farben -------------------------------------------------------

const BLAU = "#2A4B9B", GELB = "#F5C518", TINTE = "#14161C";
const DOMAIN = "binderplan.app";
/**
 * Die Adresse im Abspann je Plattform — seit dem 21.09.2026 die Kurzlinks des
 * Produkts (`/ig`, `/tt`, `/yt`), nicht mehr die nackte Domain.
 *
 * Grund: Die Herkunftsmessung des Produkts läuft ohne Cookie über genau diese
 * Kurzlinks. Mit `binderplan.app` im Bild kamen 64 Besuche als „binderplan.de"
 * an — und niemand wusste, aus welchem Kanal. Der Abspann ist der einzige
 * Moment, in dem eine Adresse im Bild steht; er muss die messbare tragen.
 * Die Plattform-Schlüssel sind die aus `folgen-pille.ts` (`shorts` = YouTube).
 */
export const ABSPANN_ADRESSE: Record<string, string> = {
  instagram: "binderplan.app/ig",
  tiktok: "binderplan.app/tt",
  shorts: "binderplan.app/yt",
  youtube: "binderplan.app/yt",
};
export const adresseFuer = (plattform?: string | null): string =>
  (plattform && ABSPANN_ADRESSE[plattform]) || DOMAIN;
const CLAIM = ["Plane deine Seite,", "bevor du kaufst."];
const FUSS = "Kostenlos, ohne Anmeldung";

/** Wo die Ebenen im Bild sitzen — dieselben Werte für alle drei Varianten. */
const LOGO_B = 330, LOGO_Y = 600;
const DOMAIN_Y = 1010, CLAIM_Y = 1160, FUSS_Y = 1330;

const kopf = `<meta charset="utf-8">${fontHead()}<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
</style>`;

function grundHtml(): string {
  return `<!doctype html><html><head>${kopf}</head><body style="background:${BLAU}">
    <div style="position:absolute;inset:0;background:
      radial-gradient(ellipse 62% 34% at 50% 26%,rgba(255,255,255,.20),transparent 72%),
      radial-gradient(ellipse 90% 50% at 50% 104%,rgba(0,0,0,.28),transparent 70%)"></div>
  </body></html>`;
}

function logoHtml(logoUrl: string): string {
  return `<!doctype html><html><head>${kopf}</head><body style="background:transparent">
    <img src="${logoUrl}" style="position:absolute;left:${(W - LOGO_B) / 2}px;top:${LOGO_Y}px;width:${LOGO_B}px;height:${LOGO_B}px;
         filter:drop-shadow(0 18px 40px rgba(0,0,0,.35))">
  </body></html>`;
}

/**
 * Bungee braucht rund 0,663 em je Zeichen (gemessen); `binderplan.app` (14
 * Zeichen) passt bei 106 px, `binderplan.app/yt` (17) nicht mehr in 1.000 px.
 * Die Größe folgt deshalb der Länge, nach oben bei 106 gedeckelt.
 */
const adressGroesse = (text: string) => Math.min(106, Math.floor(1000 / (text.length * 0.663)));

/** Eine Textebene: Adresse, Claim oder Fußzeile — jede für sich, damit sie einzeln aufblenden können. */
function textHtml(welche: "domain" | "claim" | "fuss", adresse = DOMAIN): string {
  const inhalt = welche === "domain"
    ? `<div style="position:absolute;left:0;right:0;top:${DOMAIN_Y}px;text-align:center;
         font-family:'Bungee',system-ui;font-size:${adressGroesse(adresse)}px;letter-spacing:-.02em;color:#fff;white-space:nowrap">${adresse}</div>`
    : welche === "claim"
    ? `<div style="position:absolute;left:0;right:0;top:${CLAIM_Y}px;text-align:center;
         font-family:'Archivo',system-ui;font-weight:800;font-size:56px;line-height:1.24;color:#fff">
         ${CLAIM.map((z) => `<div>${z}</div>`).join("")}</div>`
    : `<div style="position:absolute;left:0;right:0;top:${FUSS_Y}px;text-align:center">
         <span style="display:inline-block;font-family:'Archivo',system-ui;font-weight:600;font-size:40px;color:#fff;
           background:${TINTE};border-radius:999px;padding:20px 44px">${FUSS}</span></div>`;
  return `<!doctype html><html><head>${kopf}</head><body style="background:transparent">${inhalt}</body></html>`;
}

// --- Das Logo in Teilen ------------------------------------------------------
//
// Fuer die lebendigen Varianten wird das Zeichen zerlegt: ein Raster ohne die
// drei farbigen Felder, dazu die Felder einzeln. Beides schneidet ffmpeg aus
// der Originaldatei — das gelbe Ersatzfeld ist ein **Stempel aus dem Logo
// selbst** (Feld 1,0), damit Rundung und Gitterlinien exakt stimmen. Gemessen
// im 512er-Original: Felder liegen bei 114, 212 und 310, Kantenlaenge 88.
//
// Zusammengesetzt wird in Originalgroesse und **erst danach** skaliert. Wuerde
// man die Teile einzeln auf Reel-Groesse rechnen, verschoeben sie sich um bis
// zu einem Pixel gegeneinander (88 · 330/512 = 56,72).

const RASTER = [114, 212, 310], FELD = 88, LOGO_ROH = 512;
/** Die drei Felder, die im Logo Farbe tragen: oben links, oben rechts, Mitte. */
const FELDER: [number, number][] = [[0, 0], [2, 0], [1, 1]];

async function logoTeile(datenDir: string, werk: string): Promise<{ leer: string; felder: string[] }> {
  const quelle = path.join(datenDir, "assets", PROJEKT, "brand", "binderplan-logo-512.png");
  const leer = path.join(werk, "logo-leer.png");
  const felder = FELDER.map((_, i) => path.join(werk, `logo-feld-${i}.png`));
  if (fs.existsSync(leer) && felder.every((f) => fs.existsSync(f))) return { leer, felder };

  const stempel = `crop=${FELD}:${FELD}:${RASTER[1]}:${RASTER[0]}`;   // ein gelbes Feld
  const f: string[] = [`[0]split=${FELDER.length + 1}[b]${FELDER.map((_, i) => `[s${i}]`).join("")}`];
  FELDER.forEach((_, i) => f.push(`[s${i}]${stempel}[st${i}]`));
  let letzte = "[b]";
  FELDER.forEach(([sp, ze], i) => {
    const raus = i === FELDER.length - 1 ? "[out]" : `[x${i}]`;
    f.push(`${letzte}[st${i}]overlay=${RASTER[sp]}:${RASTER[ze]}${raus}`);
    letzte = raus;
  });
  await runFfmpeg(["-i", quelle, "-filter_complex", f.join(";"), "-map", "[out]", "-y", leer]);
  for (const [i, [sp, ze]] of FELDER.entries()) {
    await runFfmpeg(["-i", quelle, "-vf", `crop=${FELD}:${FELD}:${RASTER[sp]}:${RASTER[ze]}`, "-y", felder[i]!]);
  }
  return { leer, felder };
}

// --- Die Varianten -----------------------------------------------------------
//
// Jede liefert einen ffmpeg-Filtergraphen über den fünf Ebenen; `[0]` ist der
// Grund, danach Logo, Adresse, Claim, Fußzeile.

type Bau = () => string[];

/**
 * Baut aus den Logo-Teilen (Eingaenge 5–8) das Zeichen in Originalgroesse.
 * `wann` sagt je Feld, ab wann es da ist; `fallen` laesst es hineinfallen
 * statt aufzublenden.
 */
function logoKette(wann: number[], fallen: boolean): string[] {
  const f = ["[5:v]format=rgba[leer]"];
  let letzte = "[leer]";
  FELDER.forEach(([sp, ze], i) => {
    const ein = 5 + 1 + i;
    const ab = wann[i]!;
    const raus = i === FELDER.length - 1 ? "[logo512]" : `[m${i}]`;
    if (fallen) {
      // 300 px in 220 ms — im fertigen Reel rund 26 px je Bild, also weit
      // ueber der Schwelle, ab der Pixelrundung als Ruckeln auffaellt.
      const p = `min(1,max(0,(t-${s3(ab)})/0.22))`;
      f.push(`[${ein}:v]format=rgba,fade=t=in:st=${s3(ab)}:d=0.04:alpha=1[f${i}]`);
      f.push(`${letzte}[f${i}]overlay=${RASTER[sp]}:'${RASTER[ze]}-300*(1-(1-pow(1-${p},3)))':eof_action=pass${raus}`);
    } else {
      f.push(`[${ein}:v]format=rgba,fade=t=in:st=${s3(ab)}:d=0.13:alpha=1[f${i}]`);
      f.push(`${letzte}[f${i}]overlay=${RASTER[sp]}:${RASTER[ze]}${raus}`);
    }
    letzte = raus;
  });
  return f;
}

/** Einflug des Zeichens von oben, mit kurzem Nachfedern. */
const EINFLUG = (() => {
  const p = `min(1,t/0.48)`;
  const weg = `(1-pow(1-${p},3))`;
  const federn = `(28*sin(6.3*${p})*(1-${p})*(1-${p}))`;
  return `-420*(1-${weg})+${federn}`;
})();

/** Weiches Aufblenden einer Ebene über der vorherigen. */
const blende = (quelle: number, unten: string, raus: string, abMs: number, dauerMs = 320) =>
  `[${quelle}:v]format=rgba,fade=t=in:st=${s3(abMs)}:d=${s3(dauerMs)}:alpha=1[b${quelle}];` +
  `${unten}[b${quelle}]overlay=0:0${raus}`;

const VARIANTEN: Record<string, { name: string; beschreibung: string; bau: Bau; teile?: boolean }> = {
  /**
   * „Ruhig" — nichts fährt, alles blendet auf. Der Schein im Grund ist die
   * einzige Bewegung, und der ist so weich, dass Pixelrundung nicht auffällt.
   */
  a: {
    name: "Ruhig",
    beschreibung: "Alles blendet gestaffelt auf, nichts bewegt sich. Ruhigster Schluss.",
    bau: () => [
      "[0:v]format=rgba[g]",
      blende(1, "[g]", "[l]", 60, 420),
      blende(2, "[l]", "[d]", 320),
      blende(3, "[d]", "[c]", 500),
      blende(4, "[c]", "[f]", 700),
    ],
  },
  /**
   * „Einrasten" — das Logo fällt von oben herein und setzt mit leichtem
   * Überschwingen auf. Die Bewegung läuft in 480 ms über 420 px, also rund
   * 35 px je Bild: weit über der Rundungsschwelle.
   */
  b: {
    name: "Einrasten",
    beschreibung: "Das Logo fällt von oben ein und setzt auf, dann kommt der Text.",
    bau: () => {
      // Gedämpftes Einschwingen: erst über das Ziel hinaus, dann zurück.
      const p = `min(1,t/0.48)`;
      const weg = `(1-pow(1-${p},3))`;                       // weich auslaufend
      const federn = `(28*sin(6.3*${p})*(1-${p})*(1-${p}))`; // Nachschwingen, klingt ab
      return [
        "[0:v]format=rgba[g]",
        `[1:v]format=rgba[lo]`,
        `[g][lo]overlay=0:'-420+420*${weg}+${federn}':eof_action=pass[l]`,
        blende(2, "[l]", "[d]", 520),
        blende(3, "[d]", "[c]", 700),
        blende(4, "[c]", "[f]", 900),
      ];
    },
  },
  /**
   * „Wisch" — der ganze Abspann schiebt sich von unten ins Bild, wie eine
   * Karte, die ins Fach rutscht. Ein klarer Bruch zum Reel davor.
   */
  c: {
    name: "Wisch",
    beschreibung: "Der ganze Abspann schiebt sich von unten herein wie eine Karte ins Fach.",
    bau: () => {
      const p = `min(1,t/0.42)`;
      const weg = `(1-pow(1-${p},3))`;
      return [
        // Erst alles zu einem Bild stapeln, dann als Ganzes einfahren.
        "[0:v]format=rgba[g]",
        "[g][1:v]overlay=0:0[g1]",
        "[g1][2:v]overlay=0:0[g2]",
        "[g2][3:v]overlay=0:0[g3]",
        "[g3][4:v]overlay=0:0[voll]",
        `color=c=${BLAU}:s=${W}x${H}:d=${s3(ABSPANN_MS)}:r=${OUTPUT_FPS},format=rgba[unter]`,
        `[unter][voll]overlay=0:'${H}-${H}*${weg}':eof_action=pass[f]`,
      ];
    },
  },
  /**
   * „Aufbauen" — das Zeichen kommt als leeres Raster und **fuellt sich**:
   * blau, rot, blau, im Abstand von 130 ms. Danach ein kurzer Puls des ganzen
   * Logos: 7 % in 260 ms, also rund 4 px je Bild. Am Scheitel steht er ein Bild
   * lang still — das gehoert zur Bewegung und ist nicht das Zittern von frueher,
   * das ueber eine ganze Sekunde lief. Der Endzustand ist Pixel fuer Pixel das
   * Originallogo.
   */
  d: {
    name: "Aufbauen",
    beschreibung: "Leeres Raster fällt ein, die drei Felder füllen sich nacheinander, dann ein kurzer Puls.",
    teile: true,
    bau: () => [
      "[0:v]format=rgba[g]",
      ...logoKette([550, 680, 810], false),
      // Puls ab 0,95 s; die Mitte bleibt stehen, deshalb wandert y mit der Hoehe.
      `[logo512]scale=w='${LOGO_B}*(1+0.07*sin(3.14159*max(0,min(1,(t-0.95)/0.26))))':h=-1:eval=frame[logo]`,
      `[g][logo]overlay=x='(W-w)/2':y='${LOGO_Y}+(${LOGO_B}-h)/2+${EINFLUG}':eof_action=pass[l]`,
      blende(2, "[l]", "[d]", 1150),
      blende(3, "[d]", "[c]", 1320),
      blende(4, "[c]", "[f]", 1480),
    ],
  },

  /**
   * „Einfallen" — dieselbe Idee, aber die Felder fallen von oben ins Raster,
   * wie Karten, die ins Fach rutschen. Kein Puls, dafuer drei Einschlaege.
   */
  e: {
    name: "Einfallen",
    beschreibung: "Die drei Felder fallen von oben ins Raster wie Karten ins Fach.",
    teile: true,
    bau: () => [
      "[0:v]format=rgba[g]",
      ...logoKette([540, 660, 780], true),
      `[logo512]scale=${LOGO_B}:-1[logo]`,
      `[g][logo]overlay=x='(W-w)/2':y='${LOGO_Y}+${EINFLUG}':eof_action=pass[l]`,
      blende(2, "[l]", "[d]", 1080),
      blende(3, "[d]", "[c]", 1250),
      blende(4, "[c]", "[f]", 1410),
    ],
  },
};

// --- Bauen -------------------------------------------------------------------

const ebenenNamen = ["grund", "logo", "domain", "claim", "fuss"] as const;

function ebenenPfade(werk: string): Record<(typeof ebenenNamen)[number], string> {
  return Object.fromEntries(ebenenNamen.map((n) => [n, path.join(werk, `${n}.png`)])) as never;
}

/**
 * Laesst sich der Abspann ueberhaupt bauen? Er haengt am Logo des Projekts;
 * fehlt die Datei (frische Installation, Testdaten), soll das Rendern eines
 * Reels nicht daran scheitern.
 */
export function abspannVerfuegbar(datenDir: string): boolean {
  return fs.existsSync(path.join(datenDir, "assets", PROJEKT, "brand", "binderplan-logo-512.png"));
}

/**
 * Ein Abspann-Clip, stumm, genau `ABSPANN_MS` lang.
 *
 * `datenDir` ist `MP_DATA_DIR`; Zwischenstände liegen unter
 * `assets/<projekt>/abspann/` und werden wiederverwendet.
 */
export async function abspannClip(datenDir: string, variante = ABSPANN_VARIANTE, adresse = DOMAIN): Promise<string> {
  const v = VARIANTEN[variante];
  if (!v) throw new Error(`Keine Abspann-Variante „${variante}". Bekannt: ${Object.keys(VARIANTEN).join(", ")}`);
  const werk = path.join(datenDir, "assets", PROJEKT, "abspann");
  fs.mkdirSync(werk, { recursive: true });
  const dateien = ebenenPfade(werk);
  // Eine andere Adresse bekommt eine eigene Textebene und einen eigenen Clip;
  // Grund, Logo, Claim und Fußzeile bleiben geteilt.
  const kennung = adresse === DOMAIN ? "" : `-${adresse.replace(/^binderplan\.app\/?/, "").replace(/[^\w-]/g, "_") || "x"}`;
  if (kennung) dateien.domain = path.join(werk, `domain${kennung}.png`);

  if (!ebenenNamen.every((n) => fs.existsSync(dateien[n]))) {
    const logoDatei = path.join(datenDir, "assets", PROJEKT, "brand", "binderplan-logo-512.png");
    const logoUrl = dataUrlFor(logoDatei);
    if (!logoUrl) throw new Error(`Logo fehlt: ${logoDatei}`);
    const jobs: RenderJob[] = [
      { html: grundHtml(), width: W, height: H, file: dateien.grund },
      { html: logoHtml(logoUrl), width: W, height: H, transparent: true, file: dateien.logo },
      { html: textHtml("domain", adresse), width: W, height: H, transparent: true, file: dateien.domain },
      { html: textHtml("claim"), width: W, height: H, transparent: true, file: dateien.claim },
      { html: textHtml("fuss"), width: W, height: H, transparent: true, file: dateien.fuss },
    ];
    await playwrightRenderer(jobs);
  }

  const ziel = path.join(werk, `abspann-${variante}${kennung}.mp4`);
  const ebenen = ebenenNamen.map((n) => dateien[n]);
  if (v.teile) {
    const teile = await logoTeile(datenDir, werk);
    ebenen.push(teile.leer, ...teile.felder);
  }
  const eingang = ebenen.flatMap((d) => ["-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(ABSPANN_MS), "-i", d]);
  const f = v.bau();
  // Der letzte Strang heißt immer [f]; darauf noch das Ausblenden des Reels.
  f.push(`[f]fade=t=out:st=${s3(ABSPANN_MS - 420)}:d=0.42,format=yuv420p,setsar=1[vout]`);
  await runFfmpeg([...eingang, "-filter_complex", f.join(";"), "-map", "[vout]",
    "-r", String(OUTPUT_FPS), "-t", s3(ABSPANN_MS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-an", "-y", ziel]);
  return ziel;
}

/** Alle Varianten mit ihrer Beschreibung — für die Musterausgabe im Skript. */
export const ABSPANN_VARIANTEN = Object.entries(VARIANTEN).map(([k, v]) => ({ schluessel: k, name: v.name, beschreibung: v.beschreibung }));
