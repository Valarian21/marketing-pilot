/**
 * Assembly with ffmpeg (Remotion was rejected - see DECISIONS.md), in three
 * cheap passes so memory stays flat even for 4K-ish phone recordings:
 *   1. per scene: input-seeked trims (auto-cut) -> fps/scale -> last-frame pad
 *      -> zoom on the click point -> small H.264 segment
 *   2. concat the segments (stream copy)
 *   3. compose: background + body + device frame + hook/end cards + word
 *      captions (each caption image only exists inside its own time window) + audio
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RecordedScene, Recording } from "./record.js";
import type { CaptionCue, Layout } from "./overlays.js";

export type FfmpegRunner = (args: string[]) => Promise<string>;

export const runFfmpeg: FfmpegRunner = (args) => new Promise((resolve, reject) => {
  const p = spawn("ffmpeg", ["-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-stats", ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d: Buffer) => { err += d.toString(); if (err.length > 200_000) err = err.slice(-100_000); });
  p.on("error", reject);
  p.on("close", (code, signal) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg ${code === null ? `killed (${signal})` : `exit ${code}`}: ${err.replace(/\r/g, "\n").split("\n").filter((l) => !/^frame=/.test(l.trim())).slice(-12).join(" ").slice(-1500)}`))));
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
  // freezedetect logs at info level - request it explicitly on top of the quiet default
  const err = await run(["-loglevel", "info", "-i", file, "-vf", `scale=320:-2,freezedetect=n=0.003:d=${minMs / 1000}`, "-an", "-f", "null", "-"]);
  return parseFreezes(err);
}

export interface Interval { startMs: number; endMs: number }
export interface ScenePlan { id: string; keep: Interval[]; videoMs: number; padMs: number; totalMs: number; clickAtMs: number | null; clickX: number | null; clickY: number | null }

/**
 * Auto-cut: inside a scene, frozen stretches (loading, nothing happening) are
 * shortened to `keepMs`; the scene is then padded with its last frame to the
 * voiceover length. Click timestamps are remapped to the cut timeline.
 */
/** Playwright's screencast is a fixed 25 fps - rendering at 30 would duplicate every fifth frame (visible judder on scrolls). */
export const OUTPUT_FPS = 25;

export function planScene(scene: RecordedScene, freezes: Freeze[], audioMs: number, opts: { keepMs?: number; minCutMs?: number; recWidth: number; recHeight: number; viewportWidth: number; viewportHeight: number }): ScenePlan {
  const keepMs = opts.keepMs ?? 900, minCut = opts.minCutMs ?? 1800;
  // detected freezes + explicit idle spans (waitFor: the app was working, maybe with a spinner - not a freeze, but dead time)
  const cuts: Interval[] = [...freezes, ...(scene.idle ?? [])]
    .sort((a, b) => a.startMs - b.startMs)
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

const s3 = (ms: number) => (ms / 1000).toFixed(3);

/** Pass 1: one small H.264 segment per scene at the inner (frame) size. */
export function buildSceneArgs(rec: Recording, p: ScenePlan, layout: Layout, out: string, fps = OUTPUT_FPS): string[] {
  const { inner } = layout;
  const inputs: string[] = [];
  p.keep.forEach((k) => inputs.push("-ss", s3(k.startMs), "-to", s3(k.endMs), "-i", rec.file));
  const f: string[] = [];
  const parts = p.keep.map((_, i) => { f.push(`[${i}:v]setpts=PTS-STARTPTS[k${i}]`); return `[k${i}]`; });
  let cur = parts[0]!;
  if (parts.length > 1) { f.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0[kc]`); cur = "[kc]"; }
  const chain = [`fps=${fps}`, `scale=${inner.w}:${inner.h}:flags=lanczos`];
  if (p.padMs > 0) chain.push(`tpad=stop_mode=clone:stop_duration=${s3(p.padMs)}`);
  if (p.clickAtMs !== null && p.clickX !== null && p.clickY !== null) {
    const c = Math.round((p.clickAtMs / 1000) * fps) + 6;
    const sx = inner.w / rec.width, sy = inner.h / rec.height;
    const cx = Math.round(p.clickX * sx), cy = Math.round(p.clickY * sy);
    chain.push(`zoompan=z='1+0.28*max(0,1-abs(in-${c})/${fps * 1.6})':x='min(max(${cx}-iw/zoom/2,0),iw-iw/zoom)':y='min(max(${cy}-ih/zoom/2,0),ih-ih/zoom)':d=1:fps=${fps}:s=${inner.w}x${inner.h}`);
  }
  chain.push(`trim=duration=${s3(p.totalMs)}`, "setpts=PTS-STARTPTS", "format=yuv420p");
  f.push(`${cur}${chain.join(",")}[v]`);
  return [...inputs, "-filter_complex", f.join(";"), "-map", "[v]", "-an", "-r", String(fps), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", out];
}

/** Pass 3: compose the final video. Caption images are opened only for their own time window. */
export interface ComposeInput {
  body: string; bodyMs: number; layout: Layout;
  audio: { file: string | null; durationMs: number }[]; plans: ScenePlan[];
  hookCard: string; endCard: string; frame: string; background: string; hookMs: number; endMs: number;
  captions: CaptionCue[]; music: string | null; out: string; fps?: number;
}
export function buildComposeArgs(i: ComposeInput): { args: string[]; totalMs: number } {
  const fps = i.fps ?? OUTPUT_FPS;
  const totalMs = i.hookMs + i.bodyMs + i.endMs;
  const inputs: string[] = [];
  let n = 0;
  const add = (...a: string[]) => { inputs.push(...a); return n++; };
  const BODY = add("-i", i.body);
  const BG = add("-loop", "1", "-framerate", String(fps), "-t", s3(totalMs), "-i", i.background);
  const FR = add("-loop", "1", "-framerate", String(fps), "-t", s3(i.bodyMs), "-itsoffset", s3(i.hookMs), "-i", i.frame);
  const HOOK = add("-loop", "1", "-framerate", String(fps), "-t", s3(i.hookMs), "-i", i.hookCard);
  const END = add("-loop", "1", "-framerate", String(fps), "-t", s3(i.endMs), "-itsoffset", s3(i.hookMs + i.bodyMs), "-i", i.endCard);
  const caps = i.captions.filter((c) => c.endMs > c.startMs).map((c) => ({ ...c, idx: add("-loop", "1", "-framerate", String(fps), "-t", s3(c.endMs - c.startMs), "-itsoffset", s3(i.hookMs + c.startMs), "-i", c.file) }));
  const audioIdx = i.audio.map((a) => (a.file ? add("-i", a.file) : -1));
  const MUSIC = i.music ? add("-i", i.music) : -1;

  const f: string[] = [];
  const { inner } = i.layout;
  f.push(`[${BODY}:v]setpts=PTS-STARTPTS+${s3(i.hookMs)}/TB[bodyd]`);
  f.push(`[${BG}:v]format=yuv420p[bg]`);
  f.push(`[bg][bodyd]overlay=x=${inner.x}:y=${inner.y}:eof_action=pass[c0]`);
  f.push(`[c0][${FR}:v]overlay=0:0:eof_action=pass[c1]`);
  let last = "[c1]";
  caps.forEach((c, k) => { const out = `[cp${k}]`; f.push(`${last}[${c.idx}:v]overlay=0:${i.layout.captionY}:eof_action=pass:enable='between(t,${s3(i.hookMs + c.startMs)},${s3(i.hookMs + c.endMs)})'${out}`); last = out; });
  f.push(`${last}[${HOOK}:v]overlay=0:0:eof_action=pass:enable='lt(t,${s3(i.hookMs)})'[c2]`);
  f.push(`[c2][${END}:v]overlay=0:0:eof_action=pass:enable='gte(t,${s3(i.hookMs + i.bodyMs)})',fade=t=in:st=0:d=0.3,format=yuv420p[vout]`);
  // audio: silence(hook) + per-scene voice (padded) + silence(end), then music bed
  i.plans.forEach((p, k) => {
    const idx = audioIdx[k] ?? -1;
    if (idx >= 0) f.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${s3(p.totalMs)},atrim=duration=${s3(p.totalMs)}[sa${k}]`);
    else f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(p.totalMs)}[sa${k}]`);
  });
  f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s3(i.hookMs)}[sahook]`, `anullsrc=r=44100:cl=stereo,atrim=duration=${s3(i.endMs)}[saend]`);
  f.push(`[sahook]${i.plans.map((_, k) => `[sa${k}]`).join("")}[saend]concat=n=${i.plans.length + 2}:v=0:a=1[voice]`);
  if (MUSIC >= 0) f.push(`[${MUSIC}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.12,atrim=duration=${s3(totalMs)},afade=t=out:st=${s3(Math.max(0, totalMs - 2500))}:d=2.5[music]`, `[voice][music]amix=inputs=2:duration=first:normalize=0[aout]`);
  else f.push(`[voice]acopy[aout]`);

  const args = [...inputs, "-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]", "-r", String(fps), "-t", s3(totalMs),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    "-metadata", "comment=AI-generated: true (Marketing Pilot, screen recording + synthetic voice)", "-metadata", "title=Marketing Pilot render", i.out];
  return { args, totalMs };
}

export interface AssembleInput {
  recording: Recording; plans: ScenePlan[]; audio: { file: string | null; durationMs: number }[]; layout: Layout;
  hookCard: string; endCard: string; frame: string; background: string; hookMs: number; endMs: number;
  captions: CaptionCue[]; music: string | null; out: string; fps?: number;
  /** Reuse scene segments across variants (same recording/layout, different hook). */
  segmentCache?: Map<string, string>;
}

export async function assemble(i: AssembleInput, run: FfmpegRunner = runFfmpeg): Promise<{ file: string; durationMs: number }> {
  const dir = path.dirname(i.out);
  fs.mkdirSync(dir, { recursive: true });
  const fps = i.fps ?? OUTPUT_FPS;
  const cacheKey = `${i.recording.file}|${i.layout.inner.w}x${i.layout.inner.h}`;
  let body = i.segmentCache?.get(cacheKey);
  if (!body) {
    const segs: string[] = [];
    for (const [k, p] of i.plans.entries()) {
      const seg = path.join(dir, `seg-${path.basename(i.recording.file, ".webm")}-${k}.mp4`);
      await run(buildSceneArgs(i.recording, p, i.layout, seg, fps));
      segs.push(seg);
    }
    body = path.join(dir, `body-${path.basename(i.recording.file, ".webm")}.mp4`);
    const list = body + ".txt";
    fs.writeFileSync(list, segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    await run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", body]);
    i.segmentCache?.set(cacheKey, body);
  }
  const bodyMs = i.plans.reduce((n, p) => n + p.totalMs, 0);
  const { args, totalMs } = buildComposeArgs({ body, bodyMs, layout: i.layout, audio: i.audio, plans: i.plans, hookCard: i.hookCard, endCard: i.endCard, frame: i.frame, background: i.background, hookMs: i.hookMs, endMs: i.endMs, captions: i.captions, music: i.music, out: i.out, fps });
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
