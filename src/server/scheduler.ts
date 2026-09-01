/**
 * Worker-side scheduler: enqueues the recurring jobs the plan asks for -
 * daily community radar, weekly (Sunday) report and weekly GEO re-measure -
 * per project that has a confirmed brief and a plan. Last-run stamps live in
 * mp_settings so a restart never double-runs.
 */
import { eq } from "drizzle-orm";
import * as s from "../shared/schemas.js";
import * as t from "./db/schema.js";
import { nowIso, parseJson, type Db } from "./db/index.js";
import { enqueueJob, hasActiveJob } from "./jobs.js";
import { currentVersion } from "./agents/strategy/plan.js";
import { dueSeries } from "./agents/series/series.js";
import { SERIES_STEPS } from "./agents/series/job.js";
import { berlinParts } from "./agents/series/time.js";
import { duePosts } from "./publish/schedule.js";
import { PUBLISH_STEPS } from "./publish/job.js";

const DAY = 86_400_000;
const stampKey = (kind: string, pid: string) => `sched:${kind}:${pid}`;
const lastRun = (db: Db, kind: string, pid: string): number => { const r = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, stampKey(kind, pid))).get(); return r ? Date.parse(r.value) : 0; };
const stamp = (db: Db, kind: string, pid: string, at: string): void => { db.insert(t.mpSettings).values({ key: stampKey(kind, pid), value: at, updatedAt: nowIso() }).onConflictDoUpdate({ target: t.mpSettings.key, set: { value: at, updatedAt: nowIso() } }).run(); };

export interface Due { kind: "community.scan" | "weekly.report" | "geo.measure" | "series.run" | "publish.due"; projectId: string; seriesId?: string }

/** Pure: which jobs are due right now. */
export function dueJobs(db: Db, now = new Date()): Due[] {
  const due: Due[] = [];
  const projects = db.select().from(t.mpProjects).all().filter((p) => p.status === "active" || p.status === "draft");
  for (const p of projects) {
    const meta = s.BriefMeta.safeParse(parseJson<Record<string, unknown>>(p.briefMeta, {}));
    const confirmed = meta.success && Boolean(meta.data.confirmedAt);
    const hasPlan = Boolean(currentVersion(db, p.id));
    if (!confirmed) continue;
    if (now.getTime() - lastRun(db, "community.scan", p.id) > DAY) due.push({ kind: "community.scan", projectId: p.id });
    if (now.getTime() - lastRun(db, "geo.measure", p.id) > 7 * DAY) due.push({ kind: "geo.measure", projectId: p.id });
    // Sunday from 18:00 UTC on, once per week
    if (hasPlan && now.getUTCDay() === 0 && now.getUTCHours() >= 18 && now.getTime() - lastRun(db, "weekly.report", p.id) > 6 * DAY) due.push({ kind: "weekly.report", projectId: p.id });
  }
  // Serien bringen ihre Faelligkeit selbst mit (Kadenz in Europe/Berlin, Shot 9).
  // Der Zeitstempel hier ist nur die Bremse gegen Dauerschleifen: ein Lauf, der
  // scheitert oder bewusst ausfaellt, wird erst am naechsten Tag wieder versucht.
  for (const series of dueSeries(db, now)) {
    const last = lastRun(db, `series:${series.id}`, series.projectId);
    if (last && berlinParts(new Date(last)).date === berlinParts(now).date) continue;
    due.push({ kind: "series.run", projectId: series.projectId, seriesId: series.id });
  }
  // Faellige Beitraege (Shot 10). Ohne Eintraege entsteht auch kein Job - der
  // Takt laeuft ohnehin alle zehn Minuten, das reicht fuer Redaktionsslots.
  for (const pid of new Set(duePosts(db, now).map((x) => x.projectId))) due.push({ kind: "publish.due", projectId: pid });
  return due;
}

export function enqueueDue(db: Db, now = new Date()): Due[] {
  const out: Due[] = [];
  for (const d of dueJobs(db, now)) {
    if (hasActiveJob(db, d.projectId, d.kind)) continue;
    if (d.kind === "series.run" && d.seriesId) {
      enqueueJob(db, { projectId: d.projectId, kind: d.kind, payload: { seriesId: d.seriesId, scheduled: true }, steps: SERIES_STEPS });
      stamp(db, `series:${d.seriesId}`, d.projectId, now.toISOString());
      out.push(d);
      continue;
    }
    const steps = d.kind === "community.scan" ? ["scan"] : d.kind === "weekly.report" ? ["report"] : d.kind === "publish.due" ? PUBLISH_STEPS : ["geo"];
    enqueueJob(db, { projectId: d.projectId, kind: d.kind, payload: { projectId: d.projectId, scheduled: true }, steps });
    if (d.kind !== "publish.due") stamp(db, d.kind, d.projectId, now.toISOString());
    out.push(d);
  }
  return out;
}
