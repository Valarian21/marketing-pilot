/**
 * Voll automatisches Posten (Shot 10, erweitert).
 *
 * Nur Serien-Ausgaben, nur Kanäle, die Marcel ausdrücklich auf `auto` gestellt
 * hat, nur bis zum Wochendeckel — und nur Daten-Formate, bei denen jede Zahl
 * deterministisch aus dem Provider kommt.
 *
 * Der Aufruf steht an zwei Stellen, weil ein Bündel auf zwei Wegen fertig wird:
 * ein Carousel ist es sofort nach dem Serienlauf, ein Reel erst, wenn der
 * Worker die MP4 gebaut hat. Beide landen hier.
 */
import { eq } from "drizzle-orm";
import * as t from "../db/schema.js";
import { nowIso, parseJson, type Db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import { loadProfiles } from "../channels.js";
import type { HostUser } from "../../host-adapter.js";
import { posterFor } from "./index.js";
import { autoPostsThisWeek, schedulePiece } from "./schedule.js";

/** Formate, die ohne Einzelfreigabe rausdürfen. Text aus einem Brief gehört nie dazu. */
const AUTO_FORMATS = new Set(["data_carousel", "data_reel"]);

export interface AutoResult { notes: string[]; scheduled: number }

export function autoScheduleBundle(db: Db, projectId: string, bundleId: string, opts: { now?: Date; user: HostUser }): AutoResult {
  const now = opts.now ?? new Date();
  const profiles = loadProfiles(db, projectId);
  const notes: string[] = [];
  let scheduled = 0;

  const members = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all()
    .filter((r) => parseJson<Record<string, unknown>>(r.meta, {})["bundleId"] === bundleId);

  for (const row of members) {
    if (!AUTO_FORMATS.has(row.format) || row.status !== "review") continue;
    const meta = parseJson<Record<string, unknown>>(row.meta, {});
    // Nur was aus einer Serie stammt: Handarbeit geht immer durch die Freigabe.
    const seriesId = (meta["request"] as { seriesId?: string } | undefined)?.seriesId;
    if (!seriesId) continue;
    const profile = profiles.find((p) => p.platform === row.channel);
    if (profile?.publishMode !== "auto" || !posterFor(row.channel)) continue;
    if (autoPostsThisWeek(db, projectId, row.channel, now) >= profile.autoWeeklyCap) {
      notes.push(`${row.channel}: Wochendeckel erreicht, bleibt in der Freigabe.`);
      continue;
    }
    db.update(t.mpContentPieces).set({ status: "approved", updatedAt: nowIso() }).where(eq(t.mpContentPieces.id, row.id)).run();
    const planned = schedulePiece(db, projectId, { pieceId: row.id, platforms: [row.channel], origin: "auto", now });
    scheduled++;
    notes.push(`${row.channel}: automatisch für ${planned[0]?.scheduledAt.slice(0, 16).replace("T", " ")} eingeplant.`);
    writeAudit(db, { user: opts.user, action: "publish.autoSchedule", entityType: "content_piece", entityId: row.id, projectId, content: { platform: row.channel, at: planned[0]?.scheduledAt, series: seriesId, format: row.format } });
  }
  return { notes, scheduled };
}
