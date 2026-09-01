/**
 * Serien-Katalog: die Vorlagen, aus denen Marcel eine Serie anlegt.
 *
 * Der Katalog nennt auch, was **noch nicht** geht (Artist Spotlight, Errate den
 * Preis, Binder-Showcase). Das ist Absicht: eine leere Liste erklärt nichts,
 * eine Vorlage mit dem Hinweis „kommt mit Shot 11" schon.
 */
import * as s from "../../../shared/schemas.js";

const P = (over: Partial<s.SeriesParams>): s.SeriesParams => s.SeriesParams.parse(over);
const C = (days: s.SeriesCadence["days"], hour: number): s.SeriesCadence => ({ days, hour });

export const SERIES_CATALOG: s.SeriesCatalogEntry[] = [
  {
    kind: "top_set", name: "Top-Set", available: true,
    description: "„Die 15 teuersten Karten aus <Set>“ — rotiert durch die Sets, neueste zuerst, kein Set öfter als alle 26 Wochen.",
    defaults: P({ n: 15, formats: ["data_carousel"], platforms: ["instagram", "tiktok", "pinterest", "facebook"] }),
    cadence: C(["mon"], 9), note: "",
  },
  {
    kind: "top_era", name: "Top-Ära", available: true,
    description: "„Die 15 teuersten Karten der Schwert-&-Schild-Ära“ — rotiert durch die Ären. Große Bereiche, deshalb seltener als Sets.",
    defaults: P({ n: 15, formats: ["data_carousel"], platforms: ["instagram", "tiktok"], minWeeksBetweenRepeats: 52 }),
    cadence: C(["thu"], 9), note: "",
  },
  {
    kind: "new_set", name: "Neues Set im Blick", available: true,
    description: "„Diese 10 Karten aus <Set> musst du kennen“ — feuert nur, wenn ein Set jünger als 60 Tage ist.",
    defaults: P({ n: 10, maxAgeDays: 60, formats: ["data_carousel"], platforms: ["instagram", "tiktok"] }),
    cadence: C(["fri"], 9), note: "Läuft leer, solange kein Set frisch genug ist — das ist kein Fehler.",
  },
  {
    kind: "price_movers", name: "Preis-Raketen der Woche", available: true,
    description: "Die größten Preissprünge der letzten 7 Tage, gefiltert auf Karten mit genug Messpunkten.",
    defaults: P({ n: 10, days: 7, direction: "up", minBaseEur: 5, minHistoryPoints: 4, maxChangePct: 200, formats: ["data_carousel"], platforms: ["instagram"] }),
    cadence: C(["sat"], 10),
    note: "Der Preisverlauf der Quelle ist dünn. Karten mit weniger als 4 Messpunkten oder über 200 % Ausschlag fliegen raus — bleiben zu wenige übrig, fällt der Lauf aus.",
  },
  {
    kind: "custom", name: "Fester Bereich", available: true,
    description: "Immer dasselbe Set oder dieselbe Ära — für einen Kanal, der genau eine Nische bedient. Ohne Rotation.",
    defaults: P({ n: 15, formats: ["data_carousel"], platforms: ["instagram"] }),
    cadence: C(["wed"], 9), note: "Set oder Ära in den Parametern eintragen.",
  },
  {
    kind: "artist_spotlight", name: "Artist Spotlight", available: false,
    description: "„10 Karten von <Illustrator>“ — braucht eine Abfrage nach Illustrator im Produktdaten-Provider.",
    defaults: P({ n: 10 }), cadence: C(["tue"], 9), note: "Kommt mit Shot 11.",
  },
  {
    kind: "guess_the_price", name: "Errate den Preis", available: false,
    description: "Slide 1 zeigt die Karte ohne Preis, Slide 2 löst auf — braucht eine zweite Slide-Vorlage.",
    defaults: P({ n: 5 }), cadence: C(["tue"], 17), note: "Kommt mit Shot 11.",
  },
  {
    kind: "binder_showcase", name: "Binder-Showcase", available: false,
    description: "Screenshots aus echten Vorzeige-Bindern — braucht Share-Links und den Recorder.",
    defaults: P({ n: 5 }), cadence: C(["sun"], 11), note: "Kommt mit Shot 11.",
  },
];

export const catalogFor = (kind: s.SeriesKind): s.SeriesCatalogEntry | undefined => SERIES_CATALOG.find((x) => x.kind === kind);
export const isAvailable = (kind: s.SeriesKind): boolean => catalogFor(kind)?.available ?? false;
