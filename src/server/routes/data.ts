/**
 * Produktdaten-Endpunkte (Shot 6): Status der Datenquelle, Auswahl des Providers
 * und eine Vorschau der Ranglisten zum Verifizieren, bevor daraus Slides werden.
 *
 * Die Vorschau laeuft synchron. Ein ganzes Set (150–250 Karten) ist in unter zwei
 * Minuten bepreist, eine Aera laedt nur ihre Spitzenkandidaten nach – dafuer
 * lohnt keine Job-Queue, und der Nutzer sieht das Ergebnis sofort. Der Deckel
 * dagegen steckt im Provider (`maxRefresh`), nicht in einem Timeout.
 */
import fs from "node:fs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { DataPreview, DataSource, ErrorBody, IdParams, ProductDataView } from "../../shared/schemas.js";
import { getProject } from "../repo/projects.js";
import { createProductDataProvider, loadDataSource, saveDataSource, unavailableStatus } from "../data-source.js";
import { writeAudit } from "../audit.js";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";

const PreviewQuery = z.object({
  kind: z.enum(["top", "movers"]).default("top"),
  set: z.string().optional(),
  era: z.string().optional(),
  region: z.enum(["intl", "jp"]).default("intl"),
  n: z.coerce.number().int().min(1).max(50).default(15),
  basis: z.enum(["max", "normal", "holo"]).default("max"),
  minPrice: z.coerce.number().min(0).optional(),
  days: z.coerce.number().int().refine((v) => v === 7 || v === 30, "days muss 7 oder 30 sein").default(7),
  direction: z.enum(["up", "down"]).default("up"),
  minBaseEur: z.coerce.number().min(0).default(5),
});

export function dataRoutes(app: FastifyInstance, db: Db, env: Env): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Status + Auswahllisten in einem Rutsch – die Einstellungs-Karte braucht alles zusammen. */
  r.get("/api/mp/projects/:id/data", {
    schema: { params: IdParams, response: { 200: ProductDataView, 404: ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.id)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const source = loadDataSource(db, req.params.id);
    const provider = createProductDataProvider(db, env, req.params.id, { log: (m) => app.log.info(m) });
    if (!provider) return { source, status: unavailableStatus(db, env, req.params.id), sets: [], eras: [] };
    try {
      return {
        source,
        status: await provider.status(),
        // Nur Sets mit Karten – leere Vorab-Eintraege waeren im Auswahlfeld nur Rauschen.
        sets: provider.listSets().filter((s) => s.total > 0),
        eras: provider.listEras().filter((e) => e.setCount > 0),
      };
    } finally { provider.close(); }
  });

  r.put("/api/mp/projects/:id/data-source", {
    schema: { params: IdParams, body: DataSource, response: { 200: DataSource, 404: ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.id)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const saved = saveDataSource(db, req.params.id, req.body);
    writeAudit(db, { user: req.user, action: "project.dataSource", entityType: "project", entityId: req.params.id,
      projectId: req.params.id, content: { provider: saved.provider } });
    return saved;
  });

  r.get("/api/mp/projects/:id/data/preview", {
    schema: { params: IdParams, querystring: PreviewQuery, response: { 200: DataPreview, 400: ErrorBody, 404: ErrorBody, 503: ErrorBody } },
  }, async (req, reply) => {
    if (!getProject(db, req.params.id)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const provider = createProductDataProvider(db, env, req.params.id, { log: (m) => app.log.info(m) });
    if (!provider) return reply.code(503).send({ detail: unavailableStatus(db, env, req.params.id).detail });
    const q = req.query;
    const started = Date.now();
    try {
      if (q.kind === "movers") {
        const res = await provider.priceMovers({ days: q.days as 7 | 30, direction: q.direction, minBaseEur: q.minBaseEur, n: q.n, region: q.region });
        return { kind: "movers" as const, cards: res.cards, scopeLabel: res.scopeLabel, scopeLabelEn: "", totalEur: 0,
          priceStand: res.priceStand, coverage: null, withHistory: res.withHistory, tookMs: Date.now() - started };
      }
      if (!q.set && !q.era) return reply.code(400).send({ detail: "Bereich fehlt: set oder era angeben." });
      const res = await provider.topCards({
        scope: { ...(q.set ? { set: q.set } : {}), ...(q.era ? { era: q.era } : {}), region: q.region },
        n: q.n, priceBasis: q.basis, ...(q.minPrice !== undefined ? { minPrice: q.minPrice } : {}),
      });
      return { kind: "top" as const, cards: res.cards, scopeLabel: res.scopeLabel, scopeLabelEn: res.scopeLabelEn,
        totalEur: res.totalEur, priceStand: res.priceStand, coverage: res.coverage, withHistory: 0, tookMs: Date.now() - started };
    } catch (e) {
      return reply.code(400).send({ detail: e instanceof Error ? e.message : "Vorschau fehlgeschlagen." });
    } finally { provider.close(); }
  });

  /** Kartenbild fuer die Vorschau. Laedt beim ersten Aufruf in den lokalen Cache. */
  r.get("/api/mp/projects/:id/data/card-image/:cardId", {
    schema: {
      params: z.object({ id: z.string(), cardId: z.string() }),
      querystring: z.object({ lang: z.enum(["de", "en"]).default("de") }),
    },
  }, async (req, reply) => {
    const provider = createProductDataProvider(db, env, req.params.id, { log: (m) => app.log.info(m) });
    if (!provider) return reply.code(503).send({ detail: "Keine Datenquelle." });
    try {
      const file = await provider.cardImage(req.params.cardId, req.query.lang);
      if (!file) return reply.code(404).send({ detail: "Kartenbild nicht gefunden." });
      return reply.header("Cache-Control", "public, max-age=86400")
        .type(file.endsWith(".png") ? "image/png" : "image/webp")
        .send(fs.createReadStream(file));
    } finally { provider.close(); }
  });
}
