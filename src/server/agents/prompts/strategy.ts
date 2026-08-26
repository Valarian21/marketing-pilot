/** Prompt builders for Shot 2: channel plan, task generation, generic task execution. Pure functions. */
import type { LlmMessage } from "../../providers/index.js";
import type { Brief, Channel, Competitor, Persona, StrategyPlan, Task } from "../../../shared/schemas.js";
import { writingRules } from "./voice.js";

const lang = (code: string): string => (code.toLowerCase().startsWith("de") ? "German" : code);

export interface GeoSummary { visibility: number | null; perModel: { model: string; asked: number; mentioned: number }[]; topCompetitors: string[] }

export function strategyPrompt(input: { brief: Brief; personas: Persona[]; channels: Channel[]; competitors: Competitor[]; geo: GeoSummary; startDate: string; previousPlan?: StrategyPlan | null; note?: string }): LlmMessage[] {
  const personas = input.personas.map((p) => `- ${p.name}: pains ${p.painPoints.join("; ")} | triggers ${p.buyingTriggers.join("; ")} | hangouts ${p.whereTheyHangOut.join(", ")}`).join("\n");
  const attention = input.channels.map((c) => `${c.priority}. ${c.platform} (${c.meta.format || "-"}, ${c.meta.costEstimate || "?"}, ${c.meta.effort || "?"}): ${c.rationale}`).join("\n");
  const competitors = input.competitors.map((c) => `- ${c.name}: ${c.positioning} | complaints: ${c.complaints.map((x) => x.text).join("; ")}`).join("\n");
  const geo = input.geo.visibility === null ? "no GEO baseline" : `visibility ${Math.round(input.geo.visibility * 100)}% (${input.geo.perModel.map((m) => `${m.model}: ${m.mentioned}/${m.asked}`).join(", ")}); competitors named by chatbots: ${input.geo.topCompetitors.join(", ") || "none"}`;
  const prev = input.previousPlan ? `\n\nPREVIOUS PLAN (produce an updated plan; keep what works, change what the note asks for):\n${JSON.stringify(input.previousPlan)}\nNOTE FROM USER: ${input.note ?? "(none)"}` : "";
  return [
    { role: "system", content: `[task:strategy]
You are a pragmatic growth lead for a one-founder software product. Produce a CHANNEL PLAN as JSON, grounded ONLY in the analysis below. Every recommendation carries one sentence of rationale that explicitly references a persona, a competitor complaint, the attention map rank or the GEO baseline.
- "channels": 2-3 with role "start" (what we do in the first 90 days), optionally 1-2 with role "later". Each: platform, format (e.g. "Reels 20-45 s", "Vergleichsartikel", "Directory-Eintrag", "Community-Antworten"), cadence ("3×/Woche"), rationale, evidenceRefs (names from the analysis).
- "goals": exactly three, horizonDays 30, 60, 90. metric MUST be a business number (signups, activated users, paid) - never likes or followers. Targets are conservative and justified.
- "budget": monthlyEur between 0 and 300, with items (what the money buys) and rationale. Directory entries, community replies and own content are free; ads only as small tests.
- "coreMessage": the one sentence we repeat everywhere, derived from the brief's USP and the strongest competitor complaint.
- "risks": 2-4 with mitigation.
- "summary": 3-5 sentences in ${lang(input.brief.language)} a founder reads on Monday morning.
- "startDate": "${input.startDate}".
Never propose engagement automation (follow/unfollow, mass DMs, bots). Write free text in ${lang(input.brief.language)}.
Return JSON: {"summary","startDate","coreMessage":{"text","rationale"},"channels":[{"platform","role","format","cadence","rationale","evidenceRefs":[]}],"goals":[{"horizonDays","metric","target","rationale"}],"budget":{"monthlyEur","items":[{"item","eur","rationale"}],"rationale"},"risks":[{"text","mitigation"}]}` },
    { role: "user", content: `BRIEF\n${JSON.stringify(input.brief)}\n\nPERSONAS\n${personas || "(none)"}\n\nATTENTION MAP (ranked)\n${attention || "(none)"}\n\nCOMPETITORS\n${competitors || "(none)"}\n\nGEO BASELINE\n${geo}${prev}` },
  ];
}

export function tasksPrompt(input: { brief: Brief; plan: StrategyPlan; personas: Persona[]; weeks: number }): LlmMessage[] {
  return [
    { role: "system", content: `[task:tasks]
Turn the channel plan into concrete TASKS for the first ${input.weeks} weeks. 4-8 tasks per week, each small enough for one sitting.
Fields: "week" (1-${input.weeks}), "dayOffset" (0-6, day within the week), "title" (imperative, specific, in ${lang(input.brief.language)}), "description" (what "done" looks like, 1-3 sentences), "type" one of research|strategy|content|publish|community|ads|measure, "channel" (platform name exactly as in the plan, or "" for cross-channel), "assignedTo" agent|human, "approvalLevel" auto|review|human_only.
Assignment rules:
- Preparation work (research, drafting posts/reels/directory entries, finding threads, writing replies) -> "agent".
- Anything that touches the outside world (posting, submitting, replying, spending money, approving) -> "human". Reddit, forums, Discord and any ad budget are ALWAYS assignedTo "human" with approvalLevel "human_only".
- Every agent content task is followed by a matching human review/publish task ("… freigeben und posten").
- approvalLevel: "review" is the default for everything; "human_only" ONLY for Reddit/forums/Discord posting and anything spending money; "auto" never in the first 4 weeks.
- Week 1 starts with quick wins: directory entries, product screenshots, first community threads. Include one "measure" task at the end of weeks 2 and 4 (signups per channel, GEO re-check).
Examples of good titles: "Directory-Eintrag bei AlternativeTo vorbereiten", "r/lehrerzimmer: 3 passende Threads finden und Antworten entwerfen", "Antworten posten", "Reel #1: Onboarding-Demo", "Reel #1 freigeben".
Return JSON: {"tasks":[{"week","dayOffset","title","description","type","channel","assignedTo","approvalLevel"}]}` },
    { role: "user", content: `PLAN\n${JSON.stringify(input.plan)}\n\nPERSONAS\n${input.personas.map((p) => `- ${p.name}: ${p.whereTheyHangOut.join(", ")}`).join("\n")}\n\nPRODUCT: ${input.brief.productName} - ${input.brief.oneLiner} (${input.brief.language})` },
  ];
}

export function executeTaskPrompt(input: { brief: Brief; task: Task; personas: Persona[]; plan: StrategyPlan | null; format: string }): LlmMessage[] {
  const persona = input.personas[0];
  return [
    { role: "system", content: `[task:execute]
You execute ONE marketing task for "${input.brief.productName}" and return a draft the founder reviews before anything is published.
Output format: "${input.format}". Produce "title" (internal label), "body" (the deliverable itself - the post text, the article in Markdown, the list of threads with draft replies, the directory fields, or the research notes), and "notes" (what the human must check or fill in).
${writingRules({ language: input.brief.language, community: input.task.type === "community" })}
Facts about the product come ONLY from the brief; mark anything else as [PLATZHALTER: …].
Return JSON: {"title","body","notes"}` },
    { role: "user", content: `TASK: ${input.task.title}\n${input.task.description}\nType: ${input.task.type} | Channel: ${input.task.channel || "-"} | Week ${input.task.week}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nPRIMARY PERSONA\n${persona ? `${persona.name}: ${persona.description} | pains: ${persona.painPoints.join("; ")} | phrases: ${persona.phrases.join(" / ")}` : "(none)"}\n\nCORE MESSAGE: ${input.plan?.coreMessage.text ?? "(none)"}` },
  ];
}
