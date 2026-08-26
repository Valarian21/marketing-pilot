/**
 * Assembly with ffmpeg (Remotion was rejected - see DECISIONS.md): per-scene
 * trims with auto-cut of frozen stretches, last-frame padding to the voiceover,
 * zoom-in on the click point, concat, device frame + background + hook/end cards,
 * word captions as PNG overlays, optional music bed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RecordedScene, Recording } from "./record.js";
import type { CaptionCue } from "./overlays.js";
import type { Layout } from "./overlays.js";

export type FfmpegRunner = (args: string[]) => Promise<string>;

export const runFfmpeg: FfmpegRunner = (args) => new Promise((resolve, reject) => {
  const p = spawn("ffmpeg", ["-hide_banner", "-y", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d: Buffer) => { err += d.toString(); if (err.length > 200_000) err = err.slice(-100_000); });
  p.on("error", reject);
  p.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-1500)}`))));
});

export async function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
    let out = "";
    p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    p.on("error", reject);
    p.on("close", () => resolve(Math.round(parseFloat(out.trim() || "0") * 1000)));
  });
}

export interface Freeze { startMs: number; endMs: number }
/** Parse freezedetect output ("freeze_start: 1.23" / "freeze_end: 4.5"). */
export function parseFreezes(stderr: string): Freeze[] {
  const out: Freeze[] = [];
  let start: number | null = null;
  for (const m of stderr.matchAll(/freeze_(start|end): ([\d.]+)/g)) {
    const v = Math.round(parseFloat(m[2] ?? "0") * 1000);
    if (m[1] === "start") start = v;
    else if (start !== null) { out.push({ startMs: start, endMs: v }); start = null; }
  }
  if (start !== null) out.push({ startMs: start, endMs: Number.MAX_SAFE_INTEGER });
  return out;
}
export async function detectFreezes(file: string, run: FfmpegRunner = runFfmpeg, minMs = 1500): Promise<Freeze[]> {
  const err = await run(["-i", file, "-vf", `freezedetect=n=0.003:d=${minMs / 1000}`, "-an", "-f", "null", "-"]);
  return parseFreezes(err);
}

export interface Interval { startMs: number; endMs: number }
export interface ScenePlan { id: string; keep: Interval[]; videoMs: number; padMs: number; totalMs: number; clickAtMs: number | null; clickX: number | null; clickY: number | null }

/**
 * Auto-cut: inside a scene, frozen stretches (loading, nothing happening) are
 * shortened to `keepMs`; the scene is then padded with its last frame to the
 * voiceover length. Click timestamps are remapped to the cut timeline.
 */
export function planScene(scene: RecordedScene, freezes: Freeze[], audioMs: number, opts: { keepMs?: number; minCutMs?: number; recWidth: number; recHeight: number; viewportWidth: number; viewportHeight: number }): ScenePlan {
  const keepMs = opts.keepMs ?? 900, minCut = opts.minCutMs ?? 1800;
  const cuts: Interval[] = freezes
    .map((f) => ({ startMs: Math.max(f.startMs, scene.startMs), endMs: Math.min(f.endMs, scene.endMs) }))
    .filter((f) => f.endMs - f.startMs > minCut)
    .map((f) => ({ startMs: f.startMs + keepMs, endMs: f.endMs }));
  const keep: Interval[] = [];
  let cursor = scene.startMs;
  for (const c of cuts) { if (c.startMs > cursor) keep.push({ startMs: cursor, endMs: c.startMs }); cursor = Math.max(cursor, c.endMs); }
  if (scene.endMs > cursor) keep.push({ startMs: cursor, endMs: scene.endMs });
  if (!keep.length) keep.push({ startMs: scene.startMs, endMs: Math.max(scene.endMs, scene.startMs + 500) });
  const videoMs = keep.reduce((n, k) => n + (k.endMs - k.startMs), 0);
  const totalMs = Math.max(videoMs, audioMs + 300, 1000);
  // remap first click to the cut timeline
  let clickAtMs: number | null = null, clickX: number | null = null, clickY: number | null = null;
  const first = scene.clicks[0];
  if (first) {
    let acc = 0;
    for (const k of keep) {
      if (first.tMs >= k.startMs && first.tMs <= k.endMs) { clickAtMs = acc + (first.tMs - k.startMs); break; }
      if (first.tMs < k.startMs) { clickAtMs = acc; break; }
      acc += k.endMs - k.startMs;
    }
    clickX = Math.round(first.x * (opts.recWidth / opts.viewportWidth));
    clickY = Math.round(first.y * (opts.recHeight / opts.viewportHeight));
  }
  return { id: scene.id, keep, videoMs, padMs: totalMs - videoMs, totalMs, clickAtMs, clickX, clickY };
}

export interface AssembleInput {
  recording: Recording;
  plans: ScenePlan[];
  audio: { file: string | null; durationMs: number }[];   // per scene, same order as plans
  layout: Layout;
  hookCard: string; endCard: string; frame: string; background: string;
  hookMs: number; endMs: number;
  captions: CaptionCue[];          // times relative to the start of the body (after the hook card)
  music: string | null;
  out: string;
  fps?: number;
}

const s3 = (ms: number) => (ms / 1000).toFixed(3);

/** Build the ffmpeg argument list. Pure so tests can assert on it. */
export function buildFfmpegArgs(i: AssembleInput): { args: string[]; totalMs: number } {
  const fps = i.fps ?? 30;
  const bodyMs = i.plans.reduce((n, p) => n + p.totalMs, 0);
  const totalMs = i.hookMs + bodyMs + i.endMs;
  const inputs: string[] = [];
  const add = (...a: string[]) => { inputs.push(...a); return (inputs.filter((x) => x === "-i").length - 1); };
  const REC = add("-i", i.recording.file);
  const audioIdx = i.audio.map((a) => (a.file ? add("-i", a.file) : -1));
  const BG = add("-loop", "1", "-framerate", String(fps), "-i", i.background);
  const FR = add("-loop", "1", "-framerate", String(fps), "-i", i.frame);
  const HOOK = add("-loop", "1", "-framerate", String(fps), "-i", i.hookCard);
  const END = add("-loop", "1", "-framerate", String(fps), "-i", i.endCard);
  const capIdx = i.captions.map((c) => add("-loop", "1", "-framerate", String(fps), "-i", c.file));
  const MUSIC = i.music ? add("-i", i.music) : -1;

  const f: string[] = [];
  const { inner } = i.layout;
  // per-scene video
  i.plans.forEach((p, n) => {
    const parts = p.keep.map((k, kk) => { f.push(`[${REC}:v]trim=start=${s3(k.startMs)}:end=${s3(k.endMs)},setpts=PTS-STARTPTS[v${n}_${kk}]`); return `[v${n}_${kk}]`; });
    let cur = `[v${n}c]`;
    if (parts.length > 1) f.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0${cur}`); else cur = parts[0]!;
    const chain: string[] = [`fps=${fps}`];
    if (p.padMs > 0) chain.push(`tpad=stop_mode=clone:stop_duration=${s3(p.padMs)}`);
    if (p.clickAtMs !== null && p.clickX !== null && p.clickY !== null) {
      const c = Math.round((p.clickAtMs / 1000) * fps) + 6;
      chain.push(`zoompan=z='1+0.28*max(0,1-abs(in-${c})/${fps * 1.6})':x='min(max(${p.clickX}-iw/zoom/2,0),iw-iw/zoom)':y='min(max(${p.clickY}-ih/zoom/2,0),ih-ih/zoom)':d=1:fps=${fps}:s=${i.recording.width}x${i.recording.height}`);
    }
    chain.push(`scale=${inner.w}:${inner.h}:flags=lanczos`, `trim=duration=${s3(p.totalMs)}`, "setpts=PTS-STARTPTS", "format=yuv420p");
    f.push(`${cur}${chain.join(",")}[sv${n}]`);
  });
  f.push(`${i.plans.map((_, n) => `[sv${n}]`).join("")}concat=n=${i.plans.length}:v=1:a=0[body]`);
  // per-scene audio (silence where no voice), then concat with hook/end silence
  i.plans.forEach((p, n) => {
    const idx = audioIdx[n] ?? -1;
    if (idx >= 0) f.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${s3(p.totalMs)},atrim=duration=${s3(p.totalMs)}[sa${n}]`);
    else f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(p.totalMs)}[sa${n}]`);
  });
  f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(i.hookMs)}[sahook]`, `anullsrc=r=44100:cl=stereo,atrim=duration=${s3(i.endMs)}[saend]`);
  f.push(`[sahook]${i.plans.map((_, n) => `[sa${n}]`).join("")}[saend]concat=n=${i.plans.length + 2}:v=0:a=1[voice]`);
  if (MUSIC >= 0) f.push(`[${MUSIC}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.12,atrim=duration=${s3(totalMs)},afade=t=out:st=${s3(totalMs - 2500)}:d=2.5[music]`, `[voice][music]amix=inputs=2:duration=first:normalize=0[aout]`);
  else f.push(`[voice]acopy[aout]`);
  // compose
  f.push(`[${BG}:v]trim=duration=${s3(totalMs)},setpts=PTS-STARTPTS,format=yuv420p[bg]`);
  f.push(`[body]tpad=start_duration=${s3(i.hookMs)}:start_mode=clone[bodyd]`);
  f.push(`[bg][bodyd]overlay=x=${inner.x}:y=${inner.y}:enable='between(t,${s3(i.hookMs)},${s3(i.hookMs + bodyMs)})':eof_action=pass[c0]`);
  f.push(`[c0][${FR}:v]overlay=0:0:enable='between(t,${s3(i.hookMs)},${s3(i.hookMs + bodyMs)})':eof_action=pass[c1]`);
  let last = "[c1]";
  i.captions.forEach((c, n) => {
    const st = i.hookMs + c.startMs, en = i.hookMs + c.endMs;
    if (en <= st) return;
    const out = `[cp${n}]`;
    f.push(`${last}[${capIdx[n]}:v]overlay=0:${i.layout.captionY}:enable='between(t,${s3(st)},${s3(en)})':eof_action=pass${out}`);
    last = out;
  });
  f.push(`${last}[${HOOK}:v]overlay=0:0:enable='lt(t,${s3(i.hookMs)})':eof_action=pass[c2]`);
  f.push(`[c2][${END}:v]overlay=0:0:enable='gte(t,${s3(i.hookMs + bodyMs)})':eof_action=pass,fade=t=in:st=0:d=0.3,format=yuv420p[vout]`);

  const args = [...inputs, "-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]", "-r", String(fps), "-t", s3(totalMs),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    "-metadata", "comment=AI-generated: true (Marketing Pilot, screen recording + synthetic voice)", "-metadata", "title=Marketing Pilot render", i.out];
  return { args, totalMs };
}

export async function assemble(i: AssembleInput, run: FfmpegRunner = runFfmpeg): Promise<{ file: string; durationMs: number }> {
  fs.mkdirSync(path.dirname(i.out), { recursive: true });
  const { args, totalMs } = buildFfmpegArgs(i);
  await run(args);
  return { file: i.out, durationMs: totalMs };
}

export function pickMusic(dir: string): string | null {
  try {
    const files = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f));
    if (!files.length) return null;
    return path.join(dir, files[Math.floor(Math.random() * files.length)]!);
  } catch { return null; }
}
