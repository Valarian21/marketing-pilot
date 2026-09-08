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
import { loadProfiles, patchChannel, stageOf } from "../channels.js";
import { channelBoard, projectSetup } from "../publish/board.js";
import { STAGES, stageAtLeast } from "../../shared/channels.js";
import { enqueueJob, getJob, hasActiveJob, workerAlive } from "../jobs.js";
import { getPiece } from "../agents/studio/generate.js";
import { loadCredentials, platformStatus, posterFor, saveCredentials } from "../publish/index.js";
import { cancelScheduled, listScheduled, nextFreeSlot, postedToday, recordExternPost, schedulePiece } from "../publish/schedule.js";
import { pipelineView } from "../publish/pipeline.js";
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
      board: channelBoard(db, req.params.projectId),
      setup: projectSetup(db, req.params.projectId),
      scheduled: listScheduled(db, req.params.projectId),
      bio, bioUrl: bio.enabled ? bioUrl(bio.code) : null,
      autoToday: postedToday(db, req.params.projectId),
      workerAlive: workerAlive(db),
    };
  });

  /**
   * Ein Kanal auf der Kanäle-Seite: Stufe, Adresse, Slots, Deckel. Die Stufe
   * darf nicht über das hinaus, was die Plattform zulässt — X, LinkedIn und
   * Reddit bleiben beim Vorbereiten, egal was hereinkommt.
   */
  r.patch("/api/mp/projects/:projectId/publish/channel/:platform", {
    schema: { params: P.extend({ platform: z.string().min(1) }), body: s.ChannelPatch, response: { 200: s.PublishView, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const platform = req.params.platform.trim().toLowerCase();
    if (req.body.stage) {
      const card = channelBoard(db, req.params.projectId).find((c) => c.platform === platform);
      if (card && !stageAtLeast(card.maxStage, req.body.stage)) {
        return reply.code(400).send({ detail: `${card.label} kann höchstens „${STAGES[card.maxStage].label}“: ${card.maxReason}` });
      }
    }
    const before = stageOf(db, req.params.projectId, platform);
    const next = patchChannel(db, req.params.projectId, platform, req.body);
    if (req.body.stage && req.body.stage !== before) {
      writeAudit(db, { user: req.user, action: "channel.stage", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { platform, from: before, to: next.stage } });
    }
    const bio = loadBio(db, req.params.projectId);
    return {
      profiles: loadProfiles(db, req.params.projectId),
      platforms: platformStatus(db, req.params.projectId),
      board: channelBoard(db, req.params.projectId),
      setup: projectSetup(db, req.params.projectId),
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
    // Die Stufe entscheidet: auf „Vorbereiten" postest du selbst, der Pilot plant dort nichts ein.
    const targets = (req.body.platforms.length ? req.body.platforms : [String(piece.meta["platform"] ?? piece.channel)]).map((p) => p.trim().toLowerCase());
    for (const platform of targets) {
      const stage = stageOf(db, piece.projectId, platform);
      if (!stageAtLeast(stage, "approve")) {
        return reply.code(400).send({ detail: `${platform} steht auf Stufe „${STAGES[stage].label}“ — dort postest du selbst. Zum Einplanen den Kanal auf „Freigeben“ stellen.` });
      }
    }
    const planned = schedulePiece(db, piece.projectId, { pieceId: piece.id, ...(req.body.platforms.length ? { platforms: req.body.platforms } : {}), ...(req.body.scheduledAt ? { at: req.body.scheduledAt } : {}) });
    writeAudit(db, { user: req.user, action: "publish.schedule", entityType: "content_piece", entityId: piece.id, projectId: piece.projectId, content: { entries: planned.map((x) => ({ platform: x.platform, at: x.scheduledAt })) } });
    return reply.code(201).send(planned);
  });

  /**
   * Ein Beitrag, den du selbst auf der Plattform eingestellt hast.
   *
   * Der einzige Weg, TikTok, X oder LinkedIn im Zeitplan sichtbar zu machen:
   * dort kann der Pilot nicht posten, aber er soll wissen, dass dort etwas
   * läuft. Ohne das zeigt die Ampel eine leere Woche, während zweimal täglich
   * ein Reel rausgeht.
   */
  r.post("/api/mp/projects/:projectId/publish/extern", {
    schema: { params: P, body: s.ExternPostCreate, response: { 201: s.ScheduledPost, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const eintrag = recordExternPost(db, req.params.projectId, req.body);
    writeAudit(db, {
      user: req.user, action: "publish.extern", entityType: "content_piece", entityId: req.body.pieceId, projectId: req.params.projectId,
      content: { platform: eintrag.platform, at: eintrag.scheduledAt, posted: eintrag.status === "posted", url: eintrag.externalUrl },
    });
    return reply.code(201).send(eintrag);
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

  /** Die Ampel: je Kanal die Slots der nächsten Tage und was sie füllt. */
  r.get("/api/mp/projects/:projectId/pipeline", {
    schema: { params: P, querystring: z.object({ days: z.coerce.number().int().min(1).max(31).default(10) }), response: { 200: s.PipelineView, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return pipelineView(db, req.params.projectId, { days: req.query.days });
  });

  /** Fällige Einträge sofort abarbeiten, statt auf den Zehn-Minuten-Takt zu warten. */
  r.post("/api/mp/projects/:projectId/publish/run", { schema: { params: P, response: { 202: s.Job, 400: s.ErrorBody, 409: s.ErrorBody } } }, async (req, reply) => {
    if (!workerAlive(db)) return reply.code(400).send({ detail: "Der Worker läuft nicht (app-marketing-pilot-worker)." });
    if (hasActiveJob(db, req.params.projectId, "publish.due")) return reply.code(409).send({ detail: "Es läuft bereits ein Posting-Lauf." });
    const job = enqueueJob(db, { projectId: req.params.projectId, kind: "publish.due", payload: { projectId: req.params.projectId }, steps: PUBLISH_STEPS });
    return reply.code(202).send(getJob(db, job.id)!);
  });
}
