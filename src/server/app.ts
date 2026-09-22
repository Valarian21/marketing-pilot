/** Builds the Fastify app. Kept separate from index.ts so tests can inject requests. */
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import httpProxy from "@fastify/http-proxy";
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
import { musicRoutes } from "./routes/music.js";
import { seriesRoutes } from "./routes/series.js";
import { publishRoutes } from "./routes/publish.js";
import { tiktokRoutes } from "./routes/tiktok.js";
import { youtubeRoutes } from "./routes/youtube.js";
import { loadProfiles } from "./channels.js";
import { sitzungStarten as tiktokAnmelden, sitzungStatus as tiktokSitzung, zahlenHolen as tiktokZahlenHolen } from "./publish/tiktok-studio.js";
import { aktuelleSitzung } from "./publish/studio-browser.js";
import { laufVermerken as youtubeVermerken, planenStarten as youtubePlanen, sitzungStarten as youtubeAnmelden, sitzungStatus as youtubeSitzung, zahlenHolen as youtubeZahlen } from "./publish/youtube-studio.js";
import { berlinParts } from "./agents/series/time.js";
import { pinterestRoutes } from "./routes/pinterest.js";
import { loopRoutes, EVENTS_PUBLIC_PATH } from "./routes/loop.js";
import { storageRoutes } from "./routes/storage.js";
import { mediaRoutes } from "./routes/media.js";
import { buildContext, type FullContext, type ServiceOverrides } from "./services.js";
import { markStaleRuns } from "./agents/analysis/pipeline.js";
import { resolveShortlink } from "./shortlinks.js";
import { eq } from "drizzle-orm";
import * as t from "./db/schema.js";
import * as schema from "./db/schema.js";
import { bioHtml, projectByBioCode } from "./publish/bio.js";
import { zaehleBioAufruf } from "./shortlinks.js";
import { jpegFuerMeta, readAssetToken } from "./publish/asset-tokens.js";

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

  // `maxParamLength` steht bei Fastify auf 100 Zeichen. Die signierten
  // Asset-Adressen (`/go/a/<token>`) sind 111 Zeichen lang — ohne diese Zeile
  // antwortet die Route mit 414, und Meta meldet daraufhin „Only photo or video
  // can be accepted as media type": es hat JSON statt eines Bildes bekommen.
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, maxParamLength: 500 });
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
  musicRoutes(app);
  seriesRoutes(app, db);
  publishRoutes(app, db, env);
  tiktokRoutes(app, db, env);
  youtubeRoutes(app, db, env);
  pinterestRoutes(app, db, env);
  // Die Sicht auf den Anmelde-Browser (noVNC). Liegt unter /api/mp/, damit die
  // Anmeldung des Piloten davor steht — ein eigener nginx-Pfad waere offen im
  // Netz gestanden. Der Aufstieg auf WebSocket braucht websocket: true.
  await app.register(httpProxy, {
    upstream: "http://127.0.0.1:6080",
    prefix: "/api/mp/tiktok/vnc",
    rewritePrefix: "",
    websocket: true,
    httpMethods: ["GET", "POST"],
  });
  // Derselbe Bildschirm, zweiter Pfad: die YouTube-Ansicht spricht ihren
  // eigenen Weg an, damit noVNC den WebSocket-Pfad sauber zusammensetzt.
  await app.register(httpProxy, {
    upstream: "http://127.0.0.1:6080",
    prefix: "/api/mp/youtube/vnc",
    rewritePrefix: "",
    websocket: true,
    httpMethods: ["GET", "POST"],
  });
  await app.register(httpProxy, {
    upstream: "http://127.0.0.1:6080",
    prefix: "/api/mp/pinterest/vnc",
    rewritePrefix: "",
    websocket: true,
    httpMethods: ["GET", "POST"],
  });
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
  // Bio-Seite und signierte Asset-Adressen liegen bewusst unter /go/ - nginx
  // leitet das bereits hierher, und beide muessen ohne Anmeldung erreichbar sein.
  app.get("/go/bio/:code", async (req, reply) => {
    const code = String((req.params as { code: string }).code ?? "");
    const projectId = /^[a-z0-9]{4,12}$/.test(code) ? projectByBioCode(db, code) : null;
    const html = projectId ? bioHtml(db, projectId, env.MP_PUBLIC_BASE ?? "") : null;
    if (!html) return reply.code(404).type("text/html; charset=utf-8").send("<h1 style='font-family:sans-serif;text-align:center;margin-top:20vh'>Seite nicht gefunden</h1>");
    zaehleBioAufruf(db, projectId!);
    // Kein langer Cache mehr: er würde die Aufrufe verschlucken, die hier gerade gezählt werden.
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html);
  });
  app.get("/go/a/:token", async (req, reply) => {
    const assetId = readAssetToken(db, String((req.params as { token: string }).token ?? ""));
    const asset = assetId ? db.select().from(schema.mpAssets).where(eq(schema.mpAssets.id, assetId)).get() : null;
    const file = asset ? path.resolve(env.MP_DATA_DIR, asset.path) : null;
    if (!file || !file.startsWith(path.resolve(env.MP_DATA_DIR) + path.sep) || !fs.existsSync(file)) return reply.code(404).send({ detail: "Nicht gefunden." });
    const ext = path.extname(file).toLowerCase();
    // Diese Adresse ruft nur Meta ab, und Meta nimmt als Bild ausschliesslich
    // JPEG. Ein PNG quittiert Instagram mit „Only photo or video can be accepted
    // as media type" — eine Meldung, die den Grund nicht nennt.
    if (ext === ".png") {
      try {
        const jpeg = jpegFuerMeta(file);
        return reply.type("image/jpeg").header("Cache-Control", "public, max-age=3600").send(fs.createReadStream(jpeg));
      } catch (e) {
        app.log.error(`Asset ${assetId}: ${e instanceof Error ? e.message : String(e)}`);
        return reply.code(500).send({ detail: "Bild konnte nicht ausgeliefert werden." });
      }
    }
    const type = ext === ".mp4" ? "video/mp4" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return reply.type(type).header("Cache-Control", "public, max-age=3600").send(fs.createReadStream(file));
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

  /** Ist dieser Tageslauf dran? Zwanzig Stunden Abstand, damit er täglich wandert. */
  const faellig = (key: string): boolean => {
    const letzte = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, key)).get();
    return !letzte || Date.now() - Date.parse(letzte.value) >= 20 * 3_600_000;
  };

  /** Diesen Tageslauf als erledigt stempeln. */
  const vermerke = (key: string): void => {
    const jetzt = new Date().toISOString();
    db.insert(t.mpSettings).values({ key, value: jetzt, updatedAt: jetzt })
      .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: jetzt, updatedAt: jetzt } }).run();
  };

  /**
   * Eine Aufgabe mit angemeldetem Anmelde-Browser ausführen.
   *
   * Es gibt im Piloten **eine** Sitzung: `sitzungOeffnen` schließt die vorige,
   * YouTube und TikTok können nie gleichzeitig offen sein. Wartete ein
   * Tageslauf darauf, dass seine Sitzung zufällig offen ist, hinge er daran,
   * welchen Browser zuletzt ein Mensch offen gelassen hat — und nach einem
   * Neustart des Dienstes an gar keinem. Genau so fehlten die TikTok-Zahlen
   * vom 19.–21.09.2026. Die Anmeldung überlebt im Chrome-Profil, das Öffnen
   * braucht also niemanden; nur ein laufender Plan-Lauf darf nicht gestört
   * werden.
   */
  const mitSitzung = async (
    status: (e: typeof env) => Promise<{ angemeldet: boolean; lauf: { laeuft: boolean } | null }>,
    anmelden: (e: typeof env) => Promise<unknown>,
    aufgabe: () => Promise<void>,
  ): Promise<void> => {
    if (aktuelleSitzung()?.lauf?.laeuft) return;
    if (!(await status(env)).angemeldet) {
      await anmelden(env);
      await new Promise((f) => setTimeout(f, 5_000));
    }
    if (!(await status(env)).angemeldet) return;
    await aufgabe();
  };

  /**
   * Zahlen aus dem YouTube-Studio, einmal am Tag. Läuft hier und nicht im
   * Scheduler des Workers, weil die Sitzung im Speicher **dieses** Prozesses
   * lebt.
   */
  const zahlenTakt = async () => {
    try {
      // Nicht „alle aktiven Projekte": der Browser ist an genau einem Kanal
      // angemeldet, und `status` sagt darüber nichts. Gefragt sind die
      // Projekte mit hinterlegtem YouTube-Kanal — welches davon wirklich zum
      // angemeldeten Konto gehört, prüft `zahlenHolen` selbst.
      const mitKanal = db.select().from(t.mpProjects).all()
        .filter((x) => x.status !== "archived")
        .filter((x) => (loadProfiles(db, x.id).find((c) => c.platform === "youtube")?.url ?? "").trim() !== "");
      if (!mitKanal.some((p) => faellig(`sched:youtube.zahlen:${p.id}`))) return;
      await mitSitzung(youtubeSitzung, youtubeAnmelden, async () => {
        for (const p of mitKanal) {
          const key = `sched:youtube.zahlen:${p.id}`;
          if (!faellig(key)) continue;
          // Ein fremder Kanal darf den Takt nicht anhalten: das nächste
          // Projekt ist womöglich genau das angemeldete.
          try {
            const z = await youtubeZahlen(db, env, p.id);
            vermerke(key);
            app.log.info(`youtube.zahlen ${p.name}: ${z.videos.length} Videos, ${z.zugeordnet} zugeordnet`);
          } catch (e) { app.log.warn(`youtube.zahlen ${p.name}: ${e instanceof Error ? e.message : String(e)}`); }
        }
      });
    } catch (e) { app.log.warn(`youtube.zahlen: ${e instanceof Error ? e.message : String(e)}`); }
  };
  /**
   * Dasselbe für TikTok: dort gibt es keine Lese-API, die Zahlen kommen aus
   * dem Export der Analyse-Seite. Eigener Takt, weil die TikTok-Sitzung
   * unabhängig von der YouTube-Sitzung an oder aus sein kann.
   */
  const tiktokTakt = async () => {
    try {
      const mitKonto = db.select().from(t.mpProjects).all()
        .filter((x) => x.status !== "archived")
        .filter((x) => (loadProfiles(db, x.id).find((c) => c.platform === "tiktok")?.url ?? "").trim() !== "");
      // Nicht rund um Mitternacht UTC: dort zieht TikTok das Exportfenster um
      // einen Tag zurück und liefert dieselben Werte falsch beschriftet
      // (22.09.2026 gemessen). Mittags bis abends Berliner Zeit ist von jeder
      // Tagesgrenze weit genug weg.
      const stunde = berlinParts(new Date()).hour;
      if (stunde < 12 || stunde >= 20) return;
      if (!mitKonto.some((p) => faellig(`sched:tiktok.zahlen:${p.id}`))) return;
      await mitSitzung(tiktokSitzung, tiktokAnmelden, async () => {
        for (const p of mitKonto) {
          const key = `sched:tiktok.zahlen:${p.id}`;
          if (!faellig(key)) continue;
          try {
            const z = await tiktokZahlenHolen(db, env, p.id);
            vermerke(key);
            app.log.info(`tiktok.zahlen ${p.name}: ${z.tage} Tage (${z.von}–${z.bis})`);
          } catch (e) { app.log.warn(`tiktok.zahlen ${p.name}: ${e instanceof Error ? e.message : String(e)}`); }
        }
      });
    } catch (e) { app.log.warn(`tiktok.zahlen: ${e instanceof Error ? e.message : String(e)}`); }
  };
  /**
   * Studio-Lauf einmal am Tag, morgens zwischen 6 und 8 Uhr Berliner Zeit —
   * nur mit angemeldeter Sitzung und höchstens zwölf Stücke, weil YouTube
   * unbestätigte Kanäle auf wenige Uploads am Tag deckelt (21.09.2026 gemessen)
   * und ein Stapel im Tagesfenster sonst zur Hälfte scheitert. Der vorige Lauf
   * wird vorher verbucht, damit erledigte Termine nicht noch einmal anstehen.
   */
  const studioTakt = async () => {
    try {
      const st = await youtubeSitzung(env);
      if (!st.angemeldet || st.lauf?.laeuft) return;
      const jetzt = berlinParts(new Date());
      if (jetzt.hour < 6 || jetzt.hour > 8) return;
      for (const p of db.select().from(t.mpProjects).all().filter((x) => x.status === "active")) {
        const key = `sched:youtube.studio:${p.id}`;
        const letzte = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, key)).get();
        if (letzte && Date.now() - Date.parse(letzte.value) < 20 * 3_600_000) continue;
        youtubeVermerken(db, p.id);
        await youtubePlanen(db, env, p.id, false, 12);
        db.insert(t.mpSettings).values({ key, value: new Date().toISOString(), updatedAt: new Date().toISOString() })
          .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: new Date().toISOString(), updatedAt: new Date().toISOString() } }).run();
        app.log.info(`youtube.studio: Tageslauf gestartet (${p.id.slice(0, 8)})`);
      }
    } catch (e) { app.log.warn(`youtube.studio: ${e instanceof Error ? e.message : String(e)}`); }
  };
  /**
   * Die drei Läufe **nacheinander**: sie teilen sich eine Browsersitzung, und
   * parallel gestartet würden sie einander den Browser unter den Füßen
   * wegziehen. `laeuftTakt` deckelt außerdem den Fall, dass ein Lauf länger
   * dauert als der Stundentakt.
   */
  let laeuftTakt = false;
  const takt = async () => {
    if (laeuftTakt) return;
    laeuftTakt = true;
    // Reihenfolge ist nicht beliebig: die beiden YouTube-Läufe brauchen
    // dieselbe Sitzung, und der TikTok-Lauf schließt sie. Also erst YouTube
    // zu Ende, dann TikTok.
    try { await zahlenTakt(); await studioTakt(); await tiktokTakt(); }
    finally { laeuftTakt = false; }
  };
  setInterval(() => { void takt(); }, 60 * 60_000).unref();
  // Nach einem Neustart nicht bis zur vollen Stunde warten: sonst kostet jeder
  // Deploy am frühen Morgen den Tageslauf. `faellig` verhindert Doppelläufe.
  setTimeout(() => { void takt(); }, 120_000).unref();

  return {
    app, db, host, ctx,
    close: async () => { await app.close(); sqlite.close(); },
  };
}
