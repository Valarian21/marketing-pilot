/** Video factory endpoints: script generation/editing, render jobs (queued for the worker), job status. */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { type Db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import { getProject } from "../repo/projects.js";
import { cancelJob, enqueueJob, getJob, hasActiveJob, listJobs, workerAlive } from "../jobs.js";
import { generateVideoScript, updateVideoScript } from "../agents/video/script.js";
import { getScript, VIDEO_STEPS } from "../agents/video/pipeline.js";
import { pieceOf, withCosts } from "../agents/studio/generate.js";
import type { FullContext } from "../services.js";
import { ROOT } from "../env.js";

export function videoRoutes(app: FastifyInstance, db: Db, getCtx: () => FullContext | null): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  r.get("/api/mp/projects/:projectId/video", { schema: { params: P, response: { 200: s.VideoView, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const ctx = getCtx();
    const env = ctx?.env;
    let musicTracks = 0;
    try { musicTracks = fs.readdirSync(path.join(ROOT, "assets", "music")).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f)).length; } catch { /* none */ }
    return {
      pieces: withCosts(db, db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, req.params.projectId)).all().map(pieceOf).filter((p) => p.format === "video")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      jobs: listJobs(db, req.params.projectId, 10),
      demoConfigured: Boolean(env?.MP_DEMO_BASE_URL),
      voiceConfigured: Boolean(ctx?.voice),
      workerAlive: workerAlive(db),
      musicTracks,
    };
  });

  r.post("/api/mp/projects/:projectId/video/script", { schema: { params: P, body: s.VideoScriptRequest, response: { 201: s.ContentPiece, 400: s.ErrorBody, 404: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx();
    if (!ctx) return reply.code(503).send({ detail: "OPENROUTER_API_KEY fehlt in der .env." });
    return reply.code(201).send(await generateVideoScript(ctx, req.params.projectId, req.body, req.user));
  });

  r.put("/api/mp/content/:id/script", { schema: { params: s.IdParams, body: s.VideoScript, response: { 200: s.ContentPiece, 404: s.ErrorBody } } }, async (req, reply) => {
    const piece = updateVideoScript(db, req.params.id, req.body, req.user);
    return piece ?? reply.code(404).send({ detail: "Kein Video-Stück mit dieser ID." });
  });

  r.post("/api/mp/content/:id/video/render", { schema: { params: s.IdParams, body: s.VideoRenderRequest, response: { 202: s.Job, 400: s.ErrorBody, 404: s.ErrorBody, 409: s.ErrorBody } } }, async (req, reply) => {
    const got = getScript(db, req.params.id);
    if (!got) return reply.code(404).send({ detail: "Kein Video-Skript an diesem Stück." });
    if (hasActiveJob(db, got.piece.projectId, "video.render")) return reply.code(409).send({ detail: "Für dieses Projekt läuft bereits ein Render." });
    if (!workerAlive(db)) return reply.code(400).send({ detail: "Der Worker läuft nicht (app-marketing-pilot-worker) - Job wurde nicht gestartet." });
    const job = enqueueJob(db, { projectId: got.piece.projectId, kind: "video.render", payload: { pieceId: got.piece.id, variants: req.body.variants, landscape: req.body.landscape }, steps: VIDEO_STEPS });
    writeAudit(db, { user: req.user, action: "video.render", entityType: "content_piece", entityId: got.piece.id, projectId: got.piece.projectId, content: { job: job.id, variants: req.body.variants, landscape: req.body.landscape } });
    return reply.code(202).send(job);
  });

  r.get("/api/mp/jobs/:id", { schema: { params: s.IdParams, response: { 200: s.Job, 404: s.ErrorBody } } }, async (req, reply) => getJob(db, req.params.id) ?? reply.code(404).send({ detail: "Job nicht gefunden." }));

  r.delete("/api/mp/jobs/:id", { schema: { params: s.IdParams, response: { 200: s.Job, 404: s.ErrorBody, 409: s.ErrorBody } } }, async (req, reply) => {
    const job = getJob(db, req.params.id);
    if (!job) return reply.code(404).send({ detail: "Job nicht gefunden." });
    if (!cancelJob(db, job.id)) return reply.code(409).send({ detail: "Nur wartende Jobs lassen sich abbrechen." });
    return getJob(db, job.id)!;
  });
}
