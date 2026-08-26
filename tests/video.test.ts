/** Shot 4: pure helpers (timing, cuts, captions, ffmpeg graph), job queue, script agent, full render job with fakes. */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { LlmMessage, LlmProvider, LlmResult, VoiceProvider } from "../src/server/providers/index.js";
import type { Recorder } from "../src/server/agents/video/record.js";
import { isSelector, substitute, easeInOutCubic, resolveUrl } from "../src/server/agents/video/record.js";
import { estimateWords, wordsFromAlignment } from "../src/server/agents/video/voice.js";
import { chunkWords, layoutFor } from "../src/server/agents/video/overlays.js";
import { buildFfmpegArgs, parseFreezes, planScene } from "../src/server/agents/video/assemble.js";
import { claimNextJob, enqueueJob, finishJob, markStaleJobs, processNextJob, workerAlive, writeHeartbeat } from "../src/server/jobs.js";
import { renderVideoJob } from "../src/server/agents/video/pipeline.js";
import { videoScriptPrompt } from "../src/server/agents/prompts/video.js";
import { scriptToBody } from "../src/server/agents/video/script.js";
import type { Brief, VideoScript } from "../src/shared/schemas.js";
import { fakeHost } from "./helpers.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const usage = { tokensIn: 30, tokensOut: 20, costUsd: 0.001 };
const brief: Brief = { productName: "Beispielwerk", oneLiner: "Arbeitsblätter in Minuten.", category: "worksheet generator", language: "de", features: ["Generator"], pricing: [], usp: ["Lehrplan"], tone: "Du", targetAudience: "Lehrkräfte", keywords: [], sources: ["https://beispielwerk.test/"] };
const script: VideoScript = {
  title: "Onboarding in 20 Sekunden", goal: "Signup", persona: "Lehrerin", devices: ["mobile", "desktop"], language: "de",
  hooks: ["Sonntag gehört wieder dir", "3 Blätter in 2 Minuten", "Schluss mit Zettelchaos", "Lehrplan inklusive", "Ohne Kreditkarte"],
  scenes: [
    { id: "s1", voiceover: "Ich öffne Beispielwerk und wähle mein Fach.", caption: "Fach wählen", actions: [{ type: "goto", url: "/" }, { type: "click", target: "Kostenlos starten" }], durationMs: 3000 },
    { id: "s2", voiceover: "Thema eintippen, fertig.", caption: "", actions: [{ type: "type", target: "Thema", text: "Bruchrechnen" }], durationMs: 3000 },
  ],
  cta: { text: "Probier es kostenlos", url: "https://beispielwerk.test" },
};
const fakeLlm: LlmProvider = {
  async chat(_m: string, messages: LlmMessage[]): Promise<LlmResult> {
    const task = /^\[task:([a-z-]+)\]/.exec(messages.find((x) => x.role === "system")?.content ?? "")?.[1];
    if (task === "video-script") return { text: JSON.stringify(script), model: "fake", usage };
    return { text: "{}", model: "fake", usage };
  },
};
const fakeRecorder: Recorder = async (sc, opts) => {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const file = path.join(opts.outDir, `recording-${opts.device}.webm`); fs.writeFileSync(file, "webm");
  const scenes = sc.scenes.map((x, i) => ({ id: x.id, startMs: i * 4000, endMs: i * 4000 + 4000, clicks: i === 0 ? [{ tMs: 1500, x: 200, y: 400 }] : [], error: null }));
  return { file, device: opts.device, width: opts.device === "mobile" ? 1170 : 1440, height: opts.device === "mobile" ? 2532 : 900, viewportWidth: opts.device === "mobile" ? 390 : 1440, viewportHeight: opts.device === "mobile" ? 844 : 900, scenes, durationMs: 8000, warnings: [] };
};
const fakeVoice: VoiceProvider = { async synthesize(req, outDir) { fs.mkdirSync(outDir, { recursive: true }); const p = path.join(outDir, `v-${req.text.length}.mp3`); fs.writeFileSync(p, "mp3"); return { path: p, durationMs: 2600, alignment: estimateWords(req.text, 2400) }; } };
const ffmpegCalls: string[][] = [];
const fakeFfmpeg = async (args: string[]) => { ffmpegCalls.push(args); const out = args[args.length - 1]!; if (out.endsWith(".mp4")) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, "mp4"); } return ""; };
const renderedJobs: string[] = [];
const fakeRenderer = async (jobs: { file: string; html: string }[]) => { for (const j of jobs) { fs.mkdirSync(path.dirname(j.file), { recursive: true }); fs.writeFileSync(j.file, PNG); renderedJobs.push(j.html); } };

const DATA = path.resolve("data/test-video");
let built: Awaited<ReturnType<typeof buildApp>>;
const auth = { authorization: "Bearer test-token" };
let pid = "";

beforeAll(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA, MP_DEMO_BASE_URL: "https://demo.beispielwerk.test", MP_DEMO_USER: "demo", MP_DEMO_PASSWORD: "pw" }),
    { host: fakeHost(), dbFile: ":memory:", logger: false, services: { llm: fakeLlm, recorder: fakeRecorder, voice: fakeVoice, ffmpeg: fakeFfmpeg, renderer: fakeRenderer, freezes: async () => [{ startMs: 2500, endMs: 5000 }], image: null } });
  pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Beispielwerk", url: "https://beispielwerk.test" } })).json().id;
  await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}`, headers: auth, payload: { brief } });
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("pure helpers", () => {
  it("target resolution, easing, substitution", () => {
    expect(isSelector("#login")).toBe(true); expect(isSelector("button.primary")).toBe(true); expect(isSelector("Kostenlos starten")).toBe(false);
    expect(easeInOutCubic(0)).toBe(0); expect(easeInOutCubic(1)).toBe(1); expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(substitute("{{DEMO_USER}}@x", { DEMO_USER: "demo" })).toBe("demo@x");
    expect(resolveUrl("/preise", "https://x.test/app")).toBe("https://x.test/preise");
  });
  it("word timing from alignment and estimation", () => {
    const w = wordsFromAlignment(["H", "i", " ", "d", "u"], [0, 0.1, 0.2, 0.3, 0.4], [0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(w).toEqual([{ word: "Hi", startMs: 0, endMs: 200 }, { word: "du", startMs: 300, endMs: 500 }]);
    const est = estimateWords("eins zwei drei vier", 2000);
    expect(est).toHaveLength(4); expect(est[3]!.endMs).toBeLessThanOrEqual(2000);
    expect(chunkWords(estimateWords("a b c d e f g h i"), 4).map((c) => c.length)).toEqual([4, 4, 1]);
  });
  it("freeze parsing and scene planning with auto-cut, padding and click remap", () => {
    expect(parseFreezes("[freezedetect] lavfi.freezedetect.freeze_start: 1.5\nfreeze_end: 4.0\nfreeze_start: 9.0")).toEqual([{ startMs: 1500, endMs: 4000 }, { startMs: 9000, endMs: Number.MAX_SAFE_INTEGER }]);
    const plan = planScene({ id: "s1", startMs: 0, endMs: 6000, clicks: [{ tMs: 5000, x: 195, y: 422 }], error: null }, [{ startMs: 1000, endMs: 4000 }], 3000, { recWidth: 1170, recHeight: 2532, viewportWidth: 390, viewportHeight: 844 });
    expect(plan.keep).toEqual([{ startMs: 0, endMs: 1900 }, { startMs: 4000, endMs: 6000 }]);   // 3 s freeze cut down to 0.9 s
    expect(plan.videoMs).toBe(3900);
    expect(plan.totalMs).toBe(3900);
    expect(plan.clickAtMs).toBe(1900 + 1000);
    expect(plan.clickX).toBe(585); expect(plan.clickY).toBe(1266);
    const padded = planScene({ id: "s2", startMs: 0, endMs: 2000, clicks: [], error: null }, [], 4000, { recWidth: 1, recHeight: 1, viewportWidth: 1, viewportHeight: 1 });
    expect(padded.padMs).toBe(2300);
  });
  it("layout keeps the recording inside the frame", () => {
    const reel = layoutFor("mobile", false, { width: 1170, height: 2532 });
    expect(reel.w).toBe(1080); expect(reel.inner.h).toBeLessThanOrEqual(1500); expect(reel.inner.w % 2).toBe(0);
    const land = layoutFor("desktop", true, { width: 1440, height: 900 });
    expect(land.inner.w).toBeLessThanOrEqual(1560); expect(land.inner.x).toBeGreaterThan(0);
  });
  it("ffmpeg graph contains trims, zoom, overlays and provenance metadata", () => {
    const { args, totalMs } = buildFfmpegArgs({
      recording: { file: "rec.webm", device: "mobile", width: 1170, height: 2532, viewportWidth: 390, viewportHeight: 844, scenes: [], durationMs: 8000, warnings: [] },
      plans: [{ id: "s1", keep: [{ startMs: 0, endMs: 1900 }, { startMs: 4000, endMs: 6000 }], videoMs: 3900, padMs: 500, totalMs: 4400, clickAtMs: 2900, clickX: 585, clickY: 1266 }],
      audio: [{ file: "a.mp3", durationMs: 4000 }], layout: layoutFor("mobile", false, { width: 1170, height: 2532 }),
      hookCard: "hook.png", endCard: "end.png", frame: "frame.png", background: "bg.png", hookMs: 1500, endMs: 2500,
      captions: [{ file: "c1.png", startMs: 100, endMs: 600 }], music: "m.mp3", out: "out.mp4",
    });
    expect(totalMs).toBe(1500 + 4400 + 2500);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("trim=start=0.000:end=1.900");
    expect(graph).toContain("concat=n=2:v=1:a=0");
    expect(graph).toContain("tpad=stop_mode=clone:stop_duration=0.500");
    expect(graph).toContain("zoompan=z='1+0.28*max(0,1-abs(in-93)/48)'");
    expect(graph).toContain("overlay=0:1590:enable='between(t,1.600,2.100)'");
    expect(graph).toContain("amix=inputs=2");
    expect(args).toContain("libx264");
    expect(args.join(" ")).toContain("AI-generated: true");
    expect(args[args.length - 1]).toBe("out.mp4");
  });
  it("script prompt snapshot and readable body", () => {
    expect(videoScriptPrompt({ brief, topic: "Onboarding", hint: "", voiceProfile: null, demoBaseUrl: "https://demo.test", pages: [{ url: "https://x.test/", title: "Start", kind: "home" }], hasLogin: true, targetSeconds: 30 })).toMatchSnapshot();
    expect(scriptToBody(script)).toContain("Szene 1 (s1, 3 s)");
    expect(scriptToBody(script)).toContain("click „Kostenlos starten“");
  });
});

describe("job queue", () => {
  it("claims atomically, finishes, marks stale, heartbeat", async () => {
    const db = built.db;
    const j = enqueueJob(db, { projectId: pid, kind: "noop", payload: {}, steps: ["a", "b"] });
    expect(j.status).toBe("queued");
    const claimed = claimNextJob(db);
    expect(claimed?.id).toBe(j.id); expect(claimNextJob(db)).toBeNull();
    finishJob(db, j.id, { result: { ok: true } });
    const j2 = enqueueJob(db, { projectId: pid, kind: "x", payload: {}, steps: ["a"] });
    claimNextJob(db);
    expect(markStaleJobs(db)).toBe(1);
    expect(workerAlive(db, Date.now())).toBe(false);
    writeHeartbeat(db);
    expect(workerAlive(db)).toBe(true);
    const done = await processNextJob({ db, log: () => undefined }, {});
    expect(done).toBe(false);
    void j2;
  });
});

describe("video API + render job", () => {
  let pieceId = "";
  it("generates an editable script piece", async () => {
    const res = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/video/script`, headers: auth, payload: { topic: "Onboarding" } });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    pieceId = p.id;
    expect(p).toMatchObject({ format: "video", status: "draft" });
    expect(p.meta.script.hooks).toHaveLength(5);
    const edited = { ...script, hooks: [...script.hooks.slice(0, 2)], title: "Bearbeitet" };
    const put = await built.app.inject({ method: "PUT", url: `/api/mp/content/${pieceId}/script`, headers: auth, payload: edited });
    expect(put.json()).toMatchObject({ title: "Bearbeitet", humanEdited: true });
    const view = (await built.app.inject({ url: `/api/mp/projects/${pid}/video`, headers: auth })).json();
    expect(view).toMatchObject({ demoConfigured: true, voiceConfigured: true, workerAlive: true });
  });

  it("enqueues a render job and the worker produces reels + landscape + assets", async () => {
    const res = await built.app.inject({ method: "POST", url: `/api/mp/content/${pieceId}/video/render`, headers: auth, payload: { variants: 2, landscape: true } });
    expect(res.statusCode).toBe(202);
    const job = res.json();
    expect(job.steps.map((st: { name: string }) => st.name)).toEqual(["record", "voice", "overlays", "reels", "landscape", "assets"]);
    expect((await built.app.inject({ method: "POST", url: `/api/mp/content/${pieceId}/video/render`, headers: auth, payload: {} })).statusCode).toBe(409);

    ffmpegCalls.length = 0; renderedJobs.length = 0;
    const did = await processNextJob(built.ctx!, { "video.render": renderVideoJob });
    expect(did).toBe(true);
    const done = (await built.app.inject({ url: `/api/mp/jobs/${job.id}`, headers: auth })).json();
    expect(done.error).toBeNull();
    expect(done.status).toBe("done");
    expect(done.steps.every((st: { status: string }) => st.status === "done")).toBe(true);
    expect(done.result.variants).toEqual(["reel-1", "reel-2", "landscape"]);
    // 3 outputs rendered, each with a full graph; overlays include hook cards, frames, captions
    expect(ffmpegCalls.filter((a) => a[a.length - 1]!.endsWith(".mp4"))).toHaveLength(3);
    expect(renderedJobs.some((h) => h.includes("Sonntag gehört wieder dir"))).toBe(true);
    expect(renderedJobs.some((h) => h.includes("<mask"))).toBe(true);

    const piece = (await built.app.inject({ url: `/api/mp/content/${pieceId}`, headers: auth })).json();
    expect(piece.status).toBe("review");
    expect(piece.meta.variants.map((v: { variant: string }) => v.variant)).toEqual(["reel-1", "reel-2", "landscape"]);
    const pkg = (await built.app.inject({ url: `/api/mp/content/${pieceId}/package`, headers: auth })).json();
    const kinds = pkg.assets.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(["image", "image", "image", "recording", "recording", "render", "render", "render"]);
    const mp4 = pkg.assets.find((a: { filename: string }) => a.filename === "reel-1.mp4");
    const file = await built.app.inject({ url: mp4.url, headers: { ...auth, range: "bytes=0-1" } });
    expect(file.statusCode).toBe(206);
    expect(file.headers["content-type"]).toBe("video/mp4");
    expect(file.headers["content-range"]).toBe("bytes 0-1/3");
  });
});
