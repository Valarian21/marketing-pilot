/**
 * Pokémon-Ären, 1:1 übernommen aus Binderplans `main.py` (Abschnitt „Ären“,
 * Zeilen ~60–137: `AEREN`, `AERA_SERIEN`, `_aera_fuer_set`, `_aera_sql`).
 *
 * Bewusst kopiert statt importiert: der Marketing Pilot liest Binderplans
 * Datenbank, nicht seinen Code, und darf ihn nicht anfassen. Weicht Binderplan
 * hier ab, fällt es über die Tests in `tests/product-data.test.ts` auf.
 *
 * Warum überhaupt eigene Ären: TCGdex-Serien entsprechen nicht den echten
 * TCG-Ären (Platin ist dort eigene Serie, e-Card/Gym/Legendary Collection
 * fehlen der Klassik). Quer-Serien wie POP, Trainer-Kits und McDonald's haben
 * keine feste Ära und werden über ihr Erscheinungsdatum zugeschlagen.
 */

export interface Era {
  id: string;
  name: string;
  nameEn: string;
  from: string;
  to: string;
  /** Ab diesem Datum zählt die Ära für Quer-Serien. */
  start: string;
}

export const ERAS: readonly Era[] = [
  { id: "klassik", name: "Klassik (WotC)", nameEn: "Classic (WotC)", from: "1999", to: "2003", start: "0000-00-00" },
  { id: "ex", name: "EX (Rubin & Saphir)", nameEn: "EX (Ruby & Sapphire)", from: "2003", to: "2007", start: "2003-06-15" },
  { id: "dp", name: "Diamant & Perl", nameEn: "Diamond & Pearl", from: "2007", to: "2009", start: "2007-05-01" },
  { id: "pl", name: "Platin", nameEn: "Platinum", from: "2009", to: "2010", start: "2009-02-11" },
  { id: "hgss", name: "HeartGold & SoulSilver", nameEn: "HeartGold & SoulSilver", from: "2010", to: "2011", start: "2010-02-10" },
  { id: "bw", name: "Schwarz & Weiß", nameEn: "Black & White", from: "2011", to: "2013", start: "2011-03-01" },
  { id: "xy", name: "XY", nameEn: "XY", from: "2013", to: "2016", start: "2013-10-12" },
  { id: "sm", name: "Sonne & Mond", nameEn: "Sun & Moon", from: "2017", to: "2019", start: "2017-02-03" },
  { id: "swsh", name: "Schwert & Schild", nameEn: "Sword & Shield", from: "2020", to: "2023", start: "2019-11-15" },
  { id: "sv", name: "Karmesin & Purpur", nameEn: "Scarlet & Violet", from: "2023", to: "2025", start: "2023-03-01" },
  { id: "me", name: "Mega-Entwicklung", nameEn: "Mega Evolution", from: "2025", to: "", start: "2025-09-01" },
] as const;

/** Feste Serie→Ära-Zuordnung; alles andere (pop, tk, mc, …) läuft übers Datum. */
export const ERA_SERIES: Readonly<Record<string, string>> = {
  base: "klassik", gym: "klassik", neo: "klassik", lc: "klassik",
  ecard: "klassik", misc: "klassik",
  ex: "ex", dp: "dp", pl: "pl", hgss: "hgss", col: "hgss",
  bw: "bw", xy: "xy", sm: "sm", swsh: "swsh", sv: "sv",
  me: "me",
};

/** Quer-Serien ohne feste Ära – sie werden über das Erscheinungsdatum zugeordnet. */
const CROSS_SERIES = ["pop", "tk", "mc"] as const;

/** TCG Pocket (Handy-App, nur digital) wird bewusst nicht geführt – keine physischen Karten. */
export const POCKET_SERIES = new Set(["tcgp"]);

const ERA_ORDER = new Map(ERAS.map((e, i) => [e.id, i]));

export function findEra(eraId: string): Era | undefined {
  return ERAS.find((e) => e.id === eraId);
}

/** Ära eines Sets: feste Zuordnung, sonst die zum Erscheinungsdatum laufende Ära. */
export function eraForSet(serieId: string | null, releaseDate: string | null): string {
  const fixed = ERA_SERIES[serieId ?? ""];
  if (fixed) return fixed;
  const date = releaseDate || "0000-00-00";
  let match = "klassik";
  for (const era of ERAS) if (date >= era.start) match = era.id;
  return match;
}

/** Datumsfenster einer Ära: von ihrem Start bis zum Start der nächsten. */
export function eraWindow(eraId: string): { start: string; end: string } | null {
  const idx = ERA_ORDER.get(eraId);
  const era = findEra(eraId);
  if (idx === undefined || !era) return null;
  const next = ERAS.slice(idx + 1).find((e) => e.start);
  return { start: era.start, end: next?.start ?? "9999-99-99" };
}

/**
 * WHERE-Fragment auf `sets` für den Ären-Filter – die TS-Entsprechung von
 * Binderplans `_aera_sql`. Liefert Fragment + Parameter, damit der Aufrufer
 * es in eine `set_id IN (SELECT id FROM sets WHERE …)`-Klausel setzen kann.
 */
export function eraSetFilter(eraId: string): { sql: string; params: string[] } | null {
  const series = Object.entries(ERA_SERIES).filter(([, e]) => e === eraId).map(([s]) => s);
  const window = eraWindow(eraId);
  if (!window) return null;
  let sql = `serie_id IN (${series.map(() => "?").join(",")})`;
  const params: string[] = [...series];
  const cross = CROSS_SERIES.filter((s) => !series.includes(s));
  sql += ` OR (serie_id IN (${cross.map(() => "?").join(",")}) AND release_date >= ? AND release_date < ?)`;
  params.push(...cross, window.start, window.end);
  return { sql, params };
}
