/** Prompts for "change this" instructions on finished pieces and for the scene check (Shot 6 follow-ups). Pure functions. */
import type { LlmMessage } from "../../providers/index.js";
import type { Brief, VideoScript } from "../../../shared/schemas.js";
import { writingRules } from "./voice.js";

const lang = (code: string): string => (code.toLowerCase().startsWith("de") ? "German" : code);

/** Edit an existing text-like piece following one instruction; keep everything not mentioned. */
export function reviseTextPrompt(input: { brief: Brief; format: string; body: string; instruction: string; voiceProfile: string | null; limit?: number }): LlmMessage[] {
  return [
    { role: "system", content: `[task:revise-text]
You edit an existing ${input.format} for "${input.brief.productName}" according to ONE instruction from the founder. Change only what the instruction asks for; keep tone, facts, structure and length of everything else. ${input.limit ? `Hard limit ${input.limit} characters.` : ""}
${writingRules({ language: input.brief.language, voiceProfile: input.voiceProfile })}
Return JSON: {"body": "<the full revised text>", "changed": "<one sentence in ${lang(input.brief.language)} saying what you changed>"}` },
    { role: "user", content: `INSTRUCTION: ${input.instruction}\n\nCURRENT TEXT:\n${input.body}` },
  ];
}

export interface SceneTiming { id: string; startMs: number; endMs: number }

/** Map an instruction (possibly with seconds like "12-20 s") onto script edits. */
export function reviseScriptPrompt(input: { brief: Brief; script: VideoScript; timeline: SceneTiming[]; hookMs: number; instruction: string; sceneNotes: { id: string; seen?: string; issue?: string }[] }): LlmMessage[] {
  const tl = input.timeline.map((t) => `${t.id}: ${((t.startMs + input.hookMs) / 1000).toFixed(1)}-${((t.endMs + input.hookMs) / 1000).toFixed(1)} s`).join(", ");
  return [
    { role: "system", content: `[task:revise-script]
You revise a screen-recording script for "${input.brief.productName}" following ONE instruction from the founder. Timecodes in the instruction refer to the rendered video (hook card ${input.hookMs / 1000} s, then scenes: ${tl || "unknown"}). Map them to scene ids.
Rules: change only the scenes the instruction concerns; keep ids of unchanged scenes; keep voiceover to max 2 short sentences; "Untertitel/Captions" means the voiceover text (captions are generated from it); actions use the same types as before (goto/click/type/scroll/hover/wait/press; target = visible text or CSS selector).
Set "needsRecording": true only if any scene's actions, durations, order or device list changed; false if only voiceover/captions/hooks/CTA changed.
${writingRules({ language: input.brief.language })}
Return JSON: {"script": {<full VideoScript with the same schema>}, "needsRecording": true|false, "changed": "<one sentence in ${lang(input.brief.language)}>"}` },
    { role: "user", content: `INSTRUCTION: ${input.instruction}\n\nWHAT THE SCENES ACTUALLY SHOWED (scene check):\n${input.sceneNotes.map((n) => `- ${n.id}: ${n.seen ?? "?"}${n.issue ? ` | issue: ${n.issue}` : ""}`).join("\n") || "(no check yet)"}\n\nCURRENT SCRIPT:\n${JSON.stringify(input.script)}` },
  ];
}

/** Vision check: does the recorded frame match what the voiceover claims? */
export function sceneCheckPrompt(input: { sceneId: string; voiceover: string; caption: string; actions: string; language: string; image: string }): LlmMessage[] {
  return [
    { role: "system", content: `[task:scene-check]
You compare a screenshot from a screen recording with the voiceover that plays over it. Answer strictly as JSON: {"match": true|false, "seen": "<what the screen shows, max 20 words>", "issue": "<if no match: what is wrong, e.g. 'onboarding tour covers the app', 'cookie banner', 'wrong page', max 25 words, else empty>"} in ${lang(input.language)}.` },
    { role: "user", content: `SCENE ${input.sceneId}\nVOICEOVER: ${input.voiceover}\nCAPTION: ${input.caption || "-"}\nPLANNED ACTIONS: ${input.actions || "-"}`, images: [input.image] },
  ];
}
