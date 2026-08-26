/**
 * Minimal DB job queue (mp_jobs). The API enqueues; a separate worker process
 * (src/server/worker.ts) claims jobs one at a time so renders never share the
 * web server's memory budget. Progress lives in `steps` so the UI can poll.
 */
import { and, desc, eq } from "drizzle-orm";
import type * as s from "../shared/schemas.js";
import * as t from "./db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "./db/index.js";

const HEARTBEAT_KEY = "worker:heartbeat";
export const HEARTBEAT_STALE_MS = 20_000;

const toJob = (r: typeof t.mpJobs.$inferSelect): s.Job => ({
  ...r, status: r.status as s.Job["status"], payload: parseJson<Record<string, unknown>>(r.payload, {}),
  steps: parseJson<s.JobStep[]>(r.steps, []), result: parseJson<Record<string, unknown>>(r.result, {}),
});

export function enqueueJob(db: Db, input: { projectId: string | null; kind: string; payload: Record<string, unknown>; steps: string[] }): s.Job {
  const row = {
    id: newId(), projectId: input.projectId, kind: input.kind, payload: toJson(input.payload), status: "queued",
    steps: toJson(input.steps.map((name) => ({ name, status: "pending", detail: "", startedAt: null, finishedAt: null }))),
    result: "{}", error: null, createdAt: nowIso(), startedAt: null, finishedAt: null,
  };
  db.insert(t.mpJobs).values(row).run();
  return toJob(row);
}

export function getJob(db: Db, id: string): s.Job | null {
  const r = db.select().from(t.mpJobs).where(eq(t.mpJobs.id, id)).get();
  return r ? toJob(r) : null;
}

export function listJobs(db: Db, projectId: string, limit = 20): s.Job[] {
  return db.select().from(t.mpJobs).where(eq(t.mpJobs.projectId, projectId)).orderBy(desc(t.mpJobs.createdAt)).limit(limit).all().map(toJob);
}

export function hasActiveJob(db: Db, projectId: string, kind: string): boolean {
  return db.select({ id: t.mpJobs.id }).from(t.mpJobs).where(and(eq(t.mpJobs.projectId, projectId), eq(t.mpJobs.kind, kind))).all()
    .some((x) => { const j = getJob(db, x.id); return j?.status === "queued" || j?.status === "running"; });
}

/** Atomically claim the oldest queued job (UPDATE guarded by status). */
export function claimNextJob(db: Db): s.Job | null {
  const next = db.select({ id: t.mpJobs.id }).from(t.mpJobs).where(eq(t.mpJobs.status, "queued")).orderBy(t.mpJobs.createdAt).limit(1).get();
  if (!next) return null;
  const res = db.update(t.mpJobs).set({ status: "running", startedAt: nowIso() }).where(and(eq(t.mpJobs.id, next.id), eq(t.mpJobs.status, "queued"))).run();
  return res.changes ? getJob(db, next.id) : null;
}

export function updateJobStep(db: Db, id: string, name: string, patch: Partial<s.JobStep>): void {
  const job = getJob(db, id);
  if (!job) return;
  const steps = job.steps.map((st) => (st.name === name ? { ...st, ...patch } : st));
  db.update(t.mpJobs).set({ steps: toJson(steps) }).where(eq(t.mpJobs.id, id)).run();
}

export function finishJob(db: Db, id: string, out: { result?: Record<string, unknown>; error?: string | null }): void {
  const job = getJob(db, id);
  if (!job) return;
  const steps = job.steps.map((st) => (st.status === "pending" || st.status === "running" ? { ...st, status: out.error ? (st.status === "running" ? "failed" : "skipped") : "done", finishedAt: st.finishedAt ?? nowIso() } as s.JobStep : st));
  db.update(t.mpJobs).set({ status: out.error ? "failed" : "done", error: out.error ?? null, result: toJson(out.result ?? {}), finishedAt: nowIso(), steps: toJson(steps) }).where(eq(t.mpJobs.id, id)).run();
}

export function cancelJob(db: Db, id: string): boolean {
  const res = db.update(t.mpJobs).set({ status: "cancelled", finishedAt: nowIso() }).where(and(eq(t.mpJobs.id, id), eq(t.mpJobs.status, "queued"))).run();
  return res.changes > 0;
}

/** Jobs left "running" by a crashed worker can never finish. */
export function markStaleJobs(db: Db): number {
  const rows = db.select({ id: t.mpJobs.id }).from(t.mpJobs).where(eq(t.mpJobs.status, "running")).all();
  for (const r of rows) finishJob(db, r.id, { error: "Abgebrochen: Worker wurde neu gestartet." });
  return rows.length;
}

export function writeHeartbeat(db: Db): void {
  db.insert(t.mpSettings).values({ key: HEARTBEAT_KEY, value: nowIso(), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: nowIso(), updatedAt: nowIso() } }).run();
}

export function workerAlive(db: Db, now = Date.now()): boolean {
  const row = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, HEARTBEAT_KEY)).get();
  return Boolean(row && now - Date.parse(row.value) < HEARTBEAT_STALE_MS);
}

export type JobHandler<C> = (ctx: C, job: s.Job, progress: (step: string, patch: Partial<s.JobStep>) => void) => Promise<Record<string, unknown>>;

/** Run one queued job if any. Returns true when a job was processed. */
export async function processNextJob<C extends { db: Db; log: (m: string) => void }>(ctx: C, handlers: Record<string, JobHandler<C>>): Promise<boolean> {
  const job = claimNextJob(ctx.db);
  if (!job) return false;
  const handler = handlers[job.kind];
  const progress = (step: string, patch: Partial<s.JobStep>) => updateJobStep(ctx.db, job.id, step, patch);
  if (!handler) { finishJob(ctx.db, job.id, { error: `Unbekannte Job-Art: ${job.kind}` }); return true; }
  ctx.log(`job ${job.id} (${job.kind}) start`);
  try {
    const result = await handler(ctx, job, progress);
    finishJob(ctx.db, job.id, { result });
    ctx.log(`job ${job.id} done`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    finishJob(ctx.db, job.id, { error });
    ctx.log(`job ${job.id} FAILED ${error}`);
  }
  return true;
}

export async function runWorkerLoop<C extends { db: Db; log: (m: string) => void }>(ctx: C, handlers: Record<string, JobHandler<C>>, opts: { pollMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const poll = opts.pollMs ?? 2000;
  while (!opts.signal?.aborted) {
    writeHeartbeat(ctx.db);
    const did = await processNextJob(ctx, handlers);
    if (!did) await new Promise((r) => setTimeout(r, poll));
  }
}
