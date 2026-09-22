/**
 * TikTok-Studio: anmelden und planen lassen.
 *
 * Die Sicht auf den Browser läuft über `/api/mp/tiktok/vnc` — also durch den
 * Piloten und damit durch dessen Anmeldung. Ein eigener nginx-Pfad wäre offen
 * im Netz gestanden; so kommt nur hinein, wer ohnehin im Dashboard angemeldet
 * ist, und das VNC-Passwort ist die zweite Tür.
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
  laufVermerken, offeneAuftraege, planenStarten, schritt, sitzungBeenden, sitzungStarten, sitzungStatus,
  tiktokZahlen, zahlenHolen,
} from "../publish/tiktok-studio.js";

export function tiktokRoutes(app: FastifyInstance, db: Db, env: Env): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  /** Was wartet, was fällt raus — ohne irgendetwas zu starten. */
  r.get("/api/mp/projects/:projectId/tiktok", {
    schema: { params: P, response: { 200: s.TiktokView, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const { auftraege, uebersprungen } = offeneAuftraege(db, env, req.params.projectId);
    const st = await sitzungStatus(env);
    return {
      ...st,
      wartend: auftraege.map((a) => ({ pieceId: a.pieceId, titel: a.titel, geplantAm: a.geplantAm })),
      uebersprungen,
    };
  });

  /** Browser hochfahren und TikTok öffnen; der Mensch meldet sich selbst an. */
  r.post("/api/mp/projects/:projectId/tiktok/sitzung", {
    schema: { params: P, response: { 200: s.TiktokView, 404: s.ErrorBody, 400: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { await sitzungStarten(env); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Sitzung ließ sich nicht starten." }); }
    writeAudit(db, { user: req.user, action: "tiktok.sitzung", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: {} });
    const { auftraege, uebersprungen } = offeneAuftraege(db, env, req.params.projectId);
    return { ...(await sitzungStatus(env)), wartend: auftraege.map((a) => ({ pieceId: a.pieceId, titel: a.titel, geplantAm: a.geplantAm })), uebersprungen };
  });

  /** Browser und VNC wieder abschalten. */
  r.delete("/api/mp/projects/:projectId/tiktok/sitzung", {
    schema: { params: P, response: { 200: z.object({ ok: z.boolean() }), 400: s.ErrorBody } },
  }, async (req, reply) => {
    try { await sitzungBeenden(env); return { ok: true }; }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Konnte nicht beenden." }); }
  });

  /** Die Zahlen jetzt aus dem Studio holen, statt auf den Tagestakt zu warten. */
  r.post("/api/mp/projects/:projectId/tiktok/zahlen", {
    schema: { params: P, querystring: z.object({ tage: z.coerce.number().int().min(7).max(365).default(60) }),
      response: { 200: s.TiktokZahlen, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try {
      const z = await zahlenHolen(db, env, req.params.projectId, req.query.tage);
      writeAudit(db, { user: req.user, action: "tiktok.zahlen", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { tage: z.tage, von: z.von, bis: z.bis } });
      return z;
    } catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message.slice(0, 400) : "Abruf fehlgeschlagen." }); }
  });

  /** Der letzte Stand, ohne etwas anzustoßen. */
  r.get("/api/mp/projects/:projectId/tiktok/zahlen", {
    schema: { params: P, response: { 200: s.TiktokZahlen.nullable(), 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return tiktokZahlen(db, req.params.projectId);
  });

  /** Fernsteuerung für die Einrichtung — siehe `schritt()` in studio-browser.ts. */
  r.post("/api/mp/projects/:projectId/tiktok/schritt", {
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

  /** Den Stapel im Studio eintragen. `probe: true` füllt alles aus, schickt aber nicht ab. */
  r.post("/api/mp/projects/:projectId/tiktok/planen", {
    schema: { params: P, body: z.object({ probe: z.boolean().default(false) }), response: { 200: s.TiktokView, 400: s.ErrorBody, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    try { await planenStarten(db, env, req.params.projectId, req.body.probe); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : "Lauf ließ sich nicht starten." }); }
    writeAudit(db, { user: req.user, action: "tiktok.planen", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { probe: req.body.probe } });
    const { auftraege, uebersprungen } = offeneAuftraege(db, env, req.params.projectId);
    return { ...(await sitzungStatus(env)), wartend: auftraege.map((a) => ({ pieceId: a.pieceId, titel: a.titel, geplantAm: a.geplantAm })), uebersprungen };
  });

  /** Nach dem Lauf: im Piloten vermerken, was jetzt im Studio liegt. */
  r.post("/api/mp/projects/:projectId/tiktok/vermerken", {
    schema: { params: P, response: { 200: z.object({ vermerkt: z.number().int() }), 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return { vermerkt: laufVermerken(db, req.params.projectId) };
  });
}
