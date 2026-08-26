/**
 * Video job: record (per device) -> voiceover -> overlays -> assemble reels
 * (one per hook) + landscape cut -> assets on the ContentPiece. Runs in the
 * worker process; progress goes to mp_jobs.steps.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import type { Env } from "../../env.js";
import type { LlmProvider, VoiceProvider } from "../../providers/index.js";
import { modelFor } from "../../../../config/models.js";
import type { JobHandler } from "../../jobs.js";
import { loadBrandKit } from "../studio/brandkit.js";
import { playwrightRenderer, type RenderJob, type Renderer } from "../studio/render.js";
import { markPng } from "../../util/png.js";
import { startRun, finishRun, bookRun } from "../../audit.js";
import { z } from "zod";
import { sceneCheckPrompt } from "../prompts/revise.js";
import { dataUrlFor } from "../studio/render.js";
import { getProject } from "../../repo/projects.js";
import { playwrightRecorder, type Recorder, type Recording } from "./record.js";
import { saveUiMap } from "./uimap.js";
import { estimateDurationMs, estimateWords, type WordTiming } from "./voice.js";
import { assemble, detectFreezes, pickMusic, planScene, runFfmpeg, type FfmpegRunner, type ScenePlan } from "./assemble.js";
import { backgroundHtml, captionJobs, deviceFrameHtml, endCardHtml, hookCardHtml, layoutFor, type CaptionCue } from "./overlays.js";

export interface VideoContext {
  db: Db; env: Env; dataDir: string; log: (m: string) => void;
  voice: VoiceProvider | null;
  /** optional: enables the vision scene check */
  llm?: LlmProvider;
  recorder?: Recorder; renderer?: Renderer; ffmpeg?: FfmpegRunner; freezes?: (file: string) => Promise<{ startMs: number; endMs: number }[]>;
}

export const HOOK_MS = 1500, END_MS = 2500;
/** Variant count / landscape flag of an earlier render (for re-renders); defaults for never-rendered pieces. */
export function renderOptionsFromMeta(meta: Record<string, unknown>): { variants: number; landscape: boolean } {
  const vs = Array.isArray(meta["variants"]) ? (meta["variants"] as { variant: string }[]) : [];
  return { variants: Math.max(1, vs.filter((v) => String(v.variant).startsWith("reel")).length), landscape: vs.some((v) => v.variant === "landscape") };
}

export const VIDEO_STEPS = ["record", "check", "voice", "overlays", "reels", "landscape", "assets"];
export interface SceneNote { id: string; device: string; match: boolean; seen: string; issue: string }

export function getScript(db: Db, pieceId: string): { piece: typeof t.mpContentPieces.$inferSelect; script: s.VideoScript } | null {
  const piece = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  if (!piece) return null;
  const parsed = s.VideoScript.safeParse(parseJson<Record<string, unknown>>(piece.meta, {})["script"]);
  return parsed.success ? { piece, script: parsed.data } : null;
}

interface SceneAudio { file: string | null; durationMs: number; words: WordTiming[] }

export const renderVideoJob: JobHandler<VideoContext> = async (ctx, job, progress) => {
  const pieceId = String(job.payload["pieceId"] ?? "");
  const variants = Number(job.payload["variants"] ?? 3);
  const wantLandscape = job.payload["landscape"] !== false;
  const reuse = job.payload["reuseRecording"] === true;
  const got = getScript(ctx.db, pieceId);
  if (!got) throw new Error("Kein Video-Skript am Stück gefunden.");
  const { piece, script } = got;
  const project = getProject(ctx.db, piece.projectId);
  if (!project) throw new Error("Projekt nicht gefunden.");
  const brief = s.Brief.safeParse(project.brief);
  const brand = brief.success ? brief.data.productName : project.name;
  const kit = loadBrandKit(ctx.db, piece.projectId);
  const outDir = path.join(ctx.dataDir, "assets", piece.projectId, "video", pieceId);
  fs.mkdirSync(outDir, { recursive: true });
  const recorder = ctx.recorder ?? playwrightRecorder;
  const renderer = ctx.renderer ?? playwrightRenderer;
  const ffmpeg = ctx.ffmpeg ?? runFfmpeg;
  const freezesOf = ctx.freezes ?? ((file: string) => detectFreezes(file, ffmpeg));
  const warnings: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    progress(name, { status: "running", startedAt: nowIso() });
    const runId = startRun(ctx.db, { task: `video.${name}`, model: null, projectId: piece.projectId, pieceId });
    try { const r = await fn(); progress(name, { status: "done", finishedAt: nowIso() }); finishRun(ctx.db, runId, { resultRef: `video:${pieceId}` }); return r; }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); progress(name, { status: "failed", detail: msg, finishedAt: nowIso() }); finishRun(ctx.db, runId, { error: msg }); throw e; }
  };

  // 1. record: mobile (reels) and desktop (landscape) if requested/available
  const devices: s.VideoDevice[] = [];
  if (script.devices.includes("mobile") || !wantLandscape) devices.push("mobile");
  if (wantLandscape) devices.push("desktop");
  const baseUrl = ctx.env.MP_DEMO_BASE_URL ?? script.scenes[0]?.actions.find((a) => a.type === "goto")?.url ?? project.url;
  const login = ctx.env.MP_DEMO_USER && ctx.env.MP_DEMO_PASSWORD ? { user: ctx.env.MP_DEMO_USER, password: ctx.env.MP_DEMO_PASSWORD } : undefined;
  const pieceMeta = parseJson<Record<string, unknown>>(piece.meta, {});
  const stored = pieceMeta["recordings"] as Partial<Record<s.VideoDevice, Recording>> | undefined;
  const canReuse = reuse && stored && devices.every((d) => stored[d] && fs.existsSync(stored[d]!.file));
  const recordings = await step("record", async () => {
    const out: Partial<Record<s.VideoDevice, Recording>> = {};
    if (canReuse) { for (const d of devices) out[d] = stored![d]!; progress("record", { detail: "vorhandene Aufnahme wiederverwendet (nur Text/Voice geändert)" }); return out; }
    for (const device of devices) {
      const rec = await recorder(script, { device, outDir, baseUrl, login, resetUrl: ctx.env.MP_DEMO_RESET_URL, loginUrl: ctx.env.MP_DEMO_LOGIN_URL, log: ctx.log });
      warnings.push(...rec.warnings);
      out[device] = rec;
      progress("record", { detail: `${Object.keys(out).join(" + ")}: ${Math.round(rec.durationMs / 1000)} s, ${rec.scenes.filter((x) => x.error).length} Szenen mit Fehlern` });
    }
    // UI map: real labels seen on tape feed the next script/revise prompt
    const labels = new Set<string>();
    for (const r of Object.values(out)) for (const l of r?.uiLabels ?? []) labels.add(l);
    if (labels.size) saveUiMap(ctx.db, piece.projectId, [...labels]);
    return out;
  });

  // 1b. scene check: does each recorded frame show what the voiceover claims? (vision model, cheap)
  const sceneNotes: SceneNote[] = await step("check", async () => {
    const out: SceneNote[] = [];
    const checkModel = modelFor("critic");
    const Verdict = z.object({ match: z.boolean(), seen: z.string().default(""), issue: z.string().default("") });
    const rec = recordings[devices[0]!];
    const llm = ctx.llm;
    if (!rec || !llm) { progress("check", { detail: "übersprungen" }); return out; }
    const runId = startRun(ctx.db, { task: "video.scene-check", model: checkModel, projectId: piece.projectId, pieceId });
    let cost = 0, tin = 0, tout = 0;
    try {
      for (const sc of script.scenes) {
        const r = rec.scenes.find((x) => x.id === sc.id);
        if (r && !r.shot && !r.error) {
          // still from the recording ~0.4 s before the scene ends (after its actions settled), downscaled for the vision model
          const shot = path.join(outDir, `scene-${rec.device}-${sc.id}.png`);
          const at = Math.max(r.startMs, r.endMs - 400) / 1000;
          try { await ffmpeg(["-y", "-ss", at.toFixed(3), "-i", rec.file, "-frames:v", "1", "-vf", "scale=600:-2", shot]); if (fs.existsSync(shot)) r.shot = shot; } catch (e) { ctx.log(`scene-still ${sc.id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        const img = r?.shot && fs.existsSync(r.shot) ? dataUrlFor(r.shot) : null;
        if (!img) continue;
        try {
          const res = await llm.chat(checkModel, sceneCheckPrompt({ sceneId: sc.id, voiceover: sc.voiceover, caption: sc.caption, actions: sc.actions.map((a) => `${a.type} ${a.target ?? a.url ?? a.text ?? ""}`).join(", "), language: script.language, image: img }), { json: true, temperature: 0, maxTokens: 300 });
          cost += res.usage.costUsd; tin += res.usage.tokensIn; tout += res.usage.tokensOut;
          const v = Verdict.safeParse(JSON.parse(res.text.replace(/^```(?:json)?|```$/g, "").trim()));
          if (v.success) out.push({ id: sc.id, device: rec.device, ...v.data });
        } catch (e) { ctx.log(`scene-check ${sc.id}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      finishRun(ctx.db, runId, { costUsd: cost, tokensIn: tin, tokensOut: tout, resultRef: `video:${pieceId}` });
    } catch (e) { finishRun(ctx.db, runId, { costUsd: cost, error: e instanceof Error ? e.message : String(e) }); }
    const bad = out.filter((n) => !n.match);
    for (const n of bad) warnings.push(`Szene ${n.id}: Bild passt nicht zum Voiceover - ${n.issue || n.seen}`);
    progress("check", { detail: bad.length ? `${bad.length}/${out.length} Szenen passen nicht zum Voiceover` : `${out.length} Szenen geprüft, alles stimmig` });
    return out;
  });

  // 2. voiceover per scene (or estimated timing without a TTS key)
  const audio = await step("voice", async () => {
    const out: SceneAudio[] = [];
    for (const [i, sc] of script.scenes.entries()) {
      if (ctx.voice && sc.voiceover.trim()) {
        const t0 = Date.now();
        const prev = script.scenes[i - 1]?.voiceover.trim(), next = script.scenes[i + 1]?.voiceover.trim();
        const r = await ctx.voice.synthesize({ text: sc.voiceover, ...(/^[a-z]{2}$/i.test(script.language) ? { language: script.language.toLowerCase() } : {}), ...(prev ? { previousText: prev } : {}), ...(next ? { nextText: next } : {}) }, path.join(outDir, "voice"));
        bookRun(ctx.db, { task: `video.voice:${sc.id}`, model: `elevenlabs/${ctx.env.ELEVENLABS_VOICE_ID ?? "voice"}`, provider: "elevenlabs", projectId: piece.projectId, pieceId, costUsd: (sc.voiceover.length / 1000) * ctx.env.ELEVENLABS_USD_PER_1K_CHARS, tokensIn: sc.voiceover.length, durationMs: Date.now() - t0 });
        out.push({ file: r.path, durationMs: r.durationMs, words: r.alignment?.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs })) ?? estimateWords(sc.voiceover, r.durationMs) });
      } else {
        out.push({ file: null, durationMs: estimateDurationMs(sc.voiceover), words: estimateWords(sc.voiceover, estimateDurationMs(sc.voiceover) - 300) });
      }
    }
    if (!ctx.voice) { warnings.push("Ohne Voiceover gerendert (ELEVENLABS_API_KEY/VOICE_ID fehlen) - Captions aus dem Skript-Timing."); progress("voice", { detail: "ohne Voiceover (kein ElevenLabs-Key)" }); }
    else progress("voice", { detail: `${out.length} Szenen, ${Math.round(out.reduce((n, a) => n + a.durationMs, 0) / 1000)} s Sprache` });
    return out;
  });

  // 3. overlays + scene plans per device
  type Prepared = { rec: Recording; plans: ScenePlan[]; layout: ReturnType<typeof layoutFor>; bg: string; frame: string; end: string; captions: CaptionCue[]; hooks: string[] };
  const prepared = await step("overlays", async () => {
    const out: Partial<Record<s.VideoDevice, Prepared>> = {};
    const jobs: RenderJob[] = [];
    for (const device of devices) {
      const rec = recordings[device]!;
      const landscape = device === "desktop";
      const layout = layoutFor(device, landscape, { width: rec.width, height: rec.height });
      const freezes = await freezesOf(rec.file);
      const plans = rec.scenes.map((sc, n) => planScene(sc, freezes, audio[n]?.durationMs ?? 0, { recWidth: rec.width, recHeight: rec.height, viewportWidth: rec.viewportWidth, viewportHeight: rec.viewportHeight }));
      const tag = landscape ? "land" : "reel";
      const bg = path.join(outDir, `${tag}-bg.png`), frame = path.join(outDir, `${tag}-frame.png`), end = path.join(outDir, `${tag}-end.png`);
      jobs.push({ html: backgroundHtml(kit, layout.w, layout.h, brand), width: layout.w, height: layout.h, file: bg });
      jobs.push({ html: deviceFrameHtml(kit, layout), width: layout.w, height: layout.h, file: frame, transparent: true });
      jobs.push({ html: endCardHtml(kit, script.cta.text, script.cta.url, brand, layout.w, layout.h), width: layout.w, height: layout.h, file: end });
      const hooks = script.hooks.slice(0, landscape ? 1 : Math.max(1, variants)).map((h, n) => { const file = path.join(outDir, `${tag}-hook-${n + 1}.png`); jobs.push({ html: hookCardHtml(kit, h, brand, layout.w, layout.h), width: layout.w, height: layout.h, file }); return file; });
      const captions: CaptionCue[] = [];
      let offset = 0;
      plans.forEach((p, n) => { const cj = captionJobs(kit, audio[n]?.words ?? [], offset, layout, outDir, `${tag}-s${n}`); jobs.push(...cj.jobs); captions.push(...cj.cues); offset += p.totalMs; });
      out[device] = { rec, plans, layout, bg, frame, end, captions, hooks };
    }
    await renderer(jobs);
    progress("overlays", { detail: `${jobs.length} Overlays gerendert` });
    return out;
  });

  const music = pickMusic(path.join(ctx.env.MP_DATA_DIR, "..", "assets", "music"));
  const segmentCache = new Map<string, string>();
  const outputs: { file: string; variant: string; hook: string; device: s.VideoDevice; landscape: boolean; durationMs: number; thumb: string }[] = [];

  // 4. reels: one per hook
  if (prepared.mobile) {
    await step("reels", async () => {
      const p = prepared.mobile!;
      for (let n = 0; n < p.hooks.length; n++) {
        const out = path.join(outDir, `reel-${n + 1}.mp4`);
        const r = await assemble({ recording: p.rec, plans: p.plans, audio: audio.map((a) => ({ file: a.file, durationMs: a.durationMs })), layout: p.layout, hookCard: p.hooks[n]!, endCard: p.end, frame: p.frame, background: p.bg, hookMs: HOOK_MS, endMs: END_MS, captions: p.captions, music, out, segmentCache }, ffmpeg);
        outputs.push({ file: out, variant: `reel-${n + 1}`, hook: script.hooks[n] ?? "", device: "mobile", landscape: false, durationMs: r.durationMs, thumb: p.hooks[n]! });
        progress("reels", { detail: `${n + 1}/${p.hooks.length} gerendert` });
      }
    });
  } else progress("reels", { status: "skipped", detail: "kein Mobile-Recording" });

  // 5. landscape cut
  if (prepared.desktop) {
    await step("landscape", async () => {
      const p = prepared.desktop!;
      const out = path.join(outDir, "landscape.mp4");
      const r = await assemble({ recording: p.rec, plans: p.plans, audio: audio.map((a) => ({ file: a.file, durationMs: a.durationMs })), layout: p.layout, hookCard: p.hooks[0]!, endCard: p.end, frame: p.frame, background: p.bg, hookMs: HOOK_MS, endMs: END_MS, captions: p.captions, music, out, segmentCache }, ffmpeg);
      outputs.push({ file: out, variant: "landscape", hook: script.hooks[0] ?? "", device: "desktop", landscape: true, durationMs: r.durationMs, thumb: p.hooks[0]! });
    });
  } else progress("landscape", { status: "skipped", detail: "nicht angefordert" });

  // 6. assets + piece
  const assetIds = await step("assets", async () => {
    // previous render assets of this piece are replaced (files + rows); recording rows stay only when reused
    const oldAssets = ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.contentPieceId, pieceId)).all();
    const keepIds: string[] = [];
    const stale: string[] = [];  // old file paths - unlinked at the end unless a new asset reuses the same path
    for (const a of oldAssets) {
      if (a.kind === "recording" && canReuse) { keepIds.push(a.id); continue; }
      if (a.kind !== "recording") stale.push(a.path);
      ctx.db.delete(t.mpAssets).where(eq(t.mpAssets.id, a.id)).run();
    }
    const ids: string[] = [];
    const newPaths = new Set<string>();
    const ts = nowIso();
    const addAsset = (kind: s.Asset["kind"], file: string, meta: Record<string, unknown>) => {
      const id = newId();
      newPaths.add(path.relative(ctx.dataDir, file));
      ctx.db.insert(t.mpAssets).values({ id, projectId: piece.projectId, contentPieceId: pieceId, kind, path: path.relative(ctx.dataDir, file), meta: toJson({ aiGenerated: true, provenance: kind === "render" ? "mp4-metadata" : "png-text-chunk", ...meta }), createdAt: ts }).run();
      ids.push(id); return id;
    };
    if (!canReuse) for (const device of devices) { const rec = recordings[device]!; addAsset("recording", rec.file, { device, width: rec.width, height: rec.height, durationMs: rec.durationMs, aiGenerated: false, provenance: "none" }); }
    for (const o of outputs) {
      const thumb = o.file.replace(/\.mp4$/, "-thumb.png");
      fs.copyFileSync(o.thumb, thumb); markPng(thumb, { aiGenerated: true, generator: "Marketing Pilot (video hook card)" });
      const thumbId = addAsset("image", thumb, { role: "thumbnail", variant: o.variant });
      addAsset("render", o.file, { variant: o.variant, hook: o.hook, device: o.device, landscape: o.landscape, durationMs: o.durationMs, thumbnailAssetId: thumbId, size: o.landscape ? "1920x1080" : "1080x1920" });
    }
    for (const rel of stale) if (!newPaths.has(rel)) { try { fs.unlinkSync(path.join(ctx.dataDir, rel)); } catch { /* gone */ } }
    // intermediates (scene segments, concatenated bodies) are large and reproducible
    for (const f of fs.readdirSync(outDir)) if (/^(seg-|body-)/.test(f)) { try { fs.unlinkSync(path.join(outDir, f)); } catch { /* ignore */ } }
    const meta = parseJson<Record<string, unknown>>(piece.meta, {});
    const timelineOf = (plans: ScenePlan[]) => { let acc = 0; return plans.map((p) => { const x = { id: p.id, startMs: acc, endMs: acc + p.totalMs }; acc += p.totalMs; return x; }); };
    const timeline = prepared.mobile ? timelineOf(prepared.mobile.plans) : prepared.desktop ? timelineOf(prepared.desktop.plans) : [];
    ctx.db.update(t.mpContentPieces).set({
      assets: toJson([...keepIds, ...ids]), status: "review", updatedAt: nowIso(),
      meta: toJson({ ...meta, renderedAt: nowIso(), warnings, variants: outputs.map((o) => ({ variant: o.variant, hook: o.hook, durationMs: o.durationMs })), recordings, timeline, hookMs: HOOK_MS, sceneNotes }),
      aiTellNotes: warnings.length ? `Render-Hinweise:\n${warnings.join("\n")}` : "",
    }).where(eq(t.mpContentPieces.id, pieceId)).run();
    return ids;
  });

  return { assets: assetIds, variants: outputs.map((o) => o.variant), warnings };
};
