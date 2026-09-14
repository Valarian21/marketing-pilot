/**
 * Die Stimme für das Michi-Video erzeugen — **ein** Aufruf für den ganzen Text.
 *
 * Warum am Stück und nicht Satz für Satz: v3 wird bei Eingaben unter 250 Zeichen
 * nachweislich unzuverlässig, und nur ein durchgehender Aufruf hält die Sprechmelodie über
 * 13 Minuten. Der Text passt mit 4.509 Zeichen unter die v3-Grenze von 5.000.
 *
 * Der Endpunkt `with-timestamps` liefert für **jedes Zeichen** Anfang und Ende. Da wir aus
 * `michi-sprechfassung.json` wissen, an welcher Zeichenstelle jede Untertitelzeile beginnt,
 * lässt sich daraus die gesprochene Dauer je Zeile ausrechnen. Die ist der Taktgeber für
 * die Neuaufnahme: jeder Untertitel steht danach genau so lange, wie er gesprochen wird.
 *
 * Stimme: Simon (`K5ZVtkkBnuPY6YqXs70E`), am 13.09.2026 nach Hörproben ausgewählt — nur für
 * YouTube-Longform. `ELEVENLABS_VOICE_ID` in der `.env` bleibt bei Ela für Reels und Shorts.
 *
 * Aufruf: pnpm exec tsx scripts/michi-stimme.ts [--stimme <id>] [--trocken]
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/server/env.js";

const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const STIMME = arg("--stimme") || "K5ZVtkkBnuPY6YqXs70E";
const MODELL = arg("--modell") || "eleven_v3";
const QUELLE = path.join(process.cwd(), "assets", "stimme");
const ZIEL = process.env.MICHI_AUSGABE || path.join(process.cwd(), "data", "video-michi");

type Zeile = { nr: number; untertitel: string; gesprochen: string; trenner: string };
type Antwort = {
  audio_base64?: string;
  alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  detail?: string | { message?: string };
};

async function lauf() {
  const { zeilen } = JSON.parse(fs.readFileSync(path.join(QUELLE, "michi-sprechfassung.json"), "utf8")) as { zeilen: Zeile[] };

  // Denselben Text noch einmal zusammensetzen und dabei die Zeichenbereiche je Zeile merken.
  let text = "";
  const bereiche = zeilen.map((z) => {
    text += z.trenner ?? "";
    const start = text.length;
    text += z.gesprochen;
    return { nr: z.nr, start, ende: text.length };
  });
  if (text.length > 5000) throw new Error(`${text.length} Zeichen — über der v3-Grenze von 5.000.`);
  console.log(`${text.length} Zeichen · ${zeilen.length} Zeilen · Stimme ${STIMME} · Modell ${MODELL}`);
  if (process.argv.includes("--trocken")) { console.log("Trockenlauf, nichts gesendet."); return; }

  const env = loadEnv();
  if (!env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY fehlt.");
  const t0 = Date.now();
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${STIMME}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text, model_id: MODELL, language_code: "de",
      // Stabilität 0.5 = „Natural". „Robust" würde die Absatzpausen einebnen, die unsere
      // einzige Pausensteuerung sind — v3 kennt keine <break>-Tags.
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const daten = (await res.json()) as Antwort;
  if (!res.ok || !daten.audio_base64) {
    const m = typeof daten.detail === "string" ? daten.detail : daten.detail?.message ?? `HTTP ${res.status}`;
    throw new Error(`ElevenLabs: ${m}`);
  }

  fs.mkdirSync(ZIEL, { recursive: true });
  const mp3 = path.join(ZIEL, "stimme.mp3");
  fs.writeFileSync(mp3, Buffer.from(daten.audio_base64, "base64"));

  const al = daten.alignment;
  if (!al || al.characters.length !== text.length) {
    throw new Error(`Zeitmessung passt nicht (${al?.characters.length ?? 0} statt ${text.length} Zeichen) — ohne sie ist die Neuaufnahme blind.`);
  }
  // Je Zeile: erste und letzte **gesprochene** Zeichenzeit. Führende Leerzeichen und
  // Umbrüche haben eigene Zeitstempel und würden die Dauer künstlich strecken.
  const zeiten = bereiche.map((b) => {
    let von = b.start, bis = b.ende - 1;
    while (von < bis && /\s/.test(al.characters[von])) von++;
    while (bis > von && /\s/.test(al.characters[bis])) bis--;
    return {
      nr: b.nr,
      untertitel: zeilen[b.nr].untertitel,
      startMs: Math.round(al.character_start_times_seconds[von] * 1000),
      endeMs: Math.round(al.character_end_times_seconds[bis] * 1000),
    };
  });
  const gesamt = al.character_end_times_seconds[al.character_end_times_seconds.length - 1];
  fs.writeFileSync(path.join(ZIEL, "stimme-zeiten.json"), JSON.stringify({ datei: path.basename(mp3), stimme: STIMME, modell: MODELL, dauerMs: Math.round(gesamt * 1000), zeilen: zeiten }, null, 1));

  const laengste = [...zeiten].sort((a, b) => (b.endeMs - b.startMs) - (a.endeMs - a.startMs))[0];
  console.log(`\nStimme: ${mp3} (${(fs.statSync(mp3).size / 1e6).toFixed(1)} MB, ${(gesamt / 60).toFixed(1)} min reine Sprechzeit)`);
  console.log(`Zeiten: ${path.join(ZIEL, "stimme-zeiten.json")} · ${zeiten.length} Zeilen · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`Längste Zeile: ${((laengste.endeMs - laengste.startMs) / 1000).toFixed(1)} s — „${laengste.untertitel.slice(0, 60)}"`);
  console.log(`Verbraucht: ~${text.length} Credits.`);
}

lauf().catch((e) => { console.error(e); process.exit(1); });
