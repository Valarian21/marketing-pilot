/**
 * Zeitplan: von der Freigabe zum Slot.
 *
 * Der manuelle Drei-Schritt-Weg bleibt vollständig erhalten — der Zeitplan ist
 * eine Abkürzung, kein Ersatz. Scheitert ein automatischer Post, entsteht genau
 * dort wieder eine Menschen-Aufgabe mit Link auf das Publish-Paket.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../db/index.js";
import type { Env } from "../env.js";
import { berlinInstant, berlinParts } from "../agents/series/time.js";
import { loadProfiles } from "../channels.js";
import { writeAudit } from "../audit.js";
import { currentVersion, dueAtFor } from "../agents/strategy/plan.js";
import { weekOf } from "../routes/tasks.js";
import { getPiece } from "../agents/studio/generate.js";
import { assetToken, assetUrl } from "./asset-tokens.js";
import { credentialsFor, posterFor } from "./index.js";
import { leseMetriken } from "./metrics.js";
import type { PostAsset } from "./types.js";

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });
const DAY = 86_400_000;

type Row = typeof t.mpScheduledPosts.$inferSelect;

export function scheduledOf(db: Db, r: Row): s.ScheduledPost {
  const piece = db.select({ title: t.mpContentPieces.title }).from(t.mpContentPieces).where(eq(t.mpContentPieces.id, r.pieceId)).get();
  return {
    ...r, status: r.status as s.ScheduledPost["status"], origin: r.origin as s.PostOrigin, title: piece?.title ?? "",
    metrics: leseMetriken(r), metricsAt: r.metricsAt,
  };
}

export function listScheduled(db: Db, projectId: string, limit = 50): s.ScheduledPost[] {
  return db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.projectId, projectId)).all()
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).slice(0, limit).map((r) => scheduledOf(db, r));
}

/**
 * Der nächste freie Slot eines Kanals.
 *
 * „Frei" heißt: noch nicht von einem anderen wartenden Beitrag desselben Kanals
 * belegt. Hat der Kanal keine Slots, wird eine Stunde nach jetzt geplant — das
 * ist ehrlicher, als die Einplanung stillschweigend zu verweigern.
 */
export function nextFreeSlot(db: Db, projectId: string, platform: string, from = new Date()): Date {
  const profile = loadProfiles(db, projectId).find((p) => p.platform === platform);
  const slots = profile?.slots ?? [];
  if (!slots.length) return new Date(from.getTime() + 3600_000);
  const taken = new Set(db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.platform, platform))).all()
    .filter((r) => r.status === "queued").map((r) => r.scheduledAt));
  for (let i = 0; i <= 28; i++) {
    const probe = new Date(from.getTime() + i * DAY);
    const parts = berlinParts(probe);
    for (const slot of [...slots].sort((a, b) => a.hour - b.hour)) {
      if (slot.day !== parts.day) continue;
      const at = berlinInstant(parts.date, slot.hour);
      if (at.getTime() > from.getTime() && !taken.has(at.toISOString())) return at;
    }
  }
  return new Date(from.getTime() + 3600_000);
}

export interface ScheduleInput { pieceId: string; platforms?: string[]; at?: string; origin?: s.PublishMode; now?: Date }

/** Einen freigegebenen Beitrag einplanen — je Kanal ein Eintrag. */
export function schedulePiece(db: Db, projectId: string, input: ScheduleInput): s.ScheduledPost[] {
  const piece = getPiece(db, input.pieceId);
  if (!piece) throw err("Stück nicht gefunden.", 404);
  if (piece.status !== "approved" && input.origin !== "auto") throw err("Nur freigegebene Stücke lassen sich einplanen.");
  const now = input.now ?? new Date();
  const platforms = (input.platforms?.length ? input.platforms : [String(piece.meta["platform"] ?? piece.channel)])
    .map((p) => p.trim().toLowerCase()).filter(Boolean);
  const out: s.ScheduledPost[] = [];
  for (const platform of platforms) {
    if (!posterFor(platform)) throw err(`Für ${platform} gibt es bewusst keinen automatischen Weg — der Beitrag bleibt Handarbeit.`);
    const missing = posterFor(platform)!.missing(credentialsFor(db, projectId, platform));
    if (missing.length) throw err(`${platform}: Zugangsdaten fehlen (${missing.join(", ")}).`);
    // Schon eingeplant? Dann keinen zweiten Eintrag: „Freigeben & einplanen"
    // löst erst die Freigabe (die selbst einplant) und dann diesen Aufruf aus —
    // am 08.09. standen so 13 Threads-Beiträge doppelt in der Schlange. Ein
    // ausdrücklicher Termin verschiebt den vorhandenen Eintrag.
    const offen = db.select().from(t.mpScheduledPosts)
      .where(and(eq(t.mpScheduledPosts.pieceId, piece.id), eq(t.mpScheduledPosts.platform, platform), eq(t.mpScheduledPosts.status, "queued"))).get();
    if (offen) {
      if (input.at) db.update(t.mpScheduledPosts).set({ scheduledAt: new Date(input.at).toISOString() }).where(eq(t.mpScheduledPosts.id, offen.id)).run();
      out.push(scheduledOf(db, db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.id, offen.id)).get() as Row));
      continue;
    }
    const at = input.at ? new Date(input.at) : nextFreeSlot(db, projectId, platform, now);
    const row = {
      id: newId(), projectId, pieceId: piece.id, platform, scheduledAt: at.toISOString(),
      status: "queued", origin: input.origin ?? "scheduled", providerRef: null, externalUrl: null,
      error: null, attempts: 0, postedAt: null, createdAt: nowIso(),
    };
    db.insert(t.mpScheduledPosts).values(row).run();
    out.push(scheduledOf(db, row as Row));
  }
  return out;
}

/**
 * Einen Beitrag eintragen, den du selbst auf der Plattform eingestellt hast.
 *
 * Der Pilot postet ihn nicht — er merkt ihn sich nur, damit Ampel, Kanalkarte
 * und Zeitplan die Woche vollständig zeigen. Ein zweiter Aufruf für dasselbe
 * Stück und dieselbe Plattform überschreibt den vorhandenen Eintrag, statt
 * einen zweiten anzulegen: „ich habe den Termin verschoben" ist der häufigere
 * Fall als „ich habe es zweimal gepostet".
 */
export function recordExternPost(db: Db, projectId: string, input: s.ExternPostCreate): s.ScheduledPost {
  const piece = getPiece(db, input.pieceId);
  if (!piece) throw err("Stück nicht gefunden.", 404);
  if (piece.projectId !== projectId) throw err("Das Stück gehört zu einem anderen Projekt.", 400);
  const platform = input.platform.trim().toLowerCase();
  const at = new Date(input.scheduledAt);
  if (Number.isNaN(at.getTime())) throw err("Kein gültiger Termin.");
  const url = input.externalUrl.trim();
  const ts = nowIso();

  const vorhanden = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.pieceId, piece.id), eq(t.mpScheduledPosts.platform, platform))).all()
    .find((x) => x.origin === "extern" && x.status !== "cancelled");

  const felder = {
    scheduledAt: at.toISOString(),
    status: input.posted ? "posted" : "queued",
    externalUrl: url || null,
    postedAt: input.posted ? (at.getTime() <= Date.now() ? at.toISOString() : ts) : null,
    error: null,
  };
  let row: Row;
  if (vorhanden) {
    db.update(t.mpScheduledPosts).set(felder).where(eq(t.mpScheduledPosts.id, vorhanden.id)).run();
    row = { ...vorhanden, ...felder } as Row;
  } else {
    row = {
      id: newId(), projectId, pieceId: piece.id, platform, origin: "extern",
      providerRef: null, attempts: 0, createdAt: ts, ...felder,
    } as Row;
    db.insert(t.mpScheduledPosts).values(row).run();
  }

  // Ein Stück, das draußen steht, ist veröffentlicht — sonst taucht es weiter
  // in der Freigabe-Warteschlange auf und die Projektion plant es noch einmal ein.
  if (input.posted) {
    db.update(t.mpContentPieces).set({
      status: "published", publishedAt: felder.postedAt, externalUrl: url || piece.externalUrl,
      meta: toJson({ ...piece.meta, postedVia: `extern:${platform}` }), updatedAt: ts,
    }).where(eq(t.mpContentPieces.id, piece.id)).run();
  }
  return scheduledOf(db, row);
}

export function cancelScheduled(db: Db, id: string): boolean {
  return db.update(t.mpScheduledPosts).set({ status: "cancelled" })
    .where(and(eq(t.mpScheduledPosts.id, id), eq(t.mpScheduledPosts.status, "queued"))).run().changes > 0;
}

/**
 * Fällige Einträge — reine Abfrage, damit der Scheduler testbar bleibt.
 *
 * `extern` bleibt draußen: das sind Beiträge, die auf der Plattform selbst
 * eingeplant sind. Sie stehen im Zeitplan, damit die Woche vollständig ist —
 * abgesetzt werden sie dort, nicht hier.
 */
export function duePosts(db: Db, now = new Date()): s.ScheduledPost[] {
  return db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.status, "queued")).all()
    .filter((r) => r.origin !== "extern")
    .filter((r) => Date.parse(r.scheduledAt) <= now.getTime())
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((r) => scheduledOf(db, r));
}

/** Wie viele Auto-Posts dieser Kanal in den letzten sieben Tagen abgesetzt hat. */
export function autoPostsThisWeek(db: Db, projectId: string, platform: string, now = new Date()): number {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  return db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.projectId, projectId)).all()
    .filter((r) => r.platform === platform && r.origin === "auto" && r.status !== "cancelled" && r.createdAt >= since).length;
}

/** Was heute automatisch rausging — der Digest fürs Cockpit. */
export function postedToday(db: Db, projectId: string, now = new Date()): s.ScheduledPost[] {
  const heute = berlinParts(now).date;
  return db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.projectId, projectId)).all()
    .filter((r) => r.origin === "auto" && r.status === "posted" && r.postedAt && berlinParts(new Date(r.postedAt)).date === heute)
    .map((r) => scheduledOf(db, r));
}

// --- Ausfuehren ---------------------------------------------------------------

export interface PostContext { db: Db; env: Env; dataDir: string; log: (m: string) => void; fetchImpl?: typeof fetch; now?: () => Date }

const mimeOf = (file: string): { mime: string; kind: "image" | "video" } => {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".mp4") return { mime: "video/mp4", kind: "video" };
  if (ext === ".webp") return { mime: "image/webp", kind: "image" };
  if (ext === ".jpg" || ext === ".jpeg") return { mime: "image/jpeg", kind: "image" };
  return { mime: "image/png", kind: "image" };
};

/** Einen fälligen Eintrag posten. Fehler landen am Eintrag **und** als Aufgabe. */
export async function runScheduledPost(ctx: PostContext, entry: s.ScheduledPost): Promise<{ ok: boolean; detail: string }> {
  const now = ctx.now?.() ?? new Date();
  const piece = getPiece(ctx.db, entry.pieceId);
  const poster = posterFor(entry.platform);
  const fail = (detail: string) => {
    ctx.db.update(t.mpScheduledPosts).set({ status: "failed", error: detail.slice(0, 500), attempts: entry.attempts + 1 })
      .where(eq(t.mpScheduledPosts.id, entry.id)).run();
    if (piece) createFallbackTask(ctx.db, entry, piece, now);
    writeAudit(ctx.db, { user: { id: "scheduler", name: "Zeitplan" }, action: "publish.failed", entityType: "scheduled_post", entityId: entry.id, projectId: entry.projectId, content: { platform: entry.platform, piece: entry.pieceId, error: detail.slice(0, 500) } });
    return { ok: false, detail };
  };
  if (!piece) return fail("Stück nicht mehr vorhanden.");
  if (!poster) return fail(`Für ${entry.platform} gibt es keinen automatischen Weg.`);
  const creds = credentialsFor(ctx.db, entry.projectId, entry.platform);
  const missing = poster.missing(creds);
  if (missing.length) return fail(`Zugangsdaten fehlen: ${missing.join(", ")}.`);

  const publicBase = ctx.env.MP_PUBLIC_BASE ?? "";
  const assets: PostAsset[] = ctx.db.select().from(t.mpAssets).all()
    .filter((a) => piece.assets.includes(a.id))
    .map((a) => {
      const meta = parseJson<Record<string, unknown>>(a.meta, {});
      const file = path.join(ctx.dataDir, a.path);
      const { mime, kind } = mimeOf(a.path);
      return { path: file, mime, kind, alt: String(meta["alt"] ?? piece.title), url: publicBase ? assetUrl(publicBase, assetToken(ctx.db, a.id, now.getTime())) : "" };
    })
    .filter((a) => fs.existsSync(a.path));

  const short = ctx.db.select().from(t.mpShortlinks).where(eq(t.mpShortlinks.pieceId, piece.id)).get();
  const link = short && publicBase ? `${publicBase.replace(/\/$/, "")}/go/${short.code}` : null;

  try {
    const res = await poster.post({
      platform: entry.platform, text: piece.body, assets, link, title: piece.title,
      // Eine Story ist ein eigenes Stück — der Poster muss das wissen, sonst
      // landet sie als normaler Beitrag im Feed und bleibt dort stehen.
      ...(piece.format === "story" ? { kind: "story" as const } : {}),
      creds, ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}), log: ctx.log,
    });
    ctx.db.update(t.mpScheduledPosts).set({ status: "posted", providerRef: res.ref, externalUrl: res.externalUrl, postedAt: now.toISOString(), attempts: entry.attempts + 1, error: null })
      .where(eq(t.mpScheduledPosts.id, entry.id)).run();
    ctx.db.update(t.mpContentPieces).set({
      status: "published", publishedAt: now.toISOString(), externalUrl: res.externalUrl ?? piece.externalUrl,
      meta: toJson({ ...piece.meta, postedVia: `api:${entry.platform}`, scheduledPostId: entry.id }), updatedAt: nowIso(),
    }).where(eq(t.mpContentPieces.id, piece.id)).run();
    writeAudit(ctx.db, {
      user: { id: "scheduler", name: "Zeitplan" }, action: "publish.posted", entityType: "scheduled_post", entityId: entry.id,
      projectId: entry.projectId, content: { platform: entry.platform, piece: piece.id, url: res.externalUrl, origin: entry.origin, body: piece.body.slice(0, 4000) },
    });
    return { ok: true, detail: res.externalUrl ?? res.ref };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Der Rückfallweg: eine Aufgabe, die auf das fertige Publish-Paket zeigt. */
function createFallbackTask(db: Db, entry: s.ScheduledPost, piece: s.ContentPiece, now: Date): void {
  const version = currentVersion(db, entry.projectId);
  const startDate = version?.plan.startDate ?? now.toISOString().slice(0, 10);
  const week = weekOf(startDate, now.toISOString()) ?? 1;
  const ts = nowIso();
  db.insert(t.mpTasks).values({
    id: newId(), projectId: entry.projectId,
    title: `Von Hand posten: ${piece.title}`.slice(0, 200),
    description: `Der automatische Weg über ${entry.platform} ist gescheitert. Text und Bilder liegen im Publish-Paket bereit.`,
    type: "publish", status: "todo", dueAt: dueAtFor(startDate, week, 0),
    assignedTo: "human", approvalLevel: "review", outputRefs: toJson([piece.id]),
    order: 99, channel: entry.platform, week, planVersion: version?.version ?? 0, createdAt: ts, updatedAt: ts,
  }).run();
}
