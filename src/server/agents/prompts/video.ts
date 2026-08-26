/** Prompt builders for the video factory (Shot 4). Pure functions, snapshot-tested. */
import type { LlmMessage } from "../../providers/index.js";
import type { Brief, Persona } from "../../../shared/schemas.js";
import { writingRules } from "./voice.js";

const lang = (code: string): string => (code.toLowerCase().startsWith("de") ? "German" : code);

export function videoScriptPrompt(input: {
  brief: Brief; persona?: Persona; topic: string; hint: string; voiceProfile: string | null;
  demoBaseUrl: string | null; pages: { url: string; title: string; kind: string }[]; hasLogin: boolean; targetSeconds: number;
}): LlmMessage[] {
  const pages = input.pages.map((p) => `- ${p.url} (${p.kind}${p.title ? `: ${p.title}` : ""})`).join("\n");
  return [
    { role: "system", content: `[task:video-script]
Write a screen-recording DEMO SCRIPT for a ${input.targetSeconds}-second vertical reel (and a landscape cut) of "${input.brief.productName}". Style: clean, templated, like a Screen Studio recording - not cinematic. One idea per scene.
SCENES (4-7): each has
- "voiceover": max 2 short sentences, first person, ${lang(input.brief.language)}, spoken in 3-6 seconds.
- "caption": 2-6 words shown on screen (may be empty).
- "actions": what the browser does during the scene, in order. Types: goto {url}, click {target}, type {target, text}, scroll {y}, hover {target}, wait {ms}, press {text = key name}. "target" is the visible text of a button/link, a placeholder/label of an input, or a CSS selector. Prefer visible text. Keep 1-3 actions per scene.
- "durationMs": minimum dwell (2500-6000).
${input.hasLogin ? `The recording starts already LOGGED IN at ${input.demoBaseUrl} (a demo account). Do not script the login.` : `There is NO demo instance/login: use only the public pages listed below (start with a goto of the first one). Never script login or signup.`}
HOOKS: exactly 5 alternative opening lines for the first 2 seconds (max 8 words each, ${lang(input.brief.language)}), each a different angle: pain, number, contrast, question-free statement, outcome. No clickbait.
CTA: one short sentence + the product URL.
"devices": ["mobile"] for app-like products, ["desktop"] for wide dashboards, or both.
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return JSON: {"title","goal","persona","devices":["mobile"|"desktop"],"language","hooks":[5 strings],"scenes":[{"id":"s1","voiceover","caption","actions":[{"type","url","target","text","y","ms"}],"durationMs"}],"cta":{"text","url"}}` },
    { role: "user", content: `TOPIC / TASK: ${input.topic || "Onboarding-Demo: vom Start bis zum ersten Ergebnis"}\nHINT: ${input.hint || "-"}\nBASE URL: ${input.demoBaseUrl ?? input.brief.sources[0] ?? "-"}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\nPERSONA\n${input.persona ? `${input.persona.name}: ${input.persona.description} | pains: ${input.persona.painPoints.join("; ")}` : "(none)"}\n\nKNOWN PAGES\n${pages || "(none crawled)"}` },
  ];
}
