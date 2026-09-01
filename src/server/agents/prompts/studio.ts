/** Prompt builders for the Content Studio (Shot 3). Pure functions, snapshot-tested. */
import type { LlmMessage } from "../../providers/index.js";
import type { Brief, ContentLanguage, HashtagPools, Persona, VoiceSample } from "../../../shared/schemas.js";
import { hashtagPolicy, type HashtagPolicy } from "../../../shared/channels.js";
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
Write ONE ${input.platform} post for "${input.brief.productName}". Hard limit: ${input.limit} characters (count them). One thought per post.
${input.platform === "linkedin" ? "LinkedIn: first line must work as a hook before 'mehr anzeigen'; short paragraphs; no hashtag block." : ""}
${input.platform === "x" ? "X: one idea, no thread unless asked; no link in the first post if possible." : ""}
${input.screenshotsAvailable ? `${input.screenshotsAvailable} product screenshots exist - reference what the reader will see ("im Screenshot ...") when it helps.` : ""}
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile, hashtags: hashtagPolicy(input.platform) })}
Return JSON: {"title": "<short internal label, max 60 chars, e.g. 'LinkedIn: Sonntagabend'>", "body": "<the post>", "altText": "<alt text for an attached screenshot, or empty>"}` },
    { role: "user", content: `TOPIC: ${input.topic || "(pick the strongest angle from the brief)"}\nHINT: ${input.hint || "-"}\nCORE MESSAGE: ${input.coreMessage ?? "-"}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nPERSONA\n${personaBlock(input.persona)}` },
  ];
}

export function carouselPrompt(input: { brief: Brief; persona?: Persona; topic: string; hint: string; voiceProfile: string | null; screenshots: { id: string; label: string }[]; slides: number; platform: string }): LlmMessage[] {
  return [
    { role: "system", content: `[task:carousel]
Plan a ${input.slides}-slide carousel (Instagram/LinkedIn) for "${input.brief.productName}". Slide 1 = hook (max 8 words + one supporting line), middle slides = one idea each (headline max 8 words, body max 30 words), last slide = CTA with the product name and what to do.
${input.screenshots.length ? `Product screenshots available (use 1-3 of them as slides with kind "screenshot" and the matching "screenshotId"): ${input.screenshots.map((s) => `${s.id} = ${s.label}`).join("; ")}` : "No screenshots available - text slides only."}
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile, hashtags: hashtagPolicy(input.platform) })}
Return JSON: {"title": "<short internal label, max 60 chars>", "caption": "<post caption, max 600 chars, hashtags per the rule above>", "slides": [{"kind": "text"|"screenshot", "headline", "body", "screenshotId": "<id or empty>"}]}` },
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
Structure: one H1, a short intro that answers the main question in the first 2 sentences (LLMs quote openings), H2/H3, tables for comparisons, a section "## FAQ" whose questions are H3 headings each followed by the answer paragraph.
Facts only from the brief and the competitor data; unknown numbers -> [PLATZHALTER: …].
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return ONLY the article as Markdown. No JSON, no code fences, no commentary before or after.` },
    { role: "user", content: `TOPIC: ${input.topic || "-"}\nHINT: ${input.hint || "-"}\nTONE / ADDRESS FORM (follow exactly): ${input.brief.tone || "wie im Brief"}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nCOMPETITORS\n${input.competitors.map((c) => `- ${c.name}: ${c.positioning} | ${c.pricing} | complaints: ${c.complaints.join("; ")}`).join("\n") || "(none)"}\n\nPERSONA\n${personaBlock(input.persona)}` },
  ];
}

export function articleMetaPrompt(input: { brief: Brief; markdown: string; productUrl: string }): LlmMessage[] {
  return [
    { role: "system", content: `[task:article-meta]
From the Markdown article, extract page metadata and structured data as JSON:
- "title": the H1 text. "slug": URL slug (lowercase, hyphens, ascii). "metaDescription": max 155 chars, ${lang(input.brief.language)}.
- "faq": every question from the FAQ section with its answer (plain text).
- "jsonLd": an array with (1) a schema.org "FAQPage" object built from "faq" and (2) a "SoftwareApplication" object for ${input.brief.productName} (name, url "${input.productUrl}", applicationCategory, operatingSystem "Web", offers with price from: ${input.brief.pricing.map((p) => `${p.plan} ${p.price}`).join("; ") || "unknown"}).
Return JSON: {"title","slug","metaDescription","faq":[{"q","a"}],"jsonLd":[{...},{...}]}` },
    { role: "user", content: input.markdown.slice(0, 40_000) },
  ];
}

export function imagePrompt(input: { brief: Brief; purpose: string; topic: string; hint: string; primaryColor: string | null }): string {
  return `Abstract, clean marketing background for a software product (${input.brief.category}). Purpose: ${input.purpose}. Theme: ${input.topic || input.brief.oneLiner}. ${input.hint}. Dominant colour ${input.primaryColor ?? "soft green"}, plenty of negative space for text overlay, no text, no letters, no logos, no people faces, no UI mockups. Flat, modern, editorial.`;
}

/**
 * Daten-Content (Shot 7): der einzige LLM-Aufruf eines Bundle-Laufs.
 *
 * Er liefert Titel, Hook, CTA-Zeile und je Plattform Caption + Hashtags —
 * die Slides selbst baut der Generator deterministisch aus dem Provider.
 * Deshalb die harte Regel: Zahlen werden zitiert, nie gerechnet, nie gerundet.
 */
export function dataContentPrompt(input: {
  brief: Brief;
  persona?: Persona;
  voiceProfile: string | null;
  language: Exclude<ContentLanguage, "both">;
  kind: "top" | "movers";
  scopeLabel: string;
  /** `price` und `change` kommen fertig formatiert — genau so muss es der Text zitieren. */
  cards: { rank: number; name: string; setName: string; localId: string; price: string; change?: string }[];
  totalLabel: string;
  priceStand: string;
  platforms: { platform: string; limit: number; policy: HashtagPolicy; linkRule: "bio" | "link" }[];
  pools: HashtagPools;
  topic: string;
  hint: string;
}): LlmMessage[] {
  const de = input.language === "de";
  const list = input.cards.map((c) => `${c.rank}. ${c.name} (${c.setName} ${c.localId}) — ${c.price}${c.change ? ` (${c.change})` : ""}`).join("\n");
  const pools = [
    input.pools.brand.length ? `brand: ${input.pools.brand.join(" ")}` : "",
    ...Object.entries(input.pools.topics).map(([k, v]) => `${k}: ${v.join(" ")}`),
    input.pools.byLanguage[input.language].length ? `${input.language}: ${input.pools.byLanguage[input.language].join(" ")}` : "",
  ].filter(Boolean).join("\n") || "(no pools filled in yet - invent fitting, specific niche tags)";
  return [
    { role: "system", content: `[task:data-content]
You write the wording around a ranking that is ALREADY FIXED. The list below comes from a product database.

THE NUMBERS ARE SACRED:
- Never invent, change, round, sum up or re-order a price, rank, card name or set name.
- Prices are already formatted for the reader's locale. Copy them character for character, including the decimal separator and the currency symbol ("626,08 €" stays "626,08 €" — never "626.08 €", never "626 €").
- Never claim a trend, a reason or a forecast that is not in the data ("weil die Karte selten ist", "wird weiter steigen" are forbidden).
- Price statements always carry their date: ${input.priceStand}.

Deliverables:
- "title": short internal label, max 60 chars.
- "coverTitle": the headline printed on the cover slide, max 60 chars, names the scope ("${input.scopeLabel}").
- "hook": ONE spoken sentence for the first 1.5 seconds of a video, max 90 chars, may quote the number of rank 1.
- "ctaLine": ONE sentence for the last slide, max 90 chars, says what the reader does next with ${input.brief.productName}.
- "captions": one entry per platform below. Each caption stands alone, opens with something worth stopping for, and never lists all ${input.cards.length} cards (that is what the slides are for).
${input.platforms.map((p) => `  - ${p.platform}: max ${p.limit} chars, ${p.policy.max === 0 ? "NO hashtags" : `${p.policy.min || 1}-${p.policy.max} hashtags`}, ${p.linkRule === "bio" ? 'no link in the text - point to "Link in Bio" if a link is needed' : "a link may go into the text"}. ${p.policy.note}`).join("\n")}
- Hashtags come from these pools where they fit; add specific niche tags when a pool is thin. Lowercase, no duplicates, no generic filler (#love #follow).
${pools}
- Every caption must contain, once, the disclosure "${de ? "Kein offizielles Pokémon-Produkt." : "Not affiliated with Nintendo or The Pokémon Company."}" — as its own short sentence near the end, before the hashtags.
${writingRules({ language: input.language, voiceProfile: input.voiceProfile })}
Return JSON: {"title","coverTitle","hook","ctaLine","captions":[{"platform","caption","hashtags":["#tag"]}]}` },
    { role: "user", content: `SCOPE: ${input.scopeLabel} (${input.kind === "top" ? "most expensive cards" : "biggest price moves"})
TOTAL VALUE OF THE LIST: ${input.totalLabel}
PRICE DATE: ${input.priceStand}
TOPIC: ${input.topic || "-"}
HINT: ${input.hint || "-"}

RANKING (verbatim, do not touch):
${list}

BRIEF
${JSON.stringify(input.brief)}

PERSONA
${personaBlock(input.persona)}` },
  ];
}

/** Einmaliger Vorschlag für die Hashtag-Vorräte eines Projekts (danach von Hand editierbar). */
export function hashtagPoolPrompt(input: { brief: Brief; personas: Persona[]; channels: string[] }): LlmMessage[] {
  return [
    { role: "system", content: `[task:hashtag-pools]
Propose hashtag pools for "${input.brief.productName}" (${input.brief.category}).
- "brand": 3-5 tags that belong to this product and its own community.
- "topics": 3-6 named groups (key = a short slug like "sammeln", "preise"), each 5-12 tags, that a post can draw from depending on its subject.
- "byLanguage": tags that only make sense in German ("de") resp. English ("en"), 5-12 each.
Rules: lowercase, no "#" prefix in the JSON, no spaces, no generic filler (love, follow, instagood, fyp alone), prefer niche tags a real community actually follows. Channels in use: ${input.channels.join(", ") || "-"}.
Return JSON: {"brand":[],"topics":{"slug":[]},"byLanguage":{"de":[],"en":[]}}` },
    { role: "user", content: `BRIEF\n${JSON.stringify(input.brief)}\n\nPERSONAS\n${input.personas.map((p) => personaBlock(p)).join("\n") || "(none)"}` },
  ];
}
