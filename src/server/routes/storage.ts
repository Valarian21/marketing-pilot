/** Storage view: free disk, what our data directory holds per project/piece, and deletion of media we created. */
import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { parseJson, toJson, type Db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import { listProjects } from "../repo/projects.js";

export const StorageFile = z.object({ path: z.string(), bytes: z.number().int(), kind: z.string(), assetId: z.string().nullable(), mtime: z.string() });
export const StoragePiece = z.object({ pieceId: z.string(), title: z.string(), format: z.string(), status: z.string(), bytes: z.number().int(), files: z.array(StorageFile) });
export const StorageProject = z.object({ projectId: z.string(), name: z.string(), bytes: z.number().int(), pieces: z.array(StoragePiece), otherBytes: z.number().int() });
export const StorageView = z.object({
  disk: z.object({ totalBytes: z.number(), freeBytes: z.number(), usedBytes: z.number(), path: z.string() }),
  dataDirBytes: z.number().int(),
  dbBytes: z.number().int(),
  projects: z.array(StorageProject),
  orphanBytes: z.number().int(),
});
export type StorageView = z.infer<typeof StorageView>;

export function dirSize(dir: string): number {
  let n = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) n += dirSize(p); else if (e.isFile()) n += fs.statSync(p).size; } } catch { /* missing */ }
  return n;
}
function listFiles(dir: string, rel: string): { path: string; bytes: number; mtime: string }[] {
  const out: { path: string; bytes: number; mtime: string }[] = [];
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...listFiles(p, path.join(rel, e.name))); else if (e.isFile()) { const st = fs.statSync(p); out.push({ path: path.join(rel, e.name), bytes: st.size, mtime: st.mtime.toISOString() }); } } } catch { /* missing */ }
  return out;
}
const kindOf = (f: string): string => /\.(mp4)$/i.test(f) ? "video" : /\.webm$/i.test(f) ? "recording" : /\.(mp3|wav)$/i.test(f) ? "audio" : /\.(png|jpg|jpeg|webp|svg)$/i.test(f) ? "image" : /\.html$/i.test(f) ? "html" : "other";

export function storageView(db: Db, dataDir: string): StorageView {
  const st = fs.statfsSync(dataDir);
  const disk = { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize, usedBytes: (st.blocks - st.bfree) * st.bsize, path: dataDir };
  const assets = db.select().from(t.mpAssets).all();
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const pieces = db.select().from(t.mpContentPieces).all();
  const projects = listProjects(db).map((p) => {
    const files = listFiles(path.join(dataDir, "assets", p.id), path.join("assets", p.id));
    const perPiece = new Map<string, typeof files>();
    let other = 0;
    for (const f of files) {
      const m = /^assets\/[^/]+\/(?:pieces|video)\/([^/]+)\//.exec(f.path);
      if (m?.[1]) { const arr = perPiece.get(m[1]) ?? []; arr.push(f); perPiece.set(m[1], arr); } else other += f.bytes;
    }
    const pcs = [...perPiece.entries()].map(([pieceId, fl]) => {
      const pc = pieces.find((x) => x.id === pieceId);
      return { pieceId, title: pc?.title ?? "(gelöschtes Stück)", format: pc?.format ?? "?", status: pc?.status ?? "?", bytes: fl.reduce((n, f) => n + f.bytes, 0), files: fl.map((f) => ({ ...f, kind: kindOf(f.path), assetId: byPath.get(f.path)?.id ?? null })).sort((a, b) => b.bytes - a.bytes) };
    }).sort((a, b) => b.bytes - a.bytes);
    return { projectId: p.id, name: p.name, bytes: files.reduce((n, f) => n + f.bytes, 0), pieces: pcs, otherBytes: other };
  });
  const known = new Set(projects.map((p) => p.projectId));
  let orphan = 0;
  try { for (const d of fs.readdirSync(path.join(dataDir, "assets"))) if (!known.has(d)) orphan += dirSize(path.join(dataDir, "assets", d)); } catch { /* none */ }
  const dbBytes = ["mp.db", "mp.db-wal"].reduce((n, f) => { try { return n + fs.statSync(path.join(dataDir, f)).size; } catch { return n; } }, 0);
  return { disk, dataDirBytes: dirSize(dataDir), dbBytes, projects, orphanBytes: orphan };
}

/** Delete media of one piece. scope: intermediates (segments/bodies/overlays/scene shots), recordings, renders, all. */
export function deletePieceMedia(db: Db, dataDir: string, pieceId: string, scope: "intermediates" | "recordings" | "all"): { deletedFiles: number; freedBytes: number } {
  const pc = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  const dirs = [path.join(dataDir, "assets", pc?.projectId ?? "", "video", pieceId), path.join(dataDir, "assets", pc?.projectId ?? "", "pieces", pieceId)];
  let deleted = 0, freed = 0;
  const rmAsset = (rel: string) => { const a = db.select().from(t.mpAssets).where(eq(t.mpAssets.path, rel)).get(); if (a) db.delete(t.mpAssets).where(eq(t.mpAssets.id, a.id)).run(); return a?.id; };
  const removedAssetIds: string[] = [];
  for (const dir of dirs) {
    for (const f of listFiles(dir, path.relative(dataDir, dir))) {
      const name = path.basename(f.path);
      const isIntermediate = /^(seg-|body-|reel-bg|reel-frame|reel-end|reel-hook|land-|reel-s\d|scene-|state\.json)/.test(name) || name.endsWith(".txt");
      const isRecording = /^recording-.*\.webm$/.test(name) || /^voice\//.test(path.relative(path.relative(dataDir, dir), f.path));
      const isRender = /\.(mp4)$/.test(name) || /thumb\.png$/.test(name);
      const hit = scope === "all" || (scope === "intermediates" && isIntermediate) || (scope === "recordings" && (isRecording || isIntermediate));
      if (!hit || (scope !== "all" && isRender)) continue;
      try { fs.unlinkSync(path.join(dataDir, f.path)); deleted++; freed += f.bytes; } catch { continue; }
      const id = rmAsset(f.path); if (id) removedAssetIds.push(id);
    }
    if (scope === "all") { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  if (pc && removedAssetIds.length) {
    const meta = parseJson<Record<string, unknown>>(pc.meta, {});
    if (scope !== "intermediates") delete meta["recordings"];
    db.update(t.mpContentPieces).set({ assets: toJson(parseJson<string[]>(pc.assets, []).filter((id) => !removedAssetIds.includes(id))), meta: toJson(meta) }).where(eq(t.mpContentPieces.id, pieceId)).run();
  }
  return { deletedFiles: deleted, freedBytes: freed };
}

export function storageRoutes(app: FastifyInstance, db: Db, dataDir: () => string): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get("/api/mp/storage", { schema: { response: { 200: StorageView } } }, async () => storageView(db, dataDir()));

  r.delete("/api/mp/storage/pieces/:id", { schema: { params: s.IdParams, querystring: z.object({ scope: z.enum(["intermediates", "recordings", "all"]).default("intermediates") }), response: { 200: z.object({ deletedFiles: z.number().int(), freedBytes: z.number().int() }) } } }, async (req) => {
    const res = deletePieceMedia(db, dataDir(), req.params.id, req.query.scope);
    const pc = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, req.params.id)).get();
    writeAudit(db, { user: req.user, action: "storage.delete", entityType: "content_piece", entityId: req.params.id, projectId: pc?.projectId ?? null, content: { scope: req.query.scope, ...res } });
    return res;
  });

  r.delete("/api/mp/assets/:id", { schema: { params: s.IdParams, response: { 200: z.object({ ok: z.boolean(), freedBytes: z.number().int() }), 404: s.ErrorBody } } }, async (req, reply) => {
    const a = db.select().from(t.mpAssets).where(eq(t.mpAssets.id, req.params.id)).get();
    if (!a) return reply.code(404).send({ detail: "Asset nicht gefunden." });
    let freed = 0;
    try { freed = fs.statSync(path.join(dataDir(), a.path)).size; fs.unlinkSync(path.join(dataDir(), a.path)); } catch { /* already gone */ }
    db.delete(t.mpAssets).where(eq(t.mpAssets.id, a.id)).run();
    if (a.contentPieceId) {
      const pc = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, a.contentPieceId)).get();
      if (pc) db.update(t.mpContentPieces).set({ assets: toJson(parseJson<string[]>(pc.assets, []).filter((x) => x !== a.id)) }).where(eq(t.mpContentPieces.id, pc.id)).run();
    }
    writeAudit(db, { user: req.user, action: "storage.delete-asset", entityType: "asset", entityId: a.id, projectId: a.projectId, content: { path: a.path, freedBytes: freed } });
    return { ok: true, freedBytes: freed };
  });

  r.post("/api/mp/storage/cleanup", { schema: { body: z.object({ scope: z.enum(["intermediates", "orphans"]).default("intermediates") }), response: { 200: z.object({ deletedFiles: z.number().int(), freedBytes: z.number().int() }) } } }, async (req) => {
    let deleted = 0, freed = 0;
    if (req.body.scope === "intermediates") {
      for (const pc of db.select({ id: t.mpContentPieces.id }).from(t.mpContentPieces).where(eq(t.mpContentPieces.format, "video")).all()) { const r2 = deletePieceMedia(db, dataDir(), pc.id, "intermediates"); deleted += r2.deletedFiles; freed += r2.freedBytes; }
    } else {
      const known = new Set(listProjects(db).map((p) => p.id));
      try { for (const d of fs.readdirSync(path.join(dataDir(), "assets"))) if (!known.has(d)) { const p = path.join(dataDir(), "assets", d); freed += dirSize(p); fs.rmSync(p, { recursive: true, force: true }); deleted++; } } catch { /* none */ }
      const ids = db.select({ id: t.mpAssets.id, path: t.mpAssets.path }).from(t.mpAssets).all().filter((a) => !fs.existsSync(path.join(dataDir(), a.path))).map((a) => a.id);
      if (ids.length) db.delete(t.mpAssets).where(inArray(t.mpAssets.id, ids)).run();
    }
    writeAudit(db, { user: req.user, action: "storage.cleanup", entityType: "storage", content: { scope: req.body.scope, deleted, freed } });
    return { deletedFiles: deleted, freedBytes: freed };
  });
}
