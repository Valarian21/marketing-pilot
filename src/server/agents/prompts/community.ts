/** Prompt builders for Shot 5: thread scoring, reply drafting, weekly report. Pure functions. */
import type { LlmMessage } from "../../providers/index.js";
import type { Brief, Persona, StrategyPlan } from "../../../shared/schemas.js";
import { writingRules } from "./voice.js";

const lang = (code: string): string => (code.toLowerCase().startsWith("de") ? "German" : code);

export interface ThreadCandidate { id: string; platform: string; url: string; title: string; excerpt: string; community: string }

export function scoreThreadsPrompt(input: { brief: Brief; personas: Persona[]; threads: ThreadCandidate[] }): LlmMessage[] {
  const pains = input.personas.map((p) => `- ${p.name}: ${p.painPoints.join("; ")} | phrases: ${p.phrases.slice(0, 4).join(" / ")}`).join("\n");
  return [
    { role: "system", content: `[task:score-threads]
Score community threads 0-100 for how well a helpful reply from the maker of "${input.brief.productName}" would fit. High: the author has a pain the product solves and is asking for tools/advice/experiences. Medium: related discussion where a genuine tip helps. Low: news, memes, unrelated, or threads where any product mention would be spam. Also flag "askingForTools" (they explicitly ask for recommendations).
Return JSON: {"scores":[{"id","score","reason","askingForTools"}]} - one entry per thread, reason in ${lang(input.brief.language)} (max 20 words).` },
    { role: "user", content: `PRODUCT: ${input.brief.oneLiner}\nCATEGORY: ${input.brief.category}\n\nPERSONA PAINS\n${pains || "(none)"}\n\nTHREADS\n${input.threads.map((t) => `[${t.id}] (${t.platform} ${t.community}) ${t.title}\n${t.excerpt.slice(0, 500)}`).join("\n\n")}` },
  ];
}

export function replyDraftPrompt(input: { brief: Brief; persona?: Persona; thread: ThreadCandidate; rules: string; linksAllowed: boolean; voiceProfile: string | null; productUrl: string }): LlmMessage[] {
  return [
    { role: "system", content: `[task:reply-draft]
Draft a reply for the founder of "${input.brief.productName}" to post in this ${input.thread.platform} thread. The human will edit and post it - never claim it was posted.
COMMUNITY RULES (read and obey; quote the relevant rule in "rulesNote"):
${input.rules || "(no rules could be fetched - assume: no self-promotion, no links in comments)"}
${input.linksAllowed ? "Links seem allowed - at most one, at the very end, only if it truly helps." : "Do NOT include any link; name the product at most once in the last third."}
${writingRules({ language: input.brief.language, community: true, voiceProfile: input.voiceProfile })}
Return JSON: {"reply": "<the comment text>", "rulesNote": "<which rule matters and how the draft respects it>", "mentionsProduct": true|false}` },
    { role: "user", content: `THREAD: ${input.thread.title}\n${input.thread.excerpt}\n\nURL: ${input.thread.url}\n\nPRODUCT FACTS (only these)\n${JSON.stringify({ name: input.brief.productName, oneLiner: input.brief.oneLiner, features: input.brief.features.slice(0, 8), pricing: input.brief.pricing, url: input.productUrl })}\n\nPERSONA\n${input.persona ? `${input.persona.name}: ${input.persona.description}` : "(none)"}` },
  ];
}

export interface WeekFacts {
  weekStart: string;
  signups: number; activated: number; paid: number; signupsPrevWeek: number;
  byChannel: { source: string; signups: number }[];
  published: { title: string; channel: string; format: string; signups: number }[];
  tasksDone: number; tasksOpen: number; tasksSkipped: number;
  leadsAnswered: number;
  geoVisibility: number | null; geoVisibilityPrev: number | null;
  goals: { horizonDays: number; metric: string; target: number }[];
}

export function weeklyReportPrompt(input: { brief: Brief; plan: StrategyPlan; facts: WeekFacts; voiceProfile: string | null }): LlmMessage[] {
  return [
    { role: "system", content: `[task:weekly-report]
You are the growth lead writing the Sunday-evening report for the founder of "${input.brief.productName}". Plain text, ${lang(input.brief.language)}, 150-300 words, three parts with these exact headings: "Was lief", "Was nicht", "Nächste Woche anders". Numbers first, no fluff, no praise. If data is thin, say so and what to measure next.
Then propose an UPDATED PLAN as JSON with the same schema as the current plan (only change what the facts justify - keep channels/goals that work, drop or adjust what did not, keep startDate; goals are cumulative targets, do not lower them without a reason stated in the report).
Return JSON: {"report": "<text>", "plan": {<full StrategyPlan>}, "nextWeekFocus": ["<3-5 bullet points>"]}` },
    { role: "user", content: `CURRENT PLAN\n${JSON.stringify(input.plan)}\n\nFACTS FOR WEEK OF ${input.facts.weekStart}\n${JSON.stringify(input.facts, null, 1)}` },
  ];
}

export function nextWeekTasksPrompt(input: { brief: Brief; plan: StrategyPlan; week: number; focus: string[]; openTasks: { title: string; type: string }[] }): LlmMessage[] {
  return [
    { role: "system", content: `[task:tasks]
Create 5-8 TASKS for week ${input.week} of the plan, following the focus points from the weekly report. Same task rules as before: fields week (=${input.week}), dayOffset 0-6, title (imperative, ${lang(input.brief.language)}), description, type research|strategy|content|publish|community|ads|measure, channel (exactly as in the plan or ""), assignedTo agent|human, approvalLevel review|human_only. Preparation -> agent; posting/submitting/spending -> human; Reddit/forums/Discord/ads -> human_only. Do not repeat still-open tasks.
Return JSON: {"tasks":[{"week","dayOffset","title","description","type","channel","assignedTo","approvalLevel"}]}` },
    { role: "user", content: `FOCUS\n${input.focus.map((f) => `- ${f}`).join("\n")}\n\nSTILL OPEN\n${input.openTasks.map((t) => `- [${t.type}] ${t.title}`).join("\n") || "(none)"}\n\nPLAN\n${JSON.stringify(input.plan)}` },
  ];
}
