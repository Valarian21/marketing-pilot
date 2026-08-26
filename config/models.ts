/**
 * Model routing. Every LLM call goes through OpenRouter; the model per task is
 * picked here and can be overridden via environment variables so a switch
 * never needs a code change.
 *
 * Defaults are the ids the dashboard already uses successfully on OpenRouter
 * (see empire_config.yaml). Re-check against https://openrouter.ai/models
 * before Shot 1 goes live.
 */
export type ModelTask =
  | "analysis"      // product brief, competitor synthesis, personas (strong)
  | "strategy"      // channel plan, weekly loop (strong)
  | "content"       // bulk drafts: posts, carousels, directory entries (cheap)
  | "critic"        // AI-tell checker, scoring (cheap)
  | "community"     // community reply drafts (strong: tone matters)
  | "script"        // video scripts (strong)
  | "scoring";      // lead scoring 0-100 (cheap)

const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

export const MODEL_STRONG = env("MP_MODEL_STRONG") ?? "anthropic/claude-sonnet-4.5";
export const MODEL_CHEAP = env("MP_MODEL_CHEAP") ?? "google/gemini-2.5-flash";
export const MODEL_IMAGE = env("MP_MODEL_IMAGE") ?? "google/gemini-2.5-flash-image-preview";

/** Engines asked in the GEO baseline (Shot 1). One answer per engine per query. */
export const GEO_MODELS: readonly string[] = (env("MP_GEO_MODELS") ?? [
  "openai/gpt-4o",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-flash",
  "perplexity/sonar",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const ROUTING: Record<ModelTask, string> = {
  analysis: MODEL_STRONG,
  strategy: MODEL_STRONG,
  community: MODEL_STRONG,
  script: MODEL_STRONG,
  content: MODEL_CHEAP,
  critic: MODEL_CHEAP,
  scoring: MODEL_CHEAP,
};

export function modelFor(task: ModelTask): string {
  return ROUTING[task];
}
