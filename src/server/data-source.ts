/**
 * Datenquelle je Projekt (`mp_settings` Schlüssel `dataSource:<projectId>`) und
 * die Fabrik, die daraus einen Provider baut.
 *
 * Ohne Eintrag hat ein Projekt keine Produktdaten – Lehreule läuft genau so
 * weiter wie bisher, und Studio/Serien blenden die Daten-Formate schlicht aus.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as t from "./db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "./db/index.js";
import { ROOT, type Env } from "./env.js";
import type { DataSource } from "../shared/schemas.js";
import type { ProductDataProvider, ProductDataStatus } from "./providers/product-data.js";
import { BinderplanProvider, BINDERPLAN_DEFAULTS } from "./providers/product-data.binderplan.js";

const key = (projectId: string) => `dataSource:${projectId}`;

export function loadDataSource(db: Db, projectId: string): DataSource {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, key(projectId))).get();
  return parseJson<DataSource>(row?.value ?? '{"provider":"none"}', { provider: "none" });
}

export function saveDataSource(db: Db, projectId: string, source: DataSource): DataSource {
  db.insert(t.mpSettings).values({ key: key(projectId), value: toJson(source), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(source), updatedAt: nowIso() } }).run();
  return loadDataSource(db, projectId);
}

/** Bildcache je Provider, damit sich zwei Produkte nicht ins Gehege kommen. */
export const imageDirFor = (env: Env, provider: string): string => path.join(env.MP_DATA_DIR, "cache", "cards", provider);

/**
 * Provider für ein Projekt – oder `null`, wenn es keine Datenquelle hat oder die
 * Quelle gerade nicht da ist. Der Aufrufer muss `close()` rufen; ein Handle je
 * Anfrage ist bei SQLite billig und erspart uns Zustand über Neustarts hinweg.
 */
export function createProductDataProvider(
  db: Db, env: Env, projectId: string, opts: { fetchImpl?: typeof fetch; log?: (m: string) => void } = {},
): ProductDataProvider | null {
  const source = loadDataSource(db, projectId);
  if (source.provider !== "binderplan") return null;
  const dbPath = path.resolve(ROOT, env.MP_BINDERPLAN_DB);
  if (!fs.existsSync(dbPath)) return null;
  return new BinderplanProvider(db, {
    dbPath,
    imageDir: imageDirFor(env, "binderplan"),
    apiBase: env.MP_BINDERPLAN_API,
    tcgdexBase: env.MP_TCGDEX_API,
    maxAgeHours: env.MP_PRICE_MAX_AGE_HOURS,
    maxRefresh: BINDERPLAN_DEFAULTS.maxRefresh,
    concurrency: BINDERPLAN_DEFAULTS.concurrency,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  });
}

/** Was das UI zeigt, wenn kein Provider zustande kam – Klartext statt leerer Karte. */
export function unavailableStatus(db: Db, env: Env, projectId: string): ProductDataStatus {
  const source = loadDataSource(db, projectId);
  const dbPath = path.resolve(ROOT, env.MP_BINDERPLAN_DB);
  const detail = source.provider === "none"
    ? "Für dieses Projekt ist keine Datenquelle hinterlegt."
    : `Datenbank nicht gefunden: ${dbPath}. Der Schnappschuss entsteht über den systemd-Timer binderplan-snapshot.timer.`;
  return {
    provider: source.provider, available: false, detail,
    dbPath: source.provider === "none" ? "" : dbPath, dbUpdatedAt: null,
    cards: 0, sets: 0, eras: 0, pricesTotal: 0, pricesFresh: 0,
    sourceLastPriceRun: null, imageCacheFiles: 0, imageCacheBytes: 0,
  };
}
