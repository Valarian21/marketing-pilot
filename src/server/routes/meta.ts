/** Host info, health and a redacted settings status (booleans only, never values). */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { HostAdapter } from "../../host-adapter.js";
import type { Env } from "../env.js";
import { HostInfo } from "../../shared/schemas.js";
import { GEO_MODELS, MODEL_CHEAP, MODEL_IMAGE, MODEL_STRONG } from "../../../config/models.js";

export const SettingsStatus = z.object({
  mode: z.enum(["dashboard", "standalone"]),
  dataDir: z.string(),
  publicBase: z.string(),
  providers: z.object({
    openrouter: z.boolean(), elevenlabs: z.boolean(), search: z.string(), publish: z.string(), postiz: z.boolean(),
  }),
  models: z.object({ strong: z.string(), cheap: z.string(), image: z.string(), geo: z.array(z.string()) }),
  demo: z.object({ testProjectUrl: z.string().nullable(), demoBaseUrl: z.string().nullable() }),
});

export function metaRoutes(app: FastifyInstance, env: Env, host: HostAdapter, version: string): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/api/mp/health", async () => ({ status: "ok", mode: host.mode, version }));

  r.get("/api/mp/host", { schema: { response: { 200: HostInfo } } }, async (req) => {
    const user = await host.authenticate(req);
    const shell = host.shell();
    return { mode: shell.mode, user, backLink: shell.backLink, backLabel: shell.backLabel, version };
  });

  r.get("/api/mp/settings/status", { schema: { response: { 200: SettingsStatus } } }, async () => ({
    mode: host.mode,
    dataDir: env.MP_DATA_DIR,
    publicBase: env.MP_PUBLIC_BASE,
    providers: {
      openrouter: Boolean(env.OPENROUTER_API_KEY),
      elevenlabs: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID),
      search: env.MP_SEARCH_PROVIDER ?? "duckduckgo-html (Fallback)",
      publish: env.MP_PUBLISH_PROVIDER,
      postiz: Boolean(env.POSTIZ_API_URL && env.POSTIZ_API_KEY),
    },
    models: { strong: MODEL_STRONG, cheap: MODEL_CHEAP, image: MODEL_IMAGE, geo: [...GEO_MODELS] },
    demo: { testProjectUrl: env.MP_TEST_PROJECT_URL ?? null, demoBaseUrl: env.MP_DEMO_BASE_URL ?? null },
  }));
}
