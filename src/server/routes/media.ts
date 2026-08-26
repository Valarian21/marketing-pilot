/** Media library: every created piece across projects with thumbnail, size and timestamps - filterable by type, project, status, time. */
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { parseJson, type Db } from "../db/index.js";
import { pieceCosts } from "../audit.js";

export const MediaItem = z.object({
  id: z.string(), projectId: z.string(), projectName: z.string(), title: z.string(), format: s.ContentFormat, status: s.ContentStatus, channel: z.string(),
  createdAt: z.string(), updatedAt: z.string(), renderedAt: z.string().nullable(), costUsd: z.number(),
  thumbUrl: z.string().nullable(), previewUrl: z.string().nullable(), assetCount: z.number().int(), bytes: z.number().int(), humanEdited: z.boolean(),
});
export type MediaItem = z.infer<typeof MediaItem>;

const MediaQuery = z.object({
  format: s.ContentFormat.optional(), projectId: z.string().optional(), status: s.ContentStatus.optional(),
  /** ISO date/time lower bound on createdAt */ since: z.string().optional(), q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function listMedia(db: Db, dataDir: string, f: z.infer<typeof MediaQuery>): MediaItem[] {
  const projects = new Map(db.select({ id: t.mpProjects.id, name: t.mpProjects.name }).from(t.mpProjects).all().map((p) => [p.id, p.name]));
  let q = db.select().from(t.mpContentPieces).$dynamic();
  if (f.projectId) q = q.where(eq(t.mpContentPieces.projectId, f.projectId));
  const rows = q.orderBy(desc(t.mpContentPieces.createdAt)).all()
    .filter((r) => (!f.format || r.format === f.format) && (!f.status || r.status === f.status) && (!f.since || r.createdAt >= f.since) && (!f.q || r.title.toLowerCase().includes(f.q.toLowerCase())))
    .slice(0, f.limit);
  const costs = pieceCosts(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const assets = db.select().from(t.mpAssets).where(eq(t.mpAssets.contentPieceId, r.id)).all();
    let bytes = 0;
    for (const a of assets) { try { bytes += fs.statSync(path.join(dataDir, a.path)).size; } catch { /* file gone */ } }
    const meta = parseJson<Record<string, unknown>>(r.meta, {});
    const thumb = assets.find((a) => a.kind === "image" && parseJson<Record<string, unknown>>(a.meta, {})["role"] === "thumbnail") ?? assets.find((a) => a.kind === "image");
    const preview = assets.find((a) => a.kind === "render") ?? null;
    return {
      id: r.id, projectId: r.projectId, projectName: projects.get(r.projectId) ?? "?", title: r.title, format: r.format as z.infer<typeof s.ContentFormat>, status: r.status as z.infer<typeof s.ContentStatus>, channel: r.channel,
      createdAt: r.createdAt, updatedAt: r.updatedAt, renderedAt: typeof meta["renderedAt"] === "string" ? meta["renderedAt"] : null, costUsd: costs.get(r.id) ?? 0,
      thumbUrl: thumb ? `/api/mp/assets/${thumb.id}/file` : null, previewUrl: preview ? `/api/mp/assets/${preview.id}/file` : null, assetCount: assets.length, bytes, humanEdited: Boolean(r.humanEdited),
    };
  });
}

export function mediaRoutes(app: FastifyInstance, db: Db, dataDir: () => string): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get("/api/mp/media", { schema: { querystring: MediaQuery, response: { 200: z.array(MediaItem) } } }, async (req) => listMedia(db, dataDir(), req.query));
}
