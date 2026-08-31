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
  ELEVENLABS_USD_PER_1K_CHARS: z.coerce.number().min(0).default(0.22),
  /** eleven_multilingual_v2 | eleven_turbo_v2_5 | eleven_flash_v2_5 | eleven_v3 - v2.5/v3 accept a fixed language, multilingual_v2 guesses per sentence */
  ELEVENLABS_MODEL: z.string().default("eleven_turbo_v2_5"),
  ELEVENLABS_STABILITY: z.coerce.number().min(0).max(1).default(0.5),
  ELEVENLABS_SIMILARITY: z.coerce.number().min(0).max(1).default(0.75),
  ELEVENLABS_STYLE: z.coerce.number().min(0).max(1).default(0),
  ELEVENLABS_SPEAKER_BOOST: z.enum(["true", "false"]).default("false"),
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
  /** Schnappschuss von Binderplans app.db, relativ zum Paket-Wurzelverzeichnis.
   *  Erzeugt vom root-eigenen systemd-Timer `binderplan-snapshot.timer` - /root ist
   *  fuer den `developer`-Prozess nicht durchquerbar, die Live-Datei also unerreichbar. */
  MP_BINDERPLAN_DB: z.string().default("./data/cache/binderplan.db"),
  /** Binderplans HTTP-Dienst - liefert Kartenbilder, deren Dateicache unter /root liegt. */
  MP_BINDERPLAN_API: z.string().default("http://127.0.0.1:8103"),
  MP_TCGDEX_API: z.string().default("https://api.tcgdex.net/v2"),
  /** Aelter als das gilt ein Preis als veraltet und wird nachgeladen. */
  MP_PRICE_MAX_AGE_HOURS: z.coerce.number().min(1).default(72),
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
