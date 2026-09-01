/** AI-tell critic: score a draft, rewrite below threshold, max two rounds. */
import { z } from "zod";
import { modelFor } from "../../../../config/models.js";
import { chatJson, type AgentContext, type UsageCollector } from "../runner.js";
import { criticPrompt, rewritePrompt } from "../prompts/studio.js";

/**
 * Kritikpunkte kommen mal als Satz, mal als Objekt (`{quote, why}`) — gemini-2.5-flash
 * wechselt das je nach Laune und liess damit ganze Laeufe scheitern. Beides wird
 * akzeptiert und zu einer Zeile gemacht; die Zeile landet ohnehin nur in den
 * Hinweisen am Stueck.
 */
const CritiqueLine = z.union([z.string(), z.record(z.string(), z.unknown())])
  .transform((v) => (typeof v === "string" ? v : Object.values(v).filter((x) => typeof x === "string" && x.trim()).join(" – ")))
  .refine((v) => v.length > 0, "leer");
const Verdict = z.object({ score: z.number().min(0).max(10), issues: z.array(CritiqueLine).default([]), suggestions: z.array(CritiqueLine).default([]) });
const Rewritten = z.object({ body: z.string().min(1) });

export interface CriticResult { body: string; score: number; rounds: number; notes: string }
export const CRITIC_THRESHOLD = 7;

export async function reviseWithCritic(ctx: AgentContext, usage: UsageCollector, input: { body: string; language: string; voiceProfile: string | null; format: string; platform?: string; limit?: number; maxRounds?: number }): Promise<CriticResult> {
  const cheap = modelFor("critic");
  let body = input.body;
  let rounds = 0;
  const log: string[] = [];
  let verdict = await chatJson(ctx.llm, cheap, Verdict, criticPrompt({ text: body, language: input.language, voiceProfile: input.voiceProfile, format: input.format, ...(input.platform ? { platform: input.platform } : {}) }), usage, { maxTokens: 1200 });
  log.push(`Runde 0: ${verdict.score}/10${verdict.issues.length ? " – " + verdict.issues.slice(0, 3).join(" | ") : ""}`);
  while (verdict.score < CRITIC_THRESHOLD && rounds < (input.maxRounds ?? 2)) {
    rounds++;
    const rw = await chatJson(ctx.llm, modelFor("content"), Rewritten, rewritePrompt({ text: body, suggestions: verdict.suggestions.length ? verdict.suggestions : verdict.issues, language: input.language, voiceProfile: input.voiceProfile, ...(input.limit ? { limit: input.limit } : {}) }), usage, { maxTokens: 4000, temperature: 0.5 });
    body = input.limit && rw.body.length > input.limit ? body : rw.body;
    verdict = await chatJson(ctx.llm, cheap, Verdict, criticPrompt({ text: body, language: input.language, voiceProfile: input.voiceProfile, format: input.format, ...(input.platform ? { platform: input.platform } : {}) }), usage, { maxTokens: 1200 });
    log.push(`Runde ${rounds}: ${verdict.score}/10${verdict.issues.length ? " – " + verdict.issues.slice(0, 3).join(" | ") : ""}`);
  }
  return { body, score: Math.round(verdict.score), rounds, notes: log.join("\n") + (verdict.suggestions.length ? `\nOffene Vorschläge: ${verdict.suggestions.slice(0, 3).join(" | ")}` : "") };
}
