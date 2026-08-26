/**
 * Prompt builders for the analysis pipeline. Pure functions (input -> messages)
 * so they can be snapshot-tested. Every system prompt starts with a `[task:…]`
 * marker that tests and logs key on. Output language follows the product.
 */
import type { LlmMessage } from "../../providers/index.js";
import type { Brief, Competitor, Persona } from "../../../shared/schemas.js";

const lang = (code: string): string => (code.toLowerCase().startsWith("de") ? "German" : code.toLowerCase().startsWith("en") ? "English" : code);

export interface PageExcerpt { url: string; kind: string; title: string; text: string }

export function briefPrompt(input: { url: string; pages: PageExcerpt[] }): LlmMessage[] {
  const pages = input.pages.map((p) => `### [${p.kind}] ${p.title || p.url}\nURL: ${p.url}\n${p.text}`).join("\n\n");
  return [
    { role: "system", content: `[task:brief]
You are a senior product marketer. From the crawled pages of a software product, write a precise PRODUCT BRIEF as JSON.
Rules:
- Only state what the pages support. No invented features or prices. Empty array when unknown.
- "oneLiner": the core benefit in ONE sentence, from the user's perspective, no marketing fluff.
- "targetAudience": how the product itself describes its users (quote-like, not your guess).
- "tone": 1-2 sentences describing the product's own voice (formal/informal, du/Sie, humour, jargon).
- "category": a short generic product category in English (e.g. "worksheet generator for teachers") - used for web searches.
- "language": ISO code of the product's primary language (de, en, ...).
- "keywords": 8-15 search phrases prospects would type, in the product's language.
- "sources": the URLs you actually used.
Write all free-text fields in the product's own language.
Return JSON: {"productName","oneLiner","category","language","features":[],"pricing":[{"plan","price","notes"}],"usp":[],"tone","targetAudience","keywords":[],"sources":[]}` },
    { role: "user", content: `Product URL: ${input.url}\n\n${pages}` },
  ];
}

export function competitorCandidatesPrompt(input: { brief: Brief; hits: { title: string; url: string; snippet: string }[] }): LlmMessage[] {
  const hits = input.hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n");
  return [
    { role: "system", content: `[task:competitor-candidates]
You identify DIRECT competitors of a software product: tools a prospect would realistically compare it with (same job, similar audience). Exclude the product itself, generic platforms (Canva, Google Docs) unless they are the real alternative, listicles, agencies and news sites.
Use the search results as evidence; you may add well-known competitors you are certain exist, each with its real homepage URL.
Return 5-10 competitors as JSON: {"competitors":[{"name","url","why"}]} - "why" is one sentence in ${lang(input.brief.language)}.` },
    { role: "user", content: `Product: ${input.brief.productName} - ${input.brief.oneLiner}\nCategory: ${input.brief.category}\nAudience: ${input.brief.targetAudience}\n\nSearch results:\n${hits}` },
  ];
}

export function competitorDetailPrompt(input: { brief: Brief; name: string; url: string; pageText: string; reviews: { url: string; text: string }[] }): LlmMessage[] {
  const reviews = input.reviews.map((r) => `--- SOURCE ${r.url}\n${r.text}`).join("\n\n");
  return [
    { role: "system", content: `[task:competitor-detail]
Profile one competitor of "${input.brief.productName}" from its own website and from review/discussion pages.
- "positioning": 2-3 sentences - who it is for and how it sells itself.
- "pricing": concise, with numbers if present ("Free; Pro 9 €/month"), else "unbekannt".
- "complaints": the 5 most frequent complaints users voice about it. Each with "text" (the complaint, paraphrased), "quote" (a verbatim snippet from a source, max 200 chars, empty if none), "source" (site name, e.g. "Reddit", "G2", "App Store"), "url" (the source URL you took it from). Only complaints you can actually see in the sources; fewer than 5 is fine. Never invent quotes.
Write free text in ${lang(input.brief.language)}. Return JSON: {"positioning","pricing","complaints":[{"text","quote","source","url"}]}` },
    { role: "user", content: `Competitor: ${input.name} (${input.url})\n\n--- WEBSITE\n${input.pageText}\n\n${reviews}` },
  ];
}

export function personasPrompt(input: { brief: Brief; competitors: Competitor[]; excerpts: PageExcerpt[] }): LlmMessage[] {
  const comp = input.competitors.map((c) => `- ${c.name}: ${c.positioning}\n  complaints: ${c.complaints.map((x) => `"${x.text}" (${x.source} ${x.url})`).join("; ")}`).join("\n");
  const pages = input.excerpts.map((p) => `### ${p.kind} ${p.url}\n${p.text}`).join("\n\n");
  return [
    { role: "system", content: `[task:personas]
Build 2-4 buyer personas for "${input.brief.productName}". Ground every persona in the material: the product's own audience description, competitor complaints (these reveal what people struggle with) and the pages.
Per persona:
- "name": short role label (e.g. "Grundschullehrerin mit Doppelbelastung"), "description": 2-3 sentences.
- "language": ISO code they write in.
- "phrases": 4-8 REAL formulations from the sources - how they describe the problem in their own words (verbatim or near-verbatim, not marketing copy).
- "painPoints": 3-6 concrete pains. "objections": 2-4 reasons they hesitate to buy. "buyingTriggers": 2-4 moments that make them act.
- "whereTheyHangOut": specific places - subreddits (r/...), forums, Discord servers, YouTube channels, hashtags, newsletters, Facebook groups. Name them concretely; mark guesses with "(vermutet)".
- "evidence": 3-6 items {"claim","quote","url"} linking statements to the sources above.
Write free text in ${lang(input.brief.language)}. Return JSON: {"personas":[{"name","description","language","phrases":[],"painPoints":[],"objections":[],"buyingTriggers":[],"whereTheyHangOut":[],"evidence":[{"claim","quote","url"}]}]}` },
    { role: "user", content: `BRIEF\n${JSON.stringify(input.brief, null, 1)}\n\nCOMPETITORS\n${comp || "(none found)"}\n\nPAGES\n${pages}` },
  ];
}

export function attentionMapPrompt(input: { brief: Brief; personas: Persona[]; competitors: Competitor[]; budgetEurMax: number }): LlmMessage[] {
  const personas = input.personas.map((p) => `- ${p.name}: pains ${p.painPoints.join("; ")} | hangouts ${p.whereTheyHangOut.join(", ")}`).join("\n");
  const comp = input.competitors.map((c) => `- ${c.name}: ${c.complaints.map((x) => x.text).join("; ")}`).join("\n");
  return [
    { role: "system", content: `[task:attention-map]
Rank marketing channels for "${input.brief.productName}" by REACHABILITY OF THE PERSONAS with a budget of 0-${input.budgetEurMax} € per month and one founder's time. Think: where do these personas already pay attention, where do competitor complaints create openings, what can a solo founder sustain.
Return 6-10 channels, best first, JSON: {"channels":[{"platform","rank","format","cadence","reach","costEstimate","effort","rationale","evidenceRefs":[]}]}
- "platform": e.g. "Reddit r/lehrerzimmer", "Instagram Reels", "Directories (AlternativeTo, Product Hunt)", "SEO/GEO comparison pages", "YouTube Shorts", "Newsletter sponsorships".
- "rationale": 2-3 sentences that explicitly reference persona names and competitor complaints from the input.
- "evidenceRefs": names of personas/competitors the rationale relies on.
- "reach": qualitative estimate for THIS audience, "costEstimate": € per month, "effort": hours per week.
Exclude anything that automates engagement (mass DMs, follow/unfollow, bots). Write free text in ${lang(input.brief.language)}.` },
    { role: "user", content: `BRIEF: ${input.brief.oneLiner}\nAudience: ${input.brief.targetAudience}\nUSP: ${input.brief.usp.join("; ")}\n\nPERSONAS\n${personas}\n\nCOMPETITOR COMPLAINTS\n${comp || "(none)"}` },
  ];
}

export function geoQuestionsPrompt(input: { brief: Brief; personas: Persona[]; count: number }): LlmMessage[] {
  const personas = input.personas.map((p) => `- ${p.name} (${p.language}): ${p.painPoints.join("; ")} | phrases: ${p.phrases.slice(0, 4).join(" / ")}`).join("\n");
  return [
    { role: "system", content: `[task:geo-questions]
Generate ${input.count} questions with BUYING INTENT that these personas would type into an AI chatbot (ChatGPT, Claude, Gemini, Perplexity) when looking for a tool like "${input.brief.productName}". Mix: "best tool for …", "X vs Y", "is there an app that …", "how do I … quickly", price questions, "alternatives to <competitor>". Use the personas' own wording and language. Do NOT mention "${input.brief.productName}" in the questions.
Return JSON: {"questions":[{"question","persona","intent"}]} where intent is one of "discover","compare","price","alternative","howto".` },
    { role: "user", content: `Product: ${input.brief.oneLiner}\nCategory: ${input.brief.category}\nCompetitors known: (see personas)\n\nPERSONAS\n${personas}` },
  ];
}

export function geoJudgePrompt(input: { productName: string; productUrl: string; competitors: string[]; question: string; answers: { engine: string; text: string }[] }): LlmMessage[] {
  const answers = input.answers.map((a) => `=== ENGINE ${a.engine}\n${a.text}`).join("\n\n");
  return [
    { role: "system", content: `[task:geo-judge]
You evaluate chatbot answers for brand visibility. Product: "${input.productName}" (${input.productUrl}). Known competitors: ${input.competitors.join(", ") || "(none)"}.
For EACH engine answer decide: "mentioned" - is the product named (name or domain, any spelling)? "position" - its rank among recommended tools in that answer (1 = first named), null if not mentioned or answer has no list. "competitorsMentioned" - which tools/brands are recommended (from the known list AND any other product names in the answer).
Return JSON: {"results":[{"engine","mentioned","position","competitorsMentioned":[]}]} with exactly one entry per engine, same engine ids as given.` },
    { role: "user", content: `QUESTION: ${input.question}\n\n${answers}` },
  ];
}
