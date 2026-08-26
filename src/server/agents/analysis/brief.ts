import { eq } from "drizzle-orm";
import { Brief, type BriefMeta } from "../../../shared/schemas.js";
import { mpPages, mpProjects } from "../../db/schema.js";
import { nowIso, toJson } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { briefPrompt, type PageExcerpt } from "../prompts/analysis.js";
import { chatJson, clip, type AgentContext, type UsageCollector } from "../runner.js";

const KIND_ORDER = ["home", "pricing", "features", "docs", "changelog", "appstore", "github", "about", "blog", "other"];
const KIND_CAP: Record<string, number> = { home: 9000, pricing: 7000, features: 6000, docs: 5000, changelog: 3000, appstore: 4000, github: 5000, about: 2500, blog: 1500, other: 1500 };

export function pageExcerpts(ctx: AgentContext, projectId: string, totalCap = 48_000): PageExcerpt[] {
  const rows = ctx.db.select().from(mpPages).where(eq(mpPages.projectId, projectId)).all();
  rows.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const out: PageExcerpt[] = [];
  let used = 0;
  for (const r of rows) {
    const cap = Math.min(KIND_CAP[r.kind] ?? 1500, totalCap - used);
    if (cap < 300) break;
    const text = clip(r.text, cap);
    used += text.length;
    out.push({ url: r.url, kind: r.kind, title: r.title, text });
  }
  return out;
}

export function renderBriefMarkdown(b: Brief): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "_keine Angaben_");
  return [
    `# ${b.productName}`, "", `**${b.oneLiner}**`, "",
    `Kategorie: ${b.category} · Sprache: ${b.language}`, "",
    "## Zielgruppe (Selbstbeschreibung)", b.targetAudience || "_keine Angaben_", "",
    "## Alleinstellung", list(b.usp), "",
    "## Funktionen", list(b.features), "",
    "## Preise", b.pricing.length ? b.pricing.map((p) => `- **${p.plan}**: ${p.price}${p.notes ? ` – ${p.notes}` : ""}`).join("\n") : "_keine Angaben_", "",
    "## Tonalität", b.tone || "_keine Angaben_", "",
    "## Suchbegriffe", b.keywords.join(", ") || "_keine_", "",
    "## Quellen", list(b.sources),
  ].join("\n");
}

export async function runBriefStep(ctx: AgentContext, project: { id: string; url: string }, usage: UsageCollector): Promise<string> {
  const pages = pageExcerpts(ctx, project.id);
  if (!pages.length) throw new Error("Keine gecrawlten Seiten - erst den Crawl ausführen.");
  const model = modelFor("analysis");
  const brief = await chatJson(ctx.llm, model, Brief, briefPrompt({ url: project.url, pages }), usage, { maxTokens: 4000 });
  const meta: BriefMeta = { generatedAt: nowIso(), model, userEdited: false, editedFields: [], editedAt: null, confirmedAt: null };
  ctx.db.update(mpProjects).set({ brief: toJson(brief), briefMeta: toJson(meta), briefMarkdown: renderBriefMarkdown(brief), updatedAt: nowIso() })
    .where(eq(mpProjects.id, project.id)).run();
  return `${brief.productName}: ${brief.features.length} Funktionen, ${brief.pricing.length} Preispläne, ${brief.usp.length} USPs`;
}
