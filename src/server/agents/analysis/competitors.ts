import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Brief, Competitor } from "../../../shared/schemas.js";
import { Complaint } from "../../../shared/schemas.js";
import { mpCompetitors } from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { fetchPage, hostOf } from "../../providers/html.js";
import type { SearchHit } from "../../providers/index.js";
import { competitorCandidatesPrompt, competitorDetailPrompt } from "../prompts/analysis.js";
import { chatJson, mapLimit, type AgentContext, type UsageCollector } from "../runner.js";

const Candidates = z.object({ competitors: z.array(z.object({ name: z.string(), url: z.string(), why: z.string().default("") })).min(1) });
const Detail = z.object({ positioning: z.string().default(""), pricing: z.string().default(""), complaints: z.array(Complaint).default([]) });

const REVIEW_HOSTS = /reddit\.com|g2\.com|capterra|trustpilot|apps\.apple\.com|play\.google\.com|omr\.com|producthunt|getapp|softwareadvice|trustradius|alternativeto|slant\.co|news\.ycombinator/i;

export async function searchMany(ctx: AgentContext, queries: string[], limit: number, excludeHosts: string[]): Promise<SearchHit[]> {
  const out: SearchHit[] = [];
  for (const q of queries) {
    try {
      const hits = await ctx.search.search(q, { limit });
      for (const h of hits) {
        const host = hostOf(h.url);
        if (!host || excludeHosts.includes(host) || out.some((o) => o.url === h.url)) continue;
        out.push(h);
      }
    } catch (e) {
      ctx.log(`Suche fehlgeschlagen "${q}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

export function competitorQueries(brief: Brief): string[] {
  const c = brief.category.trim();
  const de = brief.language.toLowerCase().startsWith("de");
  const qs = [`${c} alternatives`, `best ${c} tools`, `${brief.productName} alternative`, `${c} comparison`];
  if (de) qs.push(`${brief.keywords[0] ?? c} Anbieter Vergleich`, `${brief.keywords[1] ?? c} Alternative`);
  return qs;
}

export function listCompetitors(ctx: AgentContext, projectId: string): Competitor[] {
  return ctx.db.select().from(mpCompetitors).where(eq(mpCompetitors.projectId, projectId)).all()
    .map((r) => ({ ...r, complaints: parseJson<Competitor["complaints"]>(r.complaints, []) }));
}

export async function runCompetitorsStep(ctx: AgentContext, project: { id: string; url: string }, brief: Brief, usage: UsageCollector): Promise<string> {
  const ownHost = hostOf(project.url);
  const hits = await searchMany(ctx, competitorQueries(brief), 10, [ownHost]);
  ctx.log(`competitors: ${hits.length} Suchtreffer`);
  const strong = modelFor("analysis");
  const cands = await chatJson(ctx.llm, strong, Candidates, competitorCandidatesPrompt({ brief, hits }), usage);
  const unique = cands.competitors.filter((c, i, arr) => hostOf(c.url) && hostOf(c.url) !== ownHost && arr.findIndex((x) => hostOf(x.url) === hostOf(c.url)) === i).slice(0, 10);

  const details = await mapLimit(unique, 2, async (c) => {
    ctx.log(`competitor: ${c.name}`);
    let pageText = "";
    try { pageText = (await fetchPage(c.url, { maxChars: 8000 })).text; } catch (e) { ctx.log(`${c.name}: Website nicht lesbar (${e instanceof Error ? e.message : e})`); }
    const reviewHits = await searchMany(ctx, [`${c.name} reviews`, `${c.name} erfahrungen`, `${c.name} reddit`], 6, [hostOf(c.url), ownHost]);
    const picked = [...reviewHits.filter((h) => REVIEW_HOSTS.test(h.url)), ...reviewHits.filter((h) => !REVIEW_HOSTS.test(h.url))].slice(0, 4);
    const reviews = (await mapLimit(picked, 2, async (h) => {
      try { const f = await fetchPage(h.url, { maxChars: 6000 }); return f.text.length > 200 ? { url: h.url, text: f.text } : null; } catch { return null; }
    })).filter((r): r is { url: string; text: string } => r !== null);
    const d = await chatJson(ctx.llm, strong, Detail, competitorDetailPrompt({ brief, name: c.name, url: c.url, pageText, reviews }), usage, { maxTokens: 4000 });
    return { ...c, ...d };
  });

  ctx.db.delete(mpCompetitors).where(eq(mpCompetitors.projectId, project.id)).run();
  const ts = nowIso();
  for (const d of details) {
    ctx.db.insert(mpCompetitors).values({ id: newId(), projectId: project.id, name: d.name, url: d.url, positioning: d.positioning, pricing: d.pricing, complaints: toJson(d.complaints), createdAt: ts }).run();
  }
  const complaints = details.reduce((n, d) => n + d.complaints.length, 0);
  return `${details.length} Wettbewerber, ${complaints} belegte Beschwerden`;
}
