/** Voiceover via ElevenLabs with character timestamps (word-exact captions); estimated timing when no key is set. */
import fs from "node:fs";
import path from "node:path";
import type { Env } from "../../env.js";
import type { VoiceProvider, VoiceRequest, VoiceResult } from "../../providers/index.js";

export interface WordTiming { word: string; startMs: number; endMs: number }

interface ElevenResponse {
  audio_base64?: string;
  alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null;
  detail?: { message?: string } | string;
}

/** Group character alignment into words. */
export function wordsFromAlignment(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let cur = "", s = 0, e = 0;
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) { words.push({ word: cur, startMs: Math.round(s * 1000), endMs: Math.round(e * 1000) }); cur = ""; } return; }
    if (!cur) s = starts[i] ?? 0;
    cur += ch; e = ends[i] ?? e;
  });
  if (cur) words.push({ word: cur, startMs: Math.round(s * 1000), endMs: Math.round(e * 1000) });
  return words;
}

/** No TTS: spread words across the scene at ~2.6 words/s, honouring a given span. */
export function estimateWords(text: string, spanMs?: number): WordTiming[] {
  const ws = text.split(/\s+/).filter(Boolean);
  if (!ws.length) return [];
  const per = spanMs ? spanMs / ws.length : 380;
  return ws.map((w, i) => ({ word: w, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per - 40) }));
}
export const estimateDurationMs = (text: string): number => Math.max(1200, text.split(/\s+/).filter(Boolean).length * 380 + 300);

export interface ElevenOptions { model?: string; speed?: number; style?: number; stability?: number; similarity?: number; speakerBoost?: boolean; fetchImpl?: typeof fetch }
/** Models that take an explicit language_code (multilingual_v2 rejects it and guesses per sentence - "Material" then comes out English). */
const LANGUAGE_MODELS = /^(eleven_turbo_v2_5|eleven_flash_v2_5|eleven_v3)/;

export class ElevenLabsVoice implements VoiceProvider {
  constructor(private readonly apiKey: string, private readonly voiceId: string, private readonly opts: ElevenOptions = {}) {}

  /** Request body - exported for tests. */
  body(req: VoiceRequest): Record<string, unknown> {
    const model = this.opts.model ?? "eleven_multilingual_v2";
    const v3 = model.startsWith("eleven_v3");
    return {
      text: req.text, model_id: model,
      ...(req.language && LANGUAGE_MODELS.test(model) ? { language_code: req.language } : {}),
      ...(!v3 && req.previousText ? { previous_text: req.previousText } : {}),
      ...(!v3 && req.nextText ? { next_text: req.nextText } : {}),
      voice_settings: v3
        ? { stability: this.opts.stability ?? 0.5, similarity_boost: this.opts.similarity ?? 0.75 }
        : { stability: this.opts.stability ?? 0.5, similarity_boost: this.opts.similarity ?? 0.75, style: this.opts.style ?? 0, use_speaker_boost: this.opts.speakerBoost ?? false, speed: req.speed ?? this.opts.speed ?? 1.0 },
    };
  }

  async synthesize(req: VoiceRequest, outDir: string): Promise<VoiceResult> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const voiceId = req.voiceId ?? this.voiceId;
    const res = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(this.body(req)),
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await res.json()) as ElevenResponse;
    if (!res.ok || !data.audio_base64) {
      const msg = typeof data.detail === "string" ? data.detail : data.detail?.message ?? `HTTP ${res.status}`;
      throw new Error(`ElevenLabs: ${msg}`);
    }
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp3`);
    fs.writeFileSync(file, Buffer.from(data.audio_base64, "base64"));
    const al = data.alignment;
    const words = al ? wordsFromAlignment(al.characters, al.character_start_times_seconds, al.character_end_times_seconds) : estimateWords(req.text);
    const durationMs = words.length ? Math.max(...words.map((w) => w.endMs)) + 150 : estimateDurationMs(req.text);
    return { path: file, durationMs, alignment: words };
  }
}

export function createVoiceProvider(env: Env): VoiceProvider | null {
  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) return new ElevenLabsVoice(env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID, { model: env.ELEVENLABS_MODEL, stability: env.ELEVENLABS_STABILITY, similarity: env.ELEVENLABS_SIMILARITY, style: env.ELEVENLABS_STYLE, speakerBoost: env.ELEVENLABS_SPEAKER_BOOST === "true" });
  return null;
}
