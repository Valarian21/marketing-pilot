/** Analysis endpoints: run pipeline, read the combined view, edit/confirm the brief, serve assets. */
import path from "node:path";
import fs from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import { getProject } from "../repo/projects.js";
import { isRunning, latestRun, startAnalysis, type PipelineContext } from "../agents/analysis/pipeline.js";
import { renderBriefMarkdown } from "../agents/analysis/brief.js";
import { listCompetitors } from "../agents/analysis/competitors.js";
import { listPersonas } from "../agents/analysis/personas.js";
import { listChannels } from "../agents/analysis/attention.js";

export function buildAnalysisView(ctx: PipelineContext, projectId: string): s.AnalysisView | null {
  const project = getProject(ctx.db, projectId);
  if (!project) return null;
  const raw = ctx.db.select({ briefMeta: t.mpProjects.briefMeta, briefMarkdown: t.mpProjects.briefMarkdown }).from(t.mpProjects).where(eq(t.mpProjects.id, projectId)).get();
  const briefParsed = s.Brief.safeParse(project.brief);
  const briefMeta = s.BriefMeta.parse(parseJson<Record<string, unknown>>(raw?.briefMeta ?? "{}", {}));
  const pages = ctx.db.select({ id: t.mpPages.id, projectId: t.mpPages.projectId, url: t.mpPages.url, title: t.mpPages.title, kind: t.mpPages.kind, status: t.mpPages.status, fetchedAt: t.mpPages.fetchedAt, text: t.mpPages.text })
    .from(t.mpPages).where(eq(t.mpPages.projectId, projectId)).all()
    .map(({ text, ...p }) => ({ ...p, kind: p.kind as s.PageKind, textLength: text.length }));
  const screenshots = ctx.db.select().from(t.mpAssets).where(and(eq(t.mpAssets.projectId, projectId), eq(t.mpAssets.kind, "screenshot"))).all()
    .map((a) => ({ ...a, kind: a.kind as s.Asset["kind"], meta: parseJson<Record<string, unknown>>(a.meta, {}) }));
  const latestGeo = ctx.db.select({ batch: t.mpGeoSnapshots.batch }).from(t.mpGeoSnapshots).where(eq(t.mpGeoSnapshots.projectId, projectId)).orderBy(desc(t.mpGeoSnapshots.takenAt)).limit(1).get();
  const snapshots = latestGeo
    ? ctx.db.select().from(t.mpGeoSnapshots).where(and(eq(t.mpGeoSnapshots.projectId, projectId), eq(t.mpGeoSnapshots.batch, latestGeo.batch))).all()
      .map((g) => ({ ...g, competitorsMentioned: parseJson<string[]>(g.competitorsMentioned, []) }))
    : [];
  const models = [...new Set(snapshots.map((x) => x.engine))];
  const perModel = models.map((m) => { const xs = snapshots.filter((x) => x.engine === m); return { model: m, asked: xs.length, mentioned: xs.filter((x) => x.mentioned).length }; });
  return {
    run: latestRun(ctx.db, projectId),
    brief: briefParsed.success ? briefParsed.data : null,
    briefMeta,
    briefMarkdown: raw?.briefMarkdown ?? "",
    personas: listPersonas(ctx, projectId),
    channels: listChannels(ctx, projectId),
    competitors: listCompetitors(ctx, projectId),
    pages, screenshots,
    geo: { snapshots, models, visibility: snapshots.length ? snapshots.filter((x) => x.mentioned).length / snapshots.length : null, perModel, batch: latestGeo?.batch ?? null },
  };
}

export function analysisRoutes(app: FastifyInstance, db: Db, getCtx: () => PipelineContext | null): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  r.post("/api/mp/projects/:projectId/analysis/run", {
    schema: { params: P, response: { 202: s.AnalysisRun, 400: s.ErrorBody, 404: s.ErrorBody, 409: s.ErrorBody, 503: s.ErrorBody } },
  }, async (req, reply) => {
    // Body is optional ({} or absent); parse by hand so a bare POST works too.
    const parsedBody = s.AnalysisStart.safeParse(req.body ?? {});
    if (!parsedBody.success) return reply.code(400).send({ detail: "Ungültiger Schritt in „from“." });
    const project = getProject(db, req.params.projectId);
    if (!project) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const ctx = getCtx();
    if (!ctx) return reply.code(503).send({ detail: "OPENROUTER_API_KEY fehlt in der .env - ohne Modellzugang keine Analyse." });
    if (isRunning(project.id)) return reply.code(409).send({ detail: "Für dieses Projekt läuft bereits eine Analyse." });
    const from = parsedBody.data.from;
    const { run } = startAnalysis(ctx, project.id, from ? { from } : {});
    writeAudit(db, { user: req.user, action: "analysis.start", entityType: "analysis_run", entityId: run.id, projectId: project.id, content: { from: from ?? "crawl" } });
    return reply.code(202).send(run);
  });

  r.get("/api/mp/projects/:projectId/analysis", { schema: { params: P, response: { 200: s.AnalysisView, 404: s.ErrorBody } } }, async (req, reply) => {
    const ctx = getCtx() ?? { db } as unknown as PipelineContext;
    const view = buildAnalysisView({ ...ctx, db }, req.params.projectId);
    return view ?? reply.code(404).send({ detail: "Projekt nicht gefunden." });
  });

  r.patch("/api/mp/projects/:projectId/brief", { schema: { params: P, body: s.BriefPatch, response: { 200: s.AnalysisView, 400: s.ErrorBody, 404: s.ErrorBody } } }, async (req, reply) => {
    const project = getProject(db, req.params.projectId);
    if (!project) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const current = s.Brief.safeParse(project.brief);
    if (!current.success) return reply.code(400).send({ detail: "Noch kein Brief vorhanden - erst die Analyse ausführen." });
    const changed = (Object.keys(req.body) as (keyof s.BriefPatch)[]).filter((k) => JSON.stringify(req.body[k]) !== JSON.stringify(current.data[k]));
    const merged: s.Brief = { ...current.data, ...req.body } as s.Brief;
    const raw = db.select({ briefMeta: t.mpProjects.briefMeta }).from(t.mpProjects).where(eq(t.mpProjects.id, project.id)).get();
    const meta = s.BriefMeta.parse(parseJson<Record<string, unknown>>(raw?.briefMeta ?? "{}", {}));
    if (changed.length) {
      meta.userEdited = true; meta.editedAt = nowIso();
      meta.editedFields = [...new Set([...meta.editedFields, ...changed.map(String)])];
    }
    db.update(t.mpProjects).set({ brief: toJson(merged), briefMeta: toJson(meta), briefMarkdown: renderBriefMarkdown(merged), updatedAt: nowIso() }).where(eq(t.mpProjects.id, project.id)).run();
    if (changed.length) writeAudit(db, { user: req.user, action: "brief.edit", entityType: "project", entityId: project.id, projectId: project.id, content: { fields: changed } });
    return buildAnalysisView({ ...(getCtx() ?? {}), db } as PipelineContext, project.id)!;
  });

  r.post("/api/mp/projects/:projectId/brief/confirm", { schema: { params: P, response: { 200: s.AnalysisView, 400: s.ErrorBody, 404: s.ErrorBody } } }, async (req, reply) => {
    const project = getProject(db, req.params.projectId);
    if (!project) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    if (!s.Brief.safeParse(project.brief).success) return reply.code(400).send({ detail: "Noch kein Brief vorhanden." });
    const raw = db.select({ briefMeta: t.mpProjects.briefMeta }).from(t.mpProjects).where(eq(t.mpProjects.id, project.id)).get();
    const meta = s.BriefMeta.parse(parseJson<Record<string, unknown>>(raw?.briefMeta ?? "{}", {}));
    meta.confirmedAt = nowIso();
    db.update(t.mpProjects).set({ briefMeta: toJson(meta), status: project.status === "draft" ? "active" : project.status, updatedAt: nowIso() }).where(eq(t.mpProjects.id, project.id)).run();
    writeAudit(db, { user: req.user, action: "brief.confirm", entityType: "project", entityId: project.id, projectId: project.id, content: { userEdited: meta.userEdited } });
    return buildAnalysisView({ ...(getCtx() ?? {}), db } as PipelineContext, project.id)!;
  });

  r.get("/api/mp/assets/:id/file", { schema: { params: s.IdParams } }, async (req, reply) => {
    const asset = db.select().from(t.mpAssets).where(eq(t.mpAssets.id, req.params.id)).get();
    if (!asset) return reply.code(404).send({ detail: "Asset nicht gefunden." });
    const ctx = getCtx();
    const dataDir = ctx?.dataDir ?? process.env["MP_DATA_DIR"] ?? "";
    const abs = path.resolve(dataDir, asset.path);
    if (!abs.startsWith(path.resolve(dataDir) + path.sep) || !fs.existsSync(abs)) return reply.code(404).send({ detail: "Datei fehlt." });
    const ext = path.extname(abs).toLowerCase();
    const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".html": "text/html; charset=utf-8" };
    const type = mime[ext] ?? "application/octet-stream";
    const size = fs.statSync(abs).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    reply.header("Accept-Ranges", "bytes").header("Content-Disposition", `inline; filename="${path.basename(abs)}"`);
    if (range && size > 0) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : Math.min(start + 4 * 1024 * 1024, size - 1);
      if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
      return reply.code(206).type(type).header("Content-Range", `bytes ${start}-${end}/${size}`).header("Content-Length", String(end - start + 1)).send(fs.createReadStream(abs, { start, end }));
    }
    return reply.type(type).header("Content-Length", String(size)).send(fs.createReadStream(abs));
  });

  r.get("/api/mp/projects/:projectId/pages/:id", { schema: { params: P.extend({ id: z.string() }), response: { 200: z.object({ id: z.string(), url: z.string(), title: z.string(), text: z.string() }), 404: s.ErrorBody } } }, async (req, reply) => {
    const p = db.select().from(t.mpPages).where(and(eq(t.mpPages.projectId, req.params.projectId), eq(t.mpPages.id, req.params.id))).get();
    return p ? { id: p.id, url: p.url, title: p.title, text: p.text } : reply.code(404).send({ detail: "Seite nicht gefunden." });
  });
}
