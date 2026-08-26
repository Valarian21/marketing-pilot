/** Typed, validated process environment. Loaded once at startup. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/** Package root, found by walking up to the nearest package.json. Works for
 *  src/server (tsx) and dist/server/src/server (compiled) alike. */
function findPackageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}
export const ROOT = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

loadDotenv({ path: path.join(ROOT, ".env"), quiet: true });

const bool = z.preprocess(
  (v) => (typeof v === "string" ? ["1", "true", "yes"].includes(v.toLowerCase()) : v),
  z.boolean(),
);
const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  MP_STANDALONE: bool.default(false),
  MP_HOST: z.string().default("127.0.0.1"),
  MP_PORT: z.coerce.number().int().min(1).max(65535).default(8105),
  MP_DATA_DIR: z.string().default("./data"),
  MP_PUBLIC_BASE: z.string().default("http://localhost:8105"),
  MP_HOST_JWT_SECRET_FILE: optional,
  MP_HOST_JWT_SECRET: optional,
  MP_HOST_BACK_LINK: z.string().default("/"),
  MP_STANDALONE_USER: z.string().default("marcel"),
  MP_STANDALONE_PASSWORD: optional,
  MP_SESSION_SECRET: optional,
  OPENROUTER_API_KEY: optional,
  ELEVENLABS_API_KEY: optional,
  ELEVENLABS_VOICE_ID: optional,
  MP_PUBLISH_PROVIDER: z.enum(["manual", "postiz"]).default("manual"),
  POSTIZ_API_URL: optional,
  POSTIZ_API_KEY: optional,
  MP_SEARCH_PROVIDER: optional,
  MP_SEARCH_API_KEY: optional,
  MP_TEST_PROJECT_URL: optional,
  MP_DEMO_BASE_URL: optional,
  MP_DEMO_USER: optional,
  MP_DEMO_PASSWORD: optional,
  MP_DEMO_RESET_URL: optional,
  MP_DEMO_LOGIN_URL: optional,
  MP_EVENTS_TOKEN: optional,
  REDDIT_CLIENT_ID: optional,
  REDDIT_CLIENT_SECRET: optional,
  REDDIT_USER_AGENT: optional,
  MP_SCHEDULER: bool.default(true),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  env.MP_DATA_DIR = path.resolve(ROOT, env.MP_DATA_DIR);
  return env;
}
