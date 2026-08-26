import { z } from "zod";
import type { Brief, Competitor, Persona } from "../../../shared/schemas.js";
import { mpGeoSnapshots } from "../../db/schema.js";
import { newId, nowIso, toJson } from "../../db/index.js";
import { GEO_MODELS, modelFor } from "../../../../config/models.js";
import { geoJudgePrompt, geoQuestionsPrompt } from "../prompts/analysis.js";
import { chatJson, mapLimit, type AgentContext, type UsageCollector } from "../runner.js";

const Questions = z.object({ questions: z.array(z.object({ question: z.string(), persona: z.string().default(""), intent: z.string().default("discover") })).min(5) });
const Judge = z.object({ results: z.array(z.object({ engine: z.string(), mentioned: z.boolean(), position: z.number().int().nullable().default(null), competitorsMentioned: z.array(z.string()).default([]) })) });

export async function runGeoStep(
  ctx: AgentContext, project: { id: string; url: string }, brief: Brief, personas: Persona[], competitors: Competitor[],
  usage: UsageCollector, opts: { batch: string; count?: number; engines?: readonly string[] },
): Promise<string> {
  const engines = opts.engines ?? GEO_MODELS;
  const cheap = modelFor("critic");
  const q = await chatJson(ctx.llm, cheap, Questions, geoQuestionsPrompt({ brief, personas, count: opts.count ?? 25 }), usage, { maxTokens: 3000 });
  const questions = q.questions.slice(0, opts.count ?? 25);
  ctx.log(`geo: ${questions.length} Fragen × ${engines.length} Engines`);

  let failed = 0;
  const jobs = questions.flatMap((qq) => engines.map((engine) => ({ q: qq, engine })));
  const answers = await mapLimit(jobs, 4, async (job) => {
    try {
      const res = await ctx.llm.chat(job.engine, [{ role: "user", content: job.q.question }], { temperature: 0.3, maxTokens: 700 });
      usage.add(res.usage);
      return { ...job, text: res.text };
    } catch (e) {
      failed++;
      ctx.log(`geo: ${job.engine} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      return { ...job, text: null as string | null };
    }
  });

  const ts = nowIso();
  let mentioned = 0, total = 0;
  const compNames = competitors.map((c) => c.name);
  await mapLimit(questions, 3, async (qq) => {
    const got = answers.filter((a) => a.q === qq && a.text !== null) as { engine: string; text: string }[];
    if (!got.length) return;
    let judged: z.infer<typeof Judge>["results"] = [];
    try {
      judged = (await chatJson(ctx.llm, cheap, Judge, geoJudgePrompt({ productName: brief.productName, productUrl: project.url, competitors: compNames, question: qq.question, answers: got.map((g) => ({ engine: g.engine, text: g.text })) }), usage, { maxTokens: 1500 })).results;
    } catch (e) {
      ctx.log(`geo: Bewertung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const g of got) {
      const j = judged.find((x) => x.engine === g.engine) ?? { engine: g.engine, mentioned: false, position: null, competitorsMentioned: [] };
      total++; if (j.mentioned) mentioned++;
      ctx.db.insert(mpGeoSnapshots).values({
        id: newId(), projectId: project.id, engine: g.engine, query: qq.question, mentioned: j.mentioned, position: j.position,
        competitorsMentioned: toJson(j.competitorsMentioned), rawAnswer: g.text.slice(0, 8000), batch: opts.batch, takenAt: ts,
      }).run();
    }
  });
  const pct = total ? Math.round((mentioned / total) * 100) : 0;
  return `${questions.length} Fragen, ${total} Antworten, Sichtbarkeit ${pct} %` + (failed ? `, ${failed} Aufrufe fehlgeschlagen` : "");
}
