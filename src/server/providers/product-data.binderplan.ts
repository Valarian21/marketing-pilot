/**
 * Produktdaten-Provider für Binderplan (binderplan.app, Pokémon-Binder-Planer).
 *
 * **Binderplan wird ausschließlich gelesen.** Die Datenbank wird `readonly`
 * geöffnet, geschrieben wird nur in `mp_card_prices` in unserer eigenen `mp.db`.
 *
 * Gelesen wird ein Schnappschuss, nicht die Live-Datei: `/root` ist
 * `drwx------`, der Pilot läuft als `developer` und käme an
 * `/root/apps/binderplan/app.db` nicht heran. Ein Traversierungsrecht auf
 * `/root` schied aus – dort liegen auch die world-readable Kundendatenbanken
 * von Lehreule, atemzug und date-einladung. Ein root-eigener systemd-Timer legt
 * deshalb stündlich eine konsistente Kopie ab
 * (`deploy/binderplan-snapshot.sh`). Nebeneffekt, den wir gerne mitnehmen:
 * Binderplan spürt von unserer Leselast nichts.
 *
 * Preise sind in Binderplan absichtlich lückenhaft (gefüllt wird, was Nutzer
 * ansehen – beim Bau 486 von 33.732 Karten). Für Top-Listen lädt dieser Provider
 * fehlende und alte Preise selbst von TCGdex nach und legt sie in
 * `mp_card_prices` ab.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { inArray } from "drizzle-orm";
import * as t from "../db/schema.js";
import { nowIso, type Db } from "../db/index.js";
import { ERAS, eraForSet, eraSetFilter, findEra, POCKET_SERIES } from "./binderplan-eras.js";
import type {
  PriceBasis, PriceMover, PriceMoversQuery, PriceMoversResult, ProductDataProvider,
  ProductDataStatus, ProductEra, ProductSet, RankedCard, TopCardsQuery, TopCardsResult,
} from "./product-data.js";

/** Preisquellen von TCGdex, in der Reihenfolge, die Binderplan selbst nutzt. */
const PRICE_KEYS = ["trend", "avg30", "avg", "low"] as const;
const HOLO_KEYS = ["trend-holo", "avg30-holo", "avg-holo", "low-holo"] as const;

export interface BinderplanOptions {
  /** Schnappschuss von Binderplans app.db. */
  dbPath: string;
  /** Verzeichnis für heruntergeladene Kartenbilder (unter MP_DATA_DIR). */
  imageDir: string;
  /** Binderplans HTTP-Dienst, für Kartenbilder. */
  apiBase: string;
  tcgdexBase: string;
  /** Preise älter als das gelten als veraltet und werden nachgeladen. */
  maxAgeHours: number;
  /** Deckel je Abfrage – eine Ära hat Tausende Karten, die laden wir nie alle. */
  maxRefresh: number;
  /** Parallele TCGdex-Abfragen. Höflich bleiben. */
  concurrency: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (m: string) => void;
}

export const BINDERPLAN_DEFAULTS = { maxAgeHours: 72, maxRefresh: 400, concurrency: 6 };

interface CardRow {
  id: string; set_id: string; local_id: string; local_num: number | null;
  name_de: string | null; name_en: string | null; name_ja: string | null;
  rarity: string | null; illustrator: string | null; region: string | null;
  image_de: string | null; image_en: string | null; image_alt: string | null;
  kinds: string | null; set_name: string | null; set_name_en: string | null;
}

interface Price { eur: number | null; holo: number | null; updatedAt: string; suspect?: boolean }

/**
 * Gegenprobe gegen die zweite Preisquelle derselben Antwort.
 *
 * Anlass: „Mewtu ★" aus Holon Phantoms stand mit **56,98 €** in einer Liste,
 * während TCGplayer für dieselbe Karte 5.000 $ nennt — TCGdex verweist dort auf
 * das falsche Cardmarket-Produkt. Bei Gold-Star-Karten passiert das öfter.
 *
 * Normale Karten liegen zwischen 0,8× und 3× (Wechselkurs, andere Märkte,
 * gemessen an einer Stichprobe). Ab dem Fünffachen ist nicht mehr der Markt
 * unterschiedlich, sondern die Verknüpfung kaputt — in beide Richtungen.
 */
export const PRICE_MISMATCH_FACTOR = 5;

export function isImplausible(eur: number | null, usd: number | null): boolean {
  if (!eur || !usd || eur <= 0 || usd <= 0) return false;
  const ratio = usd / eur;
  return ratio > PRICE_MISMATCH_FACTOR || ratio < 1 / PRICE_MISMATCH_FACTOR;
}

/** Binderplan speichert `datetime('now')` (UTC, ohne Zone) – hier auf ISO gebracht. */
const toIso = (v: string | null | undefined): string => (v ? `${v.trim().replace(" ", "T")}Z`.replace("ZZ", "Z") : "");
const isoDate = (iso: string): string => (iso ? (iso.split("T")[0] ?? "") : "");

export class BinderplanProvider implements ProductDataProvider {
  readonly name = "binderplan";
  private sqlite: Database.Database;
  private readonly o: BinderplanOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly log: (m: string) => void;

  constructor(private db: Db, opts: BinderplanOptions) {
    this.o = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? (() => {});
    // readonly + fileMustExist ist die Lese-Garantie: better-sqlite3 lehnt jedes
    // Schreib-Statement gegen dieses Handle ab, egal was der Code später will.
    this.sqlite = new Database(opts.dbPath, { readonly: true, fileMustExist: true });
  }

  close(): void { this.sqlite.close(); }

  // --- Sets und Ären ---------------------------------------------------------

  private setRow(r: Record<string, unknown>): ProductSet {
    const serieId = String(r.serie_id ?? "");
    const releaseDate = String(r.release_date ?? "");
    return {
      id: String(r.id), name: String(r.name ?? r.name_en ?? ""), nameEn: String(r.name_en ?? r.name ?? ""),
      serieId, serieName: String(r.serie_name ?? ""), releaseDate, total: Number(r.total ?? 0),
      region: r.region === "jp" ? "jp" : "intl", eraId: eraForSet(serieId, releaseDate),
    };
  }

  listSets(region?: "intl" | "jp"): ProductSet[] {
    const rows = this.sqlite.prepare(
      `SELECT id, name, name_en, serie_id, serie_name, release_date, total, region FROM sets
       ${region ? "WHERE region = ?" : ""} ORDER BY release_date DESC, id`,
    ).all(...(region ? [region] : [])) as Record<string, unknown>[];
    return rows.map((r) => this.setRow(r)).filter((s) => !POCKET_SERIES.has(s.serieId));
  }

  newestSets(n: number, region: "intl" | "jp" = "intl"): ProductSet[] {
    return this.listSets(region).filter((s) => s.total > 0).slice(0, Math.max(1, n));
  }

  listEras(): ProductEra[] {
    const counts = new Map<string, number>();
    for (const s of this.listSets()) counts.set(s.eraId, (counts.get(s.eraId) ?? 0) + 1);
    return ERAS.map((e) => ({ id: e.id, name: e.name, nameEn: e.nameEn, from: e.from, to: e.to, setCount: counts.get(e.id) ?? 0 }));
  }

  /** Set über id oder (Teil-)Namen finden – der Serien-Katalog aus Shot 9 gibt Namen herein. */
  resolveSet(nameOrId: string): ProductSet | null {
    const q = nameOrId.trim();
    if (!q) return null;
    const exact = this.sqlite.prepare(
      "SELECT id, name, name_en, serie_id, serie_name, release_date, total, region FROM sets WHERE id = ? OR lower(name) = lower(?) OR lower(name_en) = lower(?)",
    ).get(q, q, q) as Record<string, unknown> | undefined;
    if (exact) return this.setRow(exact);
    const like = this.sqlite.prepare(
      "SELECT id, name, name_en, serie_id, serie_name, release_date, total, region FROM sets WHERE name LIKE ? OR name_en LIKE ? ORDER BY release_date DESC LIMIT 1",
    ).get(`%${q}%`, `%${q}%`) as Record<string, unknown> | undefined;
    return like ? this.setRow(like) : null;
  }

  // --- Preise ----------------------------------------------------------------

  /** Preise beider Quellen zusammengeführt: der jeweils frischere gewinnt. */
  private knownPrices(ids: string[]): Map<string, Price> {
    const out = new Map<string, Price>();
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const rows = this.sqlite.prepare(
        `SELECT card_id, eur, eur_holo, updated_at FROM card_prices WHERE card_id IN (${chunk.map(() => "?").join(",")})`,
      ).all(...chunk) as { card_id: string; eur: number | null; eur_holo: number | null; updated_at: string | null }[];
      for (const r of rows) out.set(r.card_id, { eur: r.eur, holo: r.eur_holo, updatedAt: toIso(r.updated_at) });
      const own = this.db.select().from(t.mpCardPrices).where(inArray(t.mpCardPrices.cardId, chunk)).all();
      for (const r of own) {
        const prev = out.get(r.cardId);
        // Der Verdacht haftet an der Karte, nicht am Eintrag: auch wenn Binderplans
        // Wert frischer ist, bleibt er unglaubwuerdig, wenn unsere Gegenprobe anschlug.
        if (!prev || r.fetchedAt > prev.updatedAt) out.set(r.cardId, { eur: r.eur, holo: r.eurHolo, updatedAt: r.fetchedAt, suspect: r.suspect === 1 });
        else if (prev) prev.suspect = r.suspect === 1;
      }
    }
    return out;
  }

  private effective(p: Price | undefined, basis: PriceBasis): { eur: number; used: "normal" | "holo" } | null {
    if (!p) return null;
    const normal = p.eur ?? null;
    const holo = p.holo ?? null;
    if (basis === "normal") return normal === null ? null : { eur: normal, used: "normal" };
    if (basis === "holo") return holo === null ? null : { eur: holo, used: "holo" };
    // "max": bei alten Holos ist die Holo-Variante die wertvolle.
    if (normal === null && holo === null) return null;
    if (holo !== null && (normal === null || holo > normal)) return { eur: holo, used: "holo" };
    return { eur: normal as number, used: "normal" };
  }

  private isStale(p: Price | undefined): boolean {
    if (!p || !p.updatedAt) return true;
    const age = this.now().getTime() - Date.parse(p.updatedAt);
    return !Number.isFinite(age) || age > this.o.maxAgeHours * 3_600_000;
  }

  /** Ein Preis von TCGdex, exakt nach Binderplans Schlüssel-Reihenfolge. */
  private async fetchPrice(cardId: string): Promise<{ eur: number | null; holo: number | null; usd: number | null }> {
    // Japanische IDs beginnen mit einem Großbuchstaben – dieselbe Regel wie in Binderplan.
    const lang = /^[A-Z]/.test(cardId) ? "ja" : "en";
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20_000);
      const res = await this.fetchImpl(`${this.o.tcgdexBase}/${lang}/cards/${encodeURIComponent(cardId)}`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) return { eur: null, holo: null, usd: null };
      const body = await res.json() as {
        pricing?: {
          cardmarket?: Record<string, number | null>;
          tcgplayer?: Record<string, { marketPrice?: number | null; midPrice?: number | null; lowPrice?: number | null } | string | null>;
        };
      };
      const cm = body.pricing?.cardmarket ?? {};
      const pick = (keys: readonly string[]): number | null => {
        for (const k of keys) { const v = cm[k]; if (v !== null && v !== undefined && Number.isFinite(Number(v))) return Math.round(Number(v) * 100) / 100; }
        return null;
      };
      // Die teuerste TCGplayer-Variante als zweite Meinung. Sie geht nie in eine
      // Rangliste ein – sie sagt nur, ob dem Euro-Preis zu trauen ist.
      let usd: number | null = null;
      for (const v of Object.values(body.pricing?.tcgplayer ?? {})) {
        if (!v || typeof v !== "object") continue;
        const p = v.marketPrice ?? v.midPrice ?? v.lowPrice ?? null;
        if (p !== null && Number.isFinite(Number(p))) usd = Math.max(usd ?? 0, Number(p));
      }
      return { eur: pick(PRICE_KEYS), holo: pick(HOLO_KEYS), usd };
    } catch { return { eur: null, holo: null, usd: null }; }
  }

  /** Nachladen in kleinen Wellen und Ergebnis in mp_card_prices ablegen. */
  private async refresh(ids: string[]): Promise<Map<string, Price>> {
    const out = new Map<string, Price>();
    const at = nowIso();
    for (let i = 0; i < ids.length; i += this.o.concurrency) {
      const wave = ids.slice(i, i + this.o.concurrency);
      const got = await Promise.all(wave.map(async (id) => [id, await this.fetchPrice(id)] as const));
      for (const [id, p] of got) {
        if (p.eur === null && p.holo === null) continue;
        const suspect = isImplausible(Math.max(p.eur ?? 0, p.holo ?? 0), p.usd) ? 1 : 0;
        if (suspect) this.log(`Preis unglaubwürdig: ${id} — Cardmarket ${Math.max(p.eur ?? 0, p.holo ?? 0)} € gegen TCGplayer ${p.usd} $`);
        out.set(id, { eur: p.eur, holo: p.holo, updatedAt: at, suspect: Boolean(suspect) });
        this.db.insert(t.mpCardPrices)
          .values({ cardId: id, eur: p.eur, eurHolo: p.holo, usd: p.usd, suspect, source: "tcgdex", fetchedAt: at })
          .onConflictDoUpdate({ target: t.mpCardPrices.cardId, set: { eur: p.eur, eurHolo: p.holo, usd: p.usd, suspect, source: "tcgdex", fetchedAt: at } })
          .run();
      }
      if (i + this.o.concurrency < ids.length) await new Promise((r) => setTimeout(r, 120));
    }
    return out;
  }

  // --- Top-Listen ------------------------------------------------------------

  private scopeCards(q: TopCardsQuery): { rows: CardRow[]; label: string; labelEn: string } {
    const select = `SELECT cards.id, cards.set_id, cards.local_id, cards.local_num, cards.name_de, cards.name_en,
        cards.name_ja, cards.rarity, cards.illustrator, cards.region, cards.image_de, cards.image_en, cards.image_alt, cards.kinds,
        (SELECT name FROM sets WHERE sets.id = cards.set_id) set_name,
        (SELECT name_en FROM sets WHERE sets.id = cards.set_id) set_name_en
      FROM cards`;
    if (q.scope.set) {
      const set = this.resolveSet(q.scope.set);
      if (!set) throw new Error(`Set unbekannt: ${q.scope.set}`);
      return {
        rows: this.sqlite.prepare(`${select} WHERE cards.set_id = ?`).all(set.id) as CardRow[],
        label: set.name, labelEn: set.nameEn,
      };
    }
    if (q.scope.era) {
      const era = findEra(q.scope.era);
      const filter = eraSetFilter(q.scope.era);
      if (!era || !filter) throw new Error(`Ära unbekannt: ${q.scope.era}`);
      const region = q.scope.region ?? "intl";
      // Maßgeblich ist die Region des SETS, nicht die der Karte: in Binderplan
      // haengen einzelne Altbestaende (z. B. neo4-4) als `intl`-Karte an einem
      // `jp`-Set mit japanischem Namen. Auf einer Slide saehe das kaputt aus.
      const rows = this.sqlite.prepare(
        `${select} WHERE cards.set_id IN (SELECT id FROM sets WHERE region = ? AND (${filter.sql}))`,
      ).all(region, ...filter.params) as CardRow[];
      return { rows, label: era.name, labelEn: era.nameEn };
    }
    if (q.scope.illustrator) {
      const region = q.scope.region ?? "intl";
      const rows = this.sqlite.prepare(
        `${select} WHERE cards.illustrator = ? AND cards.set_id IN (SELECT id FROM sets WHERE region = ?)`,
      ).all(q.scope.illustrator, region) as CardRow[];
      if (!rows.length) throw new Error(`Kein Kartenbestand fuer Illustrator: ${q.scope.illustrator}`);
      return { rows, label: q.scope.illustrator, labelEn: q.scope.illustrator };
    }
    throw new Error("Bereich fehlt: set, era oder illustrator angeben.");
  }

  /**
   * Die haeufigsten Illustratoren. Ein Mindestbestand haelt Ein-Karten-Kuenstler
   * heraus, aus denen sich keine Zehnerliste bauen laesst.
   */
  topIllustrators(n: number, region: "intl" | "jp" = "intl"): { name: string; cards: number }[] {
    return this.sqlite.prepare(
      `SELECT illustrator name, count(*) cards FROM cards
       WHERE illustrator IS NOT NULL AND trim(illustrator) <> ''
         AND set_id IN (SELECT id FROM sets WHERE region = ?)
       GROUP BY illustrator HAVING cards >= 12 ORDER BY cards DESC LIMIT ?`,
    ).all(region, Math.max(1, Math.min(n, 100))) as { name: string; cards: number }[];
  }

  private cardName(r: CardRow): { de: string; en: string } {
    const de = r.name_de || r.name_en || r.name_ja || r.id;
    const en = r.name_en || r.name_de || r.name_ja || r.id;
    return r.region === "jp"
      ? { de: r.name_de ? `${r.name_ja} · ${r.name_de}` : (r.name_ja ?? de), en: r.name_en ? `${r.name_ja} · ${r.name_en}` : (r.name_ja ?? en) }
      : { de, en };
  }

  async topCards(q: TopCardsQuery): Promise<TopCardsResult> {
    const basis = q.priceBasis ?? "max";
    const n = Math.max(1, Math.min(q.n, 50));
    const { rows, label, labelEn } = this.scopeCards(q);
    const exclude = new Set((q.excludeKinds ?? []).map((k) => k.toLowerCase()));
    const pool = exclude.size
      ? rows.filter((r) => !(JSON.parse(r.kinds || "[]") as string[]).some((k) => exclude.has(String(k).toLowerCase())))
      : rows;

    const prices = this.knownPrices(pool.map((r) => r.id));

    // Nachlade-Auswahl. Ein ganzes Set passt komplett unter den Deckel; eine Ära
    // hat Tausende Karten, deshalb zwei Prioritäten:
    //   1. Karten mit bekanntem Preis, teuerste zuerst – die entscheiden das Ranking.
    //   2. Karten ganz ohne Preis, höchste Sammlernummer zuerst. In modernen Sets
    //      liegen die Secret Rares über der Set-Grenze, das ist der beste Anhalt,
    //      den die Kartendaten ohne Preis hergeben.
    const stale = pool.filter((r) => this.isStale(prices.get(r.id)));
    const known = stale.filter((r) => this.effective(prices.get(r.id), basis) !== null)
      .sort((a, b) => (this.effective(prices.get(b.id), basis)?.eur ?? 0) - (this.effective(prices.get(a.id), basis)?.eur ?? 0));
    const unknown = stale.filter((r) => this.effective(prices.get(r.id), basis) === null)
      .sort((a, b) => (b.local_num ?? 0) - (a.local_num ?? 0));
    const budget = this.o.maxRefresh;
    const wanted = [...known.slice(0, Math.min(known.length, n * 3)), ...unknown].slice(0, budget);

    const fresh = await this.refresh(wanted.map((r) => r.id));
    for (const [id, p] of fresh) prices.set(id, p);
    if (wanted.length) this.log(`Produktdaten ${label}: ${wanted.length} Preise nachgeladen (${fresh.size} mit Wert)`);

    const ranked = pool
      .map((r) => ({ r, p: prices.get(r.id), e: this.effective(prices.get(r.id), basis) }))
      .filter((x): x is { r: CardRow; p: Price; e: { eur: number; used: "normal" | "holo" } } => x.e !== null && x.p !== undefined)
      // Karten, deren beide Quellen sich widersprechen, kommen gar nicht erst in
      // die Rangliste — lieber eine Karte weniger als eine falsche Zahl auf einer Slide.
      .filter((x) => !x.p.suspect)
      .filter((x) => (q.minPrice === undefined || x.e.eur >= q.minPrice))
      .sort((a, b) => b.e.eur - a.e.eur)
      .slice(0, n);

    const cards: RankedCard[] = ranked.map((x, i) => {
      const names = this.cardName(x.r);
      return {
        rank: i + 1, id: x.r.id, name: names.de, nameEn: names.en,
        setId: x.r.set_id, setName: x.r.set_name || x.r.set_name_en || x.r.set_id,
        localId: x.r.local_id ?? "", rarity: x.r.rarity ?? "", illustrator: x.r.illustrator ?? "",
        priceEur: x.e.eur, priceBasisUsed: x.e.used, priceUpdatedAt: x.p.updatedAt,
        region: x.r.region === "jp" ? "jp" : "intl",
        imageLang: x.r.image_de ? "de" : (x.r.image_en ? "en" : null),
      };
    });

    const priced = pool.filter((r) => this.effective(prices.get(r.id), basis) !== null).length;
    return {
      cards, scopeLabel: label, scopeLabelEn: labelEn,
      totalEur: Math.round(cards.reduce((s, c) => s + c.priceEur, 0) * 100) / 100,
      // Ältester Stand der Liste – ehrlicher als der neueste, denn er gilt für alle.
      priceStand: isoDate(cards.reduce((oldest, c) => (!oldest || c.priceUpdatedAt < oldest ? c.priceUpdatedAt : oldest), "")),
      coverage: { cardsInScope: pool.length, priced, refreshed: fresh.size, skipped: Math.max(0, stale.length - wanted.length) },
    };
  }

  // --- Preis-Bewegungen ------------------------------------------------------

  async priceMovers(q: PriceMoversQuery): Promise<PriceMoversResult> {
    const n = Math.max(1, Math.min(q.n, 50));
    const since = new Date(this.now().getTime() - q.days * 86_400_000).toISOString().slice(0, 10);
    const region = q.region ?? "intl";
    // Ein Verlauf je Karte: ältester Eintrag im Fenster als Basis, neuester als Vergleich.
    const rows = this.sqlite.prepare(
      `SELECT h.card_id,
              (SELECT eur FROM price_history WHERE card_id = h.card_id AND datum >= ? ORDER BY datum ASC  LIMIT 1) base,
              (SELECT eur FROM price_history WHERE card_id = h.card_id AND datum >= ? ORDER BY datum DESC LIMIT 1) last,
              (SELECT max(datum) FROM price_history WHERE card_id = h.card_id AND datum >= ?) stand,
              (SELECT count(*) FROM price_history WHERE card_id = h.card_id AND datum >= ?) points
       FROM (SELECT DISTINCT card_id FROM price_history WHERE datum >= ?) h`,
    ).all(since, since, since, since, since) as { card_id: string; base: number | null; last: number | null; stand: string | null; points: number }[];

    const minPoints = Math.max(2, q.minPoints ?? 2);
    const withHistory = rows.filter((r) => r.base !== null && r.last !== null && r.base !== r.last && r.points >= minPoints);
    const moves = withHistory
      .filter((r) => (r.base as number) >= q.minBaseEur)
      .map((r) => ({ id: r.card_id, base: r.base as number, last: r.last as number, stand: r.stand ?? "", delta: (r.last as number) - (r.base as number) }))
      .filter((m) => (q.direction === "up" ? m.delta > 0 : m.delta < 0))
      .sort((a, b) => (q.direction === "up" ? b.delta - a.delta : a.delta - b.delta))
      .slice(0, n * 2);

    if (moves.length === 0) {
      return { cards: [], scopeLabel: q.direction === "up" ? `Preis-Raketen ${q.days} Tage` : `Preis-Rutsche ${q.days} Tage`, priceStand: "", withHistory: withHistory.length };
    }
    // Auch hier: widersprüchliche Preise fliegen raus, bevor daraus eine „Rakete" wird.
    // Der Verlauf allein sagt nichts über die Glaubwürdigkeit — deshalb werden die
    // Kandidaten hier eigens nachgeladen, damit die Gegenprobe überhaupt vorliegt.
    // Es sind höchstens ein paar Dutzend Karten, das kostet Sekunden.
    const bekannt = this.knownPrices(moves.map((m) => m.id));
    const ungeprueft = moves.filter((m) => bekannt.get(m.id)?.suspect === undefined).map((m) => m.id);
    if (ungeprueft.length) await this.refresh(ungeprueft);
    const verdacht = this.knownPrices(moves.map((m) => m.id));
    const sauber = moves.filter((m) => !verdacht.get(m.id)?.suspect);
    if (sauber.length < moves.length) this.log(`Preis-Bewegungen: ${moves.length - sauber.length} Karten wegen widersprüchlicher Preise verworfen`);
    const ids = sauber.map((m) => m.id);
    const cardRows = this.sqlite.prepare(
      `SELECT cards.id, cards.set_id, cards.local_id, cards.local_num, cards.name_de, cards.name_en, cards.name_ja,
              cards.rarity, cards.illustrator, cards.region, cards.image_de, cards.image_en, cards.image_alt, cards.kinds,
              (SELECT name FROM sets WHERE sets.id = cards.set_id) set_name,
              (SELECT name_en FROM sets WHERE sets.id = cards.set_id) set_name_en
       FROM cards WHERE cards.id IN (${ids.map(() => "?").join(",")})
         AND cards.set_id IN (SELECT id FROM sets WHERE region = ?)`,
    ).all(...ids, region) as CardRow[];
    const byId = new Map(cardRows.map((r) => [r.id, r]));

    const cards: PriceMover[] = [];
    for (const m of sauber) {
      const r = byId.get(m.id);
      if (!r || cards.length >= n) continue;
      const names = this.cardName(r);
      cards.push({
        rank: cards.length + 1, id: r.id, name: names.de, nameEn: names.en,
        setId: r.set_id, setName: r.set_name || r.set_name_en || r.set_id,
        localId: r.local_id ?? "", rarity: r.rarity ?? "", illustrator: r.illustrator ?? "",
        priceEur: m.last, priceBasisUsed: "normal", priceUpdatedAt: `${m.stand}T00:00:00Z`,
        region: r.region === "jp" ? "jp" : "intl",
        imageLang: r.image_de ? "de" : (r.image_en ? "en" : null),
        baseEur: m.base, changeEur: Math.round(m.delta * 100) / 100,
        changePct: Math.round((m.delta / m.base) * 1000) / 10, days: q.days,
      });
    }
    return {
      cards, scopeLabel: q.direction === "up" ? `Preis-Raketen ${q.days} Tage` : `Preis-Rutsche ${q.days} Tage`,
      priceStand: cards.reduce((oldest, c) => (!oldest || isoDate(c.priceUpdatedAt) < oldest ? isoDate(c.priceUpdatedAt) : oldest), ""),
      withHistory: withHistory.length,
    };
  }

  // --- Kartenbilder ----------------------------------------------------------

  /**
   * Reihenfolge: eigener Cache → Binderplans Bild-Route auf 127.0.0.1:8103 →
   * TCGdex-Asset-URL aus der Karte. Binderplans eigener Dateicache liegt unter
   * /root und ist für uns nicht lesbar – deshalb führt der Weg über HTTP.
   */
  async cardImage(cardId: string, lang: "de" | "en" = "de"): Promise<string | null> {
    const safe = cardId.replace(/[^A-Za-z0-9._-]/g, "_");
    // Die Endung folgt dem, was tatsaechlich ankommt: TCGdex liefert webp,
    // der pokemontcg.io-Notnagel png. Der Renderer und die Vorschau-Route
    // lesen den Typ spaeter aus dem Dateinamen.
    for (const ext of ["webp", "png"]) {
      const hit = path.join(this.o.imageDir, `${safe}.${lang}.${ext}`);
      if (fs.existsSync(hit) && fs.statSync(hit).size > 0) return hit;
    }

    const row = this.sqlite.prepare("SELECT image_de, image_en, image_alt FROM cards WHERE id = ?").get(cardId) as
      { image_de: string | null; image_en: string | null; image_alt: string | null } | undefined;
    if (!row) return null;

    const base = lang === "en" ? (row.image_en ?? row.image_de) : (row.image_de ?? row.image_en);
    const candidates = [
      `${this.o.apiBase}/api/img/card/${encodeURIComponent(cardId)}?variante=high&lang=${lang}`,
      ...(base ? [`${base}/high.webp`] : []),
      ...(row.image_alt ? [row.image_alt.endsWith(".png") ? `${row.image_alt.slice(0, -4)}_hires.png` : row.image_alt] : []),
    ];
    for (const url of candidates) {
      try {
        const res = await this.fetchImpl(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) continue;
        const type = res.headers.get("content-type") ?? "";
        const ext = type.includes("png") || (!type && url.endsWith(".png")) ? "png" : "webp";
        const file = path.join(this.o.imageDir, `${safe}.${lang}.${ext}`);
        fs.mkdirSync(this.o.imageDir, { recursive: true });
        fs.writeFileSync(file, buf);
        return file;
      } catch { /* nächster Kandidat */ }
    }
    return null;
  }

  // --- Status ----------------------------------------------------------------

  async status(): Promise<ProductDataStatus> {
    const one = (sql: string): number => Number((this.sqlite.prepare(sql).get() as Record<string, unknown> | undefined)?.n ?? 0);
    const kv = this.sqlite.prepare("SELECT value FROM kv WHERE key = 'preishistorie_lauf'").get() as { value: string } | undefined;
    const cutoff = new Date(this.now().getTime() - this.o.maxAgeHours * 3_600_000).toISOString();
    const ownFresh = this.db.select().from(t.mpCardPrices).all().filter((r) => r.fetchedAt >= cutoff).length;
    const srcFresh = one(`SELECT count(*) n FROM card_prices WHERE updated_at >= '${cutoff.slice(0, 19).replace("T", " ")}'`);

    let files = 0, bytes = 0;
    if (fs.existsSync(this.o.imageDir)) {
      for (const f of fs.readdirSync(this.o.imageDir)) {
        try { bytes += fs.statSync(path.join(this.o.imageDir, f)).size; files++; } catch { /* verschwunden */ }
      }
    }
    const stat = fs.existsSync(this.o.dbPath) ? fs.statSync(this.o.dbPath) : null;
    return {
      provider: this.name, available: true, detail: "",
      dbPath: this.o.dbPath, dbUpdatedAt: stat ? stat.mtime.toISOString() : null,
      cards: one("SELECT count(*) n FROM cards"), sets: one("SELECT count(*) n FROM sets"),
      eras: ERAS.length,
      pricesTotal: one("SELECT count(*) n FROM card_prices") + this.db.select().from(t.mpCardPrices).all().length,
      pricesFresh: srcFresh + ownFresh,
      sourceLastPriceRun: kv?.value ? toIso(kv.value) : null,
      imageCacheFiles: files, imageCacheBytes: bytes,
    };
  }
}
