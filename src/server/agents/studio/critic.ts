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

/**
 * `limit` ist die harte Grenze der Plattform, `target` die Länge, die gelesen
 * wird. Ein Text über dem Ziel gilt als durchgefallen, egal wie gut der
 * Kritiker ihn findet — ein 1 300-Zeichen-Text kann stilistisch tadellos sein
 * und wird auf Instagram trotzdem von niemandem aufgeklappt. Die Kürzung ist
 * dann der erste Vorschlag an den Umschreiber und nennt die Zielzahl.
 */
export async function reviseWithCritic(ctx: AgentContext, usage: UsageCollector, input: { body: string; language: string; voiceProfile: string | null; format: string; platform?: string; limit?: number; target?: number; maxRounds?: number }): Promise<CriticResult> {
  const cheap = modelFor("critic");
  let body = input.body;
  let rounds = 0;
  const log: string[] = [];
  const zuLang = (t: string) => Boolean(input.target && t.length > input.target);
  const kuerzung = (t: string) => `Der Text hat ${t.length} Zeichen, erlaubt sind höchstens ${input.target}. Kürze auf unter ${input.target} Zeichen: erste Zeile bleibt der Haken (max. 60 Zeichen), danach höchstens drei kurze Zeilen, eine Frage an den Leser, ein Aufruf. Erklärungen streichen, Spannung behalten.`;
  const kritik = () => chatJson(ctx.llm, cheap, Verdict, criticPrompt({ text: body, language: input.language, voiceProfile: input.voiceProfile, format: input.format, ...(input.platform ? { platform: input.platform } : {}) }), usage, { maxTokens: 1200 });
  let verdict = await kritik();
  log.push(`Runde 0: ${verdict.score}/10${zuLang(body) ? ` – ${body.length} Zeichen, Ziel ${input.target}` : ""}${verdict.issues.length ? " – " + verdict.issues.slice(0, 3).join(" | ") : ""}`);
  // Zwei Runden fürs Schreiben, und bis zu zwei weitere nur fürs Kürzen — Länge
  // ist der eine Mangel, den man zuverlässig messen kann, also darf er nicht
  // an der Rundenzahl scheitern.
  while ((verdict.score < CRITIC_THRESHOLD || zuLang(body)) && rounds < (input.maxRounds ?? 2) + (zuLang(body) ? 2 : 0)) {
    rounds++;
    const vorschlaege = [...(zuLang(body) ? [kuerzung(body)] : []), ...(verdict.suggestions.length ? verdict.suggestions : verdict.issues)];
    const rw = await chatJson(ctx.llm, modelFor("content"), Rewritten, rewritePrompt({ text: body, suggestions: vorschlaege, language: input.language, voiceProfile: input.voiceProfile, ...(input.target ? { limit: input.target } : input.limit ? { limit: input.limit } : {}) }), usage, { maxTokens: 4000, temperature: 0.5 });
    // Ein Umschreiben, das über der harten Grenze landet, wird verworfen; eines
    // über dem Ziel wird angenommen, wenn es wenigstens kürzer ist als vorher.
    if (input.limit && rw.body.length > input.limit) { /* verworfen */ }
    else if (zuLang(body) && rw.body.length >= body.length) { /* nicht kürzer, verworfen */ }
    else body = rw.body;
    verdict = await kritik();
    log.push(`Runde ${rounds}: ${verdict.score}/10 – ${body.length} Zeichen${zuLang(body) ? ` (Ziel ${input.target})` : ""}${verdict.issues.length ? " – " + verdict.issues.slice(0, 3).join(" | ") : ""}`);
  }
  const rest = zuLang(body) ? `\nZU LANG: ${body.length} Zeichen, Ziel ${input.target} — vor der Freigabe kürzen.` : "";
  return { body, score: Math.round(verdict.score), rounds, notes: log.join("\n") + rest + (verdict.suggestions.length ? `\nOffene Vorschläge: ${verdict.suggestions.slice(0, 3).join(" | ")}` : "") };
}
