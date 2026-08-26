/** Costs per piece, "change this" instructions (text + video script), scene check parse, storage view + deletion, eased scroll. */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { LlmMessage, LlmProvider, LlmResult, VoiceProvider } from "../src/server/providers/index.js";
import type { Recorder } from "../src/server/agents/video/record.js";
import { estimateWords } from "../src/server/agents/video/voice.js";
import { renderVideoJob } from "../src/server/agents/video/pipeline.js";
import { processNextJob, writeHeartbeat } from "../src/server/jobs.js";
import { bookRun, pieceCosts } from "../src/server/audit.js";
import { deletePieceMedia, dirSize, storageView } from "../src/server/routes/storage.js";
import { reviseScriptPrompt, reviseTextPrompt, sceneCheckPrompt } from "../src/server/agents/prompts/revise.js";
import type { Brief, VideoScript } from "../src/shared/schemas.js";
import { fakeHost } from "./helpers.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const usage = { tokensIn: 100, tokensOut: 50, costUsd: 0.01 };
const json = (o: unknown): LlmResult => ({ text: JSON.stringify(o), model: "fake", usage });
const brief: Brief = { productName: "Beispielwerk", oneLiner: "Arbeitsblätter in Minuten.", category: "worksheet generator", language: "de", features: ["Generator"], pricing: [], usp: ["Lehrplan"], tone: "Du", targetAudience: "Lehrkräfte", keywords: [], sources: ["https://beispielwerk.test/"] };
const script: VideoScript = {
  title: "Onboarding", goal: "Signup", persona: "L", devices: ["mobile"], language: "de", hooks: ["Sonntag frei", "3 Blätter"],
  scenes: [{ id: "s1", voiceover: "Ich öffne die Werkbank.", caption: "", actions: [{ type: "goto", url: "/" }], durationMs: 3000 }, { id: "s2", voiceover: "Thema eintippen, fertig.", caption: "", actions: [{ type: "type", target: "Thema", text: "Bruch" }], durationMs: 3000 }],
  cta: { text: "Probier es", url: "https://beispielwerk.test" },
};
let images: string[] = [];
const fakeLlm: LlmProvider = {
  async chat(_m: string, messages: LlmMessage[]): Promise<LlmResult> {
    const task = /^\[task:([a-z-]+)\]/.exec(messages.find((x) => x.role === "system")?.content ?? "")?.[1];
    switch (task) {
      case "video-script": return json(script);
      case "scene-check": { images.push(...(messages[1]?.images ?? [])); const id = /SCENE (\S+)/.exec(messages[1]?.content ?? "")?.[1]; return json({ match: id === "s2", seen: id === "s1" ? "Onboarding-Tour über der App" : "Werkbank mit Themenfeld", issue: id === "s1" ? "Tour verdeckt die App" : "" }); }
      case "text-post": return json({ title: "LinkedIn: Sonntag", body: "Erster Entwurf, lang und mit zweitem Absatz.\n\nZweiter Absatz.", altText: "" });
      case "ai-tell-critic": return json({ score: 9, issues: [], suggestions: [] });
      case "revise-text": return json({ body: "Kürzer. Sonntag gehört wieder dir - 5 Blätter gratis.", changed: "Gekürzt, zweiter Absatz entfernt, Zahl ergänzt." });
      case "revise-script": {
        const instr = /INSTRUCTION: (.*)/.exec(messages[1]?.content ?? "")?.[1] ?? "";
        if (/untertitel|caption/i.test(instr)) return json({ script: { ...script, scenes: script.scenes.map((s) => (s.id === "s2" ? { ...s, voiceover: "Thema rein. Fertig." } : s)) }, needsRecording: false, changed: "Voiceover Szene 2 gekürzt." });
        return json({ script: { ...script, scenes: script.scenes.map((s) => (s.id === "s1" ? { ...s, actions: [{ type: "goto", url: "/" }, { type: "click", target: "Überspringen" }] } : s)) }, needsRecording: true, changed: "Szene 1 klickt die Tour weg." });
      }
      default: return { text: "{}", model: "fake", usage };
    }
  },
};
const fakeRecorder: Recorder = async (sc, opts) => {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const file = path.join(opts.outDir, `recording-${opts.device}.webm`); fs.writeFileSync(file, Buffer.alloc(5000));
  const scenes = sc.scenes.map((x, i) => { const shot = path.join(opts.outDir, `scene-${opts.device}-${x.id}.png`); fs.writeFileSync(shot, PNG); return { id: x.id, startMs: i * 4000, endMs: i * 4000 + 4000, clicks: [], error: null, shot }; });
  return { file, device: opts.device, width: 1170, height: 2532, viewportWidth: 390, viewportHeight: 844, scenes, durationMs: 8000, warnings: [] };
};
let recorderCalls = 0;
const countingRecorder: Recorder = async (sc, opts) => { recorderCalls++; return fakeRecorder(sc, opts); };
const fakeVoice: VoiceProvider = { async synthesize(req, outDir) { fs.mkdirSync(outDir, { recursive: true }); const p = path.join(outDir, `v-${req.text.length}.mp3`); fs.writeFileSync(p, "mp3"); return { path: p, durationMs: 2000, alignment: estimateWords(req.text, 1800) }; } };
const fakeFfmpeg = async (args: string[]) => { const out = args[args.length - 1]!; if (out.endsWith(".mp4")) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.alloc(out.includes("seg-") || out.includes("body-") ? 20000 : 3000)); } return ""; };
const fakeRenderer = async (jobs: { file: string }[]) => { for (const j of jobs) { fs.mkdirSync(path.dirname(j.file), { recursive: true }); fs.writeFileSync(j.file, PNG); } };

const DATA = path.resolve("data/test-revise");
let built: Awaited<ReturnType<typeof buildApp>>;
const auth = { authorization: "Bearer test-token" };
let pid = "";

beforeAll(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA, ELEVENLABS_USD_PER_1K_CHARS: "0.5", ELEVENLABS_VOICE_ID: "v1" }), { host: fakeHost(), dbFile: ":memory:", logger: false, services: { llm: fakeLlm, recorder: countingRecorder, voice: fakeVoice, ffmpeg: fakeFfmpeg, renderer: fakeRenderer, freezes: async () => [], image: null } });
  pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Beispielwerk", url: "https://beispielwerk.test" } })).json().id;
  await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}`, headers: auth, payload: { brief } });
  writeHeartbeat(built.db);
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("prompts", () => {
  it("snapshots + scene check carries the image", () => {
    expect(reviseTextPrompt({ brief, format: "text", body: "Alt", instruction: "kürzer", voiceProfile: null, limit: 280 })).toMatchSnapshot();
    expect(reviseScriptPrompt({ brief, script, timeline: [{ id: "s1", startMs: 0, endMs: 4000 }, { id: "s2", startMs: 4000, endMs: 8000 }], hookMs: 1500, instruction: "Sekunde 6-9 neu", sceneNotes: [{ id: "s1", seen: "Tour", issue: "verdeckt" }] })[0]?.content).toContain("s2: 5.5-9.5 s");
    const sc = sceneCheckPrompt({ sceneId: "s1", voiceover: "v", caption: "", actions: "goto /", language: "de", image: "data:image/png;base64,AA==" });
    expect(sc[1]?.images).toEqual(["data:image/png;base64,AA=="]);
  });
});

describe("costs per piece", () => {
  it("books OpenRouter and ElevenLabs spend on the piece and exposes it everywhere", async () => {
    const p = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth, payload: { format: "text", platform: "linkedin", topic: "Sonntag" } })).json();
    expect(p.costUsd).toBeCloseTo(0.02, 5);   // draft + critic
    bookRun(built.db, { task: "video.voice:s1", model: "elevenlabs/v1", provider: "elevenlabs", projectId: pid, pieceId: p.id, costUsd: 0.011 });
    expect(pieceCosts(built.db, [p.id]).get(p.id)).toBeCloseTo(0.031, 5);
    const list = (await built.app.inject({ url: `/api/mp/projects/${pid}/content`, headers: auth })).json();
    expect(list.find((x: { id: string }) => x.id === p.id).costUsd).toBeCloseTo(0.031, 4);
    const runs = (await built.app.inject({ url: `/api/mp/runs?projectId=${pid}`, headers: auth })).json();
    expect(runs.find((r: { provider: string }) => r.provider === "elevenlabs")).toMatchObject({ pieceId: p.id, costUsd: 0.011 });
  });
});

describe("revise by instruction", () => {
  it("edits a text piece in place and logs the revision", async () => {
    const p = (await built.app.inject({ url: `/api/mp/projects/${pid}/content`, headers: auth })).json()[0];
    const r = await built.app.inject({ method: "POST", url: `/api/mp/content/${p.id}/revise`, headers: auth, payload: { instruction: "Kürzer, ohne zweiten Absatz, mit Zahl" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().piece.body).toContain("Kürzer.");
    expect(r.json().changed).toContain("Gekürzt");
    expect(r.json().piece.meta.revisions).toHaveLength(1);
    expect(r.json().piece.costUsd).toBeGreaterThan(0.031);
  });

  it("video: scene check flags a mismatch, caption-only change reuses the recording, action change re-records", async () => {
    const piece = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/video/script`, headers: auth, payload: { topic: "Onboarding" } })).json();
    const job = (await built.app.inject({ method: "POST", url: `/api/mp/content/${piece.id}/video/render`, headers: auth, payload: { variants: 1, landscape: false } })).json();
    expect(job.steps.map((st: { name: string }) => st.name)).toContain("check");
    images = []; recorderCalls = 0;
    await processNextJob(built.ctx!, { "video.render": renderVideoJob });
    const done = (await built.app.inject({ url: `/api/mp/jobs/${job.id}`, headers: auth })).json();
    expect(done.status).toBe("done");
    expect(images).toHaveLength(2);   // one screenshot per scene went to the vision model
    let pc = (await built.app.inject({ url: `/api/mp/content/${piece.id}`, headers: auth })).json();
    expect(pc.meta.sceneNotes.map((n: { id: string; match: boolean }) => [n.id, n.match])).toEqual([["s1", false], ["s2", true]]);
    expect(pc.aiTellNotes).toContain("Szene s1: Bild passt nicht zum Voiceover");
    expect(pc.meta.timeline).toEqual([{ id: "s1", startMs: 0, endMs: 4000 }, { id: "s2", startMs: 4000, endMs: 8000 }]);
    expect(pc.meta.recordings.mobile.file).toContain("recording-mobile.webm");
    expect(pc.costUsd).toBeGreaterThan(0);   // scene check + voice booked on the piece
    const voiceRuns = (await built.app.inject({ url: `/api/mp/runs?projectId=${pid}`, headers: auth })).json().filter((r: { provider: string; pieceId: string }) => r.provider === "elevenlabs" && r.pieceId === piece.id);
    expect(voiceRuns).toHaveLength(2);
    expect(voiceRuns[0].costUsd).toBeCloseTo(("Thema eintippen, fertig.".length / 1000) * 0.5, 5);
    // intermediates are gone, final render + recording stay
    const dir = path.join(DATA, "assets", pid, "video", piece.id);
    expect(fs.readdirSync(dir).filter((f) => /^(seg-|body-)/.test(f))).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "reel-1.mp4"))).toBe(true);

    // caption-only instruction -> job with reuseRecording, recorder not called again
    const rev = (await built.app.inject({ method: "POST", url: `/api/mp/content/${piece.id}/revise`, headers: auth, payload: { instruction: "Untertitel in Szene 2 kürzer" } })).json();
    expect(rev.needsRecording).toBe(false);
    expect(rev.job.payload.reuseRecording).toBe(true);
    recorderCalls = 0;
    await processNextJob(built.ctx!, { "video.render": renderVideoJob });
    expect(recorderCalls).toBe(0);
    pc = (await built.app.inject({ url: `/api/mp/content/${piece.id}`, headers: auth })).json();
    expect(pc.meta.script.scenes[1].voiceover).toBe("Thema rein. Fertig.");
    expect(pc.status).toBe("review");

    // action change -> re-record
    const rev2 = (await built.app.inject({ method: "POST", url: `/api/mp/content/${piece.id}/revise`, headers: auth, payload: { instruction: "Sekunde 2-5 ist falsch: Tour wegklicken" } })).json();
    expect(rev2.needsRecording).toBe(true);
    await processNextJob(built.ctx!, { "video.render": renderVideoJob });
    expect(recorderCalls).toBe(1);
    // "Neu generieren" on a video piece = full re-render job, never the studio path (which deleted the files)
    while ((await built.app.inject({ url: `/api/mp/projects/${pid}/video`, headers: auth })).json().jobs.some((j: { status: string }) => j.status === "queued" || j.status === "running")) await processNextJob(built.ctx!, { "video.render": renderVideoJob });
    const regen = await built.app.inject({ method: "POST", url: `/api/mp/content/${piece.id}/regenerate`, headers: auth, payload: { hint: "" } });
    expect(regen.statusCode).toBe(200);
    const jobs = (await built.app.inject({ url: `/api/mp/projects/${pid}/video`, headers: auth })).json().jobs.filter((j: { payload: { pieceId: string; reuseRecording?: boolean }; status: string }) => j.payload.pieceId === piece.id && j.status === "queued");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.reuseRecording).toBe(false);
    expect(fs.existsSync(path.join(dir, "reel-1.mp4"))).toBe(true);   // files untouched until the worker replaces them
  });
});

describe("storage", () => {
  it("lists disk, per-piece files and deletes by scope", async () => {
    const view = (await built.app.inject({ url: "/api/mp/storage", headers: auth })).json();
    expect(view.disk.freeBytes).toBeGreaterThan(0);
    expect(view.projects[0].name).toBe("Beispielwerk");
    const vid = view.projects[0].pieces.find((p: { format: string }) => p.format === "video");
    expect(vid.bytes).toBeGreaterThan(0);
    expect(vid.files.some((f: { kind: string }) => f.kind === "video")).toBe(true);
    expect(vid.files.some((f: { kind: string }) => f.kind === "recording")).toBe(true);
    const r1 = (await built.app.inject({ method: "DELETE", url: `/api/mp/storage/pieces/${vid.pieceId}?scope=recordings`, headers: auth })).json();
    expect(r1.freedBytes).toBeGreaterThan(0);
    const after = (await built.app.inject({ url: "/api/mp/storage", headers: auth })).json().projects[0].pieces.find((p: { pieceId: string }) => p.pieceId === vid.pieceId);
    expect(after.files.some((f: { kind: string }) => f.kind === "recording")).toBe(false);
    expect(after.files.some((f: { kind: string }) => f.kind === "video")).toBe(true);
    const pc = (await built.app.inject({ url: `/api/mp/content/${vid.pieceId}`, headers: auth })).json();
    expect(pc.meta.recordings).toBeUndefined();
    const all = deletePieceMedia(built.db, DATA, vid.pieceId, "all");
    expect(all.deletedFiles).toBeGreaterThan(0);
    expect(dirSize(path.join(DATA, "assets", pid, "video", vid.pieceId))).toBe(0);
    const cleanup = (await built.app.inject({ method: "POST", url: "/api/mp/storage/cleanup", headers: auth, payload: { scope: "orphans" } })).json();
    expect(cleanup.deletedFiles).toBeGreaterThanOrEqual(0);
    void storageView;
  });
});

describe("media library", () => {
  it("lists pieces across projects with thumbnail, size and filters", async () => {
    const all = (await built.app.inject({ url: "/api/mp/media", headers: auth })).json();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const vid = all.find((m: { format: string }) => m.format === "video");
    expect(vid.projectName).toBe("Beispielwerk");
    expect(vid.thumbUrl === null || /^\/api\/mp\/assets\/.+\/file$/.test(vid.thumbUrl)).toBe(true);   // storage test above wiped the files
    expect(vid.bytes).toBeGreaterThanOrEqual(0);
    expect(typeof vid.renderedAt).toBe("string");
    const onlyText = (await built.app.inject({ url: "/api/mp/media?format=text", headers: auth })).json();
    expect(onlyText.every((m: { format: string }) => m.format === "text")).toBe(true);
    const none = (await built.app.inject({ url: `/api/mp/media?since=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`, headers: auth })).json();
    expect(none).toHaveLength(0);
  });
});
