/** Builds the agent/service context used by the API and by the worker process. */
import type { Env } from "./env.js";
import type { Db } from "./db/index.js";
import type { ImageProvider, LlmProvider, PublishProvider, SearchProvider, VoiceProvider } from "./providers/index.js";
import { OpenRouterProvider } from "./providers/openrouter.js";
import { createSearchProvider } from "./providers/search.js";
import { OpenRouterImageProvider } from "./providers/image.js";
import { createPublishProvider } from "./providers/publish.js";
import { MODEL_IMAGE } from "../../config/models.js";
import type { Crawler } from "./agents/analysis/crawl.js";
import type { Renderer } from "./agents/studio/render.js";
import type { BrandExtractor } from "./agents/studio/brandkit.js";
import type { PipelineContext } from "./agents/analysis/pipeline.js";
import type { StudioContext } from "./agents/studio/generate.js";
import type { VideoContext } from "./agents/video/pipeline.js";
import type { Recorder } from "./agents/video/record.js";
import type { FfmpegRunner } from "./agents/video/assemble.js";
import { createVoiceProvider } from "./agents/video/voice.js";

export type FullContext = PipelineContext & StudioContext & VideoContext;

export interface ServiceOverrides {
  llm?: LlmProvider; search?: SearchProvider; crawler?: Crawler; geoEngines?: readonly string[]; geoCount?: number;
  image?: ImageProvider | null; publish?: PublishProvider; renderer?: Renderer; brandExtractor?: BrandExtractor;
  voice?: VoiceProvider | null; recorder?: Recorder; ffmpeg?: FfmpegRunner; freezes?: VideoContext["freezes"];
}

export function buildContext(env: Env, db: Db, log: (m: string) => void, o: ServiceOverrides = {}): FullContext | null {
  const llm = o.llm ?? (env.OPENROUTER_API_KEY ? new OpenRouterProvider(env.OPENROUTER_API_KEY, { referer: env.MP_PUBLIC_BASE }) : null);
  if (!llm) return null;
  const image = o.image !== undefined ? o.image : (env.OPENROUTER_API_KEY ? new OpenRouterImageProvider(env.OPENROUTER_API_KEY, MODEL_IMAGE) : null);
  return {
    db, env, llm, image, dataDir: env.MP_DATA_DIR, log,
    search: o.search ?? createSearchProvider(env).provider,
    publish: o.publish ?? createPublishProvider(env),
    voice: o.voice !== undefined ? o.voice : createVoiceProvider(env),
    ...(o.crawler ? { crawler: o.crawler } : {}),
    ...(o.geoEngines ? { geoEngines: o.geoEngines } : {}),
    ...(o.geoCount ? { geoCount: o.geoCount } : {}),
    ...(o.renderer ? { renderer: o.renderer } : {}),
    ...(o.brandExtractor ? { brandExtractor: o.brandExtractor } : {}),
    ...(o.recorder ? { recorder: o.recorder } : {}),
    ...(o.ffmpeg ? { ffmpeg: o.ffmpeg } : {}),
    ...(o.freezes ? { freezes: o.freezes } : {}),
  };
}
