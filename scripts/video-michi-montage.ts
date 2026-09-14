/**
 * Montage für das Michi-Anleitungsvideo: Wartezeiten kürzen, Musik drunter, MP4 ausgeben.
 *
 * Die Rohaufnahme aus `video-michi.ts` enthält die echten Wartezeiten des Bildmodells
 * (66, 36 und 39 Sekunden). Die erste bleibt fast stehen — sie ist der Beweis, dass da
 * wirklich gerechnet wird —, die beiden anderen werden gekürzt. Der Schnitt liegt mitten
 * in der Ladeanimation, und die wiederholt sich: ein harter Schnitt ist dort unsichtbar.
 *
 * Die Untertitel sind in der Aufnahme schon drin (Ebene im Bild). Die .srt wird hier
 * trotzdem auf die neue Zeitachse umgerechnet — sie ist der Sprechtext für später.
 *
 * Aufruf: pnpm exec tsx scripts/video-michi-montage.ts [--roh <datei>] [--ordner <pfad>]
 */
import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, probeDurationMs } from "../src/server/agents/video/assemble.js";
import { tonspurBauen } from "./michi-tonspur.js";

const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const ORDNER = arg("--ordner") || process.env.MICHI_AUSGABE || path.join(process.cwd(), "data", "video-michi");
const MUSIK = arg("--musik") || path.join(process.cwd(), "assets", "music", "absolutesound-background-no-copyright-music-561870.mp3");

/** Wie viel vom Warten stehen bleibt. Die erste Wartezeit trägt die Erklärung, was das
 *  Modell gerade tut — sie darf lang sein. Die beiden anderen sind nur noch Wiederholung. */
const BEHALTEN = [11, 6, 6];
const LAUTSTAERKE = Number(process.env.MICHI_MUSIK_PEGEL || "0.11");   // ≈ −19 dB: Bett, kein Inhalt.
// Gemessen bei 0,08: Mittel −39,7 dB, Spitze −24,3 dB — mit Stimme darüber richtig, ohne Stimme
// eine Spur zu leise. Über MICHI_MUSIK_PEGEL nachregelbar, ohne neu aufzunehmen.
const s3 = (n: number) => n.toFixed(3);

type Schnitt = { start: number; ende: number; grund: string };
type Cue = { start: number; ende: number; text: string };

function rohDatei(): string {
  if (arg("--roh")) return arg("--roh")!;
  const dir = path.join(ORDNER, "roh");
  const dateien = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!dateien.length) throw new Error("Keine Rohaufnahme in " + dir);
  return path.join(dir, dateien[0].f);
}

/**
 * Aus den Wartezeiten die Bereiche rechnen, die herausfallen.
 *
 * Mit Stimme sprechen die Untertitel in die Wartezeit hinein („Das dauert jetzt gut eine
 * Minute", „Das Modell schaut sich die Karte an"). Ein Schnitt, der über eine solche Zeile
 * läuft, würde den Satz stumm schalten — im Bild fällt das nicht auf, im Ton schon. Der
 * Schnitt beginnt deshalb frühestens eine halbe Sekunde nach dem letzten Untertitel, der
 * in der Wartezeit steht, und endet vor dem nächsten.
 */
function wegschnitte(schnitte: Schnitt[], cues: Cue[]): { von: number; bis: number }[] {
  return schnitte
    .map((s, i) => {
      let von = s.start + (BEHALTEN[i] ?? 6);
      let bis = s.ende;
      for (const c of cues) {
        if (c.ende > von && c.start < bis) von = Math.max(von, c.ende + 0.5);   // Zeile liegt im Schnitt
      }
      for (const c of cues) {
        if (c.start > von && c.start < bis) bis = Math.min(bis, c.start - 0.3); // nächste Zeile beginnt schon
      }
      return { von, bis };
    })
    .filter((w) => w.bis - w.von > 1.5)
    .sort((a, b) => a.von - b.von);
}

/** Die Stücke, die bleiben. */
function stuecke(weg: { von: number; bis: number }[], dauer: number) {
  const out: { von: number; bis: number }[] = [];
  let cursor = 0;
  for (const w of weg) {
    if (w.von > cursor) out.push({ von: cursor, bis: w.von });
    cursor = Math.max(cursor, w.bis);
  }
  if (cursor < dauer) out.push({ von: cursor, bis: dauer });
  return out;
}

/** Alte Zeit → neue Zeit. Punkte in weggeschnittenen Bereichen rutschen auf den Schnitt. */
function umrechnen(t: number, st: { von: number; bis: number }[]) {
  let neu = 0;
  for (const s of st) {
    if (t >= s.bis) { neu += s.bis - s.von; continue; }
    if (t >= s.von) return neu + (t - s.von);
    return neu;   // liegt in einem Loch davor
  }
  return neu;
}

/**
 * Tempo je Abschnitt. Gemessen am fertigen Take: **67 % des Videos sind Stille** — 615 von
 * 920 Sekunden, die längste Lücke am Stück 63 s. Das ist die langsame Bedienung: Zeiger
 * fahren, tippen, Seiten aufbauen.
 *
 * Das ganze Video schneller abzuspielen ginge nicht: die Untertitel sind fest im Bild, bei
 * 1,5× stünde jede Zeile nur noch zwei Drittel so lange, der gesprochene Satz wäre aber
 * gleich lang — Bild und Ton liefen auseinander. Also nur die Lücken beschleunigen und
 * überall dort, wo gesprochen wird, bei 1× bleiben. Die Stimme bleibt damit unangetastet
 * und muss nicht neu erzeugt werden.
 *
 * Kurze Lücken bleiben in Ruhe: unter `MIN_LUECKE` lohnt sich der Tempowechsel nicht und
 * würde nur zappelig wirken.
 */
const TEMPO = Number(process.env.MICHI_TEMPO || "2.0");
const MIN_LUECKE = 1.5;

type Abschnitt = { von: number; bis: number; tempo: number };

/** Sprechzeitraum je Untertitel auf der Rohzeitachse: ab dem Erscheinen, so lang wie der Satz. */
function sprechzeiten(cues: Cue[], zeilen: { untertitel: string; startMs: number; endeMs: number }[]): { von: number; bis: number }[] {
  const offen = new Map<string, { startMs: number; endeMs: number }[]>();
  for (const z of zeilen) { const l = offen.get(z.untertitel) ?? []; l.push(z); offen.set(z.untertitel, l); }
  const out: { von: number; bis: number }[] = [];
  for (const c of cues) {
    const z = offen.get(c.text)?.shift();
    if (!z) continue;
    out.push({ von: c.start, bis: Math.min(c.ende, c.start + (z.endeMs - z.startMs) / 1000) });
  }
  return out;
}

/** Aus den behaltenen Stücken und den Sprechzeiten die Abschnitte mit ihrem Tempo bauen. */
function tempoKarte(st: { von: number; bis: number }[], sprechen: { von: number; bis: number }[]): Abschnitt[] {
  const out: Abschnitt[] = [];
  for (const stk of st) {
    let cursor = stk.von;
    for (const sp of sprechen) {
      if (sp.bis <= stk.von || sp.von >= stk.bis) continue;
      const von = Math.max(sp.von, stk.von), bis = Math.min(sp.bis, stk.bis);
      if (von > cursor) out.push({ von: cursor, bis: von, tempo: von - cursor > MIN_LUECKE ? TEMPO : 1 });
      if (bis > von) out.push({ von, bis, tempo: 1 });
      cursor = Math.max(cursor, bis);
    }
    if (stk.bis > cursor) out.push({ von: cursor, bis: stk.bis, tempo: stk.bis - cursor > MIN_LUECKE ? TEMPO : 1 });
  }
  // Gleiches Tempo nebeneinander zusammenfassen: jeder Abschnitt kostet einen ffmpeg-Lauf.
  const zus: Abschnitt[] = [];
  for (const a of out) {
    const v = zus[zus.length - 1];
    if (v && v.tempo === a.tempo && Math.abs(v.bis - a.von) < 0.001) v.bis = a.bis;
    else zus.push({ ...a });
  }
  return zus.filter((a) => a.bis - a.von > 0.04);
}

/** Rohzeit → Zeit im fertigen Video, entlang der Tempo-Karte. */
function aufTempoachse(t: number, karte: Abschnitt[]): number {
  let neu = 0;
  for (const a of karte) {
    if (t >= a.bis) { neu += (a.bis - a.von) / a.tempo; continue; }
    if (t >= a.von) return neu + (t - a.von) / a.tempo;
    return neu;   // liegt in einem herausgeschnittenen Loch davor
  }
  return neu;
}

function srt(cues: Cue[]) {
  const zeit = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sek = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sek).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return cues.map((c, i) => `${i + 1}\n${zeit(c.start)} --> ${zeit(c.ende)}\n${c.text}\n`).join("\n");
}

async function lauf() {
  const roh = rohDatei();
  const daten = JSON.parse(fs.readFileSync(path.join(ORDNER, "cues.json"), "utf8")) as
    { cues: Cue[]; schnitte: Schnitt[]; dauer: number };
  if (!fs.existsSync(MUSIK)) throw new Error("Musik fehlt: " + MUSIK);

  // Die gemessene Länge der Datei zählt, nicht die mitgeschriebene: die Aufnahme läuft noch
  // ein paar Zehntel weiter, nachdem das Skript fertig ist.
  const dauer = (await probeDurationMs(roh)) / 1000;
  const weg = wegschnitte(daten.schnitte, daten.cues);
  const st = stuecke(weg, dauer);
  // Sprechzeiten holen — sie entscheiden, wo 1× gilt und wo beschleunigt wird.
  const zeitenDatei = path.join(ORDNER, "stimme-zeiten.json");
  const zeilen = fs.existsSync(zeitenDatei)
    ? (JSON.parse(fs.readFileSync(zeitenDatei, "utf8")) as { zeilen: { nr: number; untertitel: string; startMs: number; endeMs: number }[] }).zeilen
    : [];
  const sprechen = sprechzeiten(daten.cues, zeilen);
  const karte = zeilen.length ? tempoKarte(st, sprechen) : st.map((x) => ({ ...x, tempo: 1 }));
  const neueDauer = karte.reduce((s, a) => s + (a.bis - a.von) / a.tempo, 0);
  const geschnitten = st.reduce((s, x) => s + (x.bis - x.von), 0);

  console.log(`Roh: ${(dauer / 60).toFixed(1)} min · ${weg.length} Wartezeiten gekürzt → ${(geschnitten / 60).toFixed(1)} min`);
  for (const [i, w] of weg.entries()) console.log(`  − ${(w.bis - w.von).toFixed(0)} s  (${daten.schnitte[i]?.grund || "?"})`);
  if (zeilen.length) {
    const schnell = karte.filter((a) => a.tempo > 1);
    const gespart = schnell.reduce((s, a) => s + (a.bis - a.von) * (1 - 1 / a.tempo), 0);
    console.log(`Tempo: ${schnell.length} Lücken auf ${TEMPO}× (${gespart.toFixed(0)} s gespart), Sprache bleibt 1×`);
  }
  console.log(`Fertig: ${Math.floor(neueDauer / 60)}:${String(Math.round(neueDauer % 60)).padStart(2, "0")} min · ${karte.length} Abschnitte`);

  // Abschnittsweise kodieren statt in einem Filtergraphen. Mehrere `trim`-Zweige auf
  // demselben Eingang zwingen ffmpeg, das ganze dekodierte Video zu puffern, bis der letzte
  // Zweig dran ist — gemessen 9–10 GB, zweimal vom OOM-Killer beendet (12. und 13.09.).
  // Jeder Abschnitt einzeln, per concat-Demuxer aneinander, Ton im zweiten Durchgang ohne
  // Neukodierung des Bildes: Spitzenbedarf bleibt bei wenigen hundert MB.
  const tmp = path.join(ORDNER, "schnitt");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const teilDateien: string[] = [];
  for (const [i, a] of karte.entries()) {
    const teil = path.join(tmp, `teil${String(i).padStart(3, "0")}.mp4`);
    if (i % 10 === 0 || a.tempo > 1) console.log(`  ${i + 1}/${karte.length}: ${s3(a.von)}–${s3(a.bis)} s${a.tempo > 1 ? `  ${a.tempo}×` : ""}`);
    await runFfmpeg([
      // `-t` gehört **vor** `-i`: als Ausgabeoption begrenzt es die Länge des Ergebnisses,
      // und ffmpeg liest dann bei doppeltem Tempo einfach doppelt so viel Quelle nach, um
      // sie zu füllen — die Abschnitte überlappen sich, das Video bleibt gleich lang.
      // Als Eingabeoption begrenzt es, wie viel gelesen wird. Genau das wollen wir.
      "-ss", s3(a.von), "-t", s3(a.bis - a.von), "-i", roh,
      "-an", "-vf", `setpts=PTS/${a.tempo}`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "25",
      "-pix_fmt", "yuv420p", "-vsync", "cfr", teil,
    ]);
    teilDateien.push(teil);
  }

  const liste = path.join(tmp, "liste.txt");
  fs.writeFileSync(liste, teilDateien.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const stumm = path.join(tmp, "stumm.mp4");
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", stumm]);

  // Untertitel auf die neue Zeitachse — sie sind zugleich die Positionen für die Stimme.
  // Das Ende wird über die Karte gerechnet, der Anfang ebenso: beides liegt in 1×-Bereichen,
  // solange dort gesprochen wird, die Stimme passt also unverändert hinein.
  const neueCues = daten.cues
    .map((c) => ({ start: aufTempoachse(c.start, karte), ende: aufTempoachse(c.ende, karte), text: c.text }))
    .filter((c) => c.ende - c.start > 0.3);

  // Sprachspur: jede Zeile an ihre Stelle im geschnittenen Bild.
  const stimmDatei = path.join(ORDNER, "stimme.mp3");
  let sprache: string | null = null;
  if (fs.existsSync(stimmDatei) && zeilen.length) {
    sprache = path.join(tmp, "sprache.wav");
    const r = tonspurBauen(neueCues, zeilen, stimmDatei, sprache, neueDauer);
    console.log(`Sprachspur: ${r.gesetzt} von ${neueCues.length} Zeilen gesetzt.`);
    if (r.fehlend.length) console.log(`  ohne Aufnahme: ${r.fehlend.length} — ${r.fehlend.slice(0, 3).join(" | ")}`);
  } else {
    console.log("Keine Stimme gefunden — Musik allein.");
  }

  const ziel = path.join(ORDNER, "michi-30jahre.mp4");
  const musikFilter = `[1:a]atrim=0:${s3(neueDauer)},asetpts=PTS-STARTPTS,volume=${LAUTSTAERKE},` +
    `afade=t=in:st=0:d=2.5,afade=t=out:st=${s3(Math.max(0, neueDauer - 3.5))}:d=3.5`;
  await runFfmpeg([
    "-i", stumm,
    "-stream_loop", "-1", "-i", MUSIK,
    ...(sprache ? ["-i", sprache] : []),
    "-filter_complex",
    sprache
      // Musik weicht unter der Stimme: der Sidechain-Kompressor senkt das Bett, sobald
      // gesprochen wird, und lässt es in den Pausen wieder hoch. Ohne das kämpfen 13
      // Minuten lang Bett und Sprecher gegeneinander.
      ? `${musikFilter}[m];[2:a]volume=1.0,asplit=2[v][sc];` +
        `[m][sc]sidechaincompress=threshold=0.03:ratio=12:attack=8:release=420:makeup=1[md];` +
        `[md][v]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]`
      : `${musikFilter}[aout]`,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    "-shortest", ziel,
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });

  fs.writeFileSync(path.join(ORDNER, "sprechtext.srt"), srt(neueCues));

  console.log(`\nFertig: ${ziel}`);
  console.log(`Sprechtext: ${path.join(ORDNER, "sprechtext.srt")} (${neueCues.length} Zeilen)`);
}

lauf().catch((e) => { console.error(e); process.exit(1); });
