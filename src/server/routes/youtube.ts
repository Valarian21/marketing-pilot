/**
 * YouTube-Studio: anmelden und planen lassen — Gegenstück zu routes/tiktok.ts.
 * Die Browser-Sicht läuft über `/api/mp/youtube/vnc` (siehe app.ts).
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
  laufVermerken, offeneAuftraege, planenStarten, schritt, sitzungBeenden, sitzungStarten, sitzungStatus, studioZahlen, zahlenHolen,
} from "../publish/youtube-studio.js";

const StudioZahlenSchema = z.object({
  abgerufenAm: z.string(),
  kanalId: z.string(),
  kanal: z.object({ abonnenten: z.number().nullable(), aufrufe28: z.number().nullable(), wiedergabeStunden28: z.number().nullable() }),
  videos: z.array(z.object({ id: z.string(), titel: z.string(), datum: z.string(), aufrufe: z.number().nullable(), kommentare: z.number().nullable(), likes: z.number().nullable() })),
  zugeordnet: z.number().int(),
});

export function youtubeRoutes(app: FastifyInstance, db: Db, env: Env): void {
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

  r.get("/api/mp/projects/:projectId/youtube", {
    schema: { params: P, response: { 200: s.TiktokView, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return view(req.params.projectId);
  });

  r.post("/api/mp/projects/:projectId/youtube/sitzung", {
    schema: { params: P, response: { 200: s.TiktokView, 404: s.ErrorBody, 400: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { await sitzungStarten(env); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Sitzung ließ sich nicht starten." }); }
    writeAudit(db, { user: req.user, action: "youtube.sitzung", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: {} });
    return view(req.params.projectId);
  });

  r.delete("/api/mp/projects/:projectId/youtube/sitzung", {
    schema: { params: P, response: { 200: z.object({ ok: z.boolean() }), 400: s.ErrorBody } },
  }, async (req, reply) => {
    try { await sitzungBeenden(env); return { ok: true }; }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Konnte nicht beenden." }); }
  });

  r.post("/api/mp/projects/:projectId/youtube/planen", {
    schema: { params: P, body: z.object({ probe: z.boolean().default(false), hoechstens: z.number().int().min(0).max(60).default(0) }), response: { 200: s.TiktokView, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { await planenStarten(db, env, req.params.projectId, req.body.probe, req.body.hoechstens); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Lauf ließ sich nicht starten." }); }
    writeAudit(db, { user: req.user, action: "youtube.planen", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { probe: req.body.probe } });
    return view(req.params.projectId);
  });

  /** Zahlen aus dem Studio lesen — Kanal-Dashboard und Inhalte-Liste — und in Kanaltag, Metriken, Verlauf schreiben. */
  r.post("/api/mp/projects/:projectId/youtube/zahlen", {
    schema: { params: P, response: { 200: StudioZahlenSchema, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try {
      const z2 = await zahlenHolen(db, env, req.params.projectId);
      writeAudit(db, { user: req.user, action: "youtube.zahlen", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { videos: z2.videos.length, zugeordnet: z2.zugeordnet } });
      return z2;
    } catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Zahlen ließen sich nicht lesen." }); }
  });

  r.get("/api/mp/projects/:projectId/youtube/zahlen", {
    schema: { params: P, response: { 200: StudioZahlenSchema.nullable(), 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return studioZahlen(db, req.params.projectId);
  });

  /** Fernsteuerung für die Einrichtung — siehe `schritt()` in studio-browser.ts. */
  r.post("/api/mp/projects/:projectId/youtube/schritt", {
    schema: { params: P, body: z.object({
      goto: z.string().url().optional(), klick: z.string().optional(), klickText: z.string().optional(),
      tippen: z.object({ selektor: z.string(), text: z.string(), loeschen: z.boolean().optional() }).optional(),
      datei: z.object({ selektor: z.string(), pfad: z.string() }).optional(),
      waehlen: z.object({ selektor: z.string(), text: z.string() }).optional(),
      taste: z.string().optional(), warteMs: z.number().int().optional(), pruefen: z.array(z.string()).optional(), name: z.string().optional(),
    }), response: { 200: z.object({ url: z.string(), text: z.string(), foto: z.string(), gefunden: z.record(z.string(), z.object({ anzahl: z.number(), sichtbar: z.boolean() })) }), 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { return await schritt(env, req.body); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message.slice(0, 400) : "Schritt fehlgeschlagen." }); }
  });

  r.post("/api/mp/projects/:projectId/youtube/vermerken", {
    schema: { params: P, response: { 200: z.object({ vermerkt: z.number().int() }), 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return { vermerkt: laufVermerken(db, req.params.projectId) };
  });
}
