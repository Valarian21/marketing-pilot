import { eq } from "drizzle-orm";
import { z } from "zod";
import { Evidence, type Brief, type Competitor, type Persona } from "../../../shared/schemas.js";
import { mpPersonas } from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { personasPrompt } from "../prompts/analysis.js";
import { chatJson, type AgentContext, type UsageCollector } from "../runner.js";
import { pageExcerpts } from "./brief.js";

const PersonaOut = z.object({
  name: z.string(), description: z.string().default(""), language: z.string().default("de"),
  phrases: z.array(z.string()).default([]), painPoints: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]), buyingTriggers: z.array(z.string()).default([]),
  whereTheyHangOut: z.array(z.string()).default([]), evidence: z.array(Evidence).default([]),
});
const Out = z.object({ personas: z.array(PersonaOut).min(1).max(6) });

export function listPersonas(ctx: AgentContext, projectId: string): Persona[] {
  return ctx.db.select().from(mpPersonas).where(eq(mpPersonas.projectId, projectId)).all().map((r) => ({
    ...r,
    painPoints: parseJson<string[]>(r.painPoints, []), phrases: parseJson<string[]>(r.phrases, []),
    objections: parseJson<string[]>(r.objections, []), buyingTriggers: parseJson<string[]>(r.buyingTriggers, []),
    whereTheyHangOut: parseJson<string[]>(r.whereTheyHangOut, []), evidence: parseJson<Persona["evidence"]>(r.evidence, []),
  }));
}

export async function runPersonasStep(ctx: AgentContext, project: { id: string }, brief: Brief, competitors: Competitor[], usage: UsageCollector): Promise<string> {
  const excerpts = pageExcerpts(ctx, project.id, 14_000);
  const out = await chatJson(ctx.llm, modelFor("analysis"), Out, personasPrompt({ brief, competitors, excerpts }), usage, { maxTokens: 5000 });
  ctx.db.delete(mpPersonas).where(eq(mpPersonas.projectId, project.id)).run();
  const ts = nowIso();
  for (const p of out.personas.slice(0, 4)) {
    ctx.db.insert(mpPersonas).values({
      id: newId(), projectId: project.id, name: p.name, description: p.description, language: p.language,
      painPoints: toJson(p.painPoints), phrases: toJson(p.phrases), objections: toJson(p.objections), buyingTriggers: toJson(p.buyingTriggers),
      whereTheyHangOut: toJson(p.whereTheyHangOut), evidence: toJson(p.evidence), createdAt: ts,
    }).run();
  }
  return `${Math.min(out.personas.length, 4)} Personas: ${out.personas.slice(0, 4).map((p) => p.name).join(", ")}`;
}
