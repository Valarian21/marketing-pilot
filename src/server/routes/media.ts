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
import { postArtOf } from "../../shared/postarten.js";

export const MediaItem = z.object({
  id: z.string(), projectId: z.string(), projectName: z.string(), title: z.string(), format: s.ContentFormat, status: s.ContentStatus, channel: z.string(),
  /** Der Plattform-Schluessel des Stuecks — `meta.platform`, sonst der Kanal. Danach laesst sich filtern. */
  platform: z.string(),
  createdAt: z.string(), updatedAt: z.string(), renderedAt: z.string().nullable(), costUsd: z.number(),
  thumbUrl: z.string().nullable(), previewUrl: z.string().nullable(), videoUrl: z.string().nullable(), assetCount: z.number().int(), bytes: z.number().int(), humanEdited: z.boolean(),
  /** Der fertige Beitragstext samt Schlagworten — die Mediathek zeigt ihn neben der Vorschau. */
  body: z.string(),
  /**
   * Was zusammengehört: die drei App-Fassungen eines Reels sind ein Thema, nicht
   * drei Stücke. Schlüssel ist das Drehbuch, sonst das Bündel, sonst der Titel
   * ohne Plattform-Endung.
   */
  gruppe: z.string(),
  /** Post-Art aus dem Playbook (A–G, T, S, X). */
  postArt: z.string(),
});
export type MediaItem = z.infer<typeof MediaItem>;

const MediaQuery = z.object({
  format: s.ContentFormat.optional(), projectId: z.string().optional(), status: s.ContentStatus.optional(),
  platform: z.string().optional(),
  /** ISO date/time lower bound on createdAt */ since: z.string().optional(), q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function listMedia(db: Db, dataDir: string, f: z.infer<typeof MediaQuery>): MediaItem[] {
  const projects = new Map(db.select({ id: t.mpProjects.id, name: t.mpProjects.name }).from(t.mpProjects).all().map((p) => [p.id, p.name]));
  let q = db.select().from(t.mpContentPieces).$dynamic();
  if (f.projectId) q = q.where(eq(t.mpContentPieces.projectId, f.projectId));
  const platformOf = (r: { channel: string; meta: string }): string =>
    String(parseJson<Record<string, unknown>>(r.meta, {})["platform"] ?? r.channel).trim().toLowerCase();
  const wanted = f.platform?.trim().toLowerCase();
  /**
   * Die Dateien eines Stücks: die eigenen Zeilen in `mp_assets` **und** die im
   * Stück verzeichneten Kennungen. Ein Bündel-Geschwister (die TikTok-Fassung
   * einer Rangliste) verweist per `assets` auf die Dateien des Leitstücks und
   * hat keine eigenen Zeilen — am 14.09.2026 fehlten deshalb 13 freigegebene
   * TikTok-Reels in der Mediathek, und die Kacheln aller Geschwister hatten
   * weder Vorschaubild noch Video.
   */
  // Alle Dateizeilen einmal laden statt zwei Abfragen je Stück — bei 900
  // Stücken sind das 1.800 Abfragen für eine Seite, die 24 Kacheln zeigt.
  const alleAssets = db.select().from(t.mpAssets).all();
  const nachId = new Map(alleAssets.map((a) => [a.id, a]));
  const nachStueck = new Map<string, typeof alleAssets>();
  for (const a of alleAssets) { if (a.contentPieceId) nachStueck.set(a.contentPieceId, [...(nachStueck.get(a.contentPieceId) ?? []), a]); }
  const assetsOf = (r: { id: string; assets: string }) => {
    const eigene = nachStueck.get(r.id) ?? [];
    // Reihenfolge des Stücks, dann die eigenen, die es nicht nennt (Vorschaubilder, Renders).
    const genannt = parseJson<string[]>(r.assets, []).map((x) => nachId.get(x)).filter((a): a is NonNullable<typeof a> => Boolean(a));
    return [...genannt, ...eigene.filter((a) => !genannt.includes(a))];
  };
  // Eine Mediathek ohne Medien ist keine. Stuecke, deren Dateien geloescht sind
  // — `cleanup.ts` raeumt abgelehnte nach sieben Tagen ab —, standen hier als
  // leere Kacheln und machten die Ansicht unbrauchbar: am 14.09.2026 waren von
  // 200 Eintraegen die meisten leere Zwischenstaende einer Render-Schleife.
  // Wer sie sehen will, waehlt den Status ausdruecklich; dann zaehlt der Filter,
  // nicht diese Regel. Ein Stueck, das nie Dateien hatte (Threads-Text,
  // Artikel), ist davon nicht betroffen — es ist nicht leer, es ist Text.
  const hatDateien = (r: { id: string; assets: string; format: string }) => {
    const alle = assetsOf(r);
    if (alle.length === 0) return r.format === "text" || r.format === "article" || r.format === "community_reply";
    return alle.some((a) => fs.existsSync(path.join(dataDir, a.path)));
  };
  /**
   * Zwischenstände fallen raus: Ein Reel wird einmal ohne Folgen-Pille gerechnet
   * (`meta.basis`), daraus entstehen die App-Fassungen. Die Basis selbst ist
   * nichts, was jemand ansieht oder freigibt.
   */
  const istBasis = (r: { meta: string }) => parseJson<Record<string, unknown>>(r.meta, {})["basis"] === true;
  const rows = q.orderBy(desc(t.mpContentPieces.createdAt)).all()
    .filter((r) => !istBasis(r))
    .filter((r) => (!f.format || r.format === f.format) && (!f.status || r.status === f.status) && (!f.since || r.createdAt >= f.since)
      && (!wanted || platformOf(r) === wanted) && (!f.q || r.title.toLowerCase().includes(f.q.toLowerCase()))
      && (f.status ? true : hatDateien(r)))
    .slice(0, f.limit);
  const costs = pieceCosts(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const assets = assetsOf(r);
    let bytes = 0;
    for (const a of assets) { try { bytes += fs.statSync(path.join(dataDir, a.path)).size; } catch { /* file gone */ } }
    const meta = parseJson<Record<string, unknown>>(r.meta, {});
    const thumb = assets.find((a) => a.kind === "image" && parseJson<Record<string, unknown>>(a.meta, {})["role"] === "thumbnail") ?? assets.find((a) => a.kind === "image");
    const preview = assets.find((a) => a.kind === "render") ?? null;
    // Das fertige Video direkt zum Mitnehmen: TikTok laedt keine Datei von uns,
    // dort wird von Hand hochgeladen — ohne Herunterladen war die Mediathek
    // fuer den haeufigsten Handgriff nutzlos.
    // Ranglisten-Reels legen ihre MP4 als `render` ab, Kunstseiten-Reels als
    // `video` — für die Kachel ist beides das Video.
    const video = assets.find((a) => a.kind === "video") ?? assets.find((a) => a.kind === "render" && /\.mp4$/i.test(a.path)) ?? null;
    const gruppe = String(meta["drehbuch"] ?? meta["bundleId"] ?? r.title.replace(/\s+·\s+\w+$/, ""));
    return {
      id: r.id, projectId: r.projectId, projectName: projects.get(r.projectId) ?? "?", title: r.title, format: r.format as z.infer<typeof s.ContentFormat>, status: r.status as z.infer<typeof s.ContentStatus>, channel: r.channel,
      platform: platformOf(r),
      createdAt: r.createdAt, updatedAt: r.updatedAt, renderedAt: typeof meta["renderedAt"] === "string" ? meta["renderedAt"] : null, costUsd: costs.get(r.id) ?? 0,
      thumbUrl: thumb ? `/api/mp/assets/${thumb.id}/file` : null, previewUrl: preview ? `/api/mp/assets/${preview.id}/file` : null,
      videoUrl: video ? `/api/mp/assets/${video.id}/file` : null, assetCount: assets.length, bytes, humanEdited: Boolean(r.humanEdited),
      body: r.body ?? "", gruppe,
      postArt: postArtOf({ format: r.format, meta }),
    };
  });
}

/**
 * Die Werte, nach denen sich filtern lässt — unabhängig vom aktuellen Filter.
 *
 * Die Mediathek baute ihre Auswahllisten aus dem gefilterten Ergebnis: Wer
 * „Status: abgelehnt" wählte, hatte danach nur noch die Projekte und Kanäle
 * der Abgelehnten zur Auswahl, und ein Filter, der nichts fand, ließ die Liste
 * leer zurück — die eigene Auswahl war dann nicht einmal mehr sichtbar.
 */
export const MediaFacets = z.object({
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  platforms: z.array(z.string()),
  formats: z.array(z.string()),
});
export type MediaFacets = z.infer<typeof MediaFacets>;

export function mediaFacets(db: Db): MediaFacets {
  const projects = db.select({ id: t.mpProjects.id, name: t.mpProjects.name }).from(t.mpProjects).all();
  const rows = db.select({ channel: t.mpContentPieces.channel, meta: t.mpContentPieces.meta, format: t.mpContentPieces.format }).from(t.mpContentPieces).all();
  const platforms = new Set<string>(), formats = new Set<string>();
  for (const r of rows) {
    const meta = parseJson<Record<string, unknown>>(r.meta, {});
    if (meta["basis"] === true) continue;
    const p = String(meta["platform"] ?? r.channel).trim().toLowerCase();
    if (p) platforms.add(p);
    formats.add(r.format);
  }
  return { projects, platforms: [...platforms].sort(), formats: [...formats].sort() };
}

export function mediaRoutes(app: FastifyInstance, db: Db, dataDir: () => string): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get("/api/mp/media", { schema: { querystring: MediaQuery, response: { 200: z.array(MediaItem) } } }, async (req) => listMedia(db, dataDir(), req.query));
  r.get("/api/mp/media/facets", { schema: { response: { 200: MediaFacets } } }, async () => mediaFacets(db));
}
