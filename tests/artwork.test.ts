/**
 * Kunstseiten: die Auswahl, die Rechte-Regel und das Lesen der Vitrine.
 *
 * Geprüft wird gegen eine Attrappe der Vitrine — kein Netz, kein Binderplan.
 * Die wichtigste Zusicherung ist die dritte: eine fremde Seite darf nie
 * versehentlich in einem Beitrag landen, nur weil sie in der Vitrine steht.
 */
import { describe, expect, it } from "vitest";
import { bildFaecher, echteFaecher, listArtworkPages, type ArtworkPage } from "../src/server/providers/artwork.binderplan.js";
import { pickArtwork, rahmungsVerstoesse } from "../src/server/agents/studio/artwork.js";

/** Antwortet wie `/api/vitrine/artwork` — gekürzt auf die Felder, die zählen. */
function fakeVitrine(artworks: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify({ artworks }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

const roh = (over: Record<string, unknown> = {}) => ({
  id: "a1", titel: "Cozy Bedroom", stil: "karte", layout: "3x3", besitzer: "Valarian", mein: false,
  veroeffentlicht_at: "2026-09-05 10:00:00", breite: 1472, hoehe: 2032, stimmen: 3, downloads: 1,
  karten: [{ id: "sv04-188", name: "Schneppke" }, { id: "me05-089", name: "Voltenso" }],
  blatt: { seiten: [{ spalten: 3, zeilen: 3, faecher: [
    { art: "artwork", id: "a1" }, { art: "artwork", id: "a1" }, { art: "card", id: "sv04-188" },
    { art: "artwork", id: "a1" }, { art: "card", id: "me05-089" }, { art: "artwork", id: "a1" },
    { art: "artwork", id: "a1" }, { art: "artwork", id: "a1" }, { art: "artwork", id: "a1" },
  ] }] },
  ...over,
});

const seite = (over: Partial<ArtworkPage> = {}): ArtworkPage => ({
  id: "a1", titel: "Cozy Bedroom", stil: "karte", layout: "3x3", besitzer: "Valarian", mein: false,
  veroeffentlichtAt: "2026-09-05 10:00:00", breite: 1472, hoehe: 2032, stimmen: 0, downloads: 0,
  karten: [], faecher: [{ art: "card", kartenId: "x" }], spalten: 3, zeilen: 3, ...over,
});

describe("Vitrine lesen", () => {
  it("liest Raster, echte Fächer und Kartennamen aus einer Seite", async () => {
    const pages = await listArtworkPages({ apiBase: "http://test", fetchImpl: fakeVitrine([roh()]) });
    expect(pages).toHaveLength(1);
    const p = pages[0]!;
    expect(p.faecher).toHaveLength(9);
    expect(bildFaecher(p)).toBe(7);
    expect(echteFaecher(p)).toEqual([{ slot: 2, name: "Schneppke" }, { slot: 4, name: "Voltenso" }]);
  });

  it("lässt Seiten ohne lesbares Raster weg", async () => {
    // Ohne `faecher` ist nicht zu sagen, welches Fach Bild und welches Karte ist —
    // und genau darauf beruht das ganze Format.
    const pages = await listArtworkPages({ apiBase: "http://test", fetchImpl: fakeVitrine([roh({ blatt: {} }), roh({ id: "a2" })]) });
    expect(pages.map((p) => p.id)).toEqual(["a2"]);
  });
});

describe("Welche Kunstseite gezeigt wird", () => {
  it("nimmt die neueste passende Seite", () => {
    const alt = seite({ id: "alt", veroeffentlichtAt: "2026-09-01 09:00:00" });
    const neu = seite({ id: "neu", veroeffentlichtAt: "2026-09-07 09:00:00" });
    expect(pickArtwork([alt, neu], { artworkId: "", ownOnly: false, styles: [] }, "").id).toBe("neu");
  });

  /** Die wichtigste Regel: „veröffentlicht" heißt sichtbar in der App, nicht freigegeben für Instagram. */
  it("postet keine fremde Seite, solange nur eigene Seiten erlaubt sind", () => {
    const fremd = seite({ id: "fremd", besitzer: "FAbio Fratello" });
    expect(() => pickArtwork([fremd], { artworkId: "", ownOnly: true, styles: [] }, "Valarian"))
      .toThrowError(/Keine eigene Kunstseite/);
    // Mit passendem Vitrinen-Namen ist dieselbe Liste in Ordnung.
    const eigen = seite({ id: "eigen", besitzer: "Valarian" });
    expect(pickArtwork([fremd, eigen], { artworkId: "", ownOnly: true, styles: [] }, "valarian").id).toBe("eigen");
  });

  it("überspringt Seiten, die zuletzt schon dran waren", () => {
    const a = seite({ id: "a", veroeffentlichtAt: "2026-09-07 09:00:00" });
    const b = seite({ id: "b", veroeffentlichtAt: "2026-09-06 09:00:00" });
    expect(pickArtwork([a, b], { artworkId: "", ownOnly: false, styles: [], exclude: ["a"] }, "").id).toBe("b");
    // Ist alles gesperrt, ist eine Wiederholung besser als ein ausgefallener Slot.
    expect(pickArtwork([a, b], { artworkId: "", ownOnly: false, styles: [], exclude: ["a", "b"] }, "").id).toBe("a");
  });

  it("filtert auf Stile, aber nicht bis zur Leere", () => {
    const karte = seite({ id: "k", stil: "karte" });
    const neon = seite({ id: "n", stil: "neon", veroeffentlichtAt: "2026-09-08 09:00:00" });
    expect(pickArtwork([karte, neon], { artworkId: "", ownOnly: false, styles: ["karte"] }, "").id).toBe("k");
    // Kein Treffer: lieber die neueste als gar keine.
    expect(pickArtwork([karte, neon], { artworkId: "", ownOnly: false, styles: ["pixel"] }, "").id).toBe("n");
  });

  it("meldet eine benannte Seite als fehlend, statt still eine andere zu nehmen", () => {
    expect(() => pickArtwork([seite()], { artworkId: "weg", ownOnly: false, styles: [] }, ""))
      .toThrowError(/steht nicht \(mehr\) in der Vitrine/);
  });
});

describe("Rahmung des Textes", () => {
  /**
   * Der Prompt verbietet diese Wendungen bereits — von zehn Bündeln, die
   * danach entstanden, trugen neun sie trotzdem. Deshalb wird gemessen.
   */
  it("findet die Wendungen, die die Aussage umdrehen", () => {
    expect(rahmungsVerstoesse("Statt die Seite halb leer zu lassen, füllt das die Lücke."))
      .toEqual(expect.arrayContaining(["halb leer", "lücke"]));
    expect(rahmungsVerstoesse("Die Karten waren zu teuer, also kam ein Platzhalter rein."))
      .toEqual(expect.arrayContaining(["zu teuer", "platzhalter"]));
    // Auch die Verneinung zählt: wer „kein Platzhalter" schreibt, ruft das Bild auf.
    expect(rahmungsVerstoesse("Das ist kein Platzhalter.")).toContain("platzhalter");
  });

  it("lässt die richtige Erzählung durch", () => {
    expect(rahmungsVerstoesse(
      "Kyogre und Groudon stehen echt drin. Die sieben Fächer dazwischen führen ihre Kunst weiter.",
      "Wo hört die Karte auf?",
    )).toEqual([]);
  });

  it("prüft Bildtexte mit, nicht nur die Bildunterschrift", () => {
    // Deckseite und Abschluss stehen im Bild und werden genauso geprüft.
    expect(rahmungsVerstoesse("Alles gut", "6 dieser 9 Fächer gab es nie als Karte")).toContain("gab es nie");
  });
});
