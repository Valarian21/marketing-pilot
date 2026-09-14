/**
 * Die Sprachspur für das Michi-Video bauen: jede Zeile an ihre Stelle im Bild.
 *
 * Die Stimme entsteht als **ein** durchgehender Aufruf (`michi-stimme.ts`) — im Video stehen
 * zwischen den Sätzen aber Wartezeiten, Klickwege und Ladebalken. Legt man die Aufnahme am
 * Stück unter, läuft sie den Untertiteln nach zwei Minuten davon.
 *
 * Also wird die Sprachaufnahme an den gemessenen Zeilengrenzen zerlegt und jedes Stück auf
 * den Zeitpunkt gesetzt, an dem der zugehörige Untertitel im Bild erscheint. Geschnitten
 * wird nur in Pausen, deshalb hört man die Fugen nicht.
 *
 * Gerechnet wird in rohem PCM, nicht in einem ffmpeg-Filtergraphen: 94 `adelay`-Zweige in
 * einem Graphen ist genau die Bauform, die am 12.09. den Arbeitsspeicher gesprengt hat.
 * Eine Stunde Mono-16-Bit sind 300 MB — das trägt jeder Rechner.
 *
 * Aufruf: pnpm exec tsx scripts/michi-tonspur.ts --cues <datei> --ziel <wav>
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const ORDNER = process.env.MICHI_AUSGABE || path.join(process.cwd(), "data", "video-michi");
const RATE = 44100;

type Cue = { start: number; ende: number; text: string };
type Zeile = { nr: number; untertitel: string; startMs: number; endeMs: number };

/** Sprachaufnahme als Mono-PCM einlesen (16 Bit, 44,1 kHz). */
function pcm(datei: string): Int16Array {
  const roh = execFileSync("ffmpeg", ["-v", "error", "-i", datei, "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"],
    { maxBuffer: 1024 * 1024 * 1024, encoding: "buffer" });
  return new Int16Array(roh.buffer, roh.byteOffset, Math.floor(roh.byteLength / 2));
}

export function tonspurBauen(cues: Cue[], zeilen: Zeile[], stimmDatei: string, ziel: string, dauerS: number): { gesetzt: number; fehlend: string[] } {
  const quelle = pcm(stimmDatei);
  const out = new Int16Array(Math.ceil((dauerS + 2) * RATE));
  // Mehrfach vorkommende Untertitel (z. B. „Und wieder warten.") der Reihe nach abarbeiten,
  // sonst bekäme jede Wiederholung dieselbe Aufnahmestelle.
  const offen = new Map<string, Zeile[]>();
  for (const z of zeilen) { const l = offen.get(z.untertitel) ?? []; l.push(z); offen.set(z.untertitel, l); }
  const fehlend: string[] = [];
  let gesetzt = 0;

  for (const c of cues) {
    const l = offen.get(c.text);
    const z = l?.shift();
    if (!z) { fehlend.push(c.text); continue; }
    const von = Math.floor((z.startMs / 1000) * RATE);
    const bis = Math.min(quelle.length, Math.ceil((z.endeMs / 1000) * RATE));
    const ziel0 = Math.floor(c.start * RATE);
    for (let i = 0; i < bis - von; i++) {
      const j = ziel0 + i;
      if (j >= out.length) break;
      // Addieren statt überschreiben: überlappte die Bedienung zwei Zeilen, bliebe sonst
      // die erste stumm. Mit Begrenzung, damit es nicht übersteuert.
      const v = out[j] + quelle[von + i];
      out[j] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    gesetzt++;
  }

  const kopf = Buffer.alloc(44);
  const daten = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  kopf.write("RIFF", 0); kopf.writeUInt32LE(36 + daten.length, 4); kopf.write("WAVE", 8);
  kopf.write("fmt ", 12); kopf.writeUInt32LE(16, 16); kopf.writeUInt16LE(1, 20); kopf.writeUInt16LE(1, 22);
  kopf.writeUInt32LE(RATE, 24); kopf.writeUInt32LE(RATE * 2, 28); kopf.writeUInt16LE(2, 32); kopf.writeUInt16LE(16, 34);
  kopf.write("data", 36); kopf.writeUInt32LE(daten.length, 40);
  fs.writeFileSync(ziel, Buffer.concat([kopf, daten]));
  return { gesetzt, fehlend };
}

if (process.argv[1]?.endsWith("michi-tonspur.ts")) {
  const cues = (JSON.parse(fs.readFileSync(arg("--cues") || path.join(ORDNER, "cues.json"), "utf8")) as { cues: Cue[]; dauer: number });
  const zeiten = JSON.parse(fs.readFileSync(path.join(ORDNER, "stimme-zeiten.json"), "utf8")) as { zeilen: Zeile[] };
  const ziel = arg("--ziel") || path.join(ORDNER, "sprachspur.wav");
  const r = tonspurBauen(cues.cues, zeiten.zeilen, path.join(ORDNER, "stimme.mp3"), ziel, cues.dauer);
  console.log(`${ziel}: ${r.gesetzt} von ${cues.cues.length} Zeilen gesetzt.`);
  if (r.fehlend.length) console.log(`Ohne Aufnahme: ${r.fehlend.length}\n  ` + r.fehlend.slice(0, 5).join("\n  "));
}
