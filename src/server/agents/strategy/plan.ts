/** Strategy agent: versioned channel plan + diff, and task generation for the first weeks. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, withRun, type AgentContext, type UsageCollector } from "../runner.js";
import { strategyPrompt, tasksPrompt, type GeoSummary } from "../prompts/strategy.js";
import { getProject } from "../../repo/projects.js";
import { listPersonas } from "../analysis/personas.js";
import { listChannels } from "../analysis/attention.js";
import { listCompetitors } from "../analysis/competitors.js";
import { writeAudit } from "../../audit.js";
import type { HostUser } from "../../../host-adapter.js";

export const HUMAN_ONLY = /reddit|forum|foren|discord|\bads?\b|anzeige|werbung|budget|ausgeben|posten|veröffentlich|einreichen|submit|publish/i;

type PlanRow = typeof t.mpStrategyPlans.$inferSelect;
const toVersion = (r: PlanRow): s.StrategyVersion => ({ ...r, plan: s.StrategyPlan.parse(parseJson(r.plan, {})), diff: parseJson<s.PlanDiffEntry[]>(r.diff, []) });

export function listVersions(db: Db, projectId: string): s.StrategyVersion[] {
  return db.select().from(t.mpStrategyPlans).where(eq(t.mpStrategyPlans.projectId, projectId)).orderBy(desc(t.mpStrategyPlans.version)).all().map(toVersion);
}
export function currentVersion(db: Db, projectId: string): s.StrategyVersion | null {
  const r = db.select().from(t.mpStrategyPlans).where(eq(t.mpStrategyPlans.projectId, projectId)).orderBy(desc(t.mpStrategyPlans.version)).limit(1).get();
  return r ? toVersion(r) : null;
}

/** Shallow-but-useful diff: top-level scalars, channels by platform, goals by horizon, budget items by name. */
export function planDiff(before: s.StrategyPlan | null, after: s.StrategyPlan): s.PlanDiffEntry[] {
  if (!before) return [{ path: "plan", before: null, after: "erste Version" }];
  const out: s.PlanDiffEntry[] = [];
  const cmp = (path: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, before: a, after: b }); };
  cmp("summary", before.summary, after.summary);
  cmp("startDate", before.startDate, after.startDate);
  cmp("coreMessage", before.coreMessage.text, after.coreMessage.text);
  const keyed = <T>(xs: T[], key: (x: T) => string) => new Map(xs.map((x) => [key(x), x]));
  const bc = keyed(before.channels, (c) => c.platform), ac = keyed(after.channels, (c) => c.platform);
  for (const k of new Set([...bc.keys(), ...ac.keys()])) cmp(`channels.${k}`, bc.get(k) ?? null, ac.get(k) ?? null);
  const bg = keyed(before.goals, (g) => String(g.horizonDays)), ag = keyed(after.goals, (g) => String(g.horizonDays));
  for (const k of new Set([...bg.keys(), ...ag.keys()])) cmp(`goals.${k}d`, bg.get(k) ?? null, ag.get(k) ?? null);
  cmp("budget.monthlyEur", before.budget.monthlyEur, after.budget.monthlyEur);
  const bb = keyed(before.budget.items, (i) => i.item), ab = keyed(after.budget.items, (i) => i.item);
  for (const k of new Set([...bb.keys(), ...ab.keys()])) cmp(`budget.${k}`, bb.get(k)?.eur ?? null, ab.get(k)?.eur ?? null);
  cmp("risks", before.risks.map((r) => r.text), after.risks.map((r) => r.text));
  return out;
}

export function geoSummary(db: Db, projectId: string): GeoSummary {
  const latest = db.select({ batch: t.mpGeoSnapshots.batch }).from(t.mpGeoSnapshots).where(eq(t.mpGeoSnapshots.projectId, projectId)).orderBy(desc(t.mpGeoSnapshots.takenAt)).limit(1).get();
  if (!latest) return { visibility: null, perModel: [], topCompetitors: [] };
  const rows = db.select().from(t.mpGeoSnapshots).where(and(eq(t.mpGeoSnapshots.projectId, projectId), eq(t.mpGeoSnapshots.batch, latest.batch))).all();
  const models = [...new Set(rows.map((r) => r.engine))];
  const counts = new Map<string, number>();
  for (const r of rows) for (const c of parseJson<string[]>(r.competitorsMentioned, [])) counts.set(c, (counts.get(c) ?? 0) + 1);
  return {
    visibility: rows.length ? rows.filter((r) => r.mentioned).length / rows.length : null,
    perModel: models.map((m) => ({ model: m, asked: rows.filter((r) => r.engine === m).length, mentioned: rows.filter((r) => r.engine === m && r.mentioned).length })),
    topCompetitors: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n),
  };
}

export function isoDate(d = new Date()): string { return d.toISOString().slice(0, 10); }
export function dueAtFor(startDate: string, week: number, dayOffset: number): string {
  const d = new Date(`${startDate}T09:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + (week - 1) * 7 + dayOffset);
  return d.toISOString();
}

const TasksOut = z.object({
  tasks: z.array(z.object({
    week: z.number().int().min(1), dayOffset: z.number().int().min(0).max(6).default(0),
    title: z.string().min(1), description: z.string().default(""), type: s.TaskType, channel: z.string().default(""),
    assignedTo: s.Assignee.default("human"), approvalLevel: s.ApprovalLevel.default("review"),
  })).min(1),
});

/** Enforce the non-negotiable approval rules regardless of what the model returned. */
export function enforceApproval<T extends { title: string; channel: string; type: string; assignedTo: "agent" | "human"; approvalLevel: "auto" | "review" | "human_only" }>(task: T): T {
  const out = { ...task };
  const outside = task.type === "publish" || task.type === "ads";
  if (outside) out.assignedTo = "human";
  if (HUMAN_ONLY.test(`${task.channel} ${task.title}`) && (outside || task.type === "community" || /ads/.test(task.type))) out.approvalLevel = "human_only";
  if (/reddit|forum|foren|discord/i.test(task.channel) && (task.type === "publish" || task.type === "community") && task.assignedTo === "human") out.approvalLevel = "human_only";
  if (task.type === "ads") out.approvalLevel = "human_only";
  return out;
}

export async function generateTasks(ctx: AgentContext, projectId: string, version: s.StrategyVersion, usage: UsageCollector, weeks = 4): Promise<number> {
  const project = getProject(ctx.db, projectId);
  const brief = s.Brief.parse(project?.brief);
  const personas = listPersonas(ctx, projectId);
  const out = await chatJson(ctx.llm, modelFor("strategy"), TasksOut, tasksPrompt({ brief, plan: version.plan, personas, weeks }), usage, { maxTokens: 6000 });
  // Untouched tasks are replaced; anything the human started or finished stays.
  ctx.db.delete(t.mpTasks).where(and(eq(t.mpTasks.projectId, projectId), eq(t.mpTasks.status, "todo"))).run();
  const ts = nowIso();
  const perWeek = new Map<number, number>();
  const tasks = out.tasks.filter((x) => x.week <= weeks).sort((a, b) => a.week - b.week || a.dayOffset - b.dayOffset).map(enforceApproval);
  for (const x of tasks) {
    const order = (perWeek.get(x.week) ?? 0) + 1; perWeek.set(x.week, order);
    ctx.db.insert(t.mpTasks).values({
      id: newId(), projectId, title: x.title, description: x.description, type: x.type, status: "todo",
      dueAt: dueAtFor(version.plan.startDate, x.week, x.dayOffset), assignedTo: x.assignedTo, approvalLevel: x.approvalLevel,
      outputRefs: "[]", order, channel: x.channel, week: x.week, planVersion: version.version, createdAt: ts, updatedAt: ts,
    }).run();
  }
  return tasks.length;
}

const jobs = new Map<string, { running: boolean; error: string | null }>();
export function strategyJob(projectId: string): { running: boolean; error: string | null } { return jobs.get(projectId) ?? { running: false, error: null }; }

export function startStrategy(ctx: AgentContext, projectId: string, opts: { note: string; user: HostUser; tasksOnly?: boolean }): Promise<void> {
  if (jobs.get(projectId)?.running) throw Object.assign(new Error("Für dieses Projekt läuft bereits ein Strategie-Lauf."), { statusCode: 409 });
  jobs.set(projectId, { running: true, error: null });
  const run = (async () => {
    const project = getProject(ctx.db, projectId);
    if (!project) throw new Error("Projekt nicht gefunden");
    const brief = s.Brief.parse(project.brief);
    let version = currentVersion(ctx.db, projectId);
    if (!opts.tasksOnly) {
      const prev = version;
      const { result: plan } = await withRun(ctx.db, { task: "strategy.plan", model: modelFor("strategy"), projectId }, (usage) =>
        chatJson(ctx.llm, modelFor("strategy"), s.StrategyPlan, strategyPrompt({
          brief, personas: listPersonas(ctx, projectId), channels: listChannels(ctx, projectId), competitors: listCompetitors(ctx, projectId),
          geo: geoSummary(ctx.db, projectId), startDate: prev?.plan.startDate ?? isoDate(), previousPlan: prev?.plan ?? null, ...(opts.note ? { note: opts.note } : {}),
        }), usage, { maxTokens: 5000 }));
      const row = { id: newId(), projectId, version: (prev?.version ?? 0) + 1, plan: toJson(plan), diff: toJson(planDiff(prev?.plan ?? null, plan)), createdBy: "agent", note: opts.note, createdAt: nowIso() };
      ctx.db.insert(t.mpStrategyPlans).values(row).run();
      version = toVersion(row);
      writeAudit(ctx.db, { user: opts.user, action: "strategy.version", entityType: "strategy_plan", entityId: row.id, projectId, content: { version: row.version, note: opts.note } });
    }
    if (!version) throw new Error("Kein Plan vorhanden.");
    const v = version;
    const { result: n } = await withRun(ctx.db, { task: "strategy.tasks", model: modelFor("strategy"), projectId }, (usage) => generateTasks(ctx, projectId, v, usage));
    writeAudit(ctx.db, { user: opts.user, action: "tasks.generate", entityType: "task", projectId, content: { count: n, planVersion: v.version } });
  })();
  const done = run.then(() => { jobs.set(projectId, { running: false, error: null }); }, (e: unknown) => {
    jobs.set(projectId, { running: false, error: e instanceof Error ? e.message : String(e) });
    ctx.log(`strategy ${projectId} failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  return done;
}

export function taskCount(db: Db, projectId: string): number {
  return db.select({ id: t.mpTasks.id }).from(t.mpTasks).where(eq(t.mpTasks.projectId, projectId)).all().length;
}

export function deleteTodoTasksNotIn(db: Db, projectId: string, keep: string[]): void {
  if (!keep.length) return;
  db.delete(t.mpTasks).where(and(eq(t.mpTasks.projectId, projectId), eq(t.mpTasks.status, "todo"), inArray(t.mpTasks.id, keep))).run();
}
