/**
 * Analysis pipeline orchestration. One mp_analysis_runs row per run, one
 * mp_agent_runs row per step. Runs detached from the HTTP request; the UI polls.
 */
import { desc, eq } from "drizzle-orm";
import type { AnalysisRun, AnalysisStep, AnalysisStepName, Brief } from "../../../shared/schemas.js";
import { AnalysisStepName as StepNameSchema, Brief as BriefSchema } from "../../../shared/schemas.js";
import { mpAnalysisRuns, mpProjects } from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { withRun, type AgentContext } from "../runner.js";
import { runCrawlStep, type Crawler } from "./crawl.js";
import { runBriefStep } from "./brief.js";
import { listCompetitors, runCompetitorsStep } from "./competitors.js";
import { listPersonas, runPersonasStep } from "./personas.js";
import { runAttentionStep } from "./attention.js";
import { runGeoStep } from "./geo.js";

export const STEP_ORDER: AnalysisStepName[] = StepNameSchema.options;
export const STEP_LABELS: Record<AnalysisStepName, string> = {
  crawl: "Website crawlen", brief: "Product Brief", competitors: "Wettbewerber", personas: "Personas", attention: "Attention Map", geo: "GEO-Baseline",
};

export type PipelineContext = AgentContext & { crawler?: Crawler; geoEngines?: readonly string[]; geoCount?: number };

const active = new Map<string, Promise<void>>();

function toRun(r: typeof mpAnalysisRuns.$inferSelect): AnalysisRun {
  return { ...r, status: r.status as AnalysisRun["status"], steps: parseJson<AnalysisStep[]>(r.steps, []) };
}

export function latestRun(db: Db, projectId: string): AnalysisRun | null {
  const r = db.select().from(mpAnalysisRuns).where(eq(mpAnalysisRuns.projectId, projectId)).orderBy(desc(mpAnalysisRuns.startedAt)).limit(1).get();
  return r ? toRun(r) : null;
}

export function isRunning(projectId: string): boolean { return active.has(projectId); }

/** Runs left in "running" after a process restart can never finish - mark them. */
export function markStaleRuns(db: Db): number {
  const stale = db.select().from(mpAnalysisRuns).where(eq(mpAnalysisRuns.status, "running")).all();
  for (const r of stale) {
    const steps = parseJson<AnalysisStep[]>(r.steps, []).map((s) => (s.status === "running" || s.status === "pending" ? { ...s, status: "failed" as const, error: s.status === "running" ? "Abgebrochen durch Neustart" : "Nicht ausgeführt" } : s));
    db.update(mpAnalysisRuns).set({ status: "failed", error: "Abgebrochen durch Neustart des Dienstes", finishedAt: nowIso(), steps: toJson(steps) }).where(eq(mpAnalysisRuns.id, r.id)).run();
  }
  return stale.length;
}

export function startAnalysis(ctx: PipelineContext, projectId: string, opts: { from?: AnalysisStepName; sync?: boolean } = {}): { run: AnalysisRun; done: Promise<void> } {
  if (active.has(projectId)) throw Object.assign(new Error("Für dieses Projekt läuft bereits eine Analyse."), { statusCode: 409 });
  const fromIdx = opts.from ? STEP_ORDER.indexOf(opts.from) : 0;
  const steps: AnalysisStep[] = STEP_ORDER.map((name, i) => ({
    name, status: i < fromIdx ? "skipped" : "pending", startedAt: null, finishedAt: null, error: null, summary: i < fromIdx ? "Übersprungen (Ergebnis bleibt)" : "", runId: null,
  }));
  const row = { id: newId(), projectId, status: "running", steps: toJson(steps), startedAt: nowIso(), finishedAt: null, error: null };
  ctx.db.insert(mpAnalysisRuns).values(row).run();
  const done = execute(ctx, row.id, projectId, steps).finally(() => active.delete(projectId));
  active.set(projectId, done);
  if (!opts.sync) done.catch((e) => ctx.log(`analysis ${row.id} crashed: ${e instanceof Error ? e.message : String(e)}`));
  return { run: toRun({ ...row }), done };
}

async function execute(ctx: PipelineContext, runId: string, projectId: string, steps: AnalysisStep[]): Promise<void> {
  const save = () => ctx.db.update(mpAnalysisRuns).set({ steps: toJson(steps) }).where(eq(mpAnalysisRuns.id, runId)).run();
  const project = ctx.db.select().from(mpProjects).where(eq(mpProjects.id, projectId)).get();
  if (!project) throw new Error("Projekt nicht gefunden");
  const loadBrief = (): Brief => {
    const p = ctx.db.select({ brief: mpProjects.brief }).from(mpProjects).where(eq(mpProjects.id, projectId)).get();
    const parsed = BriefSchema.safeParse(parseJson(p?.brief ?? "{}", {}));
    if (!parsed.success) throw new Error("Kein gültiger Brief vorhanden - Schritt „Product Brief“ zuerst ausführen.");
    return parsed.data;
  };

  let failed: string | null = null;
  for (const step of steps) {
    if (step.status === "skipped") continue;
    if (failed) { step.status = "skipped"; step.summary = "Nicht ausgeführt (vorheriger Schritt fehlgeschlagen)"; continue; }
    step.status = "running"; step.startedAt = nowIso(); save();
    ctx.log(`analysis ${runId}: ${step.name}`);
    const model = step.name === "crawl" ? null : step.name === "geo" ? modelFor("critic") : step.name === "attention" ? modelFor("strategy") : modelFor("analysis");
    try {
      const { result, runId: agentRunId } = await withRun(ctx.db, { task: `analysis.${step.name}`, model, projectId }, async (usage) => {
        switch (step.name) {
          case "crawl": return runCrawlStep(ctx, project);
          case "brief": return runBriefStep(ctx, project, usage);
          case "competitors": return runCompetitorsStep(ctx, project, loadBrief(), usage);
          case "personas": return runPersonasStep(ctx, project, loadBrief(), listCompetitors(ctx, projectId), usage);
          case "attention": return runAttentionStep(ctx, project, loadBrief(), listPersonas(ctx, projectId), listCompetitors(ctx, projectId), usage);
          case "geo": return runGeoStep(ctx, project, loadBrief(), listPersonas(ctx, projectId), listCompetitors(ctx, projectId), usage,
            { batch: runId, ...(ctx.geoCount ? { count: ctx.geoCount } : {}), ...(ctx.geoEngines ? { engines: ctx.geoEngines } : {}) });
        }
      });
      step.status = "done"; step.summary = result; step.runId = agentRunId;
    } catch (e) {
      step.status = "failed"; step.error = e instanceof Error ? e.message : String(e); failed = `${STEP_LABELS[step.name]}: ${step.error}`;
      ctx.log(`analysis ${runId}: ${step.name} FAILED ${step.error}`);
    }
    step.finishedAt = nowIso(); save();
  }
  ctx.db.update(mpAnalysisRuns).set({ status: failed ? "failed" : "done", error: failed, finishedAt: nowIso(), steps: toJson(steps) }).where(eq(mpAnalysisRuns.id, runId)).run();
}
