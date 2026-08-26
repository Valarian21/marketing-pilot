import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Brief, Channel, Competitor, Persona } from "../../../shared/schemas.js";
import { ChannelMeta } from "../../../shared/schemas.js";
import { mpChannels } from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { attentionMapPrompt } from "../prompts/analysis.js";
import { chatJson, type AgentContext, type UsageCollector } from "../runner.js";

export const ATTENTION_STATUS = "candidate";

const Out = z.object({
  channels: z.array(z.object({
    platform: z.string(), rank: z.number().int().min(1), format: z.string().default(""), cadence: z.string().default(""),
    reach: z.string().default(""), costEstimate: z.string().default(""), effort: z.string().default(""),
    rationale: z.string().default(""), evidenceRefs: z.array(z.string()).default([]),
  })).min(1),
});

export function listChannels(ctx: AgentContext, projectId: string): Channel[] {
  return ctx.db.select().from(mpChannels).where(eq(mpChannels.projectId, projectId)).orderBy(mpChannels.priority).all()
    .map((r) => ({ ...r, meta: ChannelMeta.parse(parseJson<Record<string, unknown>>(r.meta, {})) }));
}

export async function runAttentionStep(ctx: AgentContext, project: { id: string }, brief: Brief, personas: Persona[], competitors: Competitor[], usage: UsageCollector): Promise<string> {
  const out = await chatJson(ctx.llm, modelFor("strategy"), Out, attentionMapPrompt({ brief, personas, competitors, budgetEurMax: 300 }), usage, { maxTokens: 4000 });
  ctx.db.delete(mpChannels).where(and(eq(mpChannels.projectId, project.id), eq(mpChannels.status, ATTENTION_STATUS))).run();
  const ts = nowIso();
  const sorted = [...out.channels].sort((a, b) => a.rank - b.rank);
  sorted.forEach((c, i) => {
    ctx.db.insert(mpChannels).values({
      id: newId(), projectId: project.id, platform: c.platform, rationale: c.rationale, cadence: c.cadence, priority: i + 1, status: ATTENTION_STATUS,
      meta: toJson({ format: c.format, reach: c.reach, costEstimate: c.costEstimate, effort: c.effort, evidenceRefs: c.evidenceRefs }), createdAt: ts,
    }).run();
  });
  return `${sorted.length} Kanäle, Top 3: ${sorted.slice(0, 3).map((c) => c.platform).join(" · ")}`;
}
