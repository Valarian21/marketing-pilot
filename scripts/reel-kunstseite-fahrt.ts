/**
 * Kamerafahrt-Reel über eine Kunstseite — ohne Bildschirmaufnahme, ohne Foto.
 *
 * Eine Binder-Kunstseite ist 1472 × 2032 groß und damit breiter, als ein Reel
 * (9:16) zeigen kann. Statt schwarzer Balken — von Instagram ausdrücklich als
 * Grund für weniger Reichweite genannt — fährt die Kamera **durch** das Bild:
 * ein 720 × 1280-Fenster wandert von unten rechts nach oben links, also genau
 * über die Fächer 8 → 4 → 0. Bei der 151er-Glurak-Seite ist das die
 * Entwicklungsreihe: Glumanda unten in der Schlucht, Glutexo auf halber Höhe,
 * Glurak über dem Vulkan. Zum Schluss ein harter Schnitt auf die ganze Seite,
 * die auf einer unscharfen Fassung ihrer selbst liegt — Fläche gefüllt, keine
 * Balken.
 *
 * Der Takt kommt aus der Stimme, nicht aus geschätzten Sekunden: ElevenLabs
 * liefert je Satz Anfang und Ende, und Fahrt, Schnitt und Texte hängen sich
 * daran. Wird ein Satz länger, verschiebt sich alles mit.
 *
 * Aufruf: `pnpm exec tsx scripts/reel-kunstseite-fahrt.ts --plan glurak [--ohne-stimme]`
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, newId, nowIso, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { playwrightRenderer, dataUrlFor } from "../src/server/agents/studio/render.js";
import { fontHead } from "../src/server/agents/studio/fonts.js";
import { createVoiceProvider } from "../src/server/agents/video/voice.js";
import { runFfmpeg, pickMusic, OUTPUT_FPS } from "../src/server/agents/video/assemble.js";
import { bookRun } from "../src/server/audit.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const s3 = (ms: number) => (ms / 1000).toFixed(3);
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const hatFlagge = (name: string) => process.argv.includes(name);

// --- Drehbuch ----------------------------------------------------------------
//
// `sprich` ist der Ton, `zeig` steht im Bild. Beides sagt dasselbe, aber nicht
// mit denselben Worten: 85 bis 92 % sehen Reels ohne Ton, der Text muss also
// allein tragen — und wer den Ton anhat, soll nicht mitlesen, was er hört.

interface Takt { id: string; sprich: string; zeig: string; stil: "hook" | "satz" | "daten" | "schluss" }

/**
 * Wörter, die das Sprachmodell falsch liest — nur der **gesprochene** Text wird ersetzt,
 * im Bild steht weiter die richtige Schreibweise.
 *
 * „Binder" liest das Modell englisch („BAI-nder"), weil es als englisches Lehnwort im
 * Training steht. Das doppelte n erzwingt das kurze i, also die deutsche Aussprache.
 */
const AUSSPRACHE: [RegExp, string][] = [
  // Pokémon-Namen: Silben trennen, sonst verschluckt das Modell die Betonung.
  [/\bGlumanda\b/g, "Glu-manda"],
  [/\bGlutexo\b/g, "Glu-tekso"],
  [/\bGlurak\b/g, "Gluh-rak"],
];
const gesprochen = (text: string): string => AUSSPRACHE.reduce((t, [von, nach]) => t.replace(von, nach), text);

interface Plan {
  artwork: string;          // Kunstseiten-Id in Binderplan
  quelle: string;           // PNG der Seite
  titel: string;
  takte: Takt[];
  caption: string;
  hashtags: string[];
  /** Fenster startet unten rechts und endet oben links — Fach 8 → 4 → 0. */
  von: { x: number; y: number };
  bis: { x: number; y: number };
}

const PLAENE: Record<string, Plan> = {
  glurak: {
    artwork: "_JoY2MluG11O",
    quelle: "kunstseite-_JoY2MluG11O.png",
    titel: "Drei Slabs. Oder eine Schlucht.",
    von: { x: 752, y: 752 },
    bis: { x: 0, y: 0 },
    takte: [
      { id: "hook", stil: "hook", sprich: "Das 151er-Trio verdient eine eigene Seite.", zeig: "Das 151er-Trio\nverdient eine\neigene Seite." },
      { id: "unten", stil: "satz", sprich: "Ganz unten sitzt Glumanda. Da hat es bei uns allen angefangen.", zeig: "Ganz unten: Glumanda.\nDa fängt alles an." },
      { id: "mitte", stil: "satz", sprich: "Drüber Glutexo, halb den Fels hoch.", zeig: "Drüber Glutexo,\nhalb den Fels hoch." },
      { id: "oben", stil: "satz", sprich: "Und oben Glurak. Die Reihe, die du als Kind durchgespielt hast.", zeig: "Und oben Glurak.\nÜber dem Vulkan." },
      { id: "binder", stil: "satz", sprich: "Auf einer Seite die ganze Entwicklung.", zeig: "Im Binder: eine Seite,\ndie ganze Entwicklung." },
      { id: "schluss", stil: "schluss", sprich: "Einzeln ist jede nur eine Karte. Zusammen sind sie eine Geschichte.", zeig: "Einzeln im Slab ist es\nnur eine Karte." },
    ],
    caption: `Das 151er-Trio verdient eine eigene Seite. Keine drei Slabs.

Ganz unten sitzt Glumanda auf seinem Stein, da fängt alles an. Drüber Glutexo, halb den Fels hoch. Und oben Glurak über dem Vulkan. Dieselbe Reihe, die du als Kind durchgespielt hast — auf einer Seite, in einem Bild.

Binderplan hat die Artworks der drei Karten zu einer Schlucht weitergemalt, über alle neun Fächer. Ausgedruckt in 63 × 88 mm, die drei Kartenfächer bleiben frei.

Einzeln im Plastik ist jede nur eine Karte. Zusammen sind sie eine Geschichte.

Die Bilder sind KI-erzeugt und stehen so auch dran. Die Karten sind echt.

Welche Reihe würdest du so aufziehen?`,
    hashtags: ["#pokemon151", "#glurak", "#binderart", "#binderplan"],
  },
};

// --- Bildfläche --------------------------------------------------------------

const W = 1080, H = 1920;
/**
 * Das Fenster der Fahrt, 9:16 auf der 1472 × 2032-Seite.
 *
 * Erster Versuch waren 620 × 1102 — die Fahrt lief zwar sauber, aber das Fenster
 * schnitt mitten durch die Karten: zu sehen waren Attackentexte, nicht die
 * Schlucht. 720 × 1280 fasst jede der drei Karten ganz (ein Fach ist 491 × 677)
 * und lässt Fels drumherum stehen. Preis dafür: der Weg wird kürzer, 752 statt
 * 930 Pixel — deshalb startet die Fahrt erst nach dem Hook, statt langsamer zu
 * werden.
 */
const FENSTER_B = 720, FENSTER_H = 1280;
/**
 * Die ganze Seite im Bild — Breite und oberer Rand.
 *
 * 900 px ist die Blattbreite in beiden Standbildern — ganze Seite und Binderansicht
 * benutzen denselben Wert, damit beim Überblenden keine Karte springt. Unten bleibt
 * Platz für die Textzeile.
 */
const SEITE_B = 900, SEITE_Y = 148;
const VORLAUF_MS = 900;                     // Musik atmet, bevor der erste Satz kommt
const NACHLAUF_MS = 800;

/** Weiches Ein- und Ausschwingen der Fahrt, damit sie nicht ruckartig startet. */
const EASE = (p: string) => `(${p})*(${p})*(3-2*(${p}))`;

function textOverlayHtml(takt: Takt, kitFarbe: string): string {
  const gross = takt.stil === "hook";
  const daten = takt.stil === "daten";
  const zeilen = takt.zeig.split("\n").map((z) => `<span>${z}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .flaeche{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;
             padding:0 96px 470px 88px}
    .schleier{position:absolute;left:0;right:0;bottom:0;height:960px;
              background:linear-gradient(to top,rgba(0,0,0,.82) 0%,rgba(0,0,0,.62) 34%,rgba(0,0,0,0) 100%)}
    .text{position:relative;display:flex;flex-direction:column;gap:10px;
          font-family:${gross || daten ? "'Bungee'" : "'Archivo'"},system-ui,sans-serif;
          font-weight:${gross || daten ? 400 : 800};
          font-size:${gross ? 74 : daten ? 62 : 54}px;
          line-height:${gross ? 1.06 : 1.18};
          letter-spacing:${gross ? "-.01em" : "0"};
          color:#fff;
          text-shadow:0 4px 26px rgba(0,0,0,.92), 0 2px 6px rgba(0,0,0,.8);
          text-transform:${gross ? "uppercase" : "none"}}
    .strich{position:relative;width:96px;height:9px;background:${kitFarbe};margin-bottom:26px;
            box-shadow:0 2px 14px rgba(0,0,0,.6)}
  </style></head><body>
    <div class="schleier"></div>
    <div class="flaeche"><div class="strich"></div><div class="text">${zeilen}</div></div>
  </body></html>`;
}

/** Der kleine Dauerhinweis unten — Kennzeichnung, die nicht erst im Abspann kommt. */
function kennzeichnungHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .z{position:absolute;left:88px;bottom:404px;font-family:'Archivo',system-ui,sans-serif;font-weight:600;
       font-size:27px;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.84);
       text-shadow:0 2px 12px rgba(0,0,0,.95)}
  </style></head><body><div class="z">Bild: KI · Karten: echt</div></body></html>`;
}

/**
 * Die Seite so, wie sie im Binder liegt: neun Karten, dazwischen die Hüllennähte.
 *
 * **Die Seite besteht nicht aus Dritteln.** Binderplan rechnet sie in Millimetern:
 * Karte 63 × 88, Naht 4, macht 197 × 272 mm für ein 3×3-Blatt (`artwork.py`,
 * `_seite_mm`). Ein Fach ist also 63 von 67 mm breit, nicht 1472/3 Pixel. Die erste
 * Fassung teilte stumpf in Drittel und nahm damit je eine halbe Naht ins Fach —
 * die Karten füllten ihr Feld nicht und waren um 1,2 % gestaucht (Verhältnis 0,7244
 * statt 0,7159). Jetzt sitzt in jedem Fach genau das Kartenrechteck.
 *
 * Weil das Bild exakt drei Karten plus zwei Nähte breit ist, ist die Hintergrundgröße
 * schlicht die Blattgröße — und die Fuge zwischen den Fächern ist die echte 4-mm-Naht.
 * Beim Überblenden bleibt deshalb jede Karte, wo sie ist; es verschwindet nur das,
 * was beim Zuschneiden des Druckbogens ohnehin abfällt.
 */
function binderSeiteHtml(seiteDataUrl: string): string {
  const KARTE_MM = 63, HOEHE_MM = 88, NAHT_MM = 4;
  const blattB = SEITE_B;                                   // 3 Karten + 2 Nähte
  const FACH_B = blattB * KARTE_MM / (3 * KARTE_MM + 2 * NAHT_MM);
  const fuge = blattB * NAHT_MM / (3 * KARTE_MM + 2 * NAHT_MM);
  const FACH_H = FACH_B * HOEHE_MM / KARTE_MM;
  const blattH = 3 * FACH_H + 2 * fuge;
  const px = (n: number) => `${n.toFixed(2)}px`;
  const felder = Array.from({ length: 9 }, (_, i) => {
    const spalte = i % 3, zeile = Math.floor(i / 3);
    return `<div class="fach" style="background-position:-${px(spalte * (FACH_B + fuge))} -${px(zeile * (FACH_H + fuge))}"></div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:#0b0c0e;overflow:hidden}
    .grund{position:absolute;inset:-60px;background:url('${seiteDataUrl}') center/cover no-repeat;
           filter:blur(46px) brightness(.44) saturate(.7)}
    .blatt{position:absolute;left:${px((W - blattB) / 2)};top:${SEITE_Y}px;width:${px(blattB)};height:${px(blattH)};
           display:grid;grid-template-columns:repeat(3,${px(FACH_B)});grid-template-rows:repeat(3,${px(FACH_H)});gap:${px(fuge)}}
    .fach{position:relative;border-radius:6px;
          background-image:url('${seiteDataUrl}');background-size:${px(blattB)} ${px(blattH)};background-repeat:no-repeat;
          box-shadow:0 6px 22px rgba(0,0,0,.55), inset 0 0 0 1.5px rgba(255,255,255,.16)}
    /* Der Glanz der Hülle: eine schmale Diagonale, sonst wirkt es wie aufgeklebtes Papier. */
    .fach::after{content:"";position:absolute;inset:0;border-radius:6px;
                 background:linear-gradient(118deg,rgba(255,255,255,.17) 0%,rgba(255,255,255,.03) 26%,
                            rgba(255,255,255,0) 46%,rgba(255,255,255,.07) 84%,rgba(255,255,255,0) 100%)}
  </style></head><body><div class="grund"></div><div class="blatt">${felder}</div></body></html>`;
}

// --- Lauf --------------------------------------------------------------------

const planName = arg("--plan") ?? "glurak";
const plan = PLAENE[planName];
if (!plan) throw new Error(`Kein Plan „${planName}". Bekannt: ${Object.keys(PLAENE).join(", ")}`);

const env = loadEnv();

// Stimme je Lauf umstellbar — `eleven_v3` ist das ausdrucksstarke Modell und schwankt bei
// ruhiger Erzählung hörbar; `eleven_multilingual_v2` liest gleichmäßiger. Etwas mehr
// Stabilität und ein Hauch Stil machen den Ton wärmer statt vorgelesen.
if (arg("--stimme")) env.ELEVENLABS_VOICE_ID = arg("--stimme")!;
env.ELEVENLABS_MODEL = arg("--modell") ?? "eleven_multilingual_v2";
env.ELEVENLABS_STABILITY = Number(arg("--stabil") ?? 0.55);
env.ELEVENLABS_SIMILARITY = 0.8;
env.ELEVENLABS_STYLE = Number(arg("--stil") ?? 0.15);
env.ELEVENLABS_SPEAKER_BOOST = "true";

const { db } = openDatabase(env.MP_DATA_DIR);
const kit = loadBrandKit(db, PROJEKT);
// Das Binderplan-Gelb, nicht das Blau: über einer dunklen Schlucht ist Blau unsichtbar.
const akzent = kit.accent2 ?? kit.colors?.[1] ?? "#F5C518";

const quelle = path.join(env.MP_DATA_DIR, "assets", PROJEKT, plan.quelle);
if (!fs.existsSync(quelle)) throw new Error(`Kunstseite fehlt: ${quelle}`);

const pieceId = newId();
const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
const arbeit = path.join(outDir, "arbeit");
fs.mkdirSync(arbeit, { recursive: true });

// 1. Stimme — sie gibt den Takt vor, nicht umgekehrt.
const stimme = hatFlagge("--ohne-stimme") ? null : createVoiceProvider(env);
let stimmDatei: string | null = null;
let abschnitte: { id: string; startMs: number; endMs: number }[];

if (stimme?.synthesizeScript) {
  const t0 = Date.now();
  const r = await stimme.synthesizeScript(
    plan.takte.map((x) => ({ id: x.id, text: gesprochen(x.sprich) })),
    { language: "de" },
    path.join(arbeit, "stimme"),
  );
  stimmDatei = r.file;
  abschnitte = r.parts.map((p) => ({ id: p.id, startMs: p.startMs + VORLAUF_MS, endMs: p.endMs + VORLAUF_MS }));
  const zeichen = plan.takte.reduce((n, x) => n + x.sprich.length, 0);
  bookRun(db, {
    task: "reel.voice", model: `elevenlabs/${env.ELEVENLABS_VOICE_ID ?? "voice"}`, provider: "elevenlabs",
    projectId: PROJEKT, pieceId, costUsd: (zeichen / 1000) * env.ELEVENLABS_USD_PER_1K_CHARS, durationMs: Date.now() - t0,
  });
  console.log(`Stimme: ${Math.round(r.durationMs / 1000)} s, ${zeichen} Zeichen`);
} else {
  // Notlauf ohne Schlüssel: geschätzte Zeiten, damit man das Bild trotzdem sieht.
  let acc = VORLAUF_MS;
  abschnitte = plan.takte.map((x) => {
    const ms = Math.max(1400, x.sprich.split(/\s+/).length * 380 + 300);
    const o = { id: x.id, startMs: acc, endMs: acc + ms }; acc += ms + 700; return o;
  });
  console.log("Ohne Stimme gerendert (kein ElevenLabs-Schlüssel oder --ohne-stimme).");
}

const takt = (id: string) => abschnitte.find((a) => a.id === id)!;
const gesamtMs = takt("schluss").endMs + NACHLAUF_MS;
// Der Schnitt sitzt auf dem Satz „So sieht das im Binder aus" — erst die ganze Seite,
// dann legen sich die Fächer darüber. Das Auftauchen der Zwischenräume ist die Pointe.
const schnittMs = takt("binder").startMs - 260;
const fahrtMs = schnittMs;
const seiteMs = gesamtMs - schnittMs;
const BLENDE_MS = 800;
const haltMs = Math.min(1500, Math.max(700, takt("binder").endMs - takt("binder").startMs - 400));
console.log(`Länge: ${(gesamtMs / 1000).toFixed(1)} s — Fahrt ${(fahrtMs / 1000).toFixed(1)} s, ganze Seite ${(seiteMs / 1000).toFixed(1)} s`);
for (const a of abschnitte) console.log(`   ${a.id.padEnd(6)} ${s3(a.startMs)}–${s3(a.endMs)} s`);

// 2. Bildspur, Teil 1: die Fahrt von Fach 8 nach Fach 0.
const fahrtDatei = path.join(arbeit, "fahrt.mp4");
// Während des Hooks steht die Kamera auf Glumanda; erst danach klettert sie — und sie ist
// **oben angekommen, während der Satz dazu läuft**, nicht erst danach. Beim ersten Lauf lief
// die Fahrt bis zum Schnitt durch, da war Glurak beim Satz „fliegt oben drüber" noch
// angeschnitten; jetzt endet sie kurz nach dem Einsatz und steht die restliche Zeit still.
const losMs = Math.max(0, takt("unten").startMs - 400);
const ankunftMs = Math.min(fahrtMs, takt("oben").startMs + 900);
const p = `min(1,max(0,(t-${(losMs / 1000).toFixed(3)})/${((ankunftMs - losMs) / 1000).toFixed(3)}))`;
const e = EASE(p);
await runFfmpeg([
  "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(fahrtMs), "-i", quelle,
  "-vf", [
    `crop=${FENSTER_B}:${FENSTER_H}:x='${plan.von.x}+(${plan.bis.x}-${plan.von.x})*(${e})':y='${plan.von.y}+(${plan.bis.y}-${plan.von.y})*(${e})'`,
    `scale=${W}:${H}:flags=lanczos`, "setsar=1",
  ].join(","),
  "-r", String(OUTPUT_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", fahrtDatei,
]);

// 3. Bildspur, Teil 2: ganze Seite auf unscharfem Grund — Fläche gefüllt statt Balken.
const grundDatei = path.join(arbeit, "ganze-seite.png");
await runFfmpeg([
  "-i", quelle, "-filter_complex", [
    `[0:v]scale=-1:${H}:flags=lanczos,crop=${W}:${H},gblur=sigma=44,eq=brightness=-0.30:saturation=0.7[bg]`,
    `[0:v]scale=${SEITE_B}:-1:flags=lanczos[fg]`,
    `[bg][fg]overlay=(W-w)/2:${SEITE_Y}[out]`,
  ].join(";"), "-map", "[out]", "-frames:v", "1", grundDatei,
]);

// Die Binderansicht: dieselbe Seite, aber in neun Fächern mit Zwischenräumen — so, wie
// sie im Binder wirklich liegt. Ohne die Fugen sieht ein Betrachter ein Poster, kein
// Binderblatt; genau daran hing der Beitrag vorher.
const binderDatei = path.join(arbeit, "binderansicht.png");
await playwrightRenderer([{ html: binderSeiteHtml(dataUrlFor(quelle) ?? ""), width: W, height: H, file: binderDatei }]);

// Phase 2 als Überblendung: erst die ganze Seite stehen lassen, dann die Fächer einblenden.
const seiteDatei = path.join(arbeit, "seite.mp4");
await runFfmpeg([
  "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(haltMs + BLENDE_MS), "-i", grundDatei,
  "-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(seiteMs - haltMs), "-i", binderDatei,
  "-filter_complex", `[0:v][1:v]xfade=transition=fade:duration=${s3(BLENDE_MS)}:offset=${s3(haltMs)},format=yuv420p,setsar=1[v]`,
  "-map", "[v]", "-r", String(OUTPUT_FPS), "-t", s3(seiteMs),
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", seiteDatei,
]);

// 4. Texte im Bild.
const jobs = plan.takte.map((x) => ({
  html: textOverlayHtml(x, akzent), width: W, height: H, transparent: true,
  file: path.join(arbeit, `text-${x.id}.png`),
}));
jobs.push({ html: kennzeichnungHtml(), width: W, height: H, transparent: true, file: path.join(arbeit, "text-kennzeichnung.png") });
await playwrightRenderer(jobs);

// 5. Alles zusammen: Bild, Text, Stimme, Musik.
const einblendungen = plan.takte.map((x) => {
  const a = takt(x.id);
  const start = x.id === "hook" ? 250 : a.startMs - 220;
  const ende = x.id === "cta" ? gesamtMs : a.endMs + 520;
  return { datei: path.join(arbeit, `text-${x.id}.png`), startMs: Math.max(0, start), endMs: Math.min(gesamtMs, ende) };
});
einblendungen.push({ datei: path.join(arbeit, "text-kennzeichnung.png"), startMs: schnittMs, endMs: gesamtMs });

const musik = pickMusic(path.join(env.MP_DATA_DIR, "..", "assets", "music"));
const eingang: string[] = [];
let n = 0;
const add = (...a: string[]) => { eingang.push(...a); return n++; };
const A = add("-i", fahrtDatei);
const B = add("-i", seiteDatei);
// Jede Einblendung als eigene Schleife mit Startversatz — ein Einzelbild ohne `-loop`
// liegt nach dem ersten Frame auf EOF und wäre im Video nie zu sehen.
const texte = einblendungen.map((c) => ({
  ...c,
  idx: add("-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(c.endMs - c.startMs), "-itsoffset", s3(c.startMs), "-i", c.datei),
}));
const STIMME = stimmDatei ? add("-i", stimmDatei) : -1;
const MUSIK = musik ? add("-i", musik) : -1;

const f: string[] = [`[${A}:v][${B}:v]concat=n=2:v=1:a=0[bild]`];
let letzte = "[bild]";
texte.forEach((c, k) => {
  const raus = `[t${k}]`;
  f.push(`[${c.idx}:v]format=rgba,setsar=1[o${k}]`);
  f.push(`${letzte}[o${k}]overlay=0:0:eof_action=pass:enable='between(t,${s3(c.startMs)},${s3(c.endMs)})'${raus}`);
  letzte = raus;
});
f.push(`${letzte}fade=t=in:st=0:d=0.35,fade=t=out:st=${s3(gesamtMs - 500)}:d=0.5,format=yuv420p[vout]`);

if (STIMME >= 0) f.push(`[${STIMME}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${VORLAUF_MS}|${VORLAUF_MS},apad=whole_dur=${s3(gesamtMs)},atrim=duration=${s3(gesamtMs)}[voice]`);
else f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(gesamtMs)}[voice]`);

if (MUSIK >= 0) {
  f.push(`[voice]asplit=2[voice_a][voice_sc]`,
    `[${MUSIK}:a]aresample=44100,aformat=channel_layouts=stereo,loudnorm=I=-30:TP=-6:LRA=9,atrim=duration=${s3(gesamtMs)},afade=t=in:st=0:d=1.0,afade=t=out:st=${s3(Math.max(0, gesamtMs - 2200))}:d=2.2[musikroh]`,
    `[musikroh][voice_sc]sidechaincompress=threshold=0.012:ratio=10:attack=40:release=700:level_sc=1.5[musikd]`,
    `[voice_a][musikd]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
} else f.push(`[voice]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);

const reel = path.join(outDir, "reel.mp4");
await runFfmpeg([...eingang, "-filter_complex", f.join(";"),
  "-map", "[vout]", "-map", "[aout]", "-r", String(OUTPUT_FPS), "-t", s3(gesamtMs),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
  "-metadata", "comment=AI-generated: true (Binderplan Kunstseite, Marketing Pilot)",
  "-metadata", `title=${plan.titel}`, reel]);

// 6. Als Stück eintragen, damit es durch Freigabe und Zeitplan laufen kann.
// Reihenfolge ist Pflicht: `mp_assets.content_piece_id` zeigt auf das Stück, also muss
// das Stück zuerst stehen. Andersherum bricht der Fremdschlüssel (beim ersten Lauf passiert).
const ts = nowIso();
const assetId = newId();
db.insert(t.mpContentPieces).values({
  id: pieceId, projectId: PROJEKT, taskId: null, channel: "instagram", format: "artwork_reel",
  title: `${plan.titel} · instagram`,
  body: `${plan.caption}\n\n${plan.hashtags.join(" ")}`,
  assets: toJson([assetId]), status: "review", humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}",
  meta: toJson({
    platform: "instagram", language: "de", size: `${W}x${H}`, linkRule: "bio",
    caption: plan.caption, hashtags: plan.hashtags, artwork: plan.artwork,
    kunstseitenFahrt: true, dauerMs: gesamtMs,
    takte: abschnitte, anheften: false,
  }),
  aiTellScore: null, aiTellNotes: "Kamerafahrt über eine eigene Kunstseite, Texte von Hand.", rejectionReason: "",
  createdAt: ts, updatedAt: ts,
}).run();
db.insert(t.mpAssets).values({
  id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video",
  path: path.relative(env.MP_DATA_DIR, reel),
  meta: toJson({ aiGenerated: true, provenance: "kunstseiten-fahrt", artwork: plan.artwork, size: `${W}x${H}` }),
  createdAt: ts,
}).run();

console.log(`\nFertig: ${reel}`);
console.log(`Stück ${pieceId} steht auf „review".`);
