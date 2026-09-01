/**
 * Shot 6: Produktdaten-Provider. Gearbeitet wird gegen eine Fixture-Datenbank im
 * Format von Binderplans app.db – so laufen die Tests ohne den Schnappschuss vom
 * VPS und ohne eine Zeile Netzverkehr.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../src/server/db/index.js";
import { BinderplanProvider } from "../src/server/providers/product-data.binderplan.js";
import { eraForSet, eraSetFilter, ERAS } from "../src/server/providers/binderplan-eras.js";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mp-productdata-"));
const FIXTURE = path.join(DIR, "binderplan.db");
const IMAGES = path.join(DIR, "images");
const NOW = new Date("2026-08-31T12:00:00Z");
/** Frisch genug (innerhalb 72 h) bzw. eindeutig veraltet. */
const FRESH = "2026-08-31 06:00:00";
const STALE = "2026-01-01 06:00:00";

/**
 * Fixture: 3 internationale Sets über 2 Ären + ein japanisches Set, ~30 Karten,
 * Preise teils fehlend, teils veraltet.
 */
function buildFixture(): void {
  const db = new Database(FIXTURE);
  db.exec(`
    CREATE TABLE sets (id TEXT PRIMARY KEY, name TEXT, name_en TEXT, serie_id TEXT, serie_name TEXT,
                       release_date TEXT, total INTEGER, official INTEGER, symbol TEXT, serie_name_en TEXT, region TEXT, symbol_alt TEXT);
    CREATE TABLE cards (id TEXT PRIMARY KEY, set_id TEXT, local_id TEXT, local_num INTEGER, name_de TEXT, name_en TEXT,
                        name_ja TEXT, rarity TEXT, illustrator TEXT, region TEXT, image_de TEXT, image_en TEXT,
                        image_alt TEXT, kinds TEXT, release_date TEXT);
    CREATE TABLE card_prices (card_id TEXT PRIMARY KEY, eur REAL, updated_at TEXT, eur_holo REAL);
    CREATE TABLE price_history (card_id TEXT, datum TEXT, eur REAL);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
  `);
  const set = db.prepare("INSERT INTO sets (id,name,name_en,serie_id,serie_name,release_date,total,region) VALUES (?,?,?,?,?,?,?,?)");
  set.run("swsh12", "Silberne Sturmwinde", "Silver Tempest", "swsh", "Schwert & Schild", "2022-11-11", 215, "intl");
  set.run("sv01", "Karmesin & Purpur", "Scarlet & Violet", "sv", "Karmesin & Purpur", "2023-03-31", 198, "intl");
  // McDonald's ohne feste Ära – muss über das Datum in die swsh-Ära fallen.
  set.run("mc2022", "McDonald's 2022", "McDonald's 2022", "mc", "McDonald's", "2022-08-01", 15, "intl");
  set.run("S12a", "ハイクラスパック", "VSTAR Universe", "S", "ソード&シールド", "2022-12-02", 172, "jp");
  // Alter Bestand mit widerspruechlicher Region: intl-Karte in einem jp-Set.
  set.run("neo4", "闇、そして光へ...", "闇、そして光へ...", "neo", "Neo", "2001-11-01", 66, "jp");

  const card = db.prepare(`INSERT INTO cards (id,set_id,local_id,local_num,name_de,name_en,name_ja,rarity,illustrator,region,image_de,image_en,image_alt,kinds,release_date)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const price = db.prepare("INSERT INTO card_prices (card_id,eur,updated_at,eur_holo) VALUES (?,?,?,?)");

  // swsh12: 10 Karten. Zwei mit frischem Preis, zwei mit veraltetem, sechs ohne.
  for (let i = 1; i <= 10; i++) {
    card.run(`swsh12-${i}`, "swsh12", String(180 + i), 180 + i, `Karte ${i}`, `Card ${i}`, null,
      i > 8 ? "Secret Rare" : "Ultra Rare", "Illu A", "intl", `https://img/de/swsh12-${i}`, `https://img/en/swsh12-${i}`, null,
      i === 3 ? '["VMAX"]' : "[]", "2022-11-11");
  }
  price.run("swsh12-1", 50, FRESH, 5);          // frisch, normal gewinnt
  price.run("swsh12-2", 4, FRESH, 120);         // frisch, holo gewinnt deutlich
  price.run("swsh12-3", 900, STALE, null);      // veraltet und teuer -> muss nachgeladen werden
  price.run("swsh12-4", 7, STALE, null);        // veraltet, guenstig

  // sv01: 8 Karten ohne jeden Preis - der Nachlader muss sie ueber local_num priorisieren.
  for (let i = 1; i <= 8; i++) {
    card.run(`sv01-${i}`, "sv01", String(190 + i), 190 + i, `SV Karte ${i}`, `SV Card ${i}`, null, "Rare", "Illu B", "intl",
      `https://img/de/sv01-${i}`, null, null, "[]", "2023-03-31");
  }
  // McDonald's: eine Karte, damit der Datums-Zuschlag der Ära pruefbar ist.
  card.run("mc2022-1", "mc2022", "1", 1, "Glumanda", "Charmander", null, "Promo", "Illu C", "intl", "https://img/de/mc2022-1", null, null, "[]", "2022-08-01");
  price.run("mc2022-1", 3, FRESH, null);

  // Japanisches Set + der widerspruechliche Altbestand.
  card.run("S12a-1", "S12a", "1", 1, null, null, "リザードン", "AR", "Illu D", "jp", null, null, null, "[]", "2022-12-02");
  price.run("S12a-1", 80, FRESH, null);
  card.run("neo4-4", "neo4", "4", 4, "Dunkles Psiana", "Dark Espeon", null, "Rare", "Illu E", "intl", "https://img/de/neo4-4", null, null, "[]", "2001-11-01");
  price.run("neo4-4", 200, FRESH, null);

  // Verlauf fuer die Preis-Bewegungen (Fenster: die letzten 7 Tage).
  const hist = db.prepare("INSERT INTO price_history (card_id,datum,eur) VALUES (?,?,?)");
  hist.run("swsh12-1", "2026-08-20", 20);   // ausserhalb des 7-Tage-Fensters (Fenster ab 24.08.)
  hist.run("swsh12-1", "2026-08-27", 40);
  hist.run("swsh12-1", "2026-08-31", 50);   // +10 auf Basis 40
  hist.run("swsh12-2", "2026-08-27", 100);
  hist.run("swsh12-2", "2026-08-31", 60);   // Absteiger
  hist.run("swsh12-4", "2026-08-27", 2);    // unter minBaseEur
  hist.run("swsh12-4", "2026-08-31", 9);
  hist.run("neo4-4", "2026-08-27", 100);
  hist.run("neo4-4", "2026-08-31", 200);    // jp-Set: darf in einer intl-Liste nicht auftauchen

  db.prepare("INSERT INTO kv (key,value) VALUES ('preishistorie_lauf','2026-08-31 11:11:54')").run();
  db.close();
}

/** TCGdex-Attrappe: merkt sich, wer abgefragt wurde. */
function fakeTcgdex(prices: Record<string, { eur?: number; holo?: number }>) {
  const asked: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const u = String(url);
    const id = decodeURIComponent(u.split("/cards/")[1] ?? "");
    asked.push(id);
    const p = prices[id];
    if (!p) return new Response("{}", { status: 404 });
    const cm: Record<string, number> = {};
    if (p.eur !== undefined) cm.trend = p.eur;
    if (p.holo !== undefined) cm["trend-holo"] = p.holo;
    return new Response(JSON.stringify({ pricing: { cardmarket: cm } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, asked };
}

function provider(opts: { fetchImpl?: typeof fetch; maxRefresh?: number; db?: Db } = {}) {
  const db = opts.db ?? openDatabase(DIR, ":memory:").db;
  return new BinderplanProvider(db, {
    dbPath: FIXTURE, imageDir: IMAGES, apiBase: "http://binderplan.test", tcgdexBase: "https://tcgdex.test/v2",
    maxAgeHours: 72, maxRefresh: opts.maxRefresh ?? 400, concurrency: 3,
    fetchImpl: opts.fetchImpl ?? fakeTcgdex({}).impl, now: () => NOW,
  });
}

beforeAll(() => { buildFixture(); });
afterAll(() => { fs.rmSync(DIR, { recursive: true, force: true }); });

describe("Ären-Zuordnung (portiert aus Binderplans main.py)", () => {
  it("ordnet feste Serien ihrer Ära zu", () => {
    expect(eraForSet("swsh", "2022-11-11")).toBe("swsh");
    expect(eraForSet("sv", "2023-03-31")).toBe("sv");
    expect(eraForSet("base", "1999-01-09")).toBe("klassik");
    expect(eraForSet("col", "2011-02-09")).toBe("hgss");   // Ruf der Legenden gehört zu HGSS
  });
  it("schlägt Quer-Serien ohne feste Ära über das Datum zu", () => {
    expect(eraForSet("mc", "2022-08-01")).toBe("swsh");    // McDonald's 2022 -> Schwert & Schild
    expect(eraForSet("pop", "2005-06-01")).toBe("ex");
    expect(eraForSet("tk", "2010-06-01")).toBe("hgss");
    expect(eraForSet(null, "0000-00-00")).toBe("klassik"); // ohne alles: die früheste Ära
  });
  it("liefert für jede Ära ein Datumsfenster und einen Filter", () => {
    for (const era of ERAS) expect(eraSetFilter(era.id)).not.toBeNull();
    expect(eraSetFilter("gibtsnicht")).toBeNull();
  });
});

describe("Sets und Ären lesen", () => {
  it("findet Sets über id, exakten Namen und Teilstring", () => {
    const p = provider();
    expect(p.resolveSet("swsh12")?.id).toBe("swsh12");
    expect(p.resolveSet("Silberne Sturmwinde")?.id).toBe("swsh12");
    expect(p.resolveSet("silver tempest")?.id).toBe("swsh12");   // name_en, Groß/Klein egal
    expect(p.resolveSet("Sturmwinde")?.id).toBe("swsh12");        // Teilstring
    expect(p.resolveSet("gibtsnicht")).toBeNull();
    p.close();
  });
  it("zählt Sets je Ära und leitet die Ära des Sets ab", () => {
    const p = provider();
    const eras = Object.fromEntries(p.listEras().map((e) => [e.id, e.setCount]));
    expect(eras.swsh).toBe(3);   // swsh12 + mc2022 (über das Datum) + das jp-Set S12a
    expect(eras.sv).toBe(1);
    expect(eras.klassik).toBe(1);
    expect(p.newestSets(2, "intl").map((s) => s.id)).toEqual(["sv01", "swsh12"]);
    p.close();
  });
});

describe("topCards", () => {
  it("rankt nach dem effektiven Preis und nennt die verwendete Variante", async () => {
    const { impl } = fakeTcgdex({ "swsh12-3": { eur: 30 }, "swsh12-4": { eur: 7 } });
    const p = provider({ fetchImpl: impl });
    const res = await p.topCards({ scope: { set: "swsh12" }, n: 3 });
    expect(res.scopeLabel).toBe("Silberne Sturmwinde");
    expect(res.cards.map((c) => [c.rank, c.id, c.priceEur, c.priceBasisUsed])).toEqual([
      [1, "swsh12-2", 120, "holo"],   // holo schlägt normal bei basis "max"
      [2, "swsh12-1", 50, "normal"],
      [3, "swsh12-3", 30, "normal"],  // veralteter 900er Preis wurde durch 30 ersetzt
    ]);
    expect(res.totalEur).toBe(200);
    expect(res.priceStand).toBe("2026-08-31");
    p.close();
  });

  it("achtet auf priceBasis, minPrice und excludeKinds", async () => {
    // Ohne erreichbares TCGdex bleibt der veraltete 900er Preis von swsh12-3 stehen:
    // ein alter Preis ist besser als keiner (dieselbe Regel wie in Binderplan), und
    // das Stand-Datum der Liste sagt es offen. Deshalb fuehrt swsh12-3 hier.
    const p = provider();
    const normal = await p.topCards({ scope: { set: "swsh12" }, n: 5, priceBasis: "normal" });
    expect(normal.cards.map((c) => c.id)).toEqual(["swsh12-3", "swsh12-1", "swsh12-4", "swsh12-2"]);
    expect(normal.priceStand).toBe("2026-01-01");   // aeltester Stand der Liste, nicht der juengste
    const holo = await p.topCards({ scope: { set: "swsh12" }, n: 5, priceBasis: "holo" });
    expect(holo.cards.map((c) => c.id)).toEqual(["swsh12-2", "swsh12-1"]);  // nur Karten mit Holo-Preis
    const teuer = await p.topCards({ scope: { set: "swsh12" }, n: 5, minPrice: 100 });
    expect(teuer.cards.map((c) => c.id)).toEqual(["swsh12-3", "swsh12-2"]);
    const ohneVmax = await p.topCards({ scope: { set: "swsh12" }, n: 5, excludeKinds: ["vmax"] });
    expect(ohneVmax.cards.some((c) => c.id === "swsh12-3")).toBe(false);
    p.close();
  });

  it("lädt nur fehlende und veraltete Preise nach, frische bleiben unangetastet", async () => {
    const { impl, asked } = fakeTcgdex({ "swsh12-3": { eur: 30 } });
    const p = provider({ fetchImpl: impl });
    const res = await p.topCards({ scope: { set: "swsh12" }, n: 5 });
    expect(asked).not.toContain("swsh12-1");   // frisch
    expect(asked).not.toContain("swsh12-2");   // frisch
    expect(asked).toContain("swsh12-3");       // veraltet
    expect(asked).toContain("swsh12-4");       // veraltet
    expect(asked).toContain("swsh12-10");      // nie bepreist
    expect(res.coverage.cardsInScope).toBe(10);
    expect(res.coverage.refreshed).toBe(1);    // nur swsh12-3 lieferte einen Wert
    p.close();
  });

  it("hält den Nachlade-Deckel ein und priorisiert hohe Sammlernummern", async () => {
    const { impl, asked } = fakeTcgdex({});
    const p = provider({ fetchImpl: impl, maxRefresh: 3 });
    const res = await p.topCards({ scope: { set: "sv01" }, n: 5 });
    expect(asked).toHaveLength(3);
    // Ohne jeden Preis entscheidet die Sammlernummer: Secret Rares liegen oben.
    expect(asked).toEqual(["sv01-8", "sv01-7", "sv01-6"]);
    expect(res.coverage.skipped).toBe(5);
    expect(res.cards).toHaveLength(0);          // keine Preise -> keine Rangliste, keine erfundenen Zahlen
    p.close();
  });

  it("schreibt nachgeladene Preise in den eigenen Cache und liest sie beim zweiten Mal", async () => {
    const { db } = openDatabase(DIR, ":memory:");
    const first = fakeTcgdex({ "swsh12-3": { eur: 30 }, "swsh12-4": { eur: 7 } });
    const p1 = provider({ fetchImpl: first.impl, db });
    await p1.topCards({ scope: { set: "swsh12" }, n: 5 });
    p1.close();
    const second = fakeTcgdex({ "swsh12-3": { eur: 999 } });
    const p2 = provider({ fetchImpl: second.impl, db });
    const res = await p2.topCards({ scope: { set: "swsh12" }, n: 5 });
    expect(second.asked).not.toContain("swsh12-3");   // liegt frisch im eigenen Cache
    expect(res.cards.find((c) => c.id === "swsh12-3")?.priceEur).toBe(30);
    p2.close();
  });

  it("nimmt bei Ären die Region des Sets, nicht die der Karte", async () => {
    const p = provider();
    const swsh = await p.topCards({ scope: { era: "swsh", region: "intl" }, n: 10 });
    // S12a ist ein jp-Set und darf nicht in der intl-Liste stehen; mc2022 schon.
    expect(swsh.cards.some((c) => c.id === "S12a-1")).toBe(false);
    expect(swsh.cards.some((c) => c.id === "mc2022-1")).toBe(true);
    const klassik = await p.topCards({ scope: { era: "klassik", region: "intl" }, n: 10 });
    // neo4-4 ist als Karte "intl" markiert, haengt aber an einem jp-Set mit
    // japanischem Namen - auf einer Slide waere das kaputt.
    expect(klassik.cards.some((c) => c.id === "neo4-4")).toBe(false);
    p.close();
  });

  it("meldet einen unbekannten Bereich als Fehler statt still leer zu liefern", async () => {
    const p = provider();
    await expect(p.topCards({ scope: { set: "gibtsnicht" }, n: 5 })).rejects.toThrow(/Set unbekannt/);
    await expect(p.topCards({ scope: {}, n: 5 })).rejects.toThrow(/Bereich fehlt/);
    p.close();
  });
});

describe("priceMovers", () => {
  it("misst gegen den ältesten Eintrag im Fenster und filtert nach Richtung und Basis", async () => {
    const p = provider();
    const up = await p.priceMovers({ days: 7, direction: "up", minBaseEur: 5, n: 10 });
    expect(up.cards.map((c) => [c.id, c.baseEur, c.priceEur, c.changeEur, c.changePct])).toEqual([
      ["swsh12-1", 40, 50, 10, 25],   // Basis 40 aus dem Fenster, nicht 20 von davor
    ]);
    // swsh12-4 (2 € -> 9 €) faellt unter minBaseEur, neo4-4 haengt an einem jp-Set.
    expect(up.cards.some((c) => c.id === "swsh12-4")).toBe(false);
    expect(up.cards.some((c) => c.id === "neo4-4")).toBe(false);
    const down = await p.priceMovers({ days: 7, direction: "down", minBaseEur: 5, n: 10 });
    expect(down.cards.map((c) => c.id)).toEqual(["swsh12-2"]);
    expect(down.cards[0]?.changeEur).toBe(-40);
    p.close();
  });
  it("meldet, auf wie vielen Karten der Verlauf überhaupt beruht", async () => {
    const p = provider();
    const res = await p.priceMovers({ days: 7, direction: "up", minBaseEur: 0, n: 10 });
    expect(res.withHistory).toBe(4);   // swsh12-1, -2, -4, neo4-4
    p.close();
  });
});

describe("Kartenbilder", () => {
  it("geht die Fallback-Kette durch und legt die Datei lokal ab", async () => {
    const tried: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      const u = String(url);
      tried.push(u);
      // Binderplans Bild-Route antwortet nicht, TCGdex schon.
      if (u.startsWith("http://binderplan.test")) return new Response("", { status: 502 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } });
    }) as unknown as typeof fetch;
    const p = provider({ fetchImpl: impl });
    const file = await p.cardImage("swsh12-1", "de");
    expect(tried[0]).toBe("http://binderplan.test/api/img/card/swsh12-1?variante=high&lang=de");
    expect(tried[1]).toBe("https://img/de/swsh12-1/high.webp");
    expect(file).toBe(path.join(IMAGES, "swsh12-1.de.webp"));
    expect(fs.readFileSync(file!)).toEqual(Buffer.from([1, 2, 3]));

    // Zweiter Aufruf bedient sich aus dem Cache, ohne erneut zu laden.
    const before = tried.length;
    expect(await p.cardImage("swsh12-1", "de")).toBe(file);
    expect(tried).toHaveLength(before);
    p.close();
  });
  it("liefert null statt eines Platzhalters, wenn nichts zu holen ist", async () => {
    const impl = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const p = provider({ fetchImpl: impl });
    expect(await p.cardImage("sv01-1", "de")).toBeNull();
    expect(await p.cardImage("gibtsnicht", "de")).toBeNull();
    p.close();
  });
});

describe("Lese-Garantie", () => {
  it("öffnet die Produktdatenbank readonly – jedes Schreiben scheitert", () => {
    const p = provider();
    const sqlite = (p as unknown as { sqlite: Database.Database }).sqlite;
    expect(sqlite.readonly).toBe(true);
    expect(() => sqlite.prepare("UPDATE card_prices SET eur = 1").run()).toThrow(/readonly/i);
    expect(() => sqlite.prepare("INSERT INTO cards (id) VALUES ('x')").run()).toThrow(/readonly/i);
    p.close();
  });
  it("legt eigene Preise ausschließlich in mp_card_prices ab", async () => {
    const { db } = openDatabase(DIR, ":memory:");
    const { impl } = fakeTcgdex({ "swsh12-3": { eur: 30 } });
    const p = provider({ fetchImpl: impl, db });
    await p.topCards({ scope: { set: "swsh12" }, n: 5 });
    p.close();
    const check = new Database(FIXTURE, { readonly: true });
    // Der Fixture-Preis von swsh12-3 steht unveraendert bei 900.
    expect((check.prepare("SELECT eur FROM card_prices WHERE card_id='swsh12-3'").get() as { eur: number }).eur).toBe(900);
    check.close();
  });
});

describe("Status", () => {
  it("meldet Zahlen, Frischeanteil und den letzten Preislauf der Quelle", async () => {
    const p = provider();
    const s = await p.status();
    expect(s.available).toBe(true);
    expect(s.cards).toBe(21);
    expect(s.sets).toBe(5);
    expect(s.eras).toBe(ERAS.length);
    expect(s.pricesTotal).toBe(7);
    expect(s.pricesFresh).toBe(5);   // swsh12-3 und -4 sind veraltet und zaehlen nicht mit
    expect(s.sourceLastPriceRun).toBe("2026-08-31T11:11:54Z");
    p.close();
  });
});

describe("Gegenprobe gegen die zweite Preisquelle", () => {
  it("erkennt widersprüchliche Preise, lässt normale Abweichungen aber durch", async () => {
    const { isImplausible, PRICE_MISMATCH_FACTOR } = await import("../src/server/providers/product-data.binderplan.js");
    expect(PRICE_MISMATCH_FACTOR).toBe(5);
    // Der echte Fall: Mewtu ★ steht mit 56,98 € gegen 5.000 $ bei TCGplayer.
    expect(isImplausible(56.98, 5000)).toBe(true);
    // Auch andersherum, falls Cardmarket derjenige mit dem Ausreißer ist.
    expect(isImplausible(900, 12)).toBe(true);
    // Gemessene Normalfälle: Wechselkurs und Marktunterschiede bleiben drin.
    expect(isImplausible(574.54, 524.94)).toBe(false);   // Lugia V
    expect(isImplausible(95.06, 224.94)).toBe(false);    // Blastoise, 2,4x
    expect(isImplausible(3.57, 9.62)).toBe(false);       // Energie-Karte, 2,7x
    // Ohne zweite Meinung wird nichts verworfen.
    expect(isImplausible(56.98, null)).toBe(false);
    expect(isImplausible(null, 5000)).toBe(false);
    expect(isImplausible(0, 5000)).toBe(false);
  });
});
