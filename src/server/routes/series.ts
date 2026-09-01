/**
 * Serien-Endpunkte (Shot 9). Angelegt und geändert wird sofort, **erzeugt wird
 * über den Worker** — hinter einem Lauf steht ein Modellaufruf und womöglich ein
 * Videorender, das gehört nicht in einen HTTP-Request.
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import type { Db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import { getProject } from "../repo/projects.js";
import { enqueueJob, getJob, hasActiveJob, workerAlive } from "../jobs.js";
import { loadDataSource } from "../data-source.js";
import { SERIES_CATALOG } from "../agents/series/catalog.js";
import { createSeries, deleteSeries, getSeries, listSeries, patchSeries } from "../agents/series/series.js";
import { SERIES_STEPS } from "../agents/series/job.js";

export function seriesRoutes(app: FastifyInstance, db: Db): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  r.get("/api/mp/projects/:projectId/series", { schema: { params: P, response: { 200: s.SeriesView, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return {
      series: listSeries(db, req.params.projectId),
      catalog: SERIES_CATALOG,
      hasData: loadDataSource(db, req.params.projectId).provider !== "none",
      workerAlive: workerAlive(db),
    };
  });

  r.post("/api/mp/projects/:projectId/series", { schema: { params: P, body: s.SeriesCreate, response: { 201: s.ContentSeries, 400: s.ErrorBody, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.projectId)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    if (loadDataSource(db, req.params.projectId).provider === "none") return reply.code(400).send({ detail: "Serien brauchen eine Produktdatenquelle — unter „Produktdaten“ eine auswählen." });
    const series = createSeries(db, req.params.projectId, req.body);
    writeAudit(db, { user: req.user, action: "series.create", entityType: "series", entityId: series.id, projectId: series.projectId, content: { name: series.name, kind: series.kind, cadence: series.cadence } });
    return reply.code(201).send(series);
  });

  r.patch("/api/mp/series/:id", { schema: { params: s.IdParams, body: s.SeriesPatch, response: { 200: s.ContentSeries, 400: s.ErrorBody, 404: s.ErrorBody } } }, async (req, reply) => {
    if (!getSeries(db, req.params.id)) return reply.code(404).send({ detail: "Serie nicht gefunden." });
    const series = patchSeries(db, req.params.id, req.body);
    writeAudit(db, { user: req.user, action: "series.edit", entityType: "series", entityId: series.id, projectId: series.projectId, content: { fields: Object.keys(req.body), status: series.status } });
    return series;
  });

  r.delete("/api/mp/series/:id", { schema: { params: s.IdParams, response: { 200: z.object({ deleted: z.boolean() }), 404: s.ErrorBody } } }, async (req, reply) => {
    const series = getSeries(db, req.params.id);
    if (!series) return reply.code(404).send({ detail: "Serie nicht gefunden." });
    deleteSeries(db, req.params.id);
    writeAudit(db, { user: req.user, action: "series.delete", entityType: "series", entityId: series.id, projectId: series.projectId, content: { name: series.name } });
    return { deleted: true };
  });

  /** „Jetzt ausführen" bzw. „Vorschau erzeugen" — beides derselbe Lauf, nur verbraucht die Vorschau die Rotation nicht. */
  r.post("/api/mp/series/:id/run", {
    schema: { params: s.IdParams, body: z.object({ preview: z.boolean().default(false) }), response: { 202: s.Job, 400: s.ErrorBody, 404: s.ErrorBody, 409: s.ErrorBody } },
  }, async (req, reply) => {
    const series = getSeries(db, req.params.id);
    if (!series) return reply.code(404).send({ detail: "Serie nicht gefunden." });
    if (!workerAlive(db)) return reply.code(400).send({ detail: "Der Render-Worker läuft nicht (app-marketing-pilot-worker) — der Lauf wurde nicht gestartet." });
    if (hasActiveJob(db, series.projectId, "series.run")) return reply.code(409).send({ detail: "Für dieses Projekt läuft bereits ein Serien-Lauf." });
    const job = enqueueJob(db, { projectId: series.projectId, kind: "series.run", payload: { seriesId: series.id, preview: req.body.preview }, steps: SERIES_STEPS });
    writeAudit(db, { user: req.user, action: req.body.preview ? "series.preview" : "series.runNow", entityType: "series", entityId: series.id, projectId: series.projectId, content: { job: job.id } });
    return reply.code(202).send(getJob(db, job.id)!);
  });
}
