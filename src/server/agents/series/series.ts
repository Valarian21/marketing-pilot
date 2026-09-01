/**
 * Serien-Engine (Shot 9): wiederkehrender Content ohne Zuruf.
 *
 * Eine Serie ist eine Verabredung — „montags um 9 ein Top-Set-Carousel" — plus
 * ein Gedächtnis. Das Gedächtnis (`coverage`) ist der eigentliche Kern: ohne es
 * käme jede Woche dasselbe neueste Set, und der Kanal wäre nach einem Monat tot.
 *
 * Erzeugt wird über denselben Weg wie von Hand (`generateContent`), damit es nur
 * eine Wahrheit gibt, wie ein Bündel entsteht. Die Serie entscheidet allein,
 * **worüber** und **wann**.
 */
import { desc, eq } from "drizzle-orm";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import type { Env } from "../../env.js";
import { createProductDataProvider, loadDataSource } from "../../data-source.js";
import type { ProductDataProvider } from "../../providers/product-data.js";
import { writeAudit } from "../../audit.js";
import { currentVersion, dueAtFor } from "../strategy/plan.js";
import { weekOf } from "../../routes/tasks.js";
import { generateContent, pieceOf, type StudioContext } from "../studio/generate.js";
import { autoScheduleBundle } from "../../publish/auto.js";
import { catalogFor, isAvailable } from "./catalog.js";
import { isDue, nextRunAt } from "./time.js";
import { shareIdOf } from "./binder.js";
import type { HostUser } from "../../../host-adapter.js";

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });
const WEEK = 7 * 86_400_000;

type Row = typeof t.mpContentSeries.$inferSelect;

export function seriesOf(db: Db, r: Row, now = new Date()): s.ContentSeries {
  const params = s.SeriesParams.parse(parseJson<Record<string, unknown>>(r.params, {}));
  const cadence = s.SeriesCadence.parse(parseJson<Record<string, unknown>>(r.cadence, {}));
  const next = r.status === "active" ? nextRunAt(cadence, now) : null;
  return {
    id: r.id, projectId: r.projectId, name: r.name, kind: r.kind as s.SeriesKind,
    params, cadence, status: r.status as s.ContentSeries["status"],
    lastRunAt: r.lastRunAt, nextRunAt: next ? next.toISOString() : null,
    coverage: s.SeriesCoverage.parse(parseJson<Record<string, unknown>>(r.coverage, {})),
    pendingReview: pendingReview(db, r.projectId, r.id),
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/**
 * Wie viele Leit-Stücke dieser Serie noch unfreigegeben herumliegen.
 * Ab zwei ist die Kadenz zu hoch — das Cockpit sagt das dann leise.
 */
export function pendingReview(db: Db, projectId: string, seriesId: string): number {
  return db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all()
    .filter((r) => r.status === "review")
    .map((r) => parseJson<Record<string, unknown>>(r.meta, {}))
    .filter((m) => m["bundleLead"] === true && (m["request"] as { seriesId?: string } | undefined)?.seriesId === seriesId)
    .length;
}

export function listSeries(db: Db, projectId: string, now = new Date()): s.ContentSeries[] {
  return db.select().from(t.mpContentSeries).where(eq(t.mpContentSeries.projectId, projectId))
    .orderBy(desc(t.mpContentSeries.createdAt)).all().map((r) => seriesOf(db, r, now));
}

export function getSeries(db: Db, id: string, now = new Date()): s.ContentSeries | null {
  const r = db.select().from(t.mpContentSeries).where(eq(t.mpContentSeries.id, id)).get();
  return r ? seriesOf(db, r, now) : null;
}

export function createSeries(db: Db, projectId: string, input: s.SeriesCreate): s.ContentSeries {
  const entry = catalogFor(input.kind);
  if (!entry) throw err(`Unbekannte Serien-Art: ${input.kind}`);
  if (!entry.available) throw err(`„${entry.name}" ist noch nicht gebaut. ${entry.note}`);
  const ts = nowIso();
  const id = newId();
  db.insert(t.mpContentSeries).values({
    id, projectId, name: input.name, kind: input.kind,
    params: toJson(s.SeriesParams.parse({ ...entry.defaults, ...input.params })),
    cadence: toJson(s.SeriesCadence.parse({ ...entry.cadence, ...input.cadence })),
    status: "active", lastRunAt: null, coverage: toJson({ used: [] }), createdAt: ts, updatedAt: ts,
  }).run();
  return getSeries(db, id)!;
}

export function patchSeries(db: Db, id: string, patch: s.SeriesPatch): s.ContentSeries {
  const cur = getSeries(db, id);
  if (!cur) throw err("Serie nicht gefunden.", 404);
  db.update(t.mpContentSeries).set({
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.params ? { params: toJson(s.SeriesParams.parse({ ...cur.params, ...patch.params })) } : {}),
    ...(patch.cadence ? { cadence: toJson(s.SeriesCadence.parse({ ...cur.cadence, ...patch.cadence })) } : {}),
    updatedAt: nowIso(),
  }).where(eq(t.mpContentSeries.id, id)).run();
  return getSeries(db, id)!;
}

export function deleteSeries(db: Db, id: string): boolean {
  return db.delete(t.mpContentSeries).where(eq(t.mpContentSeries.id, id)).run().changes > 0;
}

// --- Rotation ----------------------------------------------------------------

export interface Scope {
  key: string; label: string; query: s.DataQuery;
  /** Nur beim Binder-Showcase: der Share-Link, der abfotografiert wird. */
  showcaseUrl?: string;
}

/**
 * Worüber der nächste Lauf geht.
 *
 * Die Reihenfolge ist bewusst „neueste zuerst": ein frisches Set interessiert
 * die Nische am meisten. Alles, was innerhalb der Sperrfrist schon dran war,
 * fällt raus; ist am Ende nichts mehr übrig, kommt das am längsten Ungezeigte —
 * lieber eine Wiederholung nach einem Jahr als ein ausgefallener Slot.
 */
export function pickScope(provider: ProductDataProvider, series: s.ContentSeries, now = new Date()): Scope {
  const { params, coverage, kind } = series;
  const usedAt = new Map(coverage.used.map((u) => [u.key, Date.parse(u.at)]));
  const blocked = (key: string) => {
    const at = usedAt.get(key);
    return at !== undefined && now.getTime() - at < params.minWeeksBetweenRepeats * WEEK;
  };
  const oldestFirst = <T extends { id: string }>(list: T[]) =>
    [...list].sort((a, b) => (usedAt.get(a.id) ?? 0) - (usedAt.get(b.id) ?? 0));

  const base = { kind: "top" as const, region: params.region, n: params.n, priceBasis: params.priceBasis, countdown: params.countdown };

  if (kind === "custom") {
    if (params.set) {
      const set = provider.resolveSet(params.set);
      if (!set) throw err(`Set „${params.set}" gibt es in den Produktdaten nicht.`);
      return { key: set.id, label: set.name, query: s.DataQuery.parse({ ...base, set: set.id }) };
    }
    if (params.era) {
      const era = provider.listEras().find((e) => e.id === params.era);
      if (!era) throw err(`Ära „${params.era}" gibt es in den Produktdaten nicht.`);
      return { key: era.id, label: era.name, query: s.DataQuery.parse({ ...base, era: era.id }) };
    }
    throw err("Für einen festen Bereich muss ein Set oder eine Ära hinterlegt sein.");
  }

  if (kind === "price_movers") {
    return {
      key: `movers-${new Date(now).toISOString().slice(0, 10)}`, label: `Preis-Raketen ${params.days} Tage`,
      query: s.DataQuery.parse({
        kind: "movers", region: params.region, n: params.n, days: params.days, direction: params.direction,
        minBaseEur: params.minBaseEur, minPoints: params.minHistoryPoints, maxChangePct: params.maxChangePct, countdown: params.countdown,
      }),
    };
  }

  if (kind === "binder_showcase") {
    const urls = params.binderUrls.map((x) => x.trim()).filter(Boolean);
    if (!urls.length) throw err("Für den Binder-Showcase fehlen die Share-Links der Binder.", 409);
    const keyOf = (u: string) => shareIdOf(u) ?? u;
    const free = urls.filter((u) => !blocked(keyOf(u)));
    const pick = free[0] ?? [...urls].sort((a, b) => (usedAt.get(keyOf(a)) ?? 0) - (usedAt.get(keyOf(b)) ?? 0))[0]!;
    // Der Bereich ist hier kein Datenausschnitt, sondern ein Binder — die Abfrage bleibt leer.
    return { key: keyOf(pick), label: `Binder ${keyOf(pick)}`, query: s.DataQuery.parse({}), showcaseUrl: pick };
  }

  if (kind === "artist_spotlight") {
    if (params.illustrator.trim()) {
      return { key: params.illustrator.trim(), label: params.illustrator.trim(), query: s.DataQuery.parse({ ...base, illustrator: params.illustrator.trim() }) };
    }
    const artists = provider.topIllustrators(40, params.region);
    if (!artists.length) throw err("Keine Illustratoren mit genug Karten in den Produktdaten.", 409);
    const free = artists.filter((a) => !blocked(a.name));
    const pick = free[0] ?? [...artists].sort((a, b) => (usedAt.get(a.name) ?? 0) - (usedAt.get(b.name) ?? 0))[0]!;
    return { key: pick.name, label: pick.name, query: s.DataQuery.parse({ ...base, illustrator: pick.name }) };
  }

  if (kind === "top_era") {
    const eras = provider.listEras().filter((e) => e.setCount > 0);
    if (!eras.length) throw err("Keine Ära mit Sets in den Produktdaten.");
    const free = eras.filter((e) => !blocked(e.id));
    const pick = free[0] ?? oldestFirst(eras)[0]!;
    return { key: pick.id, label: pick.name, query: s.DataQuery.parse({ ...base, era: pick.id }) };
  }

  // top_set und new_set: dieselbe Liste, nur ein anderer Filter davor
  const sets = provider.listSets(params.region).filter((x) => x.total > 0)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  if (!sets.length) throw err("Keine Sets in den Produktdaten.");

  if (kind === "new_set") {
    const cutoff = new Date(now.getTime() - params.maxAgeDays * 86_400_000).toISOString().slice(0, 10);
    const fresh = sets.filter((x) => x.releaseDate >= cutoff && !usedAt.has(x.id));
    const pick = fresh[0];
    if (!pick) throw err(`Kein Set jünger als ${params.maxAgeDays} Tage, das noch nicht dran war — dieser Lauf fällt aus.`, 409);
    return { key: pick.id, label: pick.name, query: s.DataQuery.parse({ ...base, set: pick.id }) };
  }

  const free = sets.filter((x) => !blocked(x.id));
  const pick = free[0] ?? oldestFirst(sets)[0]!;
  // „Errate den Preis" rotiert wie Top-Set durch die Sets, zeigt sie nur anders.
  return { key: pick.id, label: pick.name, query: s.DataQuery.parse({ ...base, ...(kind === "guess_the_price" ? { kind: "guess" } : {}), set: pick.id }) };
}

// --- Lauf --------------------------------------------------------------------

export interface SeriesRunResult { pieces: string[]; scope: string; formats: string[]; note: string }

/**
 * Einen Lauf ausführen. `preview` erzeugt dieselben Stücke, rührt aber den
 * Zustand der Serie nicht an — so kann man eine Vorlage ausprobieren, ohne die
 * Rotation zu verbrauchen.
 */
export async function runSeries(
  ctx: StudioContext & { env: Env }, seriesId: string, user: HostUser, opts: { preview?: boolean; now?: Date } = {},
): Promise<SeriesRunResult> {
  const now = opts.now ?? new Date();
  const series = getSeries(ctx.db, seriesId, now);
  if (!series) throw err("Serie nicht gefunden.", 404);
  if (!isAvailable(series.kind)) throw err(`„${series.kind}" ist noch nicht gebaut.`);
  const provider = createProductDataProvider(ctx.db, ctx.env, series.projectId, { log: ctx.log });
  if (!provider) throw err("Das Projekt hat keine Produktdatenquelle.");

  let scope: Scope;
  try {
    scope = pickScope(provider, series, now);
    if (series.kind === "price_movers") {
      // Lieber ein Lauf faellt aus, als eine „Rakete" zu behaupten, die auf zwei
      // Messpunkten beruht. Der duenne Preisverlauf der Quelle ist dokumentiert.
      const probe = await provider.priceMovers({
        days: series.params.days, direction: series.params.direction, minBaseEur: series.params.minBaseEur,
        n: series.params.n, region: series.params.region, minPoints: series.params.minHistoryPoints,
      });
      const plausible = series.params.maxChangePct > 0
        ? probe.cards.filter((c) => Math.abs(c.changePct) <= series.params.maxChangePct)
        : probe.cards;
      if (plausible.length < Math.min(5, series.params.n)) {
        throw err(`Nur ${plausible.length} glaubwürdige Bewegungen (mindestens ${series.params.minHistoryPoints} Messpunkte, höchstens ${series.params.maxChangePct} % Ausschlag) — zu dünn für eine Preis-Raketen-Ausgabe. Der Lauf fällt aus.`, 409);
      }
    }
  } finally { provider.close(); }

  const pieces: string[] = [];
  const autoNotes: string[] = [];
  // Der Showcase erzeugt genau ein Buendel, egal welche Formate eingestellt sind.
  const formats = series.kind === "binder_showcase" ? ["data_carousel" as const] : series.params.formats;
  for (const format of formats) {
    const showcase = series.kind === "binder_showcase";
    const req = s.ContentRequest.parse({
      // Der Showcase kennt nur ein Format: echte Seiten lassen sich nicht als Reel abkuerzen.
      format: showcase ? "showcase_carousel" : format,
      topic: "", hint: "", seriesId: series.id,
      platform: series.params.platforms[0] ?? "instagram",
      bundlePlatforms: series.params.platforms,
      language: series.params.language,
      dataQuery: scope.query,
      ...(showcase ? { showcase: { url: scope.showcaseUrl ?? "", maxPages: series.params.maxPages, withPrices: series.params.withPrices } } : {}),
      ...(!showcase && format === "data_reel" ? { reel: { voiceover: series.params.voiceover, music: series.params.music, secondsPerCard: series.params.secondsPerCard } } : {}),
    });
    const lead = await generateContent(ctx, series.projectId, req, user);
    pieces.push(lead.id);
    if (!opts.preview) {
      // Reels sind hier noch Entwuerfe - fuer sie greift die Automatik erst, wenn
      // der Worker die MP4 gebaut hat (siehe video/slideshow.ts).
      const auto = autoScheduleBundle(ctx.db, series.projectId, lead.id, { now, user });
      // Nur was NICHT automatisch rausgeht, braucht eine Aufgabe.
      if (auto.scheduled === 0) createPublishTask(ctx.db, series, lead, now);
      autoNotes.push(...auto.notes);
    }
  }

  if (!opts.preview) {
    const used = [...series.coverage.used.filter((u) => u.key !== scope.key), { key: scope.key, label: scope.label, at: now.toISOString() }].slice(-200);
    ctx.db.update(t.mpContentSeries).set({ lastRunAt: now.toISOString(), coverage: toJson({ used }), updatedAt: nowIso() })
      .where(eq(t.mpContentSeries.id, series.id)).run();
  }
  writeAudit(ctx.db, {
    user, action: opts.preview ? "series.preview" : "series.run", entityType: "series", entityId: series.id,
    projectId: series.projectId, content: { scope: scope.label, formats: series.params.formats, pieces },
  });
  return {
    pieces, scope: scope.label, formats,
    note: [opts.preview ? "Vorschau — die Rotation wurde nicht verbraucht." : "", ...autoNotes].filter(Boolean).join(" "),
  };
}

/** Zu jedem Bündel eine Aufgabe „Posten", verlinkt wie im Cockpit üblich. */
function createPublishTask(db: Db, series: s.ContentSeries, lead: s.ContentPiece, now: Date): void {
  const version = currentVersion(db, series.projectId);
  const startDate = version?.plan.startDate ?? now.toISOString().slice(0, 10);
  const week = weekOf(startDate, now.toISOString()) ?? 1;
  const siblings = db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, series.projectId)).all().filter((x) => x.week === week);
  const ts = nowIso();
  db.insert(t.mpTasks).values({
    id: newId(), projectId: series.projectId,
    title: `Posten: ${lead.title}`.slice(0, 200),
    description: `Aus der Serie „${series.name}". Text und Bilder liegen fertig im Publish-Paket.`,
    type: "publish", status: "todo", dueAt: dueAtFor(startDate, week, 1),
    assignedTo: "human", approvalLevel: "review", outputRefs: toJson([lead.id]),
    order: siblings.length + 1, channel: lead.channel, week, planVersion: version?.version ?? 0,
    createdAt: ts, updatedAt: ts,
  }).run();
}

// --- Faelligkeit -------------------------------------------------------------

/** Serien, die jetzt dran sind — reine Funktion, damit sie testbar bleibt. */
export function dueSeries(db: Db, now = new Date()): s.ContentSeries[] {
  const out: s.ContentSeries[] = [];
  for (const r of db.select().from(t.mpContentSeries).all()) {
    if (r.status !== "active") continue;
    if (loadDataSource(db, r.projectId).provider === "none") continue;
    const series = seriesOf(db, r, now);
    if (!isAvailable(series.kind)) continue;
    if (isDue(series.cadence, series.lastRunAt, now)) out.push(series);
  }
  return out;
}

/** Serien mit Stau: zwei oder mehr Leit-Stücke liegen unfreigegeben herum. */
export function jammedSeries(db: Db, projectId: string, now = new Date()): { id: string; name: string; pending: number }[] {
  return listSeries(db, projectId, now).filter((x) => x.pendingReview >= 2)
    .map((x) => ({ id: x.id, name: x.name, pending: x.pendingReview }));
}

export { pieceOf };
