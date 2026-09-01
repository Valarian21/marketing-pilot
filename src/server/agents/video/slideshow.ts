/**
 * Daten-Reel (Shot 8): aus den fertigen Slides eines Daten-Bündels wird ein
 * vertikales Countdown-Video — **ohne eine einzige Bildschirmaufnahme**.
 *
 * Die Aufnahme-Pipeline (`pipeline.ts`) bleibt davon unberührt; geteilt werden
 * nur die Bausteine, die nichts mit dem Browser zu tun haben: Wort-Captions,
 * Musik-Ducking, Lautheit, MP4-Kennzeichnung. Neu ist allein die Bildspur — je
 * Karte ein Standbild mit sanftem Zoom statt eines Mitschnitts.
 *
 * Die Zahlen sind auch hier unantastbar: sie stehen bereits auf den Slides und
 * werden für das Voiceover nur **ausgeschrieben** (`euroInWords`), nie neu
 * gerechnet und nie gerundet.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson } from "../../db/index.js";
import type { JobHandler } from "../../jobs.js";
import { loadBrandKit } from "../studio/brandkit.js";
import { playwrightRenderer, type RenderJob } from "../studio/render.js";
import { markPng } from "../../util/png.js";
import { bookRun, finishRun, startRun } from "../../audit.js";
import { getProject } from "../../repo/projects.js";
import { estimateDurationMs, estimateWords, isSpokenWord, type WordTiming } from "./voice.js";
import { pickMusic, runFfmpeg, OUTPUT_FPS } from "./assemble.js";
import { captionJobs, hookCardHtml, type CaptionCue, type Layout } from "./overlays.js";
import type { VideoContext } from "./pipeline.js";

export const SLIDESHOW_STEPS = ["voice", "overlays", "video", "assets"];

export const HOOK_MS = 1500, COVER_MS = 1800, END_MS = 2500;
/** Instagram und TikTok schneiden längere Reels ab bzw. drücken sie in andere Flächen. */
export const MAX_REEL_MS = 60_000;
export const MIN_SECONDS_PER_CARD = 1.4;

const s3 = (ms: number) => (ms / 1000).toFixed(3);

// --- Zahlen für die Stimme ---------------------------------------------------

const DE_ONES = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const DE_TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];

function deUnder100(n: number): string {
  if (n < 20) return DE_ONES[n]!;
  const t = Math.floor(n / 10), o = n % 10;
  return o ? `${o === 1 ? "ein" : DE_ONES[o]}und${DE_TENS[t]}` : DE_TENS[t]!;
}
function deUnder1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return `${h ? `${h === 1 ? "ein" : DE_ONES[h]}hundert` : ""}${r ? deUnder100(r) : ""}` || "null";
}
/** Ganze Zahl in deutschen Worten (0–999.999 — mehr kostet keine Karte). */
export function germanNumber(n: number): string {
  if (n <= 0) return "null";
  const th = Math.floor(n / 1000), r = n % 1000;
  return `${th ? `${th === 1 ? "ein" : deUnder1000(th)}tausend` : ""}${r ? deUnder1000(r) : ""}`;
}

const EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function enUnder100(n: number): string {
  if (n < 20) return EN_ONES[n]!;
  const t = Math.floor(n / 10), o = n % 10;
  return o ? `${EN_TENS[t]}-${EN_ONES[o]}` : EN_TENS[t]!;
}
function enUnder1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${EN_ONES[h]} hundred` : "", r ? enUnder100(r) : ""].filter(Boolean).join(" ") || "zero";
}
export function englishNumber(n: number): string {
  if (n <= 0) return "zero";
  const th = Math.floor(n / 1000), r = n % 1000;
  return [th ? `${enUnder1000(th)} thousand` : "", r ? enUnder1000(r) : ""].filter(Boolean).join(" ");
}

/**
 * „626,08 €“ → „sechshundertsechsundzwanzig Euro acht“.
 *
 * Die Cents werden bewusst ohne das Wort „Cent“ angehängt: gesprochen klingt
 * „sechshundertsechsundzwanzig Euro acht“ wie ein Preis, „…und acht Cent“ wie
 * eine Rechnung. Bei glatten Beträgen entfällt der Teil ganz.
 */
export function euroInWords(value: number, lang: "de" | "en"): string {
  const cents = Math.round(value * 100);
  const whole = Math.floor(cents / 100), rest = cents % 100;
  if (lang === "en") {
    const head = `${englishNumber(whole)} ${whole === 1 ? "euro" : "euros"}`;
    return rest ? `${head} ${enUnder100(rest)}` : head;
  }
  const head = whole === 1 ? "ein Euro" : `${germanNumber(whole)} Euro`;
  return rest ? `${head} ${deUnder100(rest)}` : head;
}

/**
 * Sprechdauer einer Reel-Zeile.
 *
 * Der Wort-Schaetzer aus `voice.ts` rechnet 380 ms je Wort — das passt fuer
 * normale Saetze, unterschaetzt aber ausgeschriebene Zahlen dramatisch:
 * „sechshundertsechsundzwanzig“ ist ein Wort und dauert fast zwei Sekunden.
 *
 * Der Faktor ist an echten Laeufen gemessen (eleven_v3, deutsch): ein Reel mit
 * acht Karten dauerte 58 s, macht rund 6 s je Kartenzeile bei ~50 Zeichen. Wer
 * ihn aendert, sollte vorher wieder messen — an dieser Zahl haengt, wie viele
 * Karten der Generator ueberhaupt erst einplant.
 */
export const MS_PER_SPOKEN_CHAR = 110;
export const estimateReelLineMs = (text: string): number =>
  Math.max(estimateDurationMs(text), Math.round(text.replace(/\s+/g, " ").trim().length * MS_PER_SPOKEN_CHAR) + 300);

/**
 * Der Satz, der zu einer Karte gesprochen wird. Steht hier, weil ihn zwei
 * Stellen brauchen: der Generator schaetzt damit vorab die Laenge des Reels,
 * der Job spricht ihn dann tatsaechlich. Waeren es zwei Formulierungen, wuerde
 * die Vorausplanung an der Wirklichkeit vorbeirechnen.
 */
export function reelCardLine(card: { rank: number; name: string; priceEur: number }, lang: "de" | "en"): string {
  return lang === "de"
    ? `Platz ${card.rank}: ${card.name}, ${euroInWords(card.priceEur, "de")}.`
    : `Number ${card.rank}: ${card.name}, ${euroInWords(card.priceEur, "en")}.`;
}

// --- Zeitplan ----------------------------------------------------------------

export interface SlideTiming { key: string; durationMs: number }
export interface SlideshowPlan {
  hookMs: number; coverMs: number; endMs: number;
  cards: SlideTiming[];
  /** Karten, die wegen der 60-Sekunden-Grenze nicht mehr ins Reel passen. */
  dropped: string[];
  secondsPerCard: number;
  totalMs: number;
}

/**
 * Wie lange jede Karte steht, damit das Reel unter einer Minute bleibt.
 *
 * Zuerst wird die Standzeit gesenkt (bis 1,4 s), erst danach werden Karten
 * gekappt — und zwar vom **Anfang** der Anzeigereihenfolge. Im Countdown sind
 * das die hintersten Plätze; die Spitze der Liste bleibt immer drin.
 */
export function planSlideshow(
  cards: { key: string; voiceMs?: number }[],
  opts: { secondsPerCard: number; hookMs?: number; coverMs?: number; endMs?: number; maxMs?: number; hasVoice?: boolean },
): SlideshowPlan {
  const hookMs = opts.hookMs ?? HOOK_MS, coverMs = opts.coverMs ?? COVER_MS, endMs = opts.endMs ?? END_MS;
  const maxMs = opts.maxMs ?? MAX_REEL_MS;
  const fixed = hookMs + coverMs + endMs;
  const durations = (list: typeof cards, sec: number) => list.map((c) => ({ key: c.key, durationMs: Math.max(Math.round(sec * 1000), (c.voiceMs ?? 0) + 250) }));
  const sum = (list: SlideTiming[]) => list.reduce((n, x) => n + x.durationMs, 0);

  let sec = opts.secondsPerCard;
  let kept = [...cards];
  let timed = durations(kept, sec);
  while (fixed + sum(timed) > maxMs && sec > MIN_SECONDS_PER_CARD + 0.001) {
    sec = Math.max(MIN_SECONDS_PER_CARD, Math.round((sec - 0.1) * 10) / 10);
    timed = durations(kept, sec);
  }
  const dropped: string[] = [];
  while (fixed + sum(timed) > maxMs && kept.length > 3) {
    dropped.push(kept[0]!.key);
    kept = kept.slice(1);
    timed = durations(kept, sec);
  }
  return { hookMs, coverMs, endMs, cards: timed, dropped, secondsPerCard: sec, totalMs: fixed + sum(timed) };
}

// --- ffmpeg ------------------------------------------------------------------

/** Ein Standbild wird zum Segment: sanfter Zoom 1,00 → 1,06 über die volle Standzeit. */
export function buildSlideArgs(image: string, durationMs: number, w: number, h: number, out: string, fps = OUTPUT_FPS, zoomTo = 1.06): string[] {
  const frames = Math.max(1, Math.round((durationMs / 1000) * fps));
  // Erst hochskalieren, dann zoompan: sonst springt der Ausschnitt sichtbar von Pixel zu Pixel.
  const chain = [
    `scale=${w * 2}:${h * 2}:flags=lanczos`,
    `zoompan=z='min(1+${(zoomTo - 1).toFixed(4)}*on/${frames},${zoomTo})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=${fps}:s=${w}x${h}`,
    `trim=duration=${s3(durationMs)}`, "setpts=PTS-STARTPTS", "format=yuv420p",
  ];
  return ["-loop", "1", "-framerate", String(fps), "-t", s3(durationMs), "-i", image,
    "-filter_complex", `[0:v]${chain.join(",")}[v]`, "-map", "[v]", "-an", "-r", String(fps),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", out];
}

export interface SlideshowCompose {
  body: string;
  /** Segmente in Reihenfolge, je mit optionaler Tonspur. */
  segments: { durationMs: number; audio: string | null }[];
  captions: CaptionCue[];
  captionY: number;
  music: string | null;
  out: string;
  fps?: number;
}

/** Bildspur steht schon; hier kommen nur Untertitel, Stimme und Musik dazu. */
export function buildSlideshowComposeArgs(i: SlideshowCompose): { args: string[]; totalMs: number } {
  const fps = i.fps ?? OUTPUT_FPS;
  const totalMs = i.segments.reduce((n, x) => n + x.durationMs, 0);
  const inputs: string[] = [];
  let n = 0;
  const add = (...a: string[]) => { inputs.push(...a); return n++; };
  const BODY = add("-i", i.body);
  const caps = i.captions.filter((c) => c.endMs > c.startMs)
    .map((c) => ({ ...c, idx: add("-loop", "1", "-framerate", String(fps), "-t", s3(c.endMs - c.startMs), "-itsoffset", s3(c.startMs), "-i", c.file) }));
  const audioIdx = i.segments.map((x) => (x.audio ? add("-i", x.audio) : -1));
  const MUSIC = i.music ? add("-i", i.music) : -1;

  const f: string[] = [`[${BODY}:v]format=yuv420p[c0]`];
  let last = "[c0]";
  caps.forEach((c, k) => {
    const out = `[cp${k}]`;
    f.push(`${last}[${c.idx}:v]overlay=0:${i.captionY}:eof_action=pass:enable='between(t,${s3(c.startMs)},${s3(c.endMs)})'${out}`);
    last = out;
  });
  f.push(`${last}fade=t=in:st=0:d=0.3,format=yuv420p[vout]`);

  i.segments.forEach((seg, k) => {
    const idx = audioIdx[k] ?? -1;
    if (idx >= 0) f.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${s3(seg.durationMs)},atrim=duration=${s3(seg.durationMs)}[sa${k}]`);
    else f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(seg.durationMs)}[sa${k}]`);
  });
  f.push(`${i.segments.map((_, k) => `[sa${k}]`).join("")}concat=n=${i.segments.length}:v=0:a=1[voice]`);
  if (MUSIC >= 0) {
    f.push(`[voice]asplit=2[voice_a][voice_sc]`,
      `[${MUSIC}:a]aresample=44100,aformat=channel_layouts=stereo,loudnorm=I=-30:TP=-6:LRA=9,atrim=duration=${s3(totalMs)},afade=t=in:st=0:d=0.8,afade=t=out:st=${s3(Math.max(0, totalMs - 2500))}:d=2.5[musicraw]`,
      `[musicraw][voice_sc]sidechaincompress=threshold=0.012:ratio=10:attack=40:release=700:level_sc=1.5[musicd]`,
      `[voice_a][musicd]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  } else f.push(`[voice]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);

  const args = [...inputs, "-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]", "-r", String(fps), "-t", s3(totalMs),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    "-metadata", "comment=AI-generated: true (Marketing Pilot, data slideshow)", "-metadata", "title=Marketing Pilot data reel", i.out];
  return { args, totalMs };
}

/**
 * Layout ohne Geräterahmen — das Bild füllt die Fläche.
 *
 * Die Untertitel sitzen **oben**, nicht wie sonst im unteren Drittel: die
 * Daten-Slide trägt dort bereits Kartenname, Preis und Fußzeile. Ein Wort-
 * Overlay an gewohnter Stelle lag im ersten Livelauf mitten auf dem Namen.
 * Über dem Kartenbild ist dagegen Platz, nur die Rang-Pille steht dort.
 */
export const reelLayout = (w = 1080, h = 1920): Layout =>
  ({ w, h, inner: { x: 0, y: 0, w, h }, radius: 0, pad: 0, captionY: Math.round(h * 0.11), captionH: 150 });

// --- Job ---------------------------------------------------------------------

interface CardMeta { rank: number; name: string; nameEn: string; setName: string; localId: string; priceEur: number }

export const renderSlideshowJob: JobHandler<VideoContext> = async (ctx, job, progress) => {
  const pieceId = String(job.payload["pieceId"] ?? "");
  const piece = ctx.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  if (!piece) throw new Error("Stück nicht gefunden.");
  if (piece.format !== "data_reel") throw new Error("Nur Daten-Reels werden als Slideshow gerendert.");
  const meta = parseJson<Record<string, unknown>>(piece.meta, {});
  const project = getProject(ctx.db, piece.projectId);
  if (!project) throw new Error("Projekt nicht gefunden.");
  const brief = s.Brief.safeParse(project.brief);
  const brand = brief.success ? brief.data.productName : project.name;
  const kit = loadBrandKit(ctx.db, piece.projectId);
  const lang: "de" | "en" = meta["language"] === "en" ? "en" : "de";
  const opts = s.ReelOptions.parse(meta["reel"] ?? {});
  const cards = (Array.isArray(meta["cards"]) ? meta["cards"] : []) as CardMeta[];
  const countdown = (meta["dataQuery"] as { countdown?: boolean } | undefined)?.countdown !== false;

  // Slides in Anzeigereihenfolge: Cover, Karten, CTA - genau so, wie Shot 7 sie gelegt hat.
  const slideIds = (Array.isArray(meta["slideAssets"]) ? meta["slideAssets"] : parseJson<string[]>(piece.assets, [])) as string[];
  const slideFiles = slideIds
    .map((id) => ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.id, id)).get())
    .filter((a): a is typeof t.mpAssets.$inferSelect => Boolean(a))
    .map((a) => path.join(ctx.dataDir, a.path))
    .filter((f) => fs.existsSync(f));
  if (slideFiles.length < 4) throw new Error(`Zu wenige Slides für ein Reel (${slideFiles.length}).`);
  const cover = slideFiles[0]!, cta = slideFiles[slideFiles.length - 1]!;
  const cardFiles = slideFiles.slice(1, -1);
  // Anzeigereihenfolge der Karten: beim Countdown steht der letzte Platz vorn.
  const cardOrder = countdown ? [...cards].reverse() : cards;

  const outDir = path.join(ctx.dataDir, "assets", piece.projectId, "video", pieceId);
  fs.mkdirSync(outDir, { recursive: true });
  const renderer = ctx.renderer ?? playwrightRenderer;
  const ffmpeg = ctx.ffmpeg ?? runFfmpeg;
  const warnings: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    progress(name, { status: "running", startedAt: nowIso() });
    const runId = startRun(ctx.db, { task: `reel.${name}`, model: null, projectId: piece.projectId, pieceId });
    try { const r = await fn(); progress(name, { status: "done", finishedAt: nowIso() }); finishRun(ctx.db, runId, { resultRef: `reel:${pieceId}` }); return r; }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); progress(name, { status: "failed", detail: msg, finishedAt: nowIso() }); finishRun(ctx.db, runId, { error: msg }); throw e; }
  };

  const hookText = String(meta["hook"] ?? meta["coverTitle"] ?? "");
  const ctaText = String(meta["ctaLine"] ?? "");
  /** Was zu einer Karte gesprochen wird — Zahlen ausgeschrieben, sonst nichts. */
  const cardLine = (c: CardMeta) => reelCardLine({ rank: c.rank, name: lang === "en" && c.nameEn ? c.nameEn : c.name, priceEur: c.priceEur }, lang);

  // 1. Stimme: ein ElevenLabs-Aufruf am Stück, danach je Abschnitt geschnitten.
  interface Part { file: string | null; durationMs: number; words: WordTiming[] }
  const voice = await step("voice", async () => {
    const parts = new Map<string, Part>();
    if (!opts.voiceover) { progress("voice", { status: "skipped", detail: "stumm gerendert (Sound kommt von der Plattform)" }); return parts; }
    const spoken = [{ id: "hook", text: hookText }, ...cardOrder.map((c) => ({ id: `c${c.rank}`, text: cardLine(c) })), { id: "end", text: ctaText }]
      .filter((x) => x.text.trim());
    if (!ctx.voice?.synthesizeScript) {
      for (const x of spoken) { const ms = estimateReelLineMs(x.text); parts.set(x.id, { file: null, durationMs: ms, words: estimateWords(x.text, ms - 300).filter((w) => isSpokenWord(w.word)) }); }
      warnings.push("Ohne Voiceover gerendert (ELEVENLABS_API_KEY/VOICE_ID fehlen) — Timing geschätzt.");
      progress("voice", { detail: "ohne Stimme (kein ElevenLabs-Key)" });
      return parts;
    }
    const t0 = Date.now();
    const voiceDir = path.join(outDir, "voice");
    const r = await ctx.voice.synthesizeScript(spoken, /^[a-z]{2}$/i.test(lang) ? { language: lang } : {}, voiceDir);
    const chars = spoken.reduce((n, x) => n + x.text.length, 0);
    bookRun(ctx.db, { task: "reel.voice", model: `elevenlabs/${ctx.env.ELEVENLABS_VOICE_ID ?? "voice"}`, provider: "elevenlabs", projectId: piece.projectId, pieceId, costUsd: (chars / 1000) * ctx.env.ELEVENLABS_USD_PER_1K_CHARS, durationMs: Date.now() - t0 });
    for (const x of spoken) {
      const part = r.parts.find((p) => p.id === x.id);
      if (!part || part.endMs <= part.startMs) { parts.set(x.id, { file: null, durationMs: estimateReelLineMs(x.text), words: [] }); continue; }
      const prevEnd = r.parts.filter((p) => p.endMs <= part.startMs).map((p) => p.endMs).sort((a, b) => b - a)[0] ?? 0;
      const nextStart = r.parts.filter((p) => p.startMs >= part.endMs).map((p) => p.startMs).sort((a, b) => a - b)[0] ?? r.durationMs;
      const from = Math.max(prevEnd, part.startMs - 120), to = Math.min(nextStart, part.endMs + 180);
      const file = path.join(voiceDir, `part-${x.id}.mp3`);
      await ffmpeg(["-y", "-ss", (from / 1000).toFixed(3), "-to", (to / 1000).toFixed(3), "-i", r.file, "-c:a", "libmp3lame", "-q:a", "2", file]);
      parts.set(x.id, { file, durationMs: to - from, words: part.words.map((w) => ({ word: w.word, startMs: w.startMs - from, endMs: w.endMs - from })).filter((w) => isSpokenWord(w.word)) });
    }
    progress("voice", { detail: `${spoken.length} Abschnitte, ${Math.round(r.durationMs / 1000)} s Sprache` });
    return parts;
  });

  // 2. Zeitplan + Overlays (Hook-Karte, Wort-Captions)
  const plan = planSlideshow(cardOrder.map((c) => ({ key: `c${c.rank}`, ...(voice.get(`c${c.rank}`) ? { voiceMs: voice.get(`c${c.rank}`)!.durationMs } : {}) })), {
    secondsPerCard: opts.secondsPerCard,
    hookMs: Math.max(HOOK_MS, (voice.get("hook")?.durationMs ?? 0) + 250),
    endMs: Math.max(END_MS, (voice.get("end")?.durationMs ?? 0) + 250),
  });
  if (plan.dropped.length) warnings.push(`${plan.dropped.length} Karten gekappt, damit das Reel unter 60 s bleibt (${plan.dropped.join(", ")}).`);
  if (plan.secondsPerCard < opts.secondsPerCard) warnings.push(`Standzeit je Karte auf ${plan.secondsPerCard.toFixed(1)} s gesenkt (Wunsch: ${opts.secondsPerCard.toFixed(1)} s).`);

  const lay = reelLayout();
  const hookCard = path.join(outDir, "hook.png");
  const { captions, segments } = await step("overlays", async () => {
    const jobs: RenderJob[] = [{ html: hookCardHtml(kit, hookText || String(meta["coverTitle"] ?? ""), brand, lay.w, lay.h), width: lay.w, height: lay.h, file: hookCard }];
    const cues: CaptionCue[] = [];
    /** Segmente in Reihenfolge: Hook, Cover, Karten (Anzeigereihenfolge), CTA. */
    const segs: { image: string; durationMs: number; audio: string | null; key: string }[] = [
      { image: hookCard, durationMs: plan.hookMs, audio: voice.get("hook")?.file ?? null, key: "hook" },
      { image: cover, durationMs: plan.coverMs, audio: null, key: "cover" },
    ];
    plan.cards.forEach((c) => {
      const rank = Number(c.key.slice(1));
      // Die Slide-Dateien liegen bereits in Anzeigereihenfolge - gekappte Karten fallen vorne weg.
      const idx = cardOrder.findIndex((x) => x.rank === rank);
      const image = cardFiles[idx];
      if (image) segs.push({ image, durationMs: c.durationMs, audio: voice.get(c.key)?.file ?? null, key: c.key });
    });
    segs.push({ image: cta, durationMs: plan.endMs, audio: voice.get("end")?.file ?? null, key: "end" });

    let offset = 0;
    for (const seg of segs) {
      const words = voice.get(seg.key)?.words ?? [];
      if (words.length) { const cj = captionJobs(kit, words, offset, lay, outDir, `reel-${seg.key}`); jobs.push(...cj.jobs); cues.push(...cj.cues); }
      offset += seg.durationMs;
    }
    await renderer(jobs);
    progress("overlays", { detail: `${jobs.length} Overlays, ${segs.length} Segmente` });
    return { captions: cues, segments: segs };
  });

  // 3. Bildspur bauen und alles zusammensetzen
  const video = await step("video", async () => {
    const segFiles: string[] = [];
    for (const [k, seg] of segments.entries()) {
      const file = path.join(outDir, `seg-${String(k).padStart(2, "0")}.mp4`);
      await ffmpeg(buildSlideArgs(seg.image, seg.durationMs, lay.w, lay.h, file));
      segFiles.push(file);
    }
    const body = path.join(outDir, "body.mp4");
    const list = `${body}.txt`;
    fs.writeFileSync(list, `${segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")}\n`);
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", body]);
    const out = path.join(outDir, "reel.mp4");
    const music = opts.music === "bed" ? pickMusic(path.join(ctx.env.MP_DATA_DIR, "..", "assets", "music")) : null;
    if (opts.music === "bed" && !music) warnings.push("Kein Musikbett gefunden (assets/music/ ist leer) — stumm gerendert.");
    const { args, totalMs } = buildSlideshowComposeArgs({ body, segments: segments.map((x) => ({ durationMs: x.durationMs, audio: x.audio })), captions, captionY: lay.captionY, music, out });
    await ffmpeg(args);
    progress("video", { detail: `${Math.round(totalMs / 1000)} s, ${segments.length} Segmente` });
    return { file: out, durationMs: totalMs };
  });

  // 4. Assets: das Reel ersetzt die Slides am Stück; alle Bündel-Mitglieder zeigen auf dieselbe Datei
  const assetIds = await step("assets", async () => {
    for (const a of ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.contentPieceId, pieceId)).all()) {
      if (a.kind !== "render" && a.kind !== "image") continue;
      const rel = path.relative(ctx.dataDir, video.file);
      if (a.path === rel || a.path.endsWith("reel-thumb.png")) {
        try { fs.unlinkSync(path.join(ctx.dataDir, a.path)); } catch { /* weg */ }
        ctx.db.delete(t.mpAssets).where(eq(t.mpAssets.id, a.id)).run();
      }
    }
    const ts = nowIso();
    const addAsset = (kind: s.Asset["kind"], file: string, m: Record<string, unknown>) => {
      const id = newId();
      ctx.db.insert(t.mpAssets).values({ id, projectId: piece.projectId, contentPieceId: pieceId, kind, path: path.relative(ctx.dataDir, file), meta: toJson({ aiGenerated: true, provenance: kind === "render" ? "mp4-metadata" : "png-text-chunk", ...m }), createdAt: ts }).run();
      return id;
    };
    // Thumbnail: der erste Platz - nicht die Hook-Karte, das Bild soll die Karte zeigen
    const thumb = path.join(outDir, "reel-thumb.png");
    const topSlide = cardFiles[cardOrder.findIndex((c) => c.rank === 1)] ?? cover;
    fs.copyFileSync(topSlide, thumb);
    markPng(thumb, { aiGenerated: true, generator: "Marketing Pilot (data reel thumbnail)" });
    const thumbId = addAsset("image", thumb, { role: "thumbnail" });
    const videoId = addAsset("render", video.file, { variant: "reel", size: "1080x1920", durationMs: video.durationMs, thumbnailAssetId: thumbId, fps: OUTPUT_FPS });

    // Zwischendateien sind groß und jederzeit reproduzierbar
    for (const f of fs.readdirSync(outDir)) if (/^(seg-|body)/.test(f)) { try { fs.unlinkSync(path.join(outDir, f)); } catch { /* egal */ } }

    const bundleId = String(meta["bundleId"] ?? pieceId);
    const members = ctx.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, piece.projectId)).all()
      .filter((r) => parseJson<Record<string, unknown>>(r.meta, {})["bundleId"] === bundleId);
    for (const m of members) {
      const mm = parseJson<Record<string, unknown>>(m.meta, {});
      ctx.db.update(t.mpContentPieces).set({
        assets: toJson([videoId, thumbId]), status: m.status === "published" ? m.status : "review", updatedAt: ts,
        meta: toJson({
          ...mm, renderedAt: ts, durationMs: video.durationMs,
          reelPlan: { secondsPerCard: plan.secondsPerCard, dropped: plan.dropped, totalMs: plan.totalMs }, warnings,
          // Die Pruefspur zeigt, was im Video steht - nicht, was einmal abgefragt wurde.
          ...(plan.dropped.length ? { cards: cards.filter((c) => !plan.dropped.includes(`c${c.rank}`)) } : {}),
        }),
        ...(m.id === pieceId ? { aiTellNotes: [m.aiTellNotes, warnings.length ? `Render-Hinweise:\n${warnings.join("\n")}` : ""].filter(Boolean).join("\n") } : {}),
      }).where(eq(t.mpContentPieces.id, m.id)).run();
    }
    progress("assets", { detail: `${members.length} Stücke aktualisiert` });
    return [videoId, thumbId];
  });

  return { assets: assetIds, durationMs: video.durationMs, dropped: plan.dropped, warnings };
};
