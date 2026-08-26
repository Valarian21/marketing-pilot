/** Voice profile: derive a prompt block from the founder's own texts. */
import { z } from "zod";
import type * as s from "../../../shared/schemas.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, withRun, type AgentContext } from "../runner.js";
import { voiceProfilePrompt } from "../prompts/studio.js";
import { loadBrandKit, saveBrandKit } from "./brandkit.js";
import { nowIso } from "../../db/index.js";

const Out = z.object({
  summary: z.string(), address: z.enum(["du", "Sie", "mixed", "n/a"]).default("n/a"), sentenceLength: z.string().default(""),
  favoriteWords: z.array(z.string()).default([]), humor: z.string().default(""), typicalOpeners: z.array(z.string()).default([]),
  noGos: z.array(z.string()).default([]), promptBlock: z.string().min(20),
});

export async function deriveVoiceProfile(ctx: AgentContext, projectId: string, brief: s.Brief): Promise<s.VoiceProfile> {
  const kit = loadBrandKit(ctx.db, projectId);
  if (kit.voiceSamples.length < 3) throw Object.assign(new Error("Mindestens 3 eigene Texte nötig (besser 5–20)."), { statusCode: 400 });
  const model = modelFor("analysis");
  const { result } = await withRun(ctx.db, { task: "studio.voice-profile", model, projectId }, (usage) =>
    chatJson(ctx.llm, model, Out, voiceProfilePrompt({ samples: kit.voiceSamples, brief }), usage, { maxTokens: 2500 }));
  const profile: s.VoiceProfile = { ...result, derivedAt: nowIso(), model, sampleCount: kit.voiceSamples.length };
  saveBrandKit(ctx.db, projectId, { ...kit, voiceProfile: profile });
  return profile;
}

export const voiceBlock = (kit: s.BrandKit): string | null => kit.voiceProfile?.promptBlock ?? null;
