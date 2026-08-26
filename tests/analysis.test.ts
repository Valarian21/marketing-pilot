/** End-to-end pipeline with fake LLM/search/crawler: no network, no browser. */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { LlmMessage, LlmProvider, LlmResult, SearchProvider } from "../src/server/providers/index.js";
import type { Crawler } from "../src/server/agents/analysis/crawl.js";
import { fakeHost } from "./helpers.js";

const usage = { tokensIn: 100, tokensOut: 50, costUsd: 0.002 };
const json = (o: unknown): LlmResult => ({ text: JSON.stringify(o), model: "fake", usage });

/** Answers by the [task:…] marker of the system prompt; engine calls (no system prompt) get plain text. */
const fakeLlm: LlmProvider = {
  async chat(model: string, messages: LlmMessage[]): Promise<LlmResult> {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const task = /^\[task:([a-z-]+)\]/.exec(sys)?.[1];
    switch (task) {
      case "brief": return json({ productName: "Beispielwerk", oneLiner: "Arbeitsblätter in Minuten.", category: "worksheet generator", language: "de", features: ["Generator"], pricing: [{ plan: "Free", price: "0 €", notes: "" }], usp: ["Lehrplan"], tone: "Du", targetAudience: "Lehrkräfte", keywords: ["arbeitsblatt"], sources: ["https://example.test/"] });
      case "competitor-candidates": return json({ competitors: [{ name: "RivalTool", url: "https://rival.test", why: "gleiche Zielgruppe" }, { name: "Self", url: "https://example.test/x", why: "should be filtered (own host)" }] });
      case "competitor-detail": return json({ positioning: "Alles für alle.", pricing: "9 €", complaints: [{ text: "Zu teuer", quote: "viel zu teuer", source: "Reddit", url: "https://reddit.test/x" }] });
      case "personas": return json({ personas: [{ name: "Grundschullehrerin", description: "Wenig Zeit.", language: "de", phrases: ["sonntags"], painPoints: ["Vorbereitung"], objections: ["Datenschutz"], buyingTriggers: ["Schuljahresbeginn"], whereTheyHangOut: ["r/lehrerzimmer"], evidence: [{ claim: "x", quote: "y", url: "https://reddit.test/x" }] }] });
      case "attention-map": return json({ channels: [{ platform: "Reddit r/lehrerzimmer", rank: 2, format: "Antworten", cadence: "3/Woche", reach: "hoch", costEstimate: "0 €", effort: "2 h", rationale: "Grundschullehrerin ist dort.", evidenceRefs: ["Grundschullehrerin"] }, { platform: "Directories", rank: 1, format: "Eintrag", cadence: "einmalig", reach: "mittel", costEstimate: "0 €", effort: "4 h", rationale: "RivalTool zu teuer.", evidenceRefs: ["RivalTool"] }] });
      case "geo-questions": return json({ questions: Array.from({ length: 6 }, (_, i) => ({ question: `Frage ${i + 1}?`, persona: "Grundschullehrerin", intent: "discover" })) });
      case "geo-judge": {
        const engines = [...(messages[1]?.content ?? "").matchAll(/=== ENGINE (\S+)/g)].map((m) => m[1]);
        return json({ results: engines.map((e) => ({ engine: e, mentioned: e === "engine-a", position: e === "engine-a" ? 1 : null, competitorsMentioned: ["RivalTool"] })) });
      }
      default:
        if (model === "engine-fail") throw new Error("engine down");
        return { text: `${model} says: RivalTool and Beispielwerk`, model, usage };
    }
  },
};
const fakeSearch: SearchProvider = { async search(q) { return [{ title: `hit for ${q}`, url: "https://rival.test/page", snippet: "s" }, { title: "own", url: "https://example.test/own", snippet: "" }]; } };
const fakeCrawler: Crawler = async (url, opts) => {
  fs.mkdirSync(opts.screenshotDir, { recursive: true });
  const file = path.join(opts.screenshotDir, "01-home.png");
  fs.writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
  return { pages: [{ url, title: "Start", kind: "home", status: 200, text: "Willkommen bei Beispielwerk. Arbeitsblätter in Minuten." }, { url: url + "/preise", title: "Preise", kind: "pricing", status: 200, text: "Free 0 €" }], screenshots: [{ url, kind: "home", file }], warnings: [] };
};

const DATA = path.resolve("data/test-analysis");
let built: Awaited<ReturnType<typeof buildApp>>;
const auth = { authorization: "Bearer test-token" };

beforeAll(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  const env = loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA });
  built = await buildApp(env, { host: fakeHost(), dbFile: ":memory:", logger: false, services: { llm: fakeLlm, search: fakeSearch, crawler: fakeCrawler, geoEngines: ["engine-a", "engine-b", "engine-fail"], geoCount: 6 } });
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("analysis pipeline", () => {
  it("runs all steps, persists results and exposes the view", async () => {
    const created = await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Beispielwerk", url: "https://example.test" } });
    const pid = created.json().id as string;

    const started = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/analysis/run`, headers: auth, payload: {} });
    expect(started.statusCode).toBe(202);
    const dup = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/analysis/run`, headers: auth, payload: {} });
    expect(dup.statusCode).toBe(409);

    // wait for the detached run
    for (let i = 0; i < 100; i++) {
      const v = (await built.app.inject({ url: `/api/mp/projects/${pid}/analysis`, headers: auth })).json();
      if (v.run.status !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const view = (await built.app.inject({ url: `/api/mp/projects/${pid}/analysis`, headers: auth })).json();
    expect(view.run.status, JSON.stringify(view.run.steps)).toBe("done");
    expect(view.run.steps.map((s: { name: string; status: string }) => [s.name, s.status])).toEqual([
      ["crawl", "done"], ["brief", "done"], ["competitors", "done"], ["personas", "done"], ["attention", "done"], ["geo", "done"],
    ]);
    expect(view.pages).toHaveLength(2);
    expect(view.screenshots).toHaveLength(1);
    expect(view.brief.productName).toBe("Beispielwerk");
    expect(view.briefMarkdown).toContain("# Beispielwerk");
    expect(view.competitors.map((c: { name: string }) => c.name)).toEqual(["RivalTool"]);
    expect(view.personas[0].whereTheyHangOut).toEqual(["r/lehrerzimmer"]);
    expect(view.channels.map((c: { platform: string; priority: number }) => [c.priority, c.platform])).toEqual([[1, "Directories"], [2, "Reddit r/lehrerzimmer"]]);
    // 6 questions × 2 working engines (engine-fail is skipped, not counted)
    expect(view.geo.snapshots).toHaveLength(12);
    expect(view.geo.visibility).toBeCloseTo(0.5);
    expect(view.geo.perModel).toEqual([{ model: "engine-a", asked: 6, mentioned: 6 }, { model: "engine-b", asked: 6, mentioned: 0 }]);

    const runs = (await built.app.inject({ url: `/api/mp/runs?projectId=${pid}`, headers: auth })).json();
    expect(runs.map((r: { task: string; status: string }) => r.task).sort()).toEqual(["analysis.attention", "analysis.brief", "analysis.competitors", "analysis.crawl", "analysis.geo", "analysis.personas"]);
    expect(runs.every((r: { status: string }) => r.status === "done")).toBe(true);
    expect(runs.find((r: { task: string }) => r.task === "analysis.geo").costUsd).toBeGreaterThan(0);

    const file = await built.app.inject({ url: `/api/mp/assets/${view.screenshots[0].id}/file`, headers: auth });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
  });

  it("brief edits are flagged as user corrections and confirmation unlocks strategy", async () => {
    const pid = ((await built.app.inject({ url: "/api/mp/projects", headers: auth })).json()[0] as { id: string }).id;
    const patched = (await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}/brief`, headers: auth, payload: { oneLiner: "Besser formuliert.", features: ["Generator", "PDF"] } })).json();
    expect(patched.brief.oneLiner).toBe("Besser formuliert.");
    expect(patched.briefMeta.userEdited).toBe(true);
    expect(patched.briefMeta.editedFields.sort()).toEqual(["features", "oneLiner"]);
    expect(patched.briefMarkdown).toContain("Besser formuliert.");

    const confirmed = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/brief/confirm`, headers: auth })).json();
    expect(confirmed.briefMeta.confirmedAt).toBeTruthy();
    const project = (await built.app.inject({ url: `/api/mp/projects/${pid}`, headers: auth })).json();
    expect(project.status).toBe("active");

    const audit = (await built.app.inject({ url: `/api/mp/audit?projectId=${pid}`, headers: auth })).json().map((a: { action: string }) => a.action);
    expect(audit.slice(0, 2)).toEqual(["brief.confirm", "brief.edit"]);
  });

  it("re-running from a later step keeps earlier results", async () => {
    const pid = ((await built.app.inject({ url: "/api/mp/projects", headers: auth })).json()[0] as { id: string }).id;
    const started = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/analysis/run`, headers: auth, payload: { from: "geo" } });
    expect(started.statusCode).toBe(202);
    expect(started.json().steps.slice(0, 5).every((s: { status: string }) => s.status === "skipped")).toBe(true);
    for (let i = 0; i < 100; i++) {
      const v = (await built.app.inject({ url: `/api/mp/projects/${pid}/analysis`, headers: auth })).json();
      if (v.run.status !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const view = (await built.app.inject({ url: `/api/mp/projects/${pid}/analysis`, headers: auth })).json();
    expect(view.run.status).toBe("done");
    expect(view.brief.oneLiner).toBe("Besser formuliert.");   // untouched by the geo-only run
    expect(view.geo.batch).toBe(view.run.id);
  });
});
