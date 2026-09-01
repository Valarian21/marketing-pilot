/**
 * Veröffentlichen v2 (Shot 10): Zugangsdaten je Kanal, Zeitplan und Bio-Seite.
 *
 * Geheimnisse gehen **nie** im Klartext hinaus: die Übersicht sagt nur, ob ein
 * Kanal eingerichtet ist. Wer einen Wert ändern will, schreibt ihn neu.
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";
import { writeAudit } from "../audit.js";
import { getProject } from "../repo/projects.js";
import { loadProfiles } from "../channels.js";
import { enqueueJob, getJob, hasActiveJob, workerAlive } from "../jobs.js";
import { getPiece } from "../agents/studio/generate.js";
import { loadCredentials, platformStatus, posterFor, saveCredentials } from "../publish/index.js";
import { cancelScheduled, listScheduled, nextFreeSlot, postedToday, schedulePiece } from "../publish/schedule.js";
import { PUBLISH_STEPS } from "../publish/job.js";
import { loadBio, saveBio } from "../publish/bio.js";

export function publishRoutes(app: FastifyInstance, db: Db, env: Env): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;
  const bioUrl = (code: string) => (env.MP_PUBLIC_BASE && code ? `${env.MP_PUBLIC_BASE.replace(/\/$/, "")}/go/bio/${code}` : null);

  r.get("/api/mp/projects/:projectId/publish", { schema: { params: P, response: { 200: s.PublishView, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const bio = loadBio(db, req.params.projectId);
    return {
      profiles: loadProfiles(db, req.params.projectId),
      platforms: platformStatus(db, req.params.projectId),
      scheduled: listScheduled(db, req.params.projectId),
      bio, bioUrl: bio.enabled ? bioUrl(bio.code) : null,
      autoToday: postedToday(db, req.params.projectId),
      workerAlive: workerAlive(db),
    };
  });

  r.put("/api/mp/projects/:projectId/publish/credentials", { schema: { params: P, body: s.CredentialsPatch, response: { 200: z.array(s.PlatformPosting) } } }, async (req) => {
    saveCredentials(db, req.params.projectId, req.body);
    writeAudit(db, { user: req.user, action: "publish.credentials", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { platforms: Object.keys(req.body) } });
    return platformStatus(db, req.params.projectId);
  });

  r.put("/api/mp/projects/:projectId/publish/bio", { schema: { params: P, body: s.BioSettings.partial(), response: { 200: z.object({ bio: s.BioSettings, bioUrl: z.string().nullable() }) } } }, async (req) => {
    const bio = saveBio(db, req.params.projectId, req.body);
    writeAudit(db, { user: req.user, action: "publish.bio", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { enabled: bio.enabled, code: bio.code } });
    return { bio, bioUrl: bio.enabled ? bioUrl(bio.code) : null };
  });

  /** „Freigeben & einplanen": je Kanal ein Eintrag, ohne Angabe zum nächsten freien Slot. */
  r.post("/api/mp/content/:id/publish/schedule", {
    schema: { params: s.IdParams, body: s.ScheduleCreate, response: { 201: z.array(s.ScheduledPost), 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    const piece = getPiece(db, req.params.id);
    if (!piece) return reply.code(404).send({ detail: "Stück nicht gefunden." });
    const planned = schedulePiece(db, piece.projectId, { pieceId: piece.id, ...(req.body.platforms.length ? { platforms: req.body.platforms } : {}), ...(req.body.scheduledAt ? { at: req.body.scheduledAt } : {}) });
    writeAudit(db, { user: req.user, action: "publish.schedule", entityType: "content_piece", entityId: piece.id, projectId: piece.projectId, content: { entries: planned.map((x) => ({ platform: x.platform, at: x.scheduledAt })) } });
    return reply.code(201).send(planned);
  });

  r.delete("/api/mp/scheduled/:id", { schema: { params: s.IdParams, response: { 200: z.object({ cancelled: z.boolean() }), 409: s.ErrorBody } } }, async (req, reply) => {
    if (!cancelScheduled(db, req.params.id)) return reply.code(409).send({ detail: "Nur wartende Einträge lassen sich absagen." });
    return { cancelled: true };
  });

  /** Wann der nächste freie Slot eines Kanals wäre — für die Anzeige vor dem Einplanen. */
  r.get("/api/mp/projects/:projectId/publish/next-slot", {
    schema: { params: P, querystring: z.object({ platform: z.string() }), response: { 200: z.object({ at: s.ScheduledPost.shape.scheduledAt, hasSlots: z.boolean(), canPost: z.boolean() }) } },
  }, async (req) => {
    const profile = loadProfiles(db, req.params.projectId).find((p) => p.platform === req.query.platform);
    return {
      at: nextFreeSlot(db, req.params.projectId, req.query.platform).toISOString(),
      hasSlots: (profile?.slots.length ?? 0) > 0,
      canPost: Boolean(posterFor(req.query.platform)) && posterFor(req.query.platform)!.missing(loadCredentials(db, req.params.projectId)[req.query.platform] ?? {}).length === 0,
    };
  });

  /** Fällige Einträge sofort abarbeiten, statt auf den Zehn-Minuten-Takt zu warten. */
  r.post("/api/mp/projects/:projectId/publish/run", { schema: { params: P, response: { 202: s.Job, 400: s.ErrorBody, 409: s.ErrorBody } } }, async (req, reply) => {
    if (!workerAlive(db)) return reply.code(400).send({ detail: "Der Worker läuft nicht (app-marketing-pilot-worker)." });
    if (hasActiveJob(db, req.params.projectId, "publish.due")) return reply.code(409).send({ detail: "Es läuft bereits ein Posting-Lauf." });
    const job = enqueueJob(db, { projectId: req.params.projectId, kind: "publish.due", payload: { projectId: req.params.projectId }, steps: PUBLISH_STEPS });
    return reply.code(202).send(getJob(db, job.id)!);
  });
}
