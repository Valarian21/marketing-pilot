/**
 * Geometrie einer Binderseite — die eine Quelle für alle Darstellungen.
 *
 * Eine 3×3-Seite ist bei Binderplan in Millimetern gerechnet: Karte 63 × 88,
 * Hüllennaht 4 → 197 × 272 mm. Ein Fach ist also **63 von 67 mm** breit, nicht
 * ein Drittel der Seite. Wer stumpf drittelt, nimmt in jedes Fach eine halbe
 * Naht mit; die Karte sitzt dann zu klein im Feld und ist um 1,2 % gestaucht
 * (am 11.09.2026 nachgemessen: 0,7244 statt 0,7159).
 *
 * Benutzt von `scripts/reel-binder.ts` (Reel) und `scripts/bildpost-seite.ts`
 * (Einzelbild). Beide sollen dieselbe Seite zeigen, deshalb steht die Rechnung
 * hier und nicht zweimal.
 */
export const KARTE_MM = 63, HOEHE_MM = 88, NAHT_MM = 4;

export interface BlattMasse {
  /** Breite eines Fachs in px. */
  fachB: number;
  /** Breite der Naht zwischen zwei Fächern in px. */
  fuge: number;
  /** Höhe eines Fachs in px. */
  fachH: number;
  /** Gesamthöhe des Blatts in px. */
  hoehe: number;
}

/**
 * Maße eines Blatts bei gegebener Bildbreite.
 *
 * `spalten`/`zeilen` sind die Raster des Produkts (`binder.py`: 2×2 bis 5×5).
 * Die Kunstseiten sind immer 3×3; die Kartenraster können abweichen.
 */
export function blattMasse(breite: number, spalten = 3, zeilen = 3): BlattMasse {
  const breiteMM = spalten * KARTE_MM + (spalten - 1) * NAHT_MM;
  const fachB = breite * KARTE_MM / breiteMM;
  const fuge = breite * NAHT_MM / breiteMM;
  const fachH = fachB * HOEHE_MM / KARTE_MM;
  return { fachB, fuge, fachH, hoehe: zeilen * fachH + (zeilen - 1) * fuge };
}
