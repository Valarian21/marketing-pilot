/**
 * Read endpoints for every domain table (they return what exists - empty until
 * the producing shot lands) plus explicit 501 stubs for the write paths, so the
 * API surface, its Zod contracts and the client typing are fixed from Shot 0.
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "../db/index.js";
import { parseJson } from "../db/index.js";
import * as t from "../db/schema.js";
import * as s from "../../shared/schemas.js";
import { listAudit, listRuns } from "../audit.js";

const arr = (raw: string) => parseJson<string[]>(raw, []);
const obj = (raw: string) => parseJson<Record<string, unknown>>(raw, {});

export function domainRoutes(app: FastifyInstance, db: Db): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = s.ProjectIdParams;

  r.get("/api/mp/projects/:projectId/personas", { schema: { params: P, response: { 200: z.array(s.Persona) } } },
    async (req) => db.select().from(t.mpPersonas).where(eq(t.mpPersonas.projectId, req.params.projectId)).all()
      .map((x) => ({ ...x, painPoints: arr(x.painPoints), whereTheyHangOut: arr(x.whereTheyHangOut) })));

  r.get("/api/mp/projects/:projectId/channels", { schema: { params: P, response: { 200: z.array(s.Channel) } } },
    async (req) => db.select().from(t.mpChannels).where(eq(t.mpChannels.projectId, req.params.projectId))
      .orderBy(t.mpChannels.priority).all());

  r.get("/api/mp/projects/:projectId/tasks", { schema: { params: P, response: { 200: z.array(s.Task) } } },
    async (req) => db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, req.params.projectId))
      .orderBy(t.mpTasks.order).all()
      .map((x) => ({ ...x, type: x.type as s.Task["type"], status: x.status as s.Task["status"],
        assignedTo: x.assignedTo as s.Task["assignedTo"], approvalLevel: x.approvalLevel as s.Task["approvalLevel"],
        outputRefs: arr(x.outputRefs) })));

  r.get("/api/mp/projects/:projectId/content", { schema: { params: P, response: { 200: z.array(s.ContentPiece) } } },
    async (req) => db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, req.params.projectId))
      .orderBy(desc(t.mpContentPieces.createdAt)).all()
      .map((x) => ({ ...x, format: x.format as s.ContentPiece["format"], status: x.status as s.ContentPiece["status"],
        assets: arr(x.assets), utm: obj(x.utm) })));

  r.get("/api/mp/projects/:projectId/insights", { schema: { params: P, response: { 200: z.array(s.Insight) } } },
    async (req) => db.select().from(t.mpInsights).where(eq(t.mpInsights.projectId, req.params.projectId))
      .orderBy(desc(t.mpInsights.period)).all().map((x) => ({ ...x, metrics: obj(x.metrics) })));

  r.get("/api/mp/projects/:projectId/geo", { schema: { params: P, response: { 200: z.array(s.GeoSnapshot) } } },
    async (req) => db.select().from(t.mpGeoSnapshots).where(eq(t.mpGeoSnapshots.projectId, req.params.projectId))
      .orderBy(desc(t.mpGeoSnapshots.takenAt)).all().map((x) => ({ ...x, competitorsMentioned: arr(x.competitorsMentioned) })));

  r.get("/api/mp/projects/:projectId/community", { schema: { params: P, response: { 200: z.array(s.CommunityLead) } } },
    async (req) => db.select().from(t.mpCommunityLeads).where(eq(t.mpCommunityLeads.projectId, req.params.projectId))
      .orderBy(desc(t.mpCommunityLeads.score)).all().map((x) => ({ ...x, status: x.status as s.CommunityLead["status"] })));

  r.get("/api/mp/runs", { schema: { querystring: s.ListQuery.extend({ projectId: z.string().optional() }), response: { 200: z.array(s.AgentRun) } } },
    async (req) => listRuns(db, req.query.limit, req.query.projectId));

  r.get("/api/mp/audit", { schema: { querystring: s.ListQuery.extend({ projectId: z.string().optional() }), response: { 200: z.array(s.AuditEntry) } } },
    async (req) => listAudit(db, req.query.limit, req.query.projectId));

  // Write paths that later shots implement. Listed explicitly so nothing 404s by accident.
  const pending: [string, number][] = [
    ["/api/mp/projects/:projectId/analysis/run", 1],
    ["/api/mp/projects/:projectId/strategy/run", 2],
    ["/api/mp/projects/:projectId/tasks", 2],
    ["/api/mp/projects/:projectId/content", 3],
    ["/api/mp/projects/:projectId/community/scan", 5],
    ["/api/mp/events", 5],
  ];
  for (const [url, shot] of pending) {
    app.post(url, async (_req, reply) => reply.code(501).send({ detail: `Kommt in Shot ${shot}.`, shot }));
  }
}
