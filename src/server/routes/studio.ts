/** Content Studio endpoints: brand kit, voice profile, generation, regeneration, publish package, directories, export. */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { newId, nowIso, toJson, type Db } from "../db/index.js";
import { finishRun, startRun, writeAudit } from "../audit.js";
import { getProject } from "../repo/projects.js";
import { extractBrandKit, loadBrandKit, saveBrandKit } from "../agents/studio/brandkit.js";
import { deriveVoiceProfile } from "../agents/studio/voice.js";
import { buildPackage, directoriesFor, generateContent, getPiece, pieceOf, regenerateContent, studioView, withCosts, type StudioContext } from "../agents/studio/generate.js";
import { bundlePieces, suggestHashtagPools } from "../agents/studio/data-content.js";
import { loadHashtags, saveHashtags } from "../hashtags.js";
import { listPersonas } from "../agents/analysis/personas.js";
import { planChannelNames } from "../channels.js";
import { revisePiece } from "../agents/revise.js";

export function studioRoutes(app: FastifyInstance, db: Db, getCtx: () => StudioContext | null): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;
  const noKey = (reply: FastifyReply) => reply.code(503).send({ detail: "OPENROUTER_API_KEY fehlt in der .env." });
  const fallbackCtx = (): StudioContext => (getCtx() ?? ({ db, dataDir: process.env["MP_DATA_DIR"] ?? "./data", publish: { name: "manual" } } as unknown as StudioContext));

  r.get("/api/mp/projects/:projectId/studio", { schema: { params: P, response: { 200: s.StudioView, 404: s.ErrorBody } } }, async (req, reply) =>
    studioView({ ...fallbackCtx(), db }, req.params.projectId) ?? reply.code(404).send({ detail: "Projekt nicht gefunden." }));

  r.post("/api/mp/projects/:projectId/brandkit/extract", { schema: { params: P, response: { 200: s.BrandKit, 404: s.ErrorBody } } }, async (req, reply) => {
    const project = getProject(db, req.params.projectId);
    if (!project) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const ctx = getCtx();
    const runId = startRun(db, { task: "studio.brandkit", model: null, projectId: project.id });
    try {
      const kit = await extractBrandKit(db, fallbackCtx().dataDir, project, ctx?.brandExtractor);
      finishRun(db, runId, { resultRef: `brandkit:${project.id}` });
      writeAudit(db, { user: req.user, action: "brandkit.extract", entityType: "project", entityId: project.id, projectId: project.id, content: { primary: kit.primary, colors: kit.colors.length } });
      return kit;
    } catch (e) { finishRun(db, runId, { error: e instanceof Error ? e.message : String(e) }); throw e; }
  });

  r.patch("/api/mp/projects/:projectId/brandkit", { schema: { params: P, body: s.BrandKitPatch, response: { 200: s.BrandKit } } }, async (req) => {
    const patch = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined)) as Partial<s.BrandKit>;
    const kit: s.BrandKit = { ...loadBrandKit(db, req.params.projectId), ...patch };
    saveBrandKit(db, req.params.projectId, kit);
    writeAudit(db, { user: req.user, action: "brandkit.edit", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { fields: Object.keys(req.body) } });
    return kit;
  });

  r.post("/api/mp/projects/:projectId/voice/samples", { schema: { params: P, body: s.VoiceSampleCreate, response: { 201: s.BrandKit, 400: s.ErrorBody } } }, async (req, reply) => {
    const kit = loadBrandKit(db, req.params.projectId);
    if (kit.voiceSamples.length >= 30) return reply.code(400).send({ detail: "Maximal 30 Texte." });
    kit.voiceSamples.push({ id: newId(), text: req.body.text, source: req.body.source, addedAt: nowIso() });
    saveBrandKit(db, req.params.projectId, kit);
    return reply.code(201).send(kit);
  });

  r.delete("/api/mp/projects/:projectId/voice/samples/:sampleId", { schema: { params: P.extend({ sampleId: z.string() }), response: { 200: s.BrandKit } } }, async (req) => {
    const kit = loadBrandKit(db, req.params.projectId);
    kit.voiceSamples = kit.voiceSamples.filter((x) => x.id !== req.params.sampleId);
    saveBrandKit(db, req.params.projectId, kit);
    return kit;
  });

  r.post("/api/mp/projects/:projectId/voice/derive", { schema: { params: P, response: { 200: s.VoiceProfile, 400: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    const project = getProject(db, req.params.projectId);
    const brief = s.Brief.safeParse(project?.brief);
    if (!brief.success) return reply.code(400).send({ detail: "Erst die Analyse ausführen (Brief nötig)." });
    const profile = await deriveVoiceProfile(ctx, req.params.projectId, brief.data);
    writeAudit(db, { user: req.user, action: "voice.derive", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { samples: profile.sampleCount } });
    return profile;
  });

  r.post("/api/mp/projects/:projectId/content", { schema: { params: P, body: s.ContentRequest, response: { 201: s.ContentPiece, 400: s.ErrorBody, 404: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    return reply.code(201).send(await generateContent(ctx, req.params.projectId, req.body, req.user));
  });

  r.post("/api/mp/content/:id/regenerate", { schema: { params: s.IdParams, body: s.RegenerateRequest, response: { 200: s.ContentPiece, 400: s.ErrorBody, 404: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    return regenerateContent(ctx, req.params.id, req.body.hint, req.user);
  });

  /** "Ändere …": one instruction, the agent edits the piece (text) or the script + re-renders (video). */
  r.post("/api/mp/content/:id/revise", { schema: { params: s.IdParams, body: z.object({ instruction: z.string().trim().min(3).max(2000) }), response: { 200: z.object({ piece: s.ContentPiece, changed: z.string(), job: s.Job.nullable(), needsRecording: z.boolean() }), 400: s.ErrorBody, 404: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    return revisePiece(ctx, req.params.id, req.body.instruction, req.user);
  });

  r.get("/api/mp/content/:id/package", { schema: { params: s.IdParams, response: { 200: s.PublishPackage, 404: s.ErrorBody } } }, async (req, reply) => {
    const piece = getPiece(db, req.params.id);
    if (!piece) return reply.code(404).send({ detail: "Stück nicht gefunden." });
    return buildPackage({ ...fallbackCtx(), db }, piece);
  });

  r.post("/api/mp/content/:id/schedule", { schema: { params: s.IdParams, body: s.ScheduleRequest, response: { 200: s.ContentPiece, 400: s.ErrorBody, 404: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx();
    const piece = getPiece(db, req.params.id);
    if (!piece) return reply.code(404).send({ detail: "Stück nicht gefunden." });
    if (!ctx || ctx.publish.name !== "postiz") return reply.code(400).send({ detail: "Postiz ist nicht konfiguriert (MP_PUBLISH_PROVIDER=postiz, POSTIZ_API_URL, POSTIZ_API_KEY)." });
    if (piece.status !== "approved") return reply.code(400).send({ detail: "Nur freigegebene Stücke können geplant werden." });
    const pkg = buildPackage(ctx, piece);
    const res = await ctx.publish.prepare({ contentPieceId: piece.id, platform: pkg.platform, body: pkg.text, assetPaths: [], scheduledAt: req.body.date });
    db.update(t.mpContentPieces).set({ meta: toJson({ ...piece.meta, scheduledAt: res.scheduledAt, scheduledVia: "postiz" }), updatedAt: nowIso() }).where(eq(t.mpContentPieces.id, piece.id)).run();
    writeAudit(db, { user: req.user, action: "content.schedule", entityType: "content_piece", entityId: piece.id, projectId: piece.projectId, content: { platform: pkg.platform, date: res.scheduledAt, body: pkg.text.slice(0, 4000) } });
    return getPiece(db, piece.id)!;
  });

  app.get("/api/mp/content/:id/export.html", async (req, reply) => {
    const piece = getPiece(db, (req.params as { id: string }).id);
    const rel = piece?.meta["htmlPath"];
    const dataDir = fallbackCtx().dataDir;
    if (!piece || typeof rel !== "string") return reply.code(404).send({ detail: "Kein HTML-Export für dieses Stück." });
    const abs = path.resolve(dataDir, rel);
    if (!abs.startsWith(path.resolve(dataDir) + path.sep) || !fs.existsSync(abs)) return reply.code(404).send({ detail: "Datei fehlt." });
    return reply.type("text/html; charset=utf-8").header("Content-Disposition", `attachment; filename="${String(piece.meta["slug"] ?? "artikel")}.html"`).send(fs.readFileSync(abs, "utf8"));
  });

  // --- Hashtag-Vorraete (Shot 7) --------------------------------------------
  // Wie viele Tags ein Stueck traegt, entscheidet die Plattform-Politik in
  // shared/channels.ts. Hier steht nur, aus welchem Vorrat sie kommen duerfen.

  r.get("/api/mp/projects/:projectId/hashtags", { schema: { params: P, response: { 200: s.HashtagPools } } }, async (req) => loadHashtags(db, req.params.projectId));

  r.put("/api/mp/projects/:projectId/hashtags", { schema: { params: P, body: s.HashtagPools, response: { 200: s.HashtagPools } } }, async (req) => {
    const saved = saveHashtags(db, req.params.projectId, req.body);
    writeAudit(db, { user: req.user, action: "hashtags.edit", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, content: { brand: saved.brand.length, topics: Object.keys(saved.topics).length } });
    return saved;
  });

  r.post("/api/mp/projects/:projectId/hashtags/suggest", { schema: { params: P, response: { 200: s.HashtagPools, 400: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    const project = getProject(db, req.params.projectId);
    const brief = s.Brief.safeParse(project?.brief);
    if (!brief.success) return reply.code(400).send({ detail: "Erst die Analyse ausführen (Brief nötig)." });
    return suggestHashtagPools(ctx, req.params.projectId, { brief: brief.data, personas: listPersonas(ctx, req.params.projectId), channels: planChannelNames(db, req.params.projectId) });
  });

  // --- Buendel (Shot 7): ein Lauf, mehrere Plattform-Stuecke -----------------

  r.get("/api/mp/content/:id/bundle", { schema: { params: s.IdParams, response: { 200: z.array(s.ContentPiece), 404: s.ErrorBody } } }, async (req, reply) => {
    const piece = getPiece(db, req.params.id);
    if (!piece) return reply.code(404).send({ detail: "Stück nicht gefunden." });
    const bundleId = String(piece.meta["bundleId"] ?? "");
    if (!bundleId) return [piece];
    return withCosts(db, bundlePieces(db, piece.projectId, bundleId).map(pieceOf));
  });

  /** „Alle freigeben“: ein Klick, ein Audit-Eintrag, statt vier einzelner PATCHes. */
  r.post("/api/mp/content/:id/bundle/status", { schema: { params: s.IdParams, body: z.object({ status: z.enum(["approved", "rejected"]), reason: z.string().default("") }), response: { 200: z.array(s.ContentPiece), 400: s.ErrorBody, 404: s.ErrorBody } } }, async (req, reply) => {
    const piece = getPiece(db, req.params.id);
    if (!piece) return reply.code(404).send({ detail: "Stück nicht gefunden." });
    const bundleId = String(piece.meta["bundleId"] ?? "");
    if (!bundleId) return reply.code(400).send({ detail: "Dieses Stück gehört zu keinem Bündel." });
    if (req.body.status === "rejected" && !req.body.reason.trim()) return reply.code(400).send({ detail: "Ablehnen braucht einen Grund." });
    const rows = bundlePieces(db, piece.projectId, bundleId).filter((x) => x.status !== "published");
    const ts = nowIso();
    for (const row of rows) {
      db.update(t.mpContentPieces).set({ status: req.body.status, rejectionReason: req.body.reason, updatedAt: ts }).where(eq(t.mpContentPieces.id, row.id)).run();
    }
    writeAudit(db, { user: req.user, action: `content.bundle.${req.body.status}`, entityType: "content_piece", entityId: bundleId, projectId: piece.projectId, content: { pieces: rows.map((x) => x.id), platforms: rows.map((x) => x.channel), reason: req.body.reason } });
    return withCosts(db, bundlePieces(db, piece.projectId, bundleId).map(pieceOf));
  });

  r.get("/api/mp/projects/:projectId/directories", { schema: { params: P, response: { 200: z.array(s.DirectoryDef) } } }, async (req) => directoriesFor(db, req.params.projectId));

  r.put("/api/mp/projects/:projectId/directories", { schema: { params: P, body: z.array(s.DirectoryDef), response: { 200: z.array(s.DirectoryDef) } } }, async (req) => {
    const key = `directories:${req.params.projectId}`;
    db.insert(t.mpSettings).values({ key, value: toJson(req.body), updatedAt: nowIso() }).onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(req.body), updatedAt: nowIso() } }).run();
    return req.body;
  });

  r.post("/api/mp/projects/:projectId/directories/:slug/prepare", { schema: { params: P.extend({ slug: z.string() }), response: { 201: s.ContentPiece, 400: s.ErrorBody, 503: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx(); if (!ctx) return noKey(reply);
    return reply.code(201).send(await generateContent(ctx, req.params.projectId, s.ContentRequest.parse({ format: "directory_entry", directory: req.params.slug }), req.user));
  });
}
