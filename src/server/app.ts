/** Builds the Fastify app. Kept separate from index.ts so tests can inject requests. */
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Env } from "./env.js";
import { ROOT } from "./env.js";
import { openDatabase, type Db } from "./db/index.js";
import type { HostAdapter, HostUser } from "../host-adapter.js";
import { createHostAdapter } from "../host-adapter.js";
import { projectRoutes } from "./routes/projects.js";
import { domainRoutes } from "./routes/domain.js";
import { metaRoutes } from "./routes/meta.js";
import { analysisRoutes } from "./routes/analysis.js";
import { strategyRoutes } from "./routes/strategy.js";
import { taskRoutes } from "./routes/tasks.js";
import { OpenRouterProvider } from "./providers/openrouter.js";
import { createSearchProvider } from "./providers/search.js";
import type { LlmProvider, SearchProvider } from "./providers/index.js";
import type { Crawler } from "./agents/analysis/crawl.js";
import { markStaleRuns, type PipelineContext } from "./agents/analysis/pipeline.js";

declare module "fastify" {
  interface FastifyRequest { user: HostUser }
}

const PUBLIC_API = ["/api/mp/health", "/api/mp/host"];

export interface BuiltApp { app: FastifyInstance; db: Db; host: HostAdapter; ctx: PipelineContext | null; close: () => Promise<void> }

export interface ServiceOverrides { llm?: LlmProvider; search?: SearchProvider; crawler?: Crawler; geoEngines?: readonly string[]; geoCount?: number }

export async function buildApp(env: Env, opts: { host?: HostAdapter; dbFile?: string; logger?: boolean; services?: ServiceOverrides } = {}): Promise<BuiltApp> {
  const version = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;
  const host = opts.host ?? await createHostAdapter(env);
  const { db, sqlite } = openDatabase(env.MP_DATA_DIR, opts.dbFile);

  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  app.decorateRequest("user", null as unknown as HostUser);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const first = err.validation[0];
      const where = first?.instancePath?.replace(/^\//, "") || first?.params?.issue?.path?.join(".") || "";
      return reply.code(400).send({ detail: `Ungültige Eingabe${where ? ` (${where})` : ""}: ${first?.message ?? ""}`.trim() });
    }
    const e = err as FastifyError;
    const status = typeof e.statusCode === "number" && e.statusCode >= 400 ? e.statusCode : 500;
    if (status >= 500) app.log.error(e);
    return reply.code(status).send({ detail: status >= 500 ? "Interner Fehler." : e.message });
  });

  // Auth: everything under /api/mp/ except health, host info and adapter-declared public paths.
  const publicPaths = new Set([...PUBLIC_API, ...host.publicPaths]);
  app.addHook("onRequest", async (req, reply) => {
    const p = req.url.split("?")[0] ?? "";
    if (!p.startsWith("/api/mp/") || publicPaths.has(p)) return;
    const user = await host.authenticate(req);
    if (!user) return reply.code(401).send({ detail: "Nicht angemeldet." });
    req.user = user;
  });

  // Agent services. Without an OpenRouter key the pipeline endpoints answer 503 instead of failing late.
  const llm = opts.services?.llm ?? (env.OPENROUTER_API_KEY ? new OpenRouterProvider(env.OPENROUTER_API_KEY, { referer: env.MP_PUBLIC_BASE }) : null);
  const search = opts.services?.search ?? createSearchProvider(env).provider;
  const ctx: PipelineContext | null = llm ? {
    db, env, llm, search, dataDir: env.MP_DATA_DIR, log: (m) => app.log.info(m),
    ...(opts.services?.crawler ? { crawler: opts.services.crawler } : {}),
    ...(opts.services?.geoEngines ? { geoEngines: opts.services.geoEngines } : {}),
    ...(opts.services?.geoCount ? { geoCount: opts.services.geoCount } : {}),
  } : null;
  const stale = markStaleRuns(db);
  if (stale) app.log.warn(`${stale} Analyse-Lauf/Läufe nach Neustart als abgebrochen markiert`);

  await host.registerRoutes(app);
  metaRoutes(app, env, host, version);
  projectRoutes(app, db);
  domainRoutes(app, db);
  analysisRoutes(app, db, () => ctx);
  strategyRoutes(app, db, () => ctx);
  taskRoutes(app, db, () => ctx);

  // Client bundle under /mp/ (both host modes share the same URL space).
  const clientDir = path.join(ROOT, "dist/client");
  const hasClient = fs.existsSync(path.join(clientDir, "index.html"));
  if (hasClient) {
    await app.register(fastifyStatic, { root: clientDir, prefix: "/mp/", wildcard: false, index: false });
  }
  app.get("/", async (_req, reply) => reply.redirect("/mp/"));
  app.get("/mp", async (_req, reply) => reply.redirect("/mp/"));
  app.setNotFoundHandler(async (req, reply) => {
    const p = req.url.split("?")[0] ?? "";
    if (req.method === "GET" && (p === "/mp/" || p.startsWith("/mp/")) && !p.startsWith("/api/")) {
      if (!hasClient) return reply.code(503).type("text/plain").send("Client nicht gebaut - `pnpm build:client` ausführen oder `pnpm dev` nutzen.");
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ detail: "Nicht gefunden." });
  });

  return {
    app, db, host, ctx,
    close: async () => { await app.close(); sqlite.close(); },
  };
}
