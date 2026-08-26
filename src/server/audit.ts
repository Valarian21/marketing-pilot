/** Audit log + agent-run bookkeeping (architecture rules 4 and 6). */
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { newId, nowIso, parseJson, toJson } from "./db/index.js";
import { mpAgentRuns, mpAuditLog } from "./db/schema.js";
import type { AgentRun, AuditEntry } from "../shared/schemas.js";
import type { HostUser } from "../host-adapter.js";

export function writeAudit(db: Db, input: {
  user: HostUser; action: string; entityType: string; entityId?: string | null;
  projectId?: string | null; content?: Record<string, unknown>;
}): AuditEntry {
  const row = {
    id: newId(),
    projectId: input.projectId ?? null,
    user: input.user.id,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    content: toJson(input.content ?? {}),
    createdAt: nowIso(),
  };
  db.insert(mpAuditLog).values(row).run();
  return { ...row, content: input.content ?? {} };
}

export function listAudit(db: Db, limit = 100, projectId?: string): AuditEntry[] {
  const q = db.select().from(mpAuditLog);
  const rows = (projectId ? q.where(eq(mpAuditLog.projectId, projectId)) : q)
    .orderBy(desc(mpAuditLog.createdAt), desc(sql`rowid`)).limit(limit).all();
  return rows.map((r) => ({ ...r, content: parseJson<Record<string, unknown>>(r.content, {}) }));
}

/** Open a run before calling a provider; close it with `finishRun` in a finally block. */
export function startRun(db: Db, input: { task: string; model?: string | null; projectId?: string | null; pieceId?: string | null; provider?: string }): string {
  const id = newId();
  db.insert(mpAgentRuns).values({
    id, projectId: input.projectId ?? null, pieceId: input.pieceId ?? null, provider: input.provider ?? "openrouter", task: input.task, model: input.model ?? null,
    status: "running", startedAt: nowIso(),
  }).run();
  return id;
}

/** Book a finished, externally priced call (e.g. ElevenLabs) as a run in one go. */
export function bookRun(db: Db, input: { task: string; model: string; provider: string; projectId?: string | null; pieceId?: string | null; costUsd: number; tokensIn?: number; tokensOut?: number; durationMs?: number; error?: string | null }): string {
  const id = newId();
  const now = nowIso();
  db.insert(mpAgentRuns).values({
    id, projectId: input.projectId ?? null, pieceId: input.pieceId ?? null, provider: input.provider, task: input.task, model: input.model,
    tokensIn: input.tokensIn ?? 0, tokensOut: input.tokensOut ?? 0, costUsd: input.costUsd, durationMs: input.durationMs ?? null, resultRef: null,
    error: input.error ?? null, status: input.error ? "failed" : "done", startedAt: now, finishedAt: now,
  }).run();
  return id;
}

/** Cost per piece, USD (all providers). */
export function pieceCosts(db: Db, pieceIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!pieceIds.length) return out;
  for (const r of db.select({ pieceId: mpAgentRuns.pieceId, costUsd: mpAgentRuns.costUsd }).from(mpAgentRuns).all()) {
    if (r.pieceId && pieceIds.includes(r.pieceId)) out.set(r.pieceId, (out.get(r.pieceId) ?? 0) + r.costUsd);
  }
  return out;
}

export function finishRun(db: Db, id: string, result: {
  tokensIn?: number; tokensOut?: number; costUsd?: number; resultRef?: string | null; error?: string | null;
}): void {
  const started = db.select({ startedAt: mpAgentRuns.startedAt }).from(mpAgentRuns).where(eq(mpAgentRuns.id, id)).get();
  const finishedAt = nowIso();
  const durationMs = started ? Date.parse(finishedAt) - Date.parse(started.startedAt) : null;
  db.update(mpAgentRuns).set({
    tokensIn: result.tokensIn ?? 0,
    tokensOut: result.tokensOut ?? 0,
    costUsd: result.costUsd ?? 0,
    resultRef: result.resultRef ?? null,
    error: result.error ?? null,
    status: result.error ? "failed" : "done",
    finishedAt,
    durationMs,
  }).where(eq(mpAgentRuns.id, id)).run();
}

export function listRuns(db: Db, limit = 100, projectId?: string): AgentRun[] {
  const q = db.select().from(mpAgentRuns);
  return (projectId ? q.where(eq(mpAgentRuns.projectId, projectId)) : q)
    .orderBy(desc(mpAgentRuns.startedAt), desc(sql`rowid`)).limit(limit).all()
    .map((r) => ({ ...r, status: r.status as AgentRun["status"] }));
}
