/** Shot 5: community radar (fake fetchers), events webhook + insights, weekly report + adopt, scheduler, snippet. */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { LlmMessage, LlmProvider, LlmResult } from "../src/server/providers/index.js";
import { deriveSources, parseFeed, scanCommunity, type Fetcher } from "../src/server/agents/community/radar.js";
import { landingSnippet, weekStartOf } from "../src/server/agents/insights/insights.js";
import { dueJobs, enqueueDue } from "../src/server/scheduler.js";
import { scoreThreadsPrompt, replyDraftPrompt, weeklyReportPrompt } from "../src/server/agents/prompts/community.js";
import type { Brief, Persona, StrategyPlan } from "../src/shared/schemas.js";
import { fakeHost } from "./helpers.js";

const usage = { tokensIn: 30, tokensOut: 20, costUsd: 0.001 };
const json = (o: unknown): LlmResult => ({ text: JSON.stringify(o), model: "fake", usage });
const brief: Brief = { productName: "Beispielwerk", oneLiner: "Arbeitsblätter in Minuten.", category: "worksheet generator", language: "de", features: ["Generator"], pricing: [{ plan: "Free", price: "0 €", notes: "" }], usp: ["Lehrplan"], tone: "Du", targetAudience: "Lehrkräfte", keywords: [], sources: [] };
const persona: Persona = { id: "p1", projectId: "x", name: "Grundschullehrerin", description: "Wenig Zeit.", painPoints: ["Sonntagabend Vorbereitung"], language: "de", phrases: ["ich sitze jeden Sonntag"], objections: [], buyingTriggers: [], whereTheyHangOut: ["r/lehrerzimmer", "Facebook-Gruppe Grundschule", "https://forum.example/feed.rss", "Hacker News"], evidence: [], createdAt: "2026-08-26T00:00:00.000Z" };
const plan: StrategyPlan = { summary: "Plan", startDate: "2026-08-24", coreMessage: { text: "Sonntag frei.", rationale: "" }, channels: [{ platform: "Reddit r/lehrerzimmer", role: "start", format: "Antworten", cadence: "3×/Woche", rationale: "", evidenceRefs: [] }], goals: [{ horizonDays: 30, metric: "signups", target: 20, rationale: "" }, { horizonDays: 60, metric: "signups", target: 60, rationale: "" }, { horizonDays: 90, metric: "signups", target: 120, rationale: "" }], budget: { monthlyEur: 50, items: [], rationale: "" }, risks: [] };

const fakeLlm: LlmProvider = {
  async chat(_m: string, messages: LlmMessage[]): Promise<LlmResult> {
    const sys = messages.find((x) => x.role === "system")?.content ?? "";
    const task = /^\[task:([a-z-]+)\]/.exec(sys)?.[1];
    switch (task) {
      case "strategy": return json(plan);
      case "tasks": return json({ tasks: [{ week: 2, dayOffset: 0, title: "r/lehrerzimmer: 3 Threads beantworten", description: "", type: "community", channel: "Reddit r/lehrerzimmer", assignedTo: "human", approvalLevel: "human_only" }, { week: 2, dayOffset: 1, title: "Post zur Sonntagsfrage entwerfen", description: "", type: "content", channel: "LinkedIn", assignedTo: "agent", approvalLevel: "review" }] });
      case "score-threads": {
        const ids = [...(messages[1]?.content ?? "").matchAll(/\[(t\d+)\]/g)].map((m) => m[1]!);
        return json({ scores: ids.map((id, i) => ({ id, score: i === 0 ? 85 : i === 1 ? 62 : 20, reason: "passt", askingForTools: i === 0 })) });
      }
      case "reply-draft": return json({ reply: "Kurz: ich hatte das gleiche Problem. Was mir half: … Ich bau das Tool selbst.", rulesNote: "Regel 3: keine Links - Entwurf enthält keinen.", mentionsProduct: true });
      case "weekly-report": return json({ report: "Was lief\n3 Signups über Reddit.\n\nWas nicht\nLinkedIn 0.\n\nNächste Woche anders\nMehr Reddit-Antworten, LinkedIn pausieren.", plan: { ...plan, summary: "Plan v2: Reddit-Fokus", budget: { ...plan.budget, monthlyEur: 30 } }, nextWeekFocus: ["5 Reddit-Antworten", "LinkedIn pausieren"] });
      default: return { text: "{}", model: "fake", usage };
    }
  },
};
const fakeReddit: Fetcher = async (src) => [
  { platform: "reddit", community: `r/${src.value}`, url: "https://www.reddit.com/r/lehrerzimmer/comments/a1/", title: "Welches Tool für Arbeitsblätter?", excerpt: "Ich verbringe jeden Sonntag …", externalId: "reddit:a1", createdAt: "2026-08-25T10:00:00.000Z" },
  { platform: "reddit", community: `r/${src.value}`, url: "https://www.reddit.com/r/lehrerzimmer/comments/a2/", title: "Klausur-Korrektur Tipps", excerpt: "…", externalId: "reddit:a2", createdAt: "2026-08-25T11:00:00.000Z" },
  { platform: "reddit", community: `r/${src.value}`, url: "https://www.reddit.com/r/lehrerzimmer/comments/a3/", title: "Meme Montag", excerpt: "…", externalId: "reddit:a3", createdAt: "2026-08-25T12:00:00.000Z" },
];

const DATA = path.resolve("data/test-loop");
let built: Awaited<ReturnType<typeof buildApp>>;
const auth = { authorization: "Bearer test-token" };
let pid = "";

beforeAll(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA, MP_EVENTS_TOKEN: "evt-secret", MP_PUBLIC_BASE: "https://mp.test" }), { host: fakeHost(), dbFile: ":memory:", logger: false, services: { llm: fakeLlm, image: null } });
  pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Beispielwerk", url: "https://beispielwerk.test" } })).json().id;
  await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}`, headers: auth, payload: { brief } });
  await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/brief/confirm`, headers: auth });
  built.db.run(`INSERT INTO mp_personas (id, project_id, name, description, pain_points, language, phrases, objections, buying_triggers, where_they_hang_out, evidence, created_at) VALUES ('p1','${pid}','Grundschullehrerin','Wenig Zeit.','["Sonntagabend Vorbereitung"]','de','["ich sitze jeden Sonntag"]','[]','[]','["r/lehrerzimmer","https://forum.example/feed.rss","Hacker News"]','[]','2026-08-26T00:00:00.000Z')` as never);
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("pure helpers", () => {
  it("derives sources from persona hangouts and channels", () => {
    const src = deriveSources([persona], [{ id: "c", projectId: "x", platform: "Reddit (r/ecommerce, r/marketing)", rationale: "", cadence: "", priority: 1, status: "candidate", meta: { format: "", reach: "", costEstimate: "", effort: "", evidenceRefs: [] }, createdAt: "2026-08-26T00:00:00.000Z" }]);
    expect(src.map((x) => `${x.type}:${x.value}`)).toEqual(["reddit:lehrerzimmer", "rss:https://forum.example/feed.rss", "hn:", "reddit:ecommerce", "reddit:marketing"]);
  });
  it("parses RSS and Atom", () => {
    const rss = parseFeed(`<rss><channel><item><title>Frage &amp; Antwort</title><link>https://f.test/1</link><description><![CDATA[<p>Hallo <b>Welt</b></p>]]></description><pubDate>Mon, 25 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>`, "https://f.test/feed");
    expect(rss).toEqual([{ platform: "forum", community: "f.test", url: "https://f.test/1", title: "Frage & Antwort", excerpt: "Hallo Welt", externalId: "rss:https://f.test/1", createdAt: "Mon, 25 Aug 2026 10:00:00 GMT" }]);
    const atom = parseFeed(`<feed><entry><title>A</title><link href="https://a.test/x"/><summary>S</summary><updated>2026-08-25T10:00:00Z</updated></entry></feed>`, "https://a.test/atom");
    expect(atom[0]).toMatchObject({ url: "https://a.test/x", excerpt: "S" });
  });
  it("week start is Monday, snippet is small and carries the webhook", () => {
    expect(weekStartOf("2026-08-26T12:00:00.000Z")).toBe("2026-08-24");
    expect(weekStartOf("2026-08-24T00:00:00.000Z")).toBe("2026-08-24");
    const sn = landingSnippet("https://mp.test/api/mp/events", "pid");
    expect(sn.length).toBeLessThan(1600);
    expect(sn).toContain("mpTrack"); expect(sn).toContain("https://mp.test/api/mp/events");
  });
  it("prompt snapshots", () => {
    expect(scoreThreadsPrompt({ brief, personas: [persona], threads: [{ id: "t0", platform: "reddit", url: "u", title: "T", excerpt: "E", community: "r/x" }] })).toMatchSnapshot();
    expect(replyDraftPrompt({ brief, persona, thread: { id: "t0", platform: "reddit", url: "u", title: "T", excerpt: "E", community: "r/x" }, rules: "1. No links", linksAllowed: false, voiceProfile: null, productUrl: "https://b.test" })[0]?.content).toContain("Ich bau das Tool selbst");
    expect(weeklyReportPrompt({ brief, plan, facts: { weekStart: "2026-08-24", signups: 3, activated: 1, paid: 0, signupsPrevWeek: 1, byChannel: [{ source: "reddit", signups: 3 }], published: [], tasksDone: 4, tasksOpen: 2, tasksSkipped: 0, leadsAnswered: 2, geoVisibility: 0, geoVisibilityPrev: null, goals: [] }, voiceProfile: null })).toMatchSnapshot();
  });
});

describe("community radar", () => {
  it("scans sources, scores threads, drafts replies for >= 60, never posts", async () => {
    const ctx = { ...built.ctx!, fetchers: { reddit: fakeReddit, rss: async () => [], hn: async () => [] }, rulesFetcher: async () => ({ text: "1. Keine Werbung\n2. Keine Links", linksAllowed: false }) };
    const r = await scanCommunity(ctx, pid);
    expect(r).toMatchObject({ scanned: 3, scored: 3, leads: 2 });
    const res = await built.app.inject({ url: `/api/mp/projects/${pid}/community`, headers: auth });
    if (res.statusCode !== 200) console.log("COMMUNITY", res.statusCode, res.body.slice(0, 800));
    const view = res.json();
    expect(view.sources.map((x: { value: string }) => x.value)).toEqual(["lehrerzimmer", "https://forum.example/feed.rss", ""]);
    expect(view.leads).toHaveLength(2);
    expect(view.leads[0]).toMatchObject({ score: 85, status: "drafted", platform: "reddit" });
    expect(view.leads[0].meta).toMatchObject({ askingForTools: true, linksAllowed: false, community: "r/lehrerzimmer" });
    expect(view.leads[0].draftReply).toContain("Ich bau das Tool selbst");
    // second scan: same threads are known -> nothing new
    expect((await scanCommunity(ctx, pid)).leads).toBe(0);
    const lead = view.leads[0];
    const edited = (await built.app.inject({ method: "PATCH", url: `/api/mp/community/${lead.id}`, headers: auth, payload: { draftReply: "Meine eigene Antwort.", status: "answered", externalUrl: "https://www.reddit.com/r/lehrerzimmer/comments/a1/c1" } })).json();
    expect(edited).toMatchObject({ status: "answered", draftReply: "Meine eigene Antwort." });
    expect(edited.meta.answeredUrl).toBe("https://www.reddit.com/r/lehrerzimmer/comments/a1/c1");
    const routes = built.app.printRoutes();
    expect(routes).not.toMatch(/community\/[^\n]*post/i);
  });
  it("sources can be edited and a scan job is queued for the worker", async () => {
    const put = await built.app.inject({ method: "PUT", url: `/api/mp/projects/${pid}/community/sources`, headers: auth, payload: [{ type: "reddit", value: "Teachers", label: "", enabled: true }] });
    expect(put.statusCode).toBe(200);
    expect((await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/community/scan`, headers: auth })).statusCode).toBe(400);   // no worker heartbeat
  });
});

describe("events + insights + weekly loop", () => {
  it("accepts server events with token and browser signups without, then aggregates", async () => {
    const send = (payload: Record<string, unknown>, token?: string) => built.app.inject({ method: "POST", url: "/api/mp/events", headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
    expect((await send({ project: pid, event: "paid" })).statusCode).toBe(401);
    expect((await send({ project: pid, event: "paid" }, "wrong")).statusCode).toBe(401);
    expect((await send({ project: "nope", event: "signup" })).statusCode).toBe(404);
    for (let i = 0; i < 3; i++) expect((await send({ project: pid, event: "signup", userRef: `u${i}`, utm: { source: "reddit", medium: "social", campaign: "start", content: "piece-1" }, occurredAt: "2026-08-25T10:00:00.000Z" })).statusCode).toBe(201);
    expect((await send({ project: pid, event: "signup", utm: { source: "linkedin" }, occurredAt: "2026-08-18T10:00:00.000Z" })).statusCode).toBe(201);
    expect((await send({ project: pid, event: "activated", userRef: "u0", utm: { source: "reddit" }, occurredAt: "2026-08-26T10:00:00.000Z" }, "evt-secret")).statusCode).toBe(201);
    const view = (await built.app.inject({ url: `/api/mp/projects/${pid}/insights`, headers: auth })).json();
    expect(view.totalEvents).toBe(5);
    expect(view.weeks).toEqual([{ weekStart: "2026-08-17", signups: 1, activated: 0, paid: 0 }, { weekStart: "2026-08-24", signups: 3, activated: 1, paid: 0 }]);
    expect(view.byChannel[0]).toEqual({ source: "reddit", signups: 3, activated: 1, paid: 0 });
    expect(view.webhookConfigured).toBe(true);
    const sn = (await built.app.inject({ url: `/api/mp/projects/${pid}/insights/snippet`, headers: auth })).json();
    expect(sn.webhookUrl).toBe("https://mp.test/api/mp/events");
    const overview = (await built.app.inject({ url: "/api/mp/overview", headers: auth })).json();
    expect(overview[0].signups7d).toBeGreaterThanOrEqual(0);
  });

  it("weekly report proposes a plan version; adopting creates the version and next week's tasks", async () => {
    // plan v1 first (strategy agent)
    await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/strategy/run`, headers: auth, payload: {} });
    for (let i = 0; i < 100; i++) { const v = (await built.app.inject({ url: `/api/mp/projects/${pid}/strategy`, headers: auth })).json(); if (!v.running) break; await new Promise((r) => setTimeout(r, 30)); }
    const rep = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/reports/run`, headers: auth, payload: { weekStart: "2026-08-24" } });
    expect(rep.statusCode).toBe(201);
    const report = rep.json();
    expect(report.status).toBe("proposed");
    expect(report.report).toContain("Was lief");
    expect(report.diff.map((d: { path: string }) => d.path)).toEqual(["summary", "budget.monthlyEur"]);
    const overview = (await built.app.inject({ url: "/api/mp/overview", headers: auth })).json();
    expect(overview[0].latestReport).toMatchObject({ id: report.id, status: "proposed" });

    const adopted = (await built.app.inject({ method: "POST", url: `/api/mp/reports/${report.id}/adopt`, headers: auth })).json();
    expect(adopted).toMatchObject({ version: 2, tasks: 2 });
    expect(adopted.report.status).toBe("adopted");
    const strategy = (await built.app.inject({ url: `/api/mp/projects/${pid}/strategy`, headers: auth })).json();
    expect(strategy.current).toMatchObject({ version: 2, createdBy: "weekly-loop" });
    expect(strategy.current.plan.budget.monthlyEur).toBe(30);
    const tasks = (await built.app.inject({ url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json().filter((t: { planVersion: number }) => t.planVersion === 2);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t: { title: string }) => t.title.startsWith("r/lehrerzimmer"))).toMatchObject({ week: 2, approvalLevel: "human_only", assignedTo: "human" });
    expect((await built.app.inject({ method: "POST", url: `/api/mp/reports/${report.id}/adopt`, headers: auth })).statusCode).toBe(409);
  });

  it("scheduler enqueues daily radar, weekly geo and the Sunday report once", () => {
    const sunday = new Date("2026-08-30T19:00:00.000Z");
    const due = dueJobs(built.db, sunday);
    expect(due.map((d) => d.kind).sort()).toEqual(["community.scan", "geo.measure", "weekly.report"]);
    const first = enqueueDue(built.db, sunday);
    expect(first).toHaveLength(3);
    expect(enqueueDue(built.db, sunday)).toHaveLength(0);
    expect(dueJobs(built.db, new Date("2026-08-31T19:00:00.000Z"))).toHaveLength(0);
    expect(dueJobs(built.db, new Date("2026-09-01T19:00:00.000Z")).map((d) => d.kind)).toEqual(["community.scan"]);
  });
});
