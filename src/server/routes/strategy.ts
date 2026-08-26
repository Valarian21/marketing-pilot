import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { eq } from "drizzle-orm";
import { parseJson, type Db } from "../db/index.js";
import { getProject } from "../repo/projects.js";
import { currentVersion, listVersions, startStrategy, strategyJob, taskCount } from "../agents/strategy/plan.js";
import type { AgentContext } from "../agents/runner.js";

export function briefConfirmed(db: Db, projectId: string): boolean {
  const raw = db.select({ briefMeta: t.mpProjects.briefMeta }).from(t.mpProjects).where(eq(t.mpProjects.id, projectId)).get();
  return Boolean(s.BriefMeta.parse(parseJson<Record<string, unknown>>(raw?.briefMeta ?? "{}", {})).confirmedAt);
}

export function strategyView(db: Db, projectId: string): s.StrategyView {
  const job = strategyJob(projectId);
  return {
    briefConfirmed: briefConfirmed(db, projectId), running: job.running, error: job.error,
    current: currentVersion(db, projectId),
    versions: listVersions(db, projectId).map((v) => ({ version: v.version, createdBy: v.createdBy, note: v.note, createdAt: v.createdAt, changes: v.diff.length })),
    taskCount: taskCount(db, projectId),
  };
}

export function strategyRoutes(app: FastifyInstance, db: Db, getCtx: () => AgentContext | null): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  r.get("/api/mp/projects/:projectId/strategy", { schema: { params: P, response: { 200: s.StrategyView, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return strategyView(db, req.params.projectId);
  });

  r.get("/api/mp/projects/:projectId/strategy/versions/:version", { schema: { params: P.extend({ version: z.coerce.number().int() }), response: { 200: s.StrategyVersion, 404: s.ErrorBody } } }, async (req, reply) => {
    const v = listVersions(db, req.params.projectId).find((x) => x.version === req.params.version);
    return v ?? reply.code(404).send({ detail: "Version nicht gefunden." });
  });

  const start = (tasksOnly: boolean) => async (req: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    const project = getProject(db, req.params.projectId);
    if (!project) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const ctx = getCtx();
    if (!ctx) return reply.code(503).send({ detail: "OPENROUTER_API_KEY fehlt in der .env." });
    if (!briefConfirmed(db, project.id)) return reply.code(409).send({ detail: "Erst den Brief bestätigen (Analyse-Seite)." });
    if (tasksOnly && !currentVersion(db, project.id)) return reply.code(409).send({ detail: "Noch kein Plan - erst die Strategie erzeugen." });
    if (strategyJob(project.id).running) return reply.code(409).send({ detail: "Läuft bereits." });
    const note = s.StrategyStart.safeParse(req.body ?? {}).data?.note ?? "";
    void startStrategy(ctx, project.id, { note, user: req.user, tasksOnly });
    return reply.code(202).send(strategyView(db, project.id));
  };
  app.post("/api/mp/projects/:projectId/strategy/run", start(false));
  app.post("/api/mp/projects/:projectId/tasks/generate", start(true));
}
