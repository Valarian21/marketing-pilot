/** Prompt builders for the Content Studio (Shot 3). Pure functions, snapshot-tested. */
import type { LlmMessage } from "../../providers/index.js";
import type { Brief, Persona, VoiceSample } from "../../../shared/schemas.js";
import { BANNED_PHRASES, writingRules } from "./voice.js";

const lang = (code: string): string => (code.toLowerCase().startsWith("de") ? "German" : code);
const personaBlock = (p: Persona | undefined) => (p ? `${p.name}: ${p.description} | pains: ${p.painPoints.join("; ")} | phrases: ${p.phrases.slice(0, 5).join(" / ")}` : "(none)");

export function voiceProfilePrompt(input: { samples: VoiceSample[]; brief: Brief }): LlmMessage[] {
  return [
    { role: "system", content: `[task:voice-profile]
Derive a VOICE PROFILE of the author from their own texts. Be concrete and quote from the samples.
- "address": du | Sie | mixed | n/a. "sentenceLength": e.g. "kurz, 8-14 Wörter, gelegentlich ein langer Satz". "favoriteWords": 6-12 words/phrases they actually use. "humor": how (dry, self-deprecating, none). "typicalOpeners": 3-6 real openers from the samples. "noGos": things they never do (from evidence: no emojis, no exclamation marks, ...).
- "summary": 3 sentences in ${lang(input.brief.language)}.
- "promptBlock": 8-14 lines, imperative, in English, that a writing model can follow to imitate this author (include 3 verbatim example sentences from the samples).
Return JSON: {"summary","address","sentenceLength","favoriteWords":[],"humor","typicalOpeners":[],"noGos":[],"promptBlock"}` },
    { role: "user", content: `PRODUCT: ${input.brief.productName} (${input.brief.language})\n\nSAMPLES (${input.samples.length}):\n${input.samples.map((s, i) => `--- SAMPLE ${i + 1}${s.source ? ` (${s.source})` : ""}\n${s.text}`).join("\n\n")}` },
  ];
}

export function criticPrompt(input: { text: string; language: string; voiceProfile: string | null; format: string; platform?: string }): LlmMessage[] {
  return [
    { role: "system", content: `[task:ai-tell-critic]
You are a merciless editor hunting AI tells. Score the text 0-10 (10 = reads like a specific human wrote it, 0 = generic AI copy).
Check against: banned phrases (${BANNED_PHRASES.join(", ")}); rhetorical question openers answered immediately; triple adjective staccato lists; emojis as bullets; hashtag walls; "It is important to note"; closing summaries; excessive em dashes; vague claims without numbers; marketing register; sentences that could be about any product.
${input.voiceProfile ? `Also score fit with this VOICE PROFILE:\n${input.voiceProfile}` : "No voice profile: judge naturalness only."}
Return JSON: {"score": 0-10, "issues": ["quote the offending passage - why"], "suggestions": ["concrete rewrite instruction"]} with 2-6 issues and suggestions. Write issues/suggestions in ${lang(input.language)}.` },
    { role: "user", content: `FORMAT: ${input.format}${input.platform ? ` / ${input.platform}` : ""}\n\nTEXT:\n${input.text}` },
  ];
}

export function rewritePrompt(input: { text: string; suggestions: string[]; language: string; voiceProfile: string | null; limit?: number }): LlmMessage[] {
  return [
    { role: "system", content: `[task:rewrite]
Rewrite the text applying the editor's suggestions. Keep facts, intent and length class. ${input.limit ? `Hard limit ${input.limit} characters.` : ""}
${writingRules({ language: input.language, voiceProfile: input.voiceProfile })}
Return JSON: {"body"}` },
    { role: "user", content: `SUGGESTIONS:\n${input.suggestions.map((s) => `- ${s}`).join("\n")}\n\nTEXT:\n${input.text}` },
  ];
}

export function textPostPrompt(input: { brief: Brief; persona?: Persona; platform: string; limit: number; topic: string; hint: string; coreMessage: string | null; voiceProfile: string | null; screenshotsAvailable: number }): LlmMessage[] {
  return [
    { role: "system", content: `[task:text-post]
Write ONE ${input.platform} post for "${input.brief.productName}". Hard limit: ${input.limit} characters (count them). One thought per post. Max 2 hashtags, only if natural on ${input.platform}; none on LinkedIn/X unless a real community tag.
${input.platform === "linkedin" ? "LinkedIn: first line must work as a hook before 'mehr anzeigen'; short paragraphs; no hashtag block." : ""}
${input.platform === "x" ? "X: one idea, no thread unless asked; no link in the first post if possible." : ""}
${input.screenshotsAvailable ? `${input.screenshotsAvailable} product screenshots exist - reference what the reader will see ("im Screenshot ...") when it helps.` : ""}
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return JSON: {"title": "<short internal label, max 60 chars, e.g. 'LinkedIn: Sonntagabend'>", "body": "<the post>", "altText": "<alt text for an attached screenshot, or empty>"}` },
    { role: "user", content: `TOPIC: ${input.topic || "(pick the strongest angle from the brief)"}\nHINT: ${input.hint || "-"}\nCORE MESSAGE: ${input.coreMessage ?? "-"}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nPERSONA\n${personaBlock(input.persona)}` },
  ];
}

export function carouselPrompt(input: { brief: Brief; persona?: Persona; topic: string; hint: string; voiceProfile: string | null; screenshots: { id: string; label: string }[]; slides: number }): LlmMessage[] {
  return [
    { role: "system", content: `[task:carousel]
Plan a ${input.slides}-slide carousel (Instagram/LinkedIn) for "${input.brief.productName}". Slide 1 = hook (max 8 words + one supporting line), middle slides = one idea each (headline max 8 words, body max 30 words), last slide = CTA with the product name and what to do.
${input.screenshots.length ? `Product screenshots available (use 1-3 of them as slides with kind "screenshot" and the matching "screenshotId"): ${input.screenshots.map((s) => `${s.id} = ${s.label}`).join("; ")}` : "No screenshots available - text slides only."}
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return JSON: {"title": "<short internal label, max 60 chars>", "caption": "<post caption, max 600 chars, max 2 hashtags, no hashtag block>", "slides": [{"kind": "text"|"screenshot", "headline", "body", "screenshotId": "<id or empty>"}]}` },
    { role: "user", content: `TOPIC: ${input.topic || "(pick the strongest angle)"}\nHINT: ${input.hint || "-"}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nPERSONA\n${personaBlock(input.persona)}` },
  ];
}

export function pinPrompt(input: { brief: Brief; persona?: Persona; topic: string; hint: string; voiceProfile: string | null }): LlmMessage[] {
  return [
    { role: "system", content: `[task:pin]
Write a Pinterest pin for "${input.brief.productName}": "title" max 100 chars (searchable, concrete), "description" max 500 chars (natural keywords, no hashtag wall, ends with what the reader gets on the page), "overlay" = 3-7 words printed on the image, "altText".
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return JSON: {"title","description","overlay","altText"}` },
    { role: "user", content: `TOPIC: ${input.topic || "(strongest angle)"}\nHINT: ${input.hint || "-"}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nPERSONA\n${personaBlock(input.persona)}` },
  ];
}

export function directoryPrompt(input: { brief: Brief; directory: { name: string; taglineMax: number; fields: string[]; notes: string }; competitors: string[]; voiceProfile: string | null }): LlmMessage[] {
  return [
    { role: "system", content: `[task:directory]
Prepare the listing of "${input.brief.productName}" for the directory "${input.directory.name}". ${input.directory.notes}
Fields: "tagline" (max ${input.directory.taglineMax} chars, no period), "descriptionShort" (max 160 chars), "descriptionMedium" (max 500 chars), "descriptionLong" (max 1500 chars, paragraphs allowed), "categories" (3-5 from what such directories offer), "tags" (5-10), "alternatives" (well-known tools it replaces - from this list where sensible: ${input.competitors.join(", ") || "none known"}), "firstComment" (maker's first comment: why built, what's next, honest, max 700 chars).
All text in ${lang(input.brief.language)} unless the directory is clearly English-only (Product Hunt, G2, There's An AI For That, SaaSHub, AlternativeTo -> English).
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return JSON: {"tagline","descriptionShort","descriptionMedium","descriptionLong","categories":[],"tags":[],"alternatives":[],"firstComment"}` },
    { role: "user", content: `BRIEF\n${JSON.stringify(input.brief)}` },
  ];
}

export function articlePrompt(input: { brief: Brief; kind: "comparison" | "best_tools" | "faq"; competitor?: string; competitors: { name: string; positioning: string; pricing: string; complaints: string[] }[]; persona?: Persona; topic: string; hint: string; voiceProfile: string | null; productUrl: string }): LlmMessage[] {
  const kindText = {
    comparison: `A fair "${input.brief.productName} vs ${input.competitor ?? "Wettbewerber"}" comparison page: intro (who this is for), comparison table (Markdown table: Kriterium | ${input.brief.productName} | ${input.competitor ?? "X"}), 4-6 sections by criterion with concrete facts, "Für wen passt was", FAQ (4-6 Q&A), conclusion. Be honest where the competitor is better.`,
    best_tools: `A "Beste Tools für ${input.topic || input.brief.category}" page: intro, 5-8 tools (own product included, placed honestly), each with 3-line profile + price + best for, comparison table, FAQ (4-6 Q&A), conclusion.`,
    faq: `An FAQ page for ${input.brief.productName}: 10-15 questions prospects ask chatbots and search engines (buying intent, how-to, price, alternatives, data protection), each answered in 40-120 words, concrete, with one internal link placeholder [LINK: …] where useful.`,
  }[input.kind];
  return [
    { role: "system", content: `[task:article-${input.kind}]
Write a GEO-optimised article for the product's own website so AI assistants and search engines can cite it. ${kindText}
Structure: H1, short intro that answers the main question in the first 2 sentences (LLMs quote openings), H2/H3, tables for comparisons, FAQ section with the exact questions as H3.
Also return JSON-LD: for FAQ/comparison a "FAQPage" object with the FAQ pairs; plus a "SoftwareApplication" object for ${input.brief.productName} (name, url ${input.productUrl}, applicationCategory, offers from pricing).
Facts only from the brief and the competitor data; unknown numbers -> [PLATZHALTER: …].
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return JSON: {"title", "slug", "metaDescription" (max 155 chars), "markdown", "faq": [{"q","a"}], "jsonLd": [ {...}, {...} ]}` },
    { role: "user", content: `TOPIC: ${input.topic || "-"}\nHINT: ${input.hint || "-"}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nCOMPETITORS\n${input.competitors.map((c) => `- ${c.name}: ${c.positioning} | ${c.pricing} | complaints: ${c.complaints.join("; ")}`).join("\n") || "(none)"}\n\nPERSONA\n${personaBlock(input.persona)}` },
  ];
}

export function imagePrompt(input: { brief: Brief; purpose: string; topic: string; hint: string; primaryColor: string | null }): string {
  return `Abstract, clean marketing background for a software product (${input.brief.category}). Purpose: ${input.purpose}. Theme: ${input.topic || input.brief.oneLiner}. ${input.hint}. Dominant colour ${input.primaryColor ?? "soft green"}, plenty of negative space for text overlay, no text, no letters, no logos, no people faces, no UI mockups. Flat, modern, editorial.`;
}
