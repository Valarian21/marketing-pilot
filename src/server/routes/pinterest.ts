/**
 * Pinterest im Anmelde-Browser: anmelden, Profil füllen, Pins setzen —
 * Gegenstück zu routes/youtube.ts. Die Browser-Sicht läuft über
 * `/api/mp/pinterest/vnc` (siehe app.ts).
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";
import { getProject } from "../repo/projects.js";
import { writeAudit } from "../audit.js";
import {
  laufVermerken, offeneAuftraege, pinnenStarten, profilStarten, sitzungBeenden, sitzungStarten, sitzungStatus,
} from "../publish/pinterest-studio.js";

export function pinterestRoutes(app: FastifyInstance, db: Db, env: Env): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  const view = async (projectId: string) => {
    const { auftraege, uebersprungen } = offeneAuftraege(db, env, projectId);
    return {
      ...(await sitzungStatus(env)),
      wartend: auftraege.map((a) => ({ pieceId: a.pieceId, titel: a.titel, geplantAm: a.geplantAm })),
      uebersprungen,
    };
  };

  r.get("/api/mp/projects/:projectId/pinterest", {
    schema: { params: P, response: { 200: s.TiktokView, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return view(req.params.projectId);
  });

  r.post("/api/mp/projects/:projectId/pinterest/sitzung", {
    schema: { params: P, response: { 200: s.TiktokView, 404: s.ErrorBody, 400: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { await sitzungStarten(env); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Sitzung ließ sich nicht starten." }); }
    writeAudit(db, { user: req.user, action: "pinterest.sitzung", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: {} });
    return view(req.params.projectId);
  });

  r.delete("/api/mp/projects/:projectId/pinterest/sitzung", {
    schema: { params: P, response: { 200: z.object({ ok: z.boolean() }), 400: s.ErrorBody } },
  }, async (req, reply) => {
    try { await sitzungBeenden(env); return { ok: true }; }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Konnte nicht beenden." }); }
  });

  r.post("/api/mp/projects/:projectId/pinterest/pinnen", {
    schema: { params: P, body: z.object({ probe: z.boolean().default(false), hoechstens: z.number().int().min(1).max(20).default(5) }), response: { 200: s.TiktokView, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { await pinnenStarten(db, env, req.params.projectId, req.body.probe, req.body.hoechstens); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Lauf ließ sich nicht starten." }); }
    writeAudit(db, { user: req.user, action: "pinterest.pinnen", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { probe: req.body.probe } });
    return view(req.params.projectId);
  });

  r.post("/api/mp/projects/:projectId/pinterest/profil", {
    schema: { params: P, body: z.object({ probe: z.boolean().default(false) }), response: { 200: s.TiktokView, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { await profilStarten(db, env, req.params.projectId, req.body.probe); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Lauf ließ sich nicht starten." }); }
    writeAudit(db, { user: req.user, action: "pinterest.profil", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { probe: req.body.probe } });
    return view(req.params.projectId);
  });

  r.post("/api/mp/projects/:projectId/pinterest/vermerken", {
    schema: { params: P, response: { 200: z.object({ vermerkt: z.number().int() }), 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return { vermerkt: laufVermerken(db, req.params.projectId) };
  });
}
