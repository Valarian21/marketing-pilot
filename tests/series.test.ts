/**
 * Shot 9: Serien-Engine. Zwei Dinge entscheiden hier über Erfolg oder Blamage —
 * die Fälligkeit (in Berliner Zeit, nicht UTC) und die Rotation (nie zweimal
 * dasselbe Set). Beides ist reine Rechnung und wird deshalb ohne Datenbank und
 * ohne Netz geprüft.
 */
import { describe, expect, it } from "vitest";
import { berlinInstant, berlinParts, isDue, nextRunAt } from "../src/server/agents/series/time.js";
import { pickScope } from "../src/server/agents/series/series.js";
import { SERIES_CATALOG, catalogFor } from "../src/server/agents/series/catalog.js";
import * as s from "../src/shared/schemas.js";
import type { ProductDataProvider, ProductSet } from "../src/server/providers/product-data.js";

const cadence = (days: s.Weekday[], hour: number): s.SeriesCadence => ({ days, hour });

describe("Berliner Zeitrechnung", () => {
  it("liest Wochentag, Stunde und Datum in Berlin, nicht in UTC", () => {
    // 22:30 UTC im Sommer ist in Berlin bereits der Folgetag, 00:30
    expect(berlinParts(new Date("2026-07-06T22:30:00Z"))).toEqual({ day: "tue", hour: 0, date: "2026-07-07" });
    // im Winter nur +1
    expect(berlinParts(new Date("2026-01-05T23:30:00Z"))).toEqual({ day: "tue", hour: 0, date: "2026-01-06" });
  });
  it("findet den UTC-Moment für neun Uhr Berliner Zeit in beiden Jahreszeiten", () => {
    expect(berlinInstant("2026-07-06", 9).toISOString()).toBe("2026-07-06T07:00:00.000Z");
    expect(berlinInstant("2026-01-05", 9).toISOString()).toBe("2026-01-05T08:00:00.000Z");
  });
  it("nennt den nächsten Slot und überspringt den schon vergangenen von heute", () => {
    const mo = cadence(["mon", "thu"], 9);
    // Montag 06.07.2026, 10:00 Berlin - der Montagsslot ist durch, als Nächstes Donnerstag
    expect(nextRunAt(mo, new Date("2026-07-06T08:00:00Z"))!.toISOString()).toBe("2026-07-09T07:00:00.000Z");
    // Sonntagabend -> Montag früh
    expect(nextRunAt(mo, new Date("2026-07-05T20:00:00Z"))!.toISOString()).toBe("2026-07-06T07:00:00.000Z");
  });
});

describe("Fälligkeit", () => {
  const mo9 = cadence(["mon"], 9);
  it("ist erst ab der Stunde fällig, und nur am richtigen Tag", () => {
    expect(isDue(mo9, null, new Date("2026-07-06T06:00:00Z"))).toBe(false);  // 08:00 Berlin
    expect(isDue(mo9, null, new Date("2026-07-06T07:30:00Z"))).toBe(true);   // 09:30 Berlin
    expect(isDue(mo9, null, new Date("2026-07-07T07:30:00Z"))).toBe(false);  // Dienstag
  });
  it("läuft am selben Berliner Tag nicht zweimal — auch nicht über einen Neustart", () => {
    const heute = new Date("2026-07-06T07:30:00Z");
    expect(isDue(mo9, "2026-07-06T07:31:00.000Z", heute)).toBe(false);
    expect(isDue(mo9, "2026-07-06T20:00:00.000Z", new Date("2026-07-06T21:00:00Z"))).toBe(false);
    // eine Woche später wieder
    expect(isDue(mo9, "2026-07-06T07:31:00.000Z", new Date("2026-07-13T07:30:00Z"))).toBe(true);
  });
});

// --- Rotation ----------------------------------------------------------------

const set = (id: string, name: string, date: string): ProductSet =>
  ({ id, name, nameEn: name, serieId: "x", serieName: "X", releaseDate: date, total: 200, region: "intl", eraId: "e1" });

const SETS = [
  set("s2026", "Set 2026", "2026-08-01"),
  set("s2025", "Set 2025", "2025-08-01"),
  set("s2024", "Set 2024", "2024-08-01"),
];

const fakeProvider = (): ProductDataProvider => ({
  name: "fake",
  listSets: () => SETS,
  listEras: () => [
    { id: "sv", name: "Karmesin & Purpur", nameEn: "Scarlet & Violet", from: "2023", to: "2026", setCount: 5 },
    { id: "swsh", name: "Schwert & Schild", nameEn: "Sword & Shield", from: "2020", to: "2023", setCount: 12 },
  ],
  resolveSet: (x) => SETS.find((y) => y.id === x) ?? null,
  newestSets: (n) => SETS.slice(0, n),
  topIllustrators: () => [{ name: "Ken Sugimori", cards: 300 }, { name: "Mitsuhiro Arita", cards: 210 }, { name: "Naoyo Kimura", cards: 90 }],
  topCards: () => Promise.reject(new Error("nicht benutzt")),
  priceMovers: () => Promise.reject(new Error("nicht benutzt")),
  cardImage: () => Promise.resolve(null),
  status: () => Promise.reject(new Error("nicht benutzt")),
  close: () => undefined,
});

const series = (over: Partial<s.ContentSeries> & { kind: s.SeriesKind }): s.ContentSeries => ({
  id: "x", projectId: "p", name: "S", params: s.SeriesParams.parse({}), cadence: cadence(["mon"], 9),
  status: "active", lastRunAt: null, nextRunAt: null, coverage: { used: [] }, pendingReview: 0,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
});

describe("Rotation", () => {
  const provider = fakeProvider();

  it("nimmt das neueste Set und rotiert über die Wochen weiter, ohne Wiederholung", () => {
    let coverage: s.SeriesCoverage = { used: [] };
    const seen: string[] = [];
    for (let week = 0; week < 3; week++) {
      const now = new Date(Date.parse("2026-09-07T07:00:00Z") + week * 7 * 86_400_000);
      const scope = pickScope(provider, series({ kind: "top_set", coverage }), now);
      seen.push(scope.key);
      coverage = { used: [...coverage.used, { key: scope.key, label: scope.label, at: now.toISOString() }] };
    }
    expect(seen).toEqual(["s2026", "s2025", "s2024"]);
  });

  it("greift nach der vierten Woche auf das am längsten Ungezeigte zurück, statt auszufallen", () => {
    const base = Date.parse("2026-09-07T07:00:00Z");
    const coverage: s.SeriesCoverage = { used: [
      { key: "s2024", label: "Set 2024", at: new Date(base).toISOString() },
      { key: "s2025", label: "Set 2025", at: new Date(base + 7 * 86_400_000).toISOString() },
      { key: "s2026", label: "Set 2026", at: new Date(base + 14 * 86_400_000).toISOString() },
    ] };
    const scope = pickScope(provider, series({ kind: "top_set", coverage }), new Date(base + 21 * 86_400_000));
    expect(scope.key).toBe("s2024");   // am längsten her
  });

  it("respektiert die Sperrfrist, lässt danach aber wieder zu", () => {
    const now = new Date("2026-09-07T07:00:00Z");
    const zehnWochenHer = new Date(now.getTime() - 10 * 7 * 86_400_000).toISOString();
    const cov: s.SeriesCoverage = { used: [{ key: "s2026", label: "Set 2026", at: zehnWochenHer }] };
    expect(pickScope(provider, series({ kind: "top_set", coverage: cov }), now).key).toBe("s2025");
    const kurz = s.SeriesParams.parse({ minWeeksBetweenRepeats: 4 });
    expect(pickScope(provider, series({ kind: "top_set", coverage: cov, params: kurz }), now).key).toBe("s2026");
  });

  it("rotiert Ären genauso", () => {
    const now = new Date("2026-09-07T07:00:00Z");
    const first = pickScope(provider, series({ kind: "top_era" }), now);
    expect(first.key).toBe("sv");
    const cov: s.SeriesCoverage = { used: [{ key: "sv", label: "Karmesin & Purpur", at: now.toISOString() }] };
    expect(pickScope(provider, series({ kind: "top_era", coverage: cov }), now).key).toBe("swsh");
  });

  it("lässt die Serie „Neues Set“ ausfallen, wenn nichts frisch genug ist", () => {
    const spaet = new Date("2027-06-01T07:00:00Z");   // alle Sets weit über 60 Tage alt
    expect(() => pickScope(provider, series({ kind: "new_set" }), spaet)).toThrowError(/Kein Set jünger/);
    const frueh = new Date("2026-09-07T07:00:00Z");   // s2026 ist 37 Tage alt
    expect(pickScope(provider, series({ kind: "new_set" }), frueh).key).toBe("s2026");
  });

  it("verlangt beim festen Bereich eine Angabe und prüft sie", () => {
    const now = new Date("2026-09-07T07:00:00Z");
    expect(() => pickScope(provider, series({ kind: "custom" }), now)).toThrowError(/Set oder eine Ära/);
    const gut = s.SeriesParams.parse({ set: "s2025" });
    expect(pickScope(provider, series({ kind: "custom", params: gut }), now).query.set).toBe("s2025");
    const schlecht = s.SeriesParams.parse({ set: "gibtsnicht" });
    expect(() => pickScope(provider, series({ kind: "custom", params: schlecht }), now)).toThrowError(/gibt es in den Produktdaten nicht/);
  });

  it("rotiert Illustratoren und respektiert einen fest eingetragenen", () => {
    const now = new Date("2026-09-07T07:00:00Z");
    const erste = pickScope(provider, series({ kind: "artist_spotlight" }), now);
    expect(erste.key).toBe("Ken Sugimori");
    expect(erste.query.illustrator).toBe("Ken Sugimori");
    const cov: s.SeriesCoverage = { used: [{ key: "Ken Sugimori", label: "Ken Sugimori", at: now.toISOString() }] };
    expect(pickScope(provider, series({ kind: "artist_spotlight", coverage: cov }), now).key).toBe("Mitsuhiro Arita");
    const fest = s.SeriesParams.parse({ illustrator: "Naoyo Kimura" });
    expect(pickScope(provider, series({ kind: "artist_spotlight", params: fest, coverage: cov }), now).key).toBe("Naoyo Kimura");
  });

  it("wechselt beim Binder-Showcase zwischen den Share-Links", () => {
    const now = new Date("2026-09-07T07:00:00Z");
    const params = s.SeriesParams.parse({ binderUrls: ["https://binderplan.app/app#ansicht/AAA111", "https://binderplan.app/app#ansicht/BBB222"] });
    const erste = pickScope(provider, series({ kind: "binder_showcase", params }), now);
    expect(erste.key).toBe("AAA111");
    expect(erste.showcaseUrl).toContain("AAA111");
    const cov: s.SeriesCoverage = { used: [{ key: "AAA111", label: "", at: now.toISOString() }] };
    expect(pickScope(provider, series({ kind: "binder_showcase", params, coverage: cov }), now).key).toBe("BBB222");
  });

  it("sagt beim Showcase klar, wenn noch kein Binder hinterlegt ist", () => {
    expect(() => pickScope(provider, series({ kind: "binder_showcase" }), new Date())).toThrowError(/Share-Links/);
  });

  it("zeigt die Rate-Serie als Set-Rotation im Ratemodus", () => {
    const q = pickScope(provider, series({ kind: "guess_the_price" }), new Date("2026-09-07T07:00:00Z")).query;
    expect(q.kind).toBe("guess");
    expect(q.set).toBe("s2026");
  });

  it("baut für Preis-Raketen eine movers-Abfrage ohne Rotation — mit Plausibilitätsgrenzen", () => {
    const q = pickScope(provider, series({ kind: "price_movers" }), new Date("2026-09-07T07:00:00Z")).query;
    expect(q.kind).toBe("movers");
    expect(q.days).toBe(7);
    expect(q.set).toBe("");
    // Die Grenzen aus den Serien-Parametern muessen in der Abfrage landen,
    // sonst zeigt die Serie wieder +500-Prozent-Artefakte.
    expect(q.minPoints).toBe(4);
    expect(q.maxChangePct).toBe(200);
  });
});

describe("Katalog", () => {
  it("hat seit Shot 11 keine offenen Vorlagen mehr", () => {
    // Vor Shot 11 standen drei Vorlagen mit „kommt noch" im Katalog. Jetzt laufen alle.
    expect(SERIES_CATALOG.filter((x) => !x.available)).toEqual([]);
    expect(SERIES_CATALOG.map((x) => x.kind)).toContain("binder_showcase");
    expect(SERIES_CATALOG.map((x) => x.kind)).toContain("artist_spotlight");
    expect(SERIES_CATALOG.map((x) => x.kind)).toContain("guess_the_price");
    for (const x of SERIES_CATALOG) expect(x.description.length).toBeGreaterThan(30);
  });
  it("liefert für jede Vorlage gültige Vorgaben", () => {
    for (const x of SERIES_CATALOG) {
      expect(() => s.SeriesParams.parse(x.defaults)).not.toThrow();
      expect(() => s.SeriesCadence.parse(x.cadence)).not.toThrow();
      expect(catalogFor(x.kind)).toBe(x);
    }
  });
});
