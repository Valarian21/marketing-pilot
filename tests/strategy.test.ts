/** Shot 2: plan versions + diff, task generation with approval rules, task execution, timeline, overview, review actions. */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { LlmMessage, LlmProvider, LlmResult } from "../src/server/providers/index.js";
import { enforceApproval, planDiff } from "../src/server/agents/strategy/plan.js";
import { formatForTask } from "../src/server/agents/strategy/execute.js";
import { strategyPrompt, tasksPrompt, executeTaskPrompt } from "../src/server/agents/prompts/strategy.js";
import { writingRules } from "../src/server/agents/prompts/voice.js";
import type { Brief, StrategyPlan } from "../src/shared/schemas.js";
import { fakeHost } from "./helpers.js";

const usage = { tokensIn: 50, tokensOut: 20, costUsd: 0.001 };
const json = (o: unknown): LlmResult => ({ text: JSON.stringify(o), model: "fake", usage });
const brief: Brief = { productName: "Beispielwerk", oneLiner: "Arbeitsblätter in Minuten.", category: "worksheet generator", language: "de", features: ["Generator"], pricing: [], usp: ["Lehrplan"], tone: "Du", targetAudience: "Lehrkräfte", keywords: [], sources: [] };
const plan = (v: number): StrategyPlan => ({
  summary: `Plan v${v}`, startDate: "2026-08-31", coreMessage: { text: "Sonntag frei.", rationale: "USP" },
  channels: [{ platform: "Reddit r/lehrerzimmer", role: "start", format: "Antworten", cadence: "3×/Woche", rationale: "Persona ist dort", evidenceRefs: [] }, { platform: "Directories", role: "start", format: "Eintrag", cadence: "einmalig", rationale: "kostenlos", evidenceRefs: [] }],
  goals: [{ horizonDays: 30, metric: "signups", target: 20 + v, rationale: "" }, { horizonDays: 60, metric: "signups", target: 60, rationale: "" }, { horizonDays: 90, metric: "signups", target: 120, rationale: "" }],
  budget: { monthlyEur: 50, items: [{ item: "Ads-Test", eur: 50, rationale: "" }], rationale: "" }, risks: [{ text: "Zeit", mitigation: "Batching" }],
});
let planVersion = 0;
const fakeLlm: LlmProvider = {
  async chat(_model: string, messages: LlmMessage[]): Promise<LlmResult> {
    const task = /^\[task:([a-z-]+)\]/.exec(messages.find((m) => m.role === "system")?.content ?? "")?.[1];
    switch (task) {
      case "strategy": return json(plan(++planVersion));
      case "tasks": return json({ tasks: [
        { week: 1, dayOffset: 0, title: "Directory-Eintrag bei AlternativeTo vorbereiten", description: "Felder ausfüllen", type: "content", channel: "Directories", assignedTo: "agent", approvalLevel: "review" },
        { week: 1, dayOffset: 2, title: "AlternativeTo einreichen", description: "", type: "publish", channel: "Directories", assignedTo: "agent", approvalLevel: "auto" },
        { week: 1, dayOffset: 3, title: "r/lehrerzimmer: 3 Threads finden und Antworten entwerfen", description: "", type: "community", channel: "Reddit r/lehrerzimmer", assignedTo: "agent", approvalLevel: "review" },
        { week: 1, dayOffset: 4, title: "Antworten posten", description: "", type: "community", channel: "Reddit r/lehrerzimmer", assignedTo: "human", approvalLevel: "review" },
        { week: 2, dayOffset: 0, title: "Ads-Test 50 €", description: "", type: "ads", channel: "Meta Ads", assignedTo: "agent", approvalLevel: "review" },
        { week: 5, dayOffset: 0, title: "zu spät", description: "", type: "measure", channel: "", assignedTo: "human", approvalLevel: "review" },
      ] });
      case "execute": return json({ title: "AlternativeTo: Eintrag", body: "Tagline: Arbeitsblätter in Minuten.\nBeschreibung: …", notes: "Screenshots ergänzen" });
      default: return { text: "irrelevant", model: "fake", usage };
    }
  },
};

const DATA = path.resolve("data/test-strategy");
let built: Awaited<ReturnType<typeof buildApp>>;
const auth = { authorization: "Bearer test-token" };
const waitIdle = async (pid: string) => { for (let i = 0; i < 100; i++) { const v = (await built.app.inject({ url: `/api/mp/projects/${pid}/strategy`, headers: auth })).json(); if (!v.running) return v; await new Promise((r) => setTimeout(r, 30)); } throw new Error("timeout"); };

beforeAll(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA }), { host: fakeHost(), dbFile: ":memory:", logger: false, services: { llm: fakeLlm } });
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("pure helpers", () => {
  it("diffs plans by channel, goal and budget", () => {
    const d = planDiff(plan(1), { ...plan(2), channels: [plan(2).channels[0]!] });
    expect(d.map((x) => x.path).sort()).toEqual(["channels.Directories", "goals.30d", "summary"]);
    expect(planDiff(null, plan(1))).toHaveLength(1);
  });
  it("forces human_only for reddit/forum/discord/ads and human for outside effects", () => {
    expect(enforceApproval({ title: "Antworten posten", channel: "Reddit r/x", type: "community", assignedTo: "human", approvalLevel: "review" }).approvalLevel).toBe("human_only");
    expect(enforceApproval({ title: "Ads-Test", channel: "Meta", type: "ads", assignedTo: "agent", approvalLevel: "auto" })).toMatchObject({ assignedTo: "human", approvalLevel: "human_only" });
    expect(enforceApproval({ title: "Eintrag einreichen", channel: "Directories", type: "publish", assignedTo: "agent", approvalLevel: "auto" }).assignedTo).toBe("human");
    expect(enforceApproval({ title: "Reel-Skript entwerfen", channel: "Instagram", type: "content", assignedTo: "agent", approvalLevel: "review" })).toMatchObject({ assignedTo: "agent", approvalLevel: "review" });
  });
  it("maps tasks to content formats", () => {
    expect(formatForTask({ type: "community", title: "x", channel: "Reddit" })).toBe("community_reply");
    expect(formatForTask({ type: "content", title: "Directory-Eintrag AlternativeTo", channel: "" })).toBe("directory_entry");
    expect(formatForTask({ type: "content", title: "Reel #1 Skript", channel: "Instagram" })).toBe("video");
    expect(formatForTask({ type: "content", title: "Post für LinkedIn", channel: "LinkedIn" })).toBe("text");
    expect(formatForTask({ type: "research", title: "Threads finden", channel: "" })).toBe("article");
  });
  it("prompt snapshots + writing rules in every execution prompt", () => {
    const p = plan(1);
    expect(strategyPrompt({ brief, personas: [], channels: [], competitors: [], geo: { visibility: 0, perModel: [], topCompetitors: ["RivalTool"] }, startDate: "2026-08-31" })).toMatchSnapshot();
    expect(tasksPrompt({ brief, plan: p, personas: [], weeks: 4 })).toMatchSnapshot();
    const ex = executeTaskPrompt({ brief, task: { id: "t", projectId: "p", title: "r/x antworten", description: "", type: "community", status: "todo", dueAt: null, assignedTo: "agent", approvalLevel: "review", outputRefs: [], order: 1, channel: "Reddit", week: 1, planVersion: 1, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z" }, personas: [], plan: p, format: "community_reply" });
    expect(ex).toMatchSnapshot();
    expect(ex[0]?.content).toContain("Game-Changer");
    expect(ex[0]?.content).toContain("Ich bau das Tool selbst");
    expect(writingRules({ language: "en" })).not.toContain("COMMUNITY REPLY RULES");
  });
});

describe("strategy + tasks API", () => {
  let pid = "";
  it("refuses without a confirmed brief, then creates plan v1 and tasks", async () => {
    pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Beispielwerk", url: "https://example.test" } })).json().id;
    expect((await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/strategy/run`, headers: auth, payload: {} })).statusCode).toBe(409);
    await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}`, headers: auth, payload: { brief } });
    // brief comes from the analysis normally; write meta directly through the brief endpoints
    expect((await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/brief/confirm`, headers: auth })).statusCode).toBe(200);
    const started = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/strategy/run`, headers: auth, payload: { note: "" } });
    expect(started.statusCode).toBe(202);
    const view = await waitIdle(pid);
    expect(view.error).toBeNull();
    expect(view.current.version).toBe(1);
    expect(view.current.plan.channels).toHaveLength(2);
    expect(view.taskCount).toBe(5);   // week-5 task dropped (4-week horizon)
    const tasks = (await built.app.inject({ url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json();
    const byTitle = (t: string) => tasks.find((x: { title: string }) => x.title.startsWith(t));
    expect(byTitle("AlternativeTo einreichen")).toMatchObject({ assignedTo: "human", type: "publish" });
    expect(byTitle("Antworten posten")).toMatchObject({ assignedTo: "human", approvalLevel: "human_only" });
    expect(byTitle("Ads-Test")).toMatchObject({ assignedTo: "human", approvalLevel: "human_only", week: 2 });
    expect(byTitle("Directory-Eintrag")).toMatchObject({ assignedTo: "agent", dueAt: "2026-08-31T09:00:00.000Z", order: 1, planVersion: 1 });
  });

  it("new version carries a diff; untouched tasks are regenerated, done tasks survive", async () => {
    const tasks = (await built.app.inject({ url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json();
    const doneId = tasks[0].id;
    await built.app.inject({ method: "PATCH", url: `/api/mp/tasks/${doneId}`, headers: auth, payload: { status: "done" } });
    await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/strategy/run`, headers: auth, payload: { note: "mehr Directories" } });
    const view = await waitIdle(pid);
    expect(view.current.version).toBe(2);
    expect(view.current.note).toBe("mehr Directories");
    expect(view.current.diff.map((d: { path: string }) => d.path)).toEqual(["summary", "goals.30d"]);
    expect(view.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const after = (await built.app.inject({ url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json();
    expect(after.find((t: { id: string }) => t.id === doneId).status).toBe("done");
    expect(after.filter((t: { planVersion: number }) => t.planVersion === 2)).toHaveLength(5);
    const v1 = (await built.app.inject({ url: `/api/mp/projects/${pid}/strategy/versions/1`, headers: auth })).json();
    expect(v1.plan.summary).toBe("Plan v1");
  });

  it("creates, reorders, executes and reviews tasks", async () => {
    const created = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/tasks`, headers: auth, payload: { title: "Discord-Antworten posten", type: "publish", channel: "Discord", week: 1, assignedTo: "agent" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ assignedTo: "human", approvalLevel: "human_only", week: 1 });
    const week1 = (await built.app.inject({ url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json().filter((t: { week: number; status: string }) => t.week === 1 && t.status === "todo");
    const ids = week1.map((t: { id: string }) => t.id).reverse();
    const reordered = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/tasks/reorder`, headers: auth, payload: { ids } })).json();
    expect(reordered.filter((t: { week: number; status: string }) => t.week === 1 && t.status === "todo").map((t: { id: string }) => t.id)).toEqual(ids);

    const agentTask = reordered.find((t: { assignedTo: string; type: string; status: string }) => t.assignedTo === "agent" && t.type === "content" && t.status === "todo");
    const humanTask = reordered.find((t: { assignedTo: string }) => t.assignedTo === "human");
    expect((await built.app.inject({ method: "POST", url: `/api/mp/tasks/${humanTask.id}/execute`, headers: auth })).statusCode).toBe(400);
    const exec = await built.app.inject({ method: "POST", url: `/api/mp/tasks/${agentTask.id}/execute`, headers: auth });
    expect(exec.statusCode).toBe(200);
    const piece = exec.json();
    expect(piece).toMatchObject({ status: "review", format: "directory_entry", taskId: agentTask.id, humanEdited: false });
    expect(piece.body).toContain("Hinweise für die Prüfung");
    const t2 = (await built.app.inject({ url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json().find((t: { id: string }) => t.id === agentTask.id);
    expect(t2).toMatchObject({ status: "review", outputRefs: [piece.id] });

    const overview = (await built.app.inject({ url: "/api/mp/overview", headers: auth })).json();
    expect(overview[0]).toMatchObject({ piecesInReview: 1, briefConfirmed: true, planVersion: 2 });

    const edited = (await built.app.inject({ method: "PATCH", url: `/api/mp/content/${piece.id}`, headers: auth, payload: { body: "Tagline: besser.", status: "approved" } })).json();
    expect(edited).toMatchObject({ status: "approved", humanEdited: true });
    const published = (await built.app.inject({ method: "PATCH", url: `/api/mp/content/${piece.id}`, headers: auth, payload: { status: "published" } })).json();
    expect(published.publishedAt).toBeTruthy();
    expect((await built.app.inject({ url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json().find((t: { id: string }) => t.id === agentTask.id).status).toBe("done");
    const audit = (await built.app.inject({ url: `/api/mp/audit?projectId=${pid}`, headers: auth })).json();
    expect(audit.slice(0, 2).map((a: { action: string }) => a.action)).toEqual(["content.published", "content.approved"]);
    expect(audit[1].content.body).toBe("Tagline: besser.");
  });

  it("timeline has channel rows, planned vs published items and a week index", async () => {
    const tl = (await built.app.inject({ url: `/api/mp/projects/${pid}/timeline`, headers: auth })).json();
    expect(tl.startDate).toBe("2026-08-31");
    expect(tl.weeks).toBe(12);
    const rows = Object.fromEntries(tl.rows.map((r: { channel: string; items: unknown[] }) => [r.channel, r.items]));
    expect(Object.keys(rows)).toEqual(expect.arrayContaining(["Reddit r/lehrerzimmer", "Directories", "Discord"]));
    const dir = rows["Directories"] as { kind: string; planned: boolean; week: number }[];
    expect(dir.some((i) => i.kind === "piece" && !i.planned)).toBe(true);
    expect(dir.every((i) => i.week >= 1)).toBe(true);
  });
});
