/**
 * Shared plumbing for agents: run bookkeeping (mp_agent_runs), usage
 * accumulation and JSON-with-schema chat calls that retry once with the
 * validation error fed back to the model.
 */
import type { ZodType } from "zod";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";
import type { LlmMessage, LlmProvider, LlmUsage, SearchProvider } from "../providers/index.js";
import { finishRun, startRun } from "../audit.js";

export class UsageCollector implements LlmUsage {
  tokensIn = 0; tokensOut = 0; costUsd = 0; calls = 0;
  add(u: LlmUsage): void { this.tokensIn += u.tokensIn; this.tokensOut += u.tokensOut; this.costUsd += u.costUsd; this.calls += 1; }
}

export interface AgentContext {
  db: Db;
  env: Env;
  llm: LlmProvider;
  search: SearchProvider;
  dataDir: string;
  log: (msg: string) => void;
}

export async function withRun<T>(
  db: Db,
  meta: { task: string; model?: string | null; projectId?: string | null },
  fn: (usage: UsageCollector) => Promise<T>,
): Promise<{ result: T; runId: string; usage: UsageCollector }> {
  const runId = startRun(db, meta);
  const usage = new UsageCollector();
  try {
    const result = await fn(usage);
    finishRun(db, runId, { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, resultRef: `${meta.task}:${meta.projectId ?? ""}` });
    return { result, runId, usage };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    finishRun(db, runId, { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, error });
    throw e;
  }
}

/** Pull the first JSON object/array out of a model answer (code fences, prose around it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("Keine JSON-Struktur in der Modellantwort");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("Unvollständiges JSON in der Modellantwort");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function chatJson<T>(
  llm: LlmProvider,
  model: string,
  schema: ZodType<T>,
  messages: LlmMessage[],
  usage: UsageCollector,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<T> {
  let lastError = "";
  let convo = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.chat(model, convo, { json: true, temperature: opts.temperature ?? 0.2, ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}) });
    usage.add(res.usage);
    try {
      const parsed = schema.safeParse(extractJson(res.text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    convo = [...messages, { role: "assistant", content: res.text.slice(0, 6000) },
      { role: "user", content: `Your JSON did not match the required schema: ${lastError}. Reply with ONLY the corrected JSON object.` }];
  }
  throw new Error(`Modellantwort passt nicht zum Schema (${model}): ${lastError}`);
}

/** Run `fn` over items with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + " …" : s);
