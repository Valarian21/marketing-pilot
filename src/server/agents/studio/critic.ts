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

/** Der Auftrag an den Umschreiber, wenn ein Text zu lang ist — nennt die Zielzahl. */
export const kuerzungsAuftrag = (laenge: number, ziel: number): string =>
  `Der Text hat ${laenge} Zeichen, erlaubt sind höchstens ${ziel}. Kürze auf unter ${ziel} Zeichen: erste Zeile bleibt der Haken (max. 60 Zeichen), danach höchstens drei kurze Zeilen, eine Frage an den Leser, ein Aufruf. Der Hinweis „Kein offizielles Pokémon-Produkt" bleibt als eigene kurze Zeile. Erklärungen streichen, Spannung behalten.`;

/**
 * Einen Text auf die Ziellänge bringen — ohne Kritiker, nur Länge.
 *
 * Für die Bildunterschriften der **weiteren** Kanäle eines Bündels: die laufen
 * nicht durch `reviseWithCritic`, weil der Kritiker teuer ist und der
 * Leit-Text schon geprüft wurde. Aber die Länge muss trotzdem stimmen — der
 * Facebook-Text kam mit 557 Zeichen bei einem Ziel von 220, der TikTok-Text
 * mit 365 bei 140. Bis zu zwei Runden; ein Umschreiben, das nicht kürzer wird,
 * wird verworfen.
 */
export async function enforceLength(ctx: AgentContext, usage: UsageCollector, input: { body: string; target: number; limit?: number; language: string; voiceProfile: string | null }): Promise<{ body: string; rounds: number; ok: boolean }> {
  let body = input.body;
  let rounds = 0;
  while (body.length > input.target && rounds < 2) {
    rounds++;
    const rw = await chatJson(ctx.llm, modelFor("content"), Rewritten, rewritePrompt({ text: body, suggestions: [kuerzungsAuftrag(body.length, input.target)], language: input.language, voiceProfile: input.voiceProfile, limit: input.target }), usage, { maxTokens: 3000, temperature: 0.4 });
    if (rw.body.length < body.length && (!input.limit || rw.body.length <= input.limit)) body = rw.body;
  }
  return { body, rounds, ok: body.length <= input.target };
}
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
  const kuerzung = (t: string) => kuerzungsAuftrag(t.length, input.target ?? t.length);
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
