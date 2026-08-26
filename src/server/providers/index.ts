/**
 * Provider interfaces. Implementations arrive with the shots that need them;
 * the contracts are fixed now so no later shot couples business logic to a
 * vendor. Every provider call that costs money must be wrapped in an AgentRun
 * (see ../runs.ts) - a silent failure is a bug.
 */

export interface LlmMessage { role: "system" | "user" | "assistant"; content: string; /** data: URLs or https images (vision models) */ images?: string[] }
export interface LlmUsage { tokensIn: number; tokensOut: number; costUsd: number }
export interface LlmResult { text: string; model: string; usage: LlmUsage }
export interface LlmProvider {
  /** Chat completion through OpenRouter. `model` is a full OpenRouter id. */
  chat(model: string, messages: LlmMessage[], opts?: { temperature?: number; json?: boolean; maxTokens?: number }): Promise<LlmResult>;
}

export interface ImageRequest { prompt: string; width: number; height: number; negative?: string }
export interface ImageResult { path: string; model: string; usage: LlmUsage }
export interface ImageProvider {
  generate(req: ImageRequest, outDir: string): Promise<ImageResult>;
}

export interface VoiceRequest { text: string; voiceId?: string; speed?: number; /** ISO 639-1, enforced on models that support it */ language?: string; /** neighbouring sentences: keeps prosody and language consistent across scenes */ previousText?: string; nextText?: string }
export interface VoiceResult { path: string; durationMs: number; alignment?: { word: string; startMs: number; endMs: number }[] }
export interface VoicePart { id: string; text: string }
export interface VoiceScriptResult { file: string; durationMs: number; parts: { id: string; startMs: number; endMs: number; words: { word: string; startMs: number; endMs: number }[] }[] }
export interface VoiceProvider {
  synthesize(req: VoiceRequest, outDir: string): Promise<VoiceResult>;
  /** Whole script in ONE request (continuous prosody, pauses between parts), timestamps split per part. Optional. */
  synthesizeScript?(parts: VoicePart[], req: Omit<VoiceRequest, "text">, outDir: string): Promise<VoiceScriptResult>;
}

export interface PublishRequest {
  contentPieceId: string;
  platform: string;
  body: string;
  assetPaths: string[];
  scheduledAt?: string;
}
export interface PublishResult {
  /** `manual` never publishes - it returns the package the human posts from. */
  mode: "manual" | "postiz";
  externalUrl?: string;
  scheduledAt?: string;
}
export interface PublishProvider {
  readonly name: "manual" | "postiz";
  prepare(req: PublishRequest): Promise<PublishResult>;
}

export interface SearchHit { title: string; url: string; snippet: string }
export interface SearchProvider {
  search(query: string, opts?: { limit?: number }): Promise<SearchHit[]>;
}
