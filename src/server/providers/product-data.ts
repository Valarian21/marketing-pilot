/**
 * Produktdaten: die Brücke von einem Marketing-Projekt zur Datenbank des
 * beworbenen Produkts. Nur Projekte mit hinterlegter Datenquelle haben eine –
 * Lehreule hat keine, und alle brief-basierten Flows laufen unverändert weiter.
 *
 * **Zahlen sind heilig.** Rang, Namen, Set und Preise kommen deterministisch aus
 * dem Provider. Das LLM formuliert später nur Captions darum herum und darf
 * Zahlen weder erfinden noch runden. Jede Preisangabe trägt deshalb ihr
 * Stand-Datum bis in die Slide.
 */

export interface ProductSet {
  id: string;
  name: string;
  nameEn: string;
  serieId: string;
  serieName: string;
  releaseDate: string;
  total: number;
  region: "intl" | "jp";
  /** Abgeleitet über `eraForSet`, nicht in der Quelle gespeichert. */
  eraId: string;
}

export interface ProductEra {
  id: string;
  name: string;
  nameEn: string;
  from: string;
  to: string;
  setCount: number;
}

/** Auf welcher Variante der Preis beruht – gehört sichtbar an jede Zahl. */
export type PriceBasis = "max" | "normal" | "holo";

export interface RankedCard {
  rank: number;
  id: string;
  name: string;
  nameEn: string;
  setId: string;
  setName: string;
  localId: string;
  rarity: string;
  illustrator: string;
  /** Cardmarket-Trend in Euro. Nie gerundet, nie geschätzt. */
  priceEur: number;
  /** „normal“ oder „holo“ – bei `basis: max` die tatsächlich gewinnende Variante. */
  priceBasisUsed: "normal" | "holo";
  priceUpdatedAt: string;
  region: "intl" | "jp";
  imageLang: "de" | "en" | null;
}

export interface TopCardsQuery {
  /** Genau eines von `set`, `era` oder `illustrator` fuellt den Bereich. */
  scope: { set?: string; era?: string; illustrator?: string; region?: "intl" | "jp" };
  n: number;
  priceBasis?: PriceBasis;
  minPrice?: number;
  excludeKinds?: string[];
}

/** Was der Lauf tatsächlich gesehen hat – die Grundlage für ehrliche UI-Hinweise. */
export interface ScopeCoverage {
  cardsInScope: number;
  /** Karten mit einem Preis nach dem Lauf. */
  priced: number;
  /** In diesem Lauf frisch von TCGdex geholt. */
  refreshed: number;
  /** Aus Budgetgründen nicht angefasst (nur bei großen Ären > 0). */
  skipped: number;
}

export interface TopCardsResult {
  cards: RankedCard[];
  scopeLabel: string;
  scopeLabelEn: string;
  /** Summe der `priceEur` der gelieferten Karten. */
  totalEur: number;
  /** Ältester Preisstand der Liste als ISO-Datum – das gehört in die Fußzeile. */
  priceStand: string;
  coverage: ScopeCoverage;
}

export interface PriceMoversQuery {
  days: 7 | 30;
  direction: "up" | "down";
  minBaseEur: number;
  n: number;
  region?: "intl" | "jp";
  /**
   * Mindestzahl an Messpunkten im Fenster. Zwei Punkte ergeben rechnerisch eine
   * Bewegung, aber keine Aussage — bei duenn gehandelten Karten schwankt der
   * Trendpreis wild. Default 2 (alles), Serien setzen mehr.
   */
  minPoints?: number;
}

export interface PriceMover extends RankedCard {
  baseEur: number;
  changeEur: number;
  changePct: number;
  days: number;
}

export interface PriceMoversResult {
  cards: PriceMover[];
  scopeLabel: string;
  priceStand: string;
  /** Karten mit Verlauf im Fenster – ohne die ist die Liste nicht aussagekräftig. */
  withHistory: number;
}

export interface ProductDataStatus {
  provider: string;
  available: boolean;
  /** Klartext, warum nicht – wird im UI so angezeigt. */
  detail: string;
  dbPath: string;
  dbUpdatedAt: string | null;
  cards: number;
  sets: number;
  eras: number;
  pricesTotal: number;
  pricesFresh: number;
  /** Letzter Preislauf des Produkts selbst (Binderplan: `kv.preishistorie_lauf`). */
  sourceLastPriceRun: string | null;
  imageCacheFiles: number;
  imageCacheBytes: number;
}

export interface ProductDataProvider {
  readonly name: string;
  listSets(region?: "intl" | "jp"): ProductSet[];
  listEras(): ProductEra[];
  resolveSet(nameOrId: string): ProductSet | null;
  newestSets(n: number, region?: "intl" | "jp"): ProductSet[];
  /** Illustratoren mit den meisten Karten — Grundlage der Artist-Spotlight-Rotation. */
  topIllustrators(n: number, region?: "intl" | "jp"): { name: string; cards: number }[];
  topCards(q: TopCardsQuery): Promise<TopCardsResult>;
  priceMovers(q: PriceMoversQuery): Promise<PriceMoversResult>;
  /** Lokaler Dateipfad eines Kartenbildes – der Renderer braucht Dateien, keine URLs. */
  cardImage(cardId: string, lang?: "de" | "en"): Promise<string | null>;
  status(): Promise<ProductDataStatus>;
  close(): void;
}
