/**
 * Weekly loop (Sunday job): plain-text report from the week's facts, a proposed
 * plan version with diff, and - once adopted by the human - the next week's tasks.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, withRun, type AgentContext } from "../runner.js";
import { nextWeekTasksPrompt, weeklyReportPrompt, type WeekFacts } from "../prompts/community.js";
import { getProject } from "../../repo/projects.js";
import { currentVersion, dueAtFor, enforceApproval, planDiff } from "../strategy/plan.js";
import { loadBrandKit } from "../studio/brandkit.js";
import { voiceBlock } from "../studio/voice.js";
import { countEvents, latestGeoVisibility, weekStartOf } from "../insights/insights.js";
import { writeAudit } from "../../audit.js";
import type { HostUser } from "../../../host-adapter.js";
import type { JobHandler } from "../../jobs.js";
import { rowToTask } from "../strategy/execute.js";

const Out = z.object({ report: z.string().min(50), plan: s.StrategyPlan, nextWeekFocus: z.array(z.string()).default([]) });
const TasksOut = z.object({ tasks: z.array(z.object({ week: z.number().int().min(1), dayOffset: z.number().int().min(0).max(6).default(0), title: z.string().min(1), description: z.string().default(""), type: s.TaskType, channel: z.string().default(""), assignedTo: s.Assignee.default("human"), approvalLevel: s.ApprovalLevel.default("review") })) });

const toReport = (r: typeof t.mpReports.$inferSelect): s.WeeklyReport => {
  const plan = s.StrategyPlan.safeParse(parseJson(r.proposedPlan, {}));
  return { ...r, proposedPlan: plan.success ? plan.data : null, diff: parseJson<s.PlanDiffEntry[]>(r.diff, []), status: r.status as s.WeeklyReport["status"] };
};
export function listReports(db: Db, projectId: string, limit = 12): s.WeeklyReport[] {
  return db.select().from(t.mpReports).where(eq(t.mpReports.projectId, projectId)).orderBy(desc(t.mpReports.createdAt)).limit(limit).all().map(toReport);
}
export function latestReport(db: Db, projectId: string): s.WeeklyReport | null { return listReports(db, projectId, 1)[0] ?? null; }

export function collectWeekFacts(db: Db, projectId: string, weekStart: string): WeekFacts {
  const start = `${weekStart}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 7 * 86_400_000).toISOString();
  const prevStart = new Date(Date.parse(start) - 7 * 86_400_000).toISOString();
  const events = db.select().from(t.mpEvents).where(eq(t.mpEvents.projectId, projectId)).all().filter((e) => e.occurredAt >= start && e.occurredAt < end);
  const byChannel = new Map<string, number>();
  for (const e of events) if (e.event === "signup") byChannel.set(e.utmSource || "(direkt)", (byChannel.get(e.utmSource || "(direkt)") ?? 0) + 1);
  const pieces = db.select().from(t.mpContentPieces).where(and(eq(t.mpContentPieces.projectId, projectId), eq(t.mpContentPieces.status, "published"))).all()
    .filter((p) => (p.publishedAt ?? "") >= start && (p.publishedAt ?? "") < end)
    .map((p) => ({ title: p.title, channel: p.channel, format: p.format, signups: events.filter((e) => e.event === "signup" && e.utmContent === p.id).length }));
  const tasks = db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, projectId)).all().filter((x) => (x.dueAt ?? "") >= start && (x.dueAt ?? "") < end);
  const leads = db.select().from(t.mpCommunityLeads).where(and(eq(t.mpCommunityLeads.projectId, projectId), eq(t.mpCommunityLeads.status, "answered"))).all().filter((l) => (parseJson<Record<string, string>>(l.meta, {})["answeredAt"] ?? "") >= start);
  const geo = latestGeoVisibility(db, projectId);
  const plan = currentVersion(db, projectId)?.plan;
  return {
    weekStart, signups: countEvents(db, projectId, "signup", start, end), activated: countEvents(db, projectId, "activated", start, end), paid: countEvents(db, projectId, "paid", start, end),
    signupsPrevWeek: countEvents(db, projectId, "signup", prevStart, start),
    byChannel: [...byChannel.entries()].map(([source, signups]) => ({ source, signups })), published: pieces,
    tasksDone: tasks.filter((x) => x.status === "done").length, tasksOpen: tasks.filter((x) => x.status === "todo" || x.status === "in_progress" || x.status === "review").length, tasksSkipped: tasks.filter((x) => x.status === "skipped").length,
    leadsAnswered: leads.length, geoVisibility: geo.current, geoVisibilityPrev: geo.previous,
    goals: plan?.goals.map((g) => ({ horizonDays: g.horizonDays, metric: g.metric, target: g.target })) ?? [],
  };
}

export async function runWeeklyReport(ctx: AgentContext, projectId: string, weekStart = weekStartOf(new Date(Date.now() - 86_400_000).toISOString())): Promise<s.WeeklyReport> {
  const project = getProject(ctx.db, projectId);
  const brief = s.Brief.safeParse(project?.brief);
  const version = currentVersion(ctx.db, projectId);
  if (!project || !brief.success || !version) throw new Error("Wochen-Report braucht Brief und Strategie-Plan.");
  const facts = collectWeekFacts(ctx.db, projectId, weekStart);
  const model = modelFor("strategy");
  const { result } = await withRun(ctx.db, { task: "weekly.report", model, projectId }, (usage) =>
    chatJson(ctx.llm, model, Out, weeklyReportPrompt({ brief: brief.data, plan: version.plan, facts, voiceProfile: voiceBlock(loadBrandKit(ctx.db, projectId)) }), usage, { maxTokens: 6000 }));
  const diff = planDiff(version.plan, result.plan);
  const row = { id: newId(), projectId, weekStart, report: result.report, proposedPlan: toJson({ ...result.plan, _focus: result.nextWeekFocus }), diff: toJson(diff), status: "proposed", createdAt: nowIso(), decidedAt: null };
  ctx.db.insert(t.mpReports).values(row).run();
  return toReport(row);
}

/** Adopt: new plan version (with the report as note) + tasks for the coming week. */
export async function adoptReport(ctx: AgentContext, reportId: string, user: HostUser): Promise<{ report: s.WeeklyReport; version: number; tasks: number }> {
  const row = ctx.db.select().from(t.mpReports).where(eq(t.mpReports.id, reportId)).get();
  if (!row) throw Object.assign(new Error("Report nicht gefunden."), { statusCode: 404 });
  if (row.status !== "proposed") throw Object.assign(new Error("Report wurde bereits entschieden."), { statusCode: 409 });
  const raw = parseJson<Record<string, unknown>>(row.proposedPlan, {});
  const focus = Array.isArray(raw["_focus"]) ? (raw["_focus"] as string[]) : [];
  delete raw["_focus"];
  const plan = s.StrategyPlan.parse(raw);
  const prev = currentVersion(ctx.db, row.projectId);
  const version = (prev?.version ?? 0) + 1;
  ctx.db.insert(t.mpStrategyPlans).values({ id: newId(), projectId: row.projectId, version, plan: toJson(plan), diff: toJson(planDiff(prev?.plan ?? null, plan)), createdBy: "weekly-loop", note: `Wochen-Report ${row.weekStart}`, createdAt: nowIso() }).run();
  // next week's tasks
  const nextWeekStart = new Date(Date.parse(`${row.weekStart}T00:00:00.000Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const weekNo = Math.max(1, Math.round((Date.parse(nextWeekStart) - Date.parse(`${plan.startDate}T00:00:00.000Z`)) / (7 * 86_400_000)) + 1);
  const project = getProject(ctx.db, row.projectId)!;
  const brief = s.Brief.parse(project.brief);
  const open = ctx.db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, row.projectId)).all().map(rowToTask).filter((x) => x.status === "todo" || x.status === "in_progress");
  const { result } = await withRun(ctx.db, { task: "weekly.tasks", model: modelFor("strategy"), projectId: row.projectId }, (usage) =>
    chatJson(ctx.llm, modelFor("strategy"), TasksOut, nextWeekTasksPrompt({ brief, plan, week: weekNo, focus, openTasks: open.map((x) => ({ title: x.title, type: x.type })) }), usage, { maxTokens: 4000 }));
  const ts = nowIso();
  let order = ctx.db.select().from(t.mpTasks).where(and(eq(t.mpTasks.projectId, row.projectId), eq(t.mpTasks.week, weekNo))).all().length;
  const tasks = result.tasks.map(enforceApproval);
  for (const x of tasks) {
    ctx.db.insert(t.mpTasks).values({ id: newId(), projectId: row.projectId, title: x.title, description: x.description, type: x.type, status: "todo", dueAt: dueAtFor(plan.startDate, weekNo, x.dayOffset), assignedTo: x.assignedTo, approvalLevel: x.approvalLevel, outputRefs: "[]", order: ++order, channel: x.channel, week: weekNo, planVersion: version, createdAt: ts, updatedAt: ts }).run();
  }
  ctx.db.update(t.mpReports).set({ status: "adopted", decidedAt: ts }).where(eq(t.mpReports.id, reportId)).run();
  writeAudit(ctx.db, { user, action: "report.adopt", entityType: "report", entityId: reportId, projectId: row.projectId, content: { version, tasks: tasks.length, week: weekNo } });
  return { report: toReport({ ...row, status: "adopted", decidedAt: ts }), version, tasks: tasks.length };
}

export function dismissReport(db: Db, reportId: string, user: HostUser): s.WeeklyReport | null {
  const row = db.select().from(t.mpReports).where(eq(t.mpReports.id, reportId)).get();
  if (!row || row.status !== "proposed") return null;
  db.update(t.mpReports).set({ status: "dismissed", decidedAt: nowIso() }).where(eq(t.mpReports.id, reportId)).run();
  writeAudit(db, { user, action: "report.dismiss", entityType: "report", entityId: reportId, projectId: row.projectId, content: {} });
  return toReport({ ...row, status: "dismissed", decidedAt: nowIso() });
}

export const weeklyReportJob: JobHandler<AgentContext> = async (ctx, job, progress) => {
  const projectId = String(job.payload["projectId"] ?? job.projectId ?? "");
  progress("report", { status: "running", startedAt: nowIso() });
  const r = await runWeeklyReport(ctx, projectId, typeof job.payload["weekStart"] === "string" ? job.payload["weekStart"] : undefined);
  progress("report", { status: "done", finishedAt: nowIso(), detail: `Report ${r.weekStart}, ${r.diff.length} Plan-Änderungen vorgeschlagen` });
  return { reportId: r.id };
};
