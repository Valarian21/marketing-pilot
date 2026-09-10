/** Shot 5 endpoints: community radar, inbound events + insights + snippet, weekly reports. */
import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import { type Db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import { getProject } from "../repo/projects.js";
import { enqueueJob, getJob, hasActiveJob, workerAlive } from "../jobs.js";
import { getLead, isScanning, lastScanAt, listLeads, loadSources, saveSources, scanCommunity, updateLead, deriveSources } from "../agents/community/radar.js";
import { antwortBudget, antworteAufThread, kannSelbstAntworten, rechteHinweis } from "../agents/community/social.js";
import { credentialsFor } from "../publish/index.js";
import { listPersonas } from "../agents/analysis/personas.js";
import { listChannels } from "../agents/analysis/attention.js";
import { insightsView, landingSnippet, recordEvent } from "../agents/insights/insights.js";
import { cockpitView } from "../agents/insights/cockpit.js";
import { produktDbPfad } from "../data-source.js";
import { KANAL_STEPS } from "../publish/job.js";
import { liesExport, speichereExport } from "../publish/kanal-import.js";
import { MESSBARE_KANAELE } from "../publish/kanal-metriken.js";
import { PLATFORMS } from "../../shared/channels.js";
import { berlinTag } from "../shortlinks.js";
import { adoptReport, dismissReport, listReports, runWeeklyReport } from "../agents/loop/weekly.js";
import type { FullContext } from "../services.js";
import type { Env } from "../env.js";

export const EVENTS_PUBLIC_PATH = "/api/mp/events";

/** Was ein Analytics-Export als Inhaltstyp mitbringt — XLSX, CSV oder roh. */
const EXPORT_TYPES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "application/vnd.ms-excel"];
const EXPORT_MAX_BYTES = 8 * 1024 * 1024;

export function loopRoutes(app: FastifyInstance, db: Db, env: Env, getCtx: () => FullContext | null): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;
  const noKey = (reply: FastifyReply) => reply.code(503).send({ detail: "OPENROUTER_API_KEY fehlt in der .env." });

  // --- community -------------------------------------------------------------
  r.get("/api/mp/projects/:projectId/community", { schema: { params: P, response: { 200: s.CommunityView, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    let sources = loadSources(db, req.params.projectId);
    if (!sources.length) sources = deriveSources(listPersonas({ db } as never, req.params.projectId), listChannels({ db } as never, req.params.projectId));
    const th = credentialsFor(db, req.params.projectId, "threads");
    const ig = credentialsFor(db, req.params.projectId, "instagram");
    const threadsBereit = Boolean(th["accessToken"] && th["userId"]);
    return {
      leads: listLeads(db, req.params.projectId), sources,
      lastScanAt: lastScanAt(db, req.params.projectId), scanning: isScanning(db, req.params.projectId),
      redditAuth: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
      threadsBereit, instagramBereit: Boolean(ig["accessToken"] && ig["igUserId"]),
      // Das Budget kostet einen Aufruf und ist die einzige Zahl, die vor dem
      // Senden zählt — ohne sie merkt man das Limit erst am Fehlschlag.
      antwortBudget: threadsBereit ? await antwortBudget(fetch, th["userId"]!, th["accessToken"]!) : null,
      llmGesperrt: env.MP_LLM_PAUSED && !env.MP_LLM_KOMMENTARE,
    };
  });

  /**
   * Einen freigegebenen Entwurf tatsächlich senden.
   *
   * Nur dort, wo die Plattform es zulässt (zurzeit Threads). Der Text kommt aus
   * dem Rumpf, nicht aus der Datenbank: was in der Freigabe steht, kann gerade
   * bearbeitet worden sein, und gesendet wird, was man gesehen hat.
   */
  r.post("/api/mp/community/:id/post", {
    schema: { params: s.IdParams, body: z.object({ text: z.string().min(1).max(500) }), response: { 200: s.CommunityPostErgebnis, 400: s.ErrorBody, 404: s.ErrorBody, 409: s.ErrorBody } },
  }, async (req, reply) => {
    const lead = getLead(db, req.params.id);
    if (!lead) return reply.code(404).send({ detail: "Eintrag nicht gefunden." });
    if (lead.status === "answered") return reply.code(409).send({ detail: "Diese Antwort wurde schon gesendet." });
    if (!kannSelbstAntworten(lead.platform)) return reply.code(400).send({ detail: `Auf ${lead.platform} kann der Pilot nicht selbst kommentieren — Text kopieren und von Hand posten.` });
    const replyToId = String((lead.meta as { externalId?: string }).externalId ?? "");
    if (!replyToId) return reply.code(400).send({ detail: "Zu diesem Eintrag fehlt die Beitrags-Kennung — er stammt aus einem Lauf vor dem Kommentar-Umbau." });
    const c = credentialsFor(db, lead.projectId, "threads");
    if (!c["accessToken"] || !c["userId"]) return reply.code(400).send({ detail: "Threads-Zugang fehlt (Kanäle → Threads)." });
    try {
      const out = await antworteAufThread({ f: fetch, userId: c["userId"], token: c["accessToken"], replyToId, text: req.body.text });
      const aktualisiert = updateLead(db, lead.id, { draftReply: req.body.text, status: "answered", externalUrl: out.permalink ?? "" })!;
      writeAudit(db, { user: req.user, action: "community.posted", entityType: "community_lead", entityId: lead.id, projectId: lead.projectId, content: { url: lead.url, antwort: req.body.text.slice(0, 500), permalink: out.permalink } });
      return { lead: aktualisiert, externalUrl: out.permalink };
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ detail: rechteHinweis(text) ?? text });
    }
  });

  r.put("/api/mp/projects/:projectId/community/sources", { schema: { params: P, body: z.array(s.CommunitySource), response: { 200: z.array(s.CommunitySource) } } }, async (req) => {
    saveSources(db, req.params.projectId, req.body);
    writeAudit(db, { user: req.user, action: "community.sources", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { count: req.body.length } });
    return req.body;
  });

  r.post("/api/mp/projects/:projectId/community/scan", { schema: { params: P, querystring: z.object({ sync: z.coerce.boolean().default(false) }), response: { 202: s.Job, 200: z.object({ scanned: z.number(), scored: z.number(), leads: z.number(), warnings: z.array(z.string()) }), 400: s.ErrorBody, 404: s.ErrorBody, 409: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    if (req.query.sync) return reply.code(200).send(await scanCommunity(ctx, req.params.projectId));
    if (hasActiveJob(db, req.params.projectId, "community.scan")) return reply.code(409).send({ detail: "Scan läuft bereits." });
    if (!workerAlive(db)) return reply.code(400).send({ detail: "Der Worker läuft nicht - Scan nicht gestartet." });
    const job = enqueueJob(db, { projectId: req.params.projectId, kind: "community.scan", payload: { projectId: req.params.projectId }, steps: ["scan"] });
    writeAudit(db, { user: req.user, action: "community.scan", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { job: job.id } });
    return reply.code(202).send(job);
  });

  r.patch("/api/mp/community/:id", { schema: { params: s.IdParams, body: s.CommunityLeadPatch, response: { 200: s.CommunityLead, 404: s.ErrorBody } } }, async (req, reply) => {
    const lead = updateLead(db, req.params.id, req.body);
    if (!lead) return reply.code(404).send({ detail: "Lead nicht gefunden." });
    if (req.body.status === "answered") writeAudit(db, { user: req.user, action: "community.answered", entityType: "community_lead", entityId: lead.id, projectId: lead.projectId, content: { url: lead.url, answeredUrl: req.body.externalUrl ?? null, reply: lead.draftReply.slice(0, 4000) } });
    return lead;
  });

  // --- insights ----------------------------------------------------------------
  r.get("/api/mp/projects/:projectId/insights", { schema: { params: P, response: { 200: s.InsightsView, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return insightsView(db, req.params.projectId, Boolean(env.MP_EVENTS_TOKEN));
  });

  /**
   * Die Übersicht: Kanalzahlen, Beiträge, Klicks, Konten und Umsatz auf einer
   * Zeitachse. `tage` ist die Länge des Zeitraums; die gleich lange Vorperiode
   * wird für den Vergleich mitgerechnet.
   */
  r.get("/api/mp/projects/:projectId/cockpit", {
    schema: { params: P, querystring: z.object({ tage: z.coerce.number().int().min(7).max(365).default(30) }), response: { 200: s.CockpitView, 404: s.ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const view = cockpitView(db, req.params.projectId, { tage: req.query.tage, produktDbPfad: produktDbPfad(db, env, req.params.projectId) });
    return { ...view, kanalStatus: { ...view.kanalStatus, laeuft: hasActiveJob(db, req.params.projectId, "kanal.stats") } };
  });

  /**
   * Kanalzahlen aus einem Analytics-Export einspielen — für Plattformen ohne
   * Lese-API (TikTok). Ohne `speichern` nur deuten und zurückgeben, damit die
   * Oberfläche zeigen kann, was gespeichert würde; erst der zweite Aufruf
   * schreibt. Die Datei kommt roh im Body, der Name in der Query.
   */
  app.addContentTypeParser(EXPORT_TYPES, { parseAs: "buffer", bodyLimit: EXPORT_MAX_BYTES }, (_req, body, done) => done(null, body));
  r.post("/api/mp/projects/:projectId/kanal-stats/import", {
    bodyLimit: EXPORT_MAX_BYTES,
    schema: {
      params: P,
      querystring: z.object({ platform: z.string().min(1), name: z.string().min(1).max(200), speichern: z.coerce.boolean().default(false) }),
      response: { 200: s.KanalImportErgebnis, 400: s.ErrorBody, 404: s.ErrorBody, 415: s.ErrorBody },
    },
  }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const { platform, name, speichern } = req.query;
    if (!PLATFORMS[platform]) return reply.code(400).send({ detail: `Unbekannte Plattform: ${platform}` });
    if (MESSBARE_KANAELE.includes(platform)) return reply.code(400).send({ detail: `${PLATFORMS[platform]?.label} holt der Pilot selbst — ein Export würde die API-Zahlen überschreiben.` });
    const body = req.body;
    if (!Buffer.isBuffer(body)) return reply.code(415).send({ detail: "Die Datei muss roh gesendet werden (text/csv oder XLSX)." });
    if (!body.length) return reply.code(400).send({ detail: "Die Datei ist leer." });
    let deutung;
    try { deutung = liesExport(body, name, berlinTag(new Date())); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : String(e) }); }
    const gespeichert = speichern && deutung.tage.length ? speichereExport(db, req.params.projectId, platform, deutung.tage) : 0;
    if (gespeichert) writeAudit(db, { user: req.user, action: "kanal.import", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { platform, name, tage: gespeichert, von: deutung.tage[0]?.tag, bis: deutung.tage.at(-1)?.tag } });
    return { platform, tage: deutung.tage, erkannt: deutung.erkannt, unbekannt: deutung.unbekannt, hinweise: deutung.hinweise, gespeichert };
  });

  /** Die Kanalzahlen jetzt holen, statt auf den Tagestakt zu warten. */
  r.post("/api/mp/projects/:projectId/kanal-stats/run", { schema: { params: P, response: { 202: s.Job, 400: s.ErrorBody, 409: s.ErrorBody } } }, async (req, reply) => {
    if (!workerAlive(db)) return reply.code(400).send({ detail: "Der Worker läuft nicht (app-marketing-pilot-worker)." });
    if (hasActiveJob(db, req.params.projectId, "kanal.stats")) return reply.code(409).send({ detail: "Es läuft bereits ein Abruf." });
    const job = enqueueJob(db, { projectId: req.params.projectId, kind: "kanal.stats", payload: { projectId: req.params.projectId }, steps: KANAL_STEPS });
    return reply.code(202).send(getJob(db, job.id)!);
  });

  r.get("/api/mp/projects/:projectId/insights/snippet", { schema: { params: P, response: { 200: z.object({ snippet: z.string(), webhookUrl: z.string(), tokenConfigured: z.boolean() }) } } }, async (req) => {
    const webhookUrl = `${env.MP_PUBLIC_BASE.replace(/\/$/, "")}${EVENTS_PUBLIC_PATH}`;
    return { snippet: landingSnippet(webhookUrl, req.params.projectId), webhookUrl, tokenConfigured: Boolean(env.MP_EVENTS_TOKEN) };
  });

  /** Public webhook (Bearer MP_EVENTS_TOKEN or the browser snippet without token for `signup` beacons). */
  app.post(EVENTS_PUBLIC_PATH, async (req, reply) => {
    const body = z.object({ project: z.string().min(1) }).and(s.InboundEvent).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ detail: "Ungültiger Event-Body." });
    const auth = req.headers.authorization ?? "";
    const tokenOk = Boolean(env.MP_EVENTS_TOKEN) && auth === `Bearer ${env.MP_EVENTS_TOKEN}`;
    // Browser beacons carry no token; accept only `signup` from them and mark the source.
    if (!tokenOk && body.data.event !== "signup") return reply.code(401).send({ detail: "Token fehlt oder falsch." });
    if (!getProject(db, body.data.project)) return reply.code(404).send({ detail: "Projekt unbekannt." });
    const { id } = recordEvent(db, body.data.project, { ...body.data, meta: { ...(body.data.meta ?? {}), via: tokenOk ? "server" : "browser" } });
    return reply.code(201).send({ ok: true, id });
  });

  // --- weekly loop ------------------------------------------------------------
  r.get("/api/mp/projects/:projectId/reports", { schema: { params: P, response: { 200: z.array(s.WeeklyReport) } } }, async (req) => listReports(db, req.params.projectId));

  r.post("/api/mp/projects/:projectId/reports/run", { schema: { params: P, body: z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional(), response: { 201: s.WeeklyReport, 400: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    try { return reply.code(201).send(await runWeeklyReport(ctx, req.params.projectId, req.body?.weekStart)); }
    catch (e) { return reply.code(400).send({ detail: e instanceof Error ? e.message : String(e) }); }
  });

  r.post("/api/mp/reports/:id/adopt", { schema: { params: s.IdParams, response: { 200: z.object({ report: s.WeeklyReport, version: z.number().int(), tasks: z.number().int() }), 404: s.ErrorBody, 409: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    return adoptReport(ctx, req.params.id, req.user);
  });

  r.post("/api/mp/reports/:id/dismiss", { schema: { params: s.IdParams, response: { 200: s.WeeklyReport, 404: s.ErrorBody } } }, async (req, reply) => {
    const r2 = dismissReport(db, req.params.id, req.user);
    return r2 ?? reply.code(404).send({ detail: "Report nicht gefunden oder bereits entschieden." });
  });

}
