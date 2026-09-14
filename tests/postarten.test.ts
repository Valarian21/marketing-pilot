/**
 * Post-Arten: die Zuordnung aus dem Playbook (Abschnitt 3a/4) muss im Code
 * dasselbe sagen wie die Tabelle — sonst zeigt der Kalender die falsche Sorte.
 */
import { describe, expect, it } from "vitest";
import { DREHBUCH_ART, POST_ARTEN, WOCHENRHYTHMUS, postArtOf, wochentagOf } from "../src/shared/postarten.js";

describe("Post-Arten", () => {
  it("ordnet Drehbücher wie die Playbook-Tabelle zu", () => {
    expect(postArtOf({ format: "artwork_reel", meta: { drehbuch: "slab" } })).toBe("A");
    expect(postArtOf({ format: "artwork_reel", meta: { drehbuch: "preise" } })).toBe("B");
    expect(postArtOf({ format: "artwork_reel", meta: { drehbuch: "aera" } })).toBe("C");
    expect(postArtOf({ format: "artwork_reel", meta: { drehbuch: "vintagemodern" } })).toBe("D");
    expect(postArtOf({ format: "artwork_reel", meta: { drehbuch: "neunfaecher" } })).toBe("F");
    expect(postArtOf({ format: "artwork_reel", meta: { drehbuch: "farbblau" } })).toBe("G");
    // Die Vorschläge („—" in der Tabelle) laufen sichtbar als Versuch, nicht als A.
    expect(postArtOf({ format: "artwork_reel", meta: { drehbuch: "duell" } })).toBe("X");
  });
  it("leitet ohne Drehbuch aus Format und Datenabfrage ab", () => {
    expect(postArtOf({ format: "artwork_carousel", meta: {} })).toBe("A");
    expect(postArtOf({ format: "data_carousel", meta: { dataQuery: { kind: "top", set: "sv3pt5" } } })).toBe("B");
    expect(postArtOf({ format: "data_reel", meta: { dataQuery: { kind: "top", era: "wotc" } } })).toBe("C");
    expect(postArtOf({ format: "data_carousel", meta: { dataQuery: { kind: "movers" } } })).toBe("E");
    expect(postArtOf({ format: "story", meta: {} })).toBe("S");
    expect(postArtOf({ format: "text", meta: { platform: "threads" } })).toBe("T");
    expect(postArtOf({ format: "carousel", meta: {} })).toBe("X");
  });
  it("kennt jede Sorte, die ein Drehbuch oder der Rhythmus nennt", () => {
    for (const a of Object.values(DREHBUCH_ART)) expect(POST_ARTEN[a]).toBeDefined();
    for (const tag of Object.values(WOCHENRHYTHMUS)) for (const a of [...tag.pflicht, ...tag.dazu]) expect(POST_ARTEN[a]).toBeDefined();
    // Jeder Tag hat die Binderseite als Pflicht — das ist der Kern des Playbooks.
    for (const tag of Object.values(WOCHENRHYTHMUS)) expect(tag.pflicht).toContain("A");
  });
  it("bestimmt den Wochentag ohne Zeitzonen-Sprung", () => {
    expect(wochentagOf("2026-09-14")).toBe("mon");
    expect(wochentagOf("2026-09-20")).toBe("sun");
  });
});
