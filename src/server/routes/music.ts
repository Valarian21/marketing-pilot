/**
 * Musikbett verwalten — die Tracks unter `assets/music/`, aus denen die
 * Video-Fabrik zufällig einen unter jedes Reel mischt.
 *
 * Bisher hieß der Weg „per SFTP in den Ordner legen". Hier kommt die Oberfläche
 * dazu: hochladen, pausieren (führender Unterstrich, dieselbe Regel wie
 * `musicTracks`), löschen. Zu jeder Datei entsteht eine gleichnamige `.txt`
 * mit Quelle, Titel, Urheber, Lizenz und Datum — der einzige Ort, an dem
 * später nachvollziehbar ist, woher ein Track kam.
 *
 * Lizenz ist kein Freitext, sondern eine von drei erlaubten. CC-BY scheitert
 * hier bewusst: die Namensnennung müsste in jede Bildunterschrift, und das
 * hält beim automatischen Posten niemand durch.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as s from "../../shared/schemas.js";
import { ROOT } from "../env.js";

const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/ogg", "application/octet-stream"];
const MAX_BYTES = 40 * 1024 * 1024;
const ENDUNG = /\.(mp3|wav|m4a|ogg)$/i;
const DATEINAME = /^[A-Za-z0-9._-]+$/;
/** Unter dieser Länge passt der Track nicht mehr unter ein 15–20-Sekunden-Reel. */
const MIN_SEKUNDEN = 30;

/** Überschreibbar für Tests; im Betrieb der Ordner im Repo. */
export function musicDir(): string {
  return process.env["MP_MUSIC_DIR"] ?? path.join(ROOT, "assets", "music");
}

function dauerSekunden(file: string): number | null {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 10_000 });
    const n = parseFloat(out.trim());
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch { return null; }
}

type Nachweis = Partial<Record<"quelle" | "titel" | "urheber" | "lizenz" | "geladen", string>>;

function nachweisLesen(txt: string): Nachweis {
  const out: Nachweis = {};
  for (const zeile of txt.split(/\r?\n/)) {
    const m = /^(Quelle|Titel|Urheber|Lizenz|Geladen):\s*(.*)$/i.exec(zeile.trim());
    if (m) out[m[1]!.toLowerCase() as keyof Nachweis] = m[2]!.trim();
  }
  return out;
}

function nachweisSchreiben(n: Required<Nachweis>): string {
  return [`Titel: ${n.titel}`, `Urheber: ${n.urheber}`, `Lizenz: ${n.lizenz}`, `Quelle: ${n.quelle}`, `Geladen: ${n.geladen}`, ""].join("\n");
}

const txtPfad = (dir: string, file: string) => path.join(dir, file.replace(ENDUNG, ".txt"));

export function trackInfo(dir: string, file: string): s.MusicTrack {
  const voll = path.join(dir, file);
  const st = fs.statSync(voll);
  let n: Nachweis = {};
  try { n = nachweisLesen(fs.readFileSync(txtPfad(dir, file), "utf8")); } catch { /* ohne Nachweis */ }
  return {
    file, name: file.replace(/^_/, "").replace(ENDUNG, ""), bytes: st.size, seconds: dauerSekunden(voll),
    aktiv: !file.startsWith("_"),
    quelle: n.quelle ?? null, titel: n.titel ?? null, urheber: n.urheber ?? null, lizenz: n.lizenz ?? null, geladen: n.geladen ?? null,
  };
}

export function listeTracks(dir: string): s.MusicTrack[] {
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => ENDUNG.test(f) && DATEINAME.test(f)); } catch { return []; }
  return files.sort((a, b) => a.replace(/^_/, "").localeCompare(b.replace(/^_/, ""), "de")).map((f) => trackInfo(dir, f));
}

/** Aus „Sommer-Lauf (Remix)!" wird „sommer-lauf-remix". */
export function dateiSlug(titel: string): string {
  const s = titel.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "track";
}

const FileParams = z.object({ file: z.string().regex(DATEINAME).regex(ENDUNG) });
const fehlt = (dir: string, file: string) => !fs.existsSync(path.join(dir, file));

export function musicRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // Rohe Audiodaten als Buffer entgegennehmen — ohne Multipart-Abhängigkeit.
  app.addContentTypeParser(AUDIO_TYPES, { parseAs: "buffer", bodyLimit: MAX_BYTES }, (_req, body, done) => done(null, body));

  r.get("/api/mp/music", { schema: { response: { 200: s.MusicView } } }, async () => {
    const dir = musicDir();
    return { tracks: listeTracks(dir), dir };
  });

  r.post("/api/mp/music", { bodyLimit: MAX_BYTES, schema: { querystring: s.MusicUploadQuery, response: { 201: s.MusicUploadResult, 400: s.ErrorBody, 415: s.ErrorBody } } }, async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body)) return reply.code(415).send({ detail: "Die Datei muss als rohe Audiodaten gesendet werden (audio/* oder application/octet-stream)." });
    if (!body.length) return reply.code(400).send({ detail: "Die Datei ist leer." });
    const q = req.query;
    const ext = ENDUNG.exec(q.name)?.[1]?.toLowerCase();
    if (!ext) return reply.code(400).send({ detail: "Erlaubt sind MP3, WAV, M4A und OGG." });

    const dir = musicDir();
    fs.mkdirSync(dir, { recursive: true });
    // Erst prüfen, dann benennen: eine unlesbare Datei darf gar nicht erst im Ordner landen.
    const tmp = path.join(dir, `_upload-${Date.now()}.${ext}`);
    fs.writeFileSync(tmp, body);
    const sek = dauerSekunden(tmp);
    if (sek === null) { fs.rmSync(tmp, { force: true }); return reply.code(400).send({ detail: "ffprobe kann die Datei nicht lesen — ist das wirklich eine Audiodatei?" }); }

    const base = dateiSlug(q.titel);
    let file = `${base}.${ext}`;
    for (let i = 2; fs.existsSync(path.join(dir, file)) || fs.existsSync(path.join(dir, `_${file}`)); i++) file = `${base}-${i}.${ext}`;
    fs.renameSync(tmp, path.join(dir, file));
    fs.writeFileSync(txtPfad(dir, file), nachweisSchreiben({ titel: q.titel.trim(), urheber: q.urheber.trim() || "unbekannt", lizenz: q.lizenz, quelle: q.quelle.trim() || "—", geladen: new Date().toISOString().slice(0, 10) }));

    const warnings: string[] = [];
    if (sek < MIN_SEKUNDEN) warnings.push(`Nur ${sek} s lang — unter ${MIN_SEKUNDEN} s reicht der Track nicht sicher über ein Reel.`);
    if (!q.quelle.trim()) warnings.push("Ohne Quell-Link lässt sich die Lizenz später nicht belegen.");
    return reply.code(201).send({ track: trackInfo(dir, file), warnings });
  });

  r.post("/api/mp/music/:file/toggle", { schema: { params: FileParams, response: { 200: s.MusicTrack, 404: s.ErrorBody } } }, async (req, reply) => {
    const dir = musicDir(); const { file } = req.params;
    if (fehlt(dir, file)) return reply.code(404).send({ detail: "Track nicht gefunden." });
    const neu = file.startsWith("_") ? file.slice(1) : `_${file}`;
    fs.renameSync(path.join(dir, file), path.join(dir, neu));
    if (fs.existsSync(txtPfad(dir, file))) fs.renameSync(txtPfad(dir, file), txtPfad(dir, neu));
    return trackInfo(dir, neu);
  });

  r.delete("/api/mp/music/:file", { schema: { params: FileParams, response: { 204: z.null(), 404: s.ErrorBody } } }, async (req, reply) => {
    const dir = musicDir(); const { file } = req.params;
    if (fehlt(dir, file)) return reply.code(404).send({ detail: "Track nicht gefunden." });
    fs.rmSync(path.join(dir, file), { force: true });
    fs.rmSync(txtPfad(dir, file), { force: true });
    return reply.code(204).send(null);
  });
}
