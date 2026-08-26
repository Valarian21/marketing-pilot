/** Tasks (CRUD, reorder, execute), content review actions, timeline and overview. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { newId, nowIso, type Db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import { getProject, listProjects } from "../repo/projects.js";
import type { AgentContext } from "../agents/runner.js";
import { executeTask, rowToTask } from "../agents/strategy/execute.js";
import { currentVersion, dueAtFor, enforceApproval, geoSummary, isoDate } from "../agents/strategy/plan.js";
import { briefConfirmed } from "./strategy.js";

import { pieceOf } from "../agents/studio/generate.js";

export function weekOf(startDate: string, iso: string | null): number | null {
  if (!iso) return null;
  const diff = Date.parse(iso) - Date.parse(`${startDate}T00:00:00.000Z`);
  return Math.floor(diff / (7 * 86_400_000)) + 1;
}

export function timelineView(db: Db, projectId: string, weeks = 12): s.TimelineView | null {
  const project = getProject(db, projectId);
  if (!project) return null;
  const plan = currentVersion(db, projectId)?.plan ?? null;
  const startDate = plan?.startDate ?? project.createdAt.slice(0, 10);
  const tasks = db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, projectId)).orderBy(t.mpTasks.week, t.mpTasks.order).all().map(rowToTask);
  const pieces = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all().map(pieceOf);
  const rows = new Map<string, s.TimelineItem[]>();
  for (const c of plan?.channels ?? []) rows.set(c.platform, []);
  const push = (ch: string, item: s.TimelineItem) => { const key = ch || "Allgemein"; if (!rows.has(key)) rows.set(key, []); rows.get(key)!.push(item); };
  for (const x of tasks) {
    const w = weekOf(startDate, x.dueAt) ?? x.week;
    push(x.channel, { kind: "task", id: x.id, title: x.title, week: Math.max(1, w), status: x.status, planned: x.status !== "done", date: x.dueAt, assignedTo: x.assignedTo, type: x.type });
  }
  for (const p of pieces) {
    if (p.status === "rejected") continue;
    const date = p.publishedAt ?? p.updatedAt;
    push(p.channel, { kind: "piece", id: p.id, title: p.title || p.format, week: Math.max(1, weekOf(startDate, date) ?? 1), status: p.status, planned: p.status !== "published", date, assignedTo: null, type: p.format });
  }
  const todayWeek = weekOf(startDate, nowIso());
  return { startDate, weeks, todayWeek: todayWeek !== null && todayWeek >= 1 && todayWeek <= weeks ? todayWeek : null, rows: [...rows.entries()].map(([channel, items]) => ({ channel, items })) };
}

export function overview(db: Db): s.ProjectOverview[] {
  return listProjects(db).map((p) => {
    const plan = currentVersion(db, p.id);
    const startDate = plan?.plan.startDate ?? p.createdAt.slice(0, 10);
    const thisWeek = weekOf(startDate, nowIso()) ?? 1;
    const tasks = db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, p.id)).all();
    const openTasksThisWeek = tasks.filter((x) => x.status !== "done" && x.status !== "skipped" && (weekOf(startDate, x.dueAt) ?? x.week) === thisWeek).length;
    const piecesInReview = db.select({ id: t.mpContentPieces.id }).from(t.mpContentPieces).where(and(eq(t.mpContentPieces.projectId, p.id), eq(t.mpContentPieces.status, "review"))).all().length;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const signups7d = db.select().from(t.mpInsights).where(eq(t.mpInsights.projectId, p.id)).all().filter((i) => i.createdAt >= since).reduce((n, i) => n + i.signups, 0);
    return { ...p, openTasksThisWeek, piecesInReview, signups7d, geoVisibility: geoSummary(db, p.id).visibility, briefConfirmed: briefConfirmed(db, p.id), planVersion: plan?.version ?? null };
  });
}

export function taskRoutes(app: FastifyInstance, db: Db, getCtx: () => AgentContext | null): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  r.get("/api/mp/overview", { schema: { response: { 200: z.array(s.ProjectOverview) } } }, async () => overview(db));

  r.get("/api/mp/projects/:projectId/timeline", { schema: { params: P, response: { 200: s.TimelineView, 404: s.ErrorBody } } }, async (req, reply) =>
    timelineView(db, req.params.projectId) ?? reply.code(404).send({ detail: "Projekt nicht gefunden." }));

  r.post("/api/mp/projects/:projectId/tasks", { schema: { params: P, body: s.TaskCreate, response: { 201: s.Task, 404: s.ErrorBody } } }, async (req, reply) => {
    const project = getProject(db, req.params.projectId);
    if (!project) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const b = enforceApproval(req.body);
    const startDate = currentVersion(db, project.id)?.plan.startDate ?? isoDate();
    const siblings = db.select({ order: t.mpTasks.order }).from(t.mpTasks).where(and(eq(t.mpTasks.projectId, project.id), eq(t.mpTasks.week, b.week))).all();
    const ts = nowIso();
    const row = {
      id: newId(), projectId: project.id, title: b.title, description: b.description, type: b.type, status: "todo", dueAt: b.dueAt ?? dueAtFor(startDate, b.week, 0),
      assignedTo: b.assignedTo, approvalLevel: b.approvalLevel, outputRefs: "[]", order: siblings.length + 1, channel: b.channel, week: b.week,
      planVersion: currentVersion(db, project.id)?.version ?? 0, createdAt: ts, updatedAt: ts,
    };
    db.insert(t.mpTasks).values(row).run();
    writeAudit(db, { user: req.user, action: "task.create", entityType: "task", entityId: row.id, projectId: project.id, content: { title: row.title } });
    return reply.code(201).send(rowToTask(row));
  });

  r.patch("/api/mp/tasks/:id", { schema: { params: s.IdParams, body: s.TaskPatch, response: { 200: s.Task, 404: s.ErrorBody } } }, async (req, reply) => {
    const row = db.select().from(t.mpTasks).where(eq(t.mpTasks.id, req.params.id)).get();
    if (!row) return reply.code(404).send({ detail: "Aufgabe nicht gefunden." });
    const patch = { ...req.body };
    const merged = enforceApproval({ title: patch.title ?? row.title, channel: patch.channel ?? row.channel, type: row.type, assignedTo: patch.assignedTo ?? (row.assignedTo as s.Task["assignedTo"]), approvalLevel: patch.approvalLevel ?? (row.approvalLevel as s.Task["approvalLevel"]) });
    db.update(t.mpTasks).set({ ...patch, assignedTo: merged.assignedTo, approvalLevel: merged.approvalLevel, updatedAt: nowIso() }).where(eq(t.mpTasks.id, row.id)).run();
    if (patch.status && patch.status !== row.status) writeAudit(db, { user: req.user, action: `task.${patch.status}`, entityType: "task", entityId: row.id, projectId: row.projectId, content: { title: row.title } });
    return rowToTask(db.select().from(t.mpTasks).where(eq(t.mpTasks.id, row.id)).get()!);
  });

  r.delete("/api/mp/tasks/:id", { schema: { params: s.IdParams, response: { 204: z.null(), 404: s.ErrorBody } } }, async (req, reply) => {
    const row = db.select().from(t.mpTasks).where(eq(t.mpTasks.id, req.params.id)).get();
    if (!row) return reply.code(404).send({ detail: "Aufgabe nicht gefunden." });
    db.delete(t.mpTasks).where(eq(t.mpTasks.id, row.id)).run();
    writeAudit(db, { user: req.user, action: "task.delete", entityType: "task", entityId: row.id, projectId: row.projectId, content: { title: row.title } });
    return reply.code(204).send(null);
  });

  r.post("/api/mp/projects/:projectId/tasks/reorder", { schema: { params: P, body: s.TaskReorder, response: { 200: z.array(s.Task) } } }, async (req) => {
    const rows = db.select().from(t.mpTasks).where(and(eq(t.mpTasks.projectId, req.params.projectId), inArray(t.mpTasks.id, req.body.ids))).all();
    const week = rows[0]?.week;
    req.body.ids.forEach((id, i) => {
      const set: Partial<typeof t.mpTasks.$inferInsert> = { order: i + 1, updatedAt: nowIso() };
      if (week !== undefined) set.week = week;
      db.update(t.mpTasks).set(set).where(and(eq(t.mpTasks.id, id), eq(t.mpTasks.projectId, req.params.projectId))).run();
    });
    return db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, req.params.projectId)).orderBy(t.mpTasks.week, t.mpTasks.order).all().map(rowToTask);
  });

  r.post("/api/mp/tasks/:id/execute", { schema: { params: s.IdParams, response: { 200: s.ContentPiece, 400: s.ErrorBody, 404: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx();
    if (!ctx) return reply.code(503).send({ detail: "OPENROUTER_API_KEY fehlt in der .env." });
    return executeTask(ctx, req.params.id, req.user);
  });

  r.get("/api/mp/content/:id", { schema: { params: s.IdParams, response: { 200: s.ContentPiece, 404: s.ErrorBody } } }, async (req, reply) => {
    const row = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, req.params.id)).get();
    return row ? pieceOf(row) : reply.code(404).send({ detail: "Stück nicht gefunden." });
  });

  r.get("/api/mp/content", { schema: { querystring: z.object({ status: s.ContentStatus.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), response: { 200: z.array(s.ContentPiece) } } }, async (req) => {
    const q = db.select().from(t.mpContentPieces);
    return (req.query.status ? q.where(eq(t.mpContentPieces.status, req.query.status)) : q).orderBy(desc(t.mpContentPieces.createdAt)).limit(req.query.limit).all().map(pieceOf);
  });

  r.patch("/api/mp/content/:id", { schema: { params: s.IdParams, body: s.ContentPatch, response: { 200: s.ContentPiece, 404: s.ErrorBody } } }, async (req, reply) => {
    const row = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, req.params.id)).get();
    if (!row) return reply.code(404).send({ detail: "Stück nicht gefunden." });
    const set: Partial<typeof t.mpContentPieces.$inferInsert> = { updatedAt: nowIso() };
    if (req.body.body !== undefined && req.body.body !== row.body) { set.body = req.body.body; set.humanEdited = true; }
    if (req.body.title !== undefined) set.title = req.body.title;
    if (req.body.externalUrl !== undefined) set.externalUrl = req.body.externalUrl || null;
    if (req.body.status) {
      set.status = req.body.status;
      if (req.body.status === "rejected") set.rejectionReason = req.body.reason ?? "";
      if (req.body.status === "published" && !row.publishedAt) set.publishedAt = nowIso();
      // Approval with outside effect is logged with user, time and content (rule 4).
      writeAudit(db, { user: req.user, action: `content.${req.body.status}`, entityType: "content_piece", entityId: row.id, projectId: row.projectId,
        content: { title: row.title, channel: row.channel, format: row.format, reason: req.body.reason ?? null, humanEdited: Boolean(set.humanEdited || row.humanEdited), body: (set.body ?? row.body).slice(0, 4000) } });
      if (row.taskId && (req.body.status === "approved" || req.body.status === "published")) {
        db.update(t.mpTasks).set({ status: req.body.status === "published" ? "done" : "review", updatedAt: nowIso() }).where(eq(t.mpTasks.id, row.taskId)).run();
      }
    }
    db.update(t.mpContentPieces).set(set).where(eq(t.mpContentPieces.id, row.id)).run();
    return pieceOf(db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, row.id)).get()!);
  });
}
