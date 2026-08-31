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
import { dataRoutes } from "./routes/data.js";
import { metaRoutes } from "./routes/meta.js";
import { analysisRoutes } from "./routes/analysis.js";
import { strategyRoutes } from "./routes/strategy.js";
import { taskRoutes } from "./routes/tasks.js";
import { studioRoutes } from "./routes/studio.js";
import { videoRoutes } from "./routes/video.js";
import { loopRoutes, EVENTS_PUBLIC_PATH } from "./routes/loop.js";
import { storageRoutes } from "./routes/storage.js";
import { mediaRoutes } from "./routes/media.js";
import { buildContext, type FullContext, type ServiceOverrides } from "./services.js";
import { markStaleRuns } from "./agents/analysis/pipeline.js";
import { resolveShortlink } from "./shortlinks.js";

declare module "fastify" {
  interface FastifyRequest { user: HostUser }
}

const PUBLIC_API = ["/api/mp/health", "/api/mp/host", EVENTS_PUBLIC_PATH];

export interface BuiltApp { app: FastifyInstance; db: Db; host: HostAdapter; ctx: FullContext | null; close: () => Promise<void> }
export type { ServiceOverrides };

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
  const ctx = buildContext(env, db, (m) => app.log.info(m), opts.services ?? {});
  const stale = markStaleRuns(db);
  if (stale) app.log.warn(`${stale} Analyse-Lauf/Läufe nach Neustart als abgebrochen markiert`);

  await host.registerRoutes(app);
  metaRoutes(app, env, host, version);
  projectRoutes(app, db);
  domainRoutes(app, db);
  dataRoutes(app, db, env);
  analysisRoutes(app, db, () => ctx);
  strategyRoutes(app, db, () => ctx);
  taskRoutes(app, db, () => ctx);
  studioRoutes(app, db, () => ctx);
  videoRoutes(app, db, () => ctx);
  loopRoutes(app, db, env, () => ctx);
  storageRoutes(app, db, () => env.MP_DATA_DIR);
  mediaRoutes(app, db, () => env.MP_DATA_DIR);

  // Client bundle under /mp/ (both host modes share the same URL space).
  const clientDir = path.join(ROOT, "dist/client");
  const hasClient = fs.existsSync(path.join(clientDir, "index.html"));
  if (hasClient) {
    await app.register(fastifyStatic, { root: clientDir, prefix: "/mp/", wildcard: false, index: false });
  }
  // Public short links from publish packages (nginx routes /go/ here). No auth, no tracking beyond a click count.
  app.get("/go/:code", async (req, reply) => {
    const code = String((req.params as { code: string }).code ?? "");
    const target = /^[a-z0-9]{4,12}$/.test(code) ? resolveShortlink(db, code) : null;
    if (!target) return reply.code(404).type("text/html; charset=utf-8").send("<h1 style='font-family:sans-serif;text-align:center;margin-top:20vh'>Link nicht gefunden</h1>");
    return reply.code(302).header("Cache-Control", "no-store").redirect(target);
  });
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
