/**
 * Seltenheiten: welche in einen Beitrag dürfen und welche nicht.
 *
 * Läuft gegen den echten Binderplan-Schnappschuss — die Regel ist eine Aussage
 * über die Daten, und gegen eine Attrappe wäre sie wertlos. Fehlt der
 * Schnappschuss, überspringt die Datei sich selbst.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { herkunftsZeile } from "../src/server/agents/studio/artwork.js";
import { BinderplanProvider, BINDERPLAN_DEFAULTS } from "../src/server/providers/product-data.binderplan.js";
import { openDatabase } from "../src/server/db/index.js";

const SNAPSHOT = path.resolve(__dirname, "..", "data", "cache", "binderplan.db");
const da = fs.existsSync(SNAPSHOT);

describe.skipIf(!da)("Seltenheit einer Karte", () => {
  const { db, sqlite } = openDatabase(path.resolve(__dirname, "..", "data"));
  const p = new BinderplanProvider(db, {
    dbPath: SNAPSHOT, imageDir: path.join(__dirname, "__tmp-bilder"), apiBase: "http://127.0.0.1:0",
    tcgdexBase: "https://api.tcgdex.net/v2", ...BINDERPLAN_DEFAULTS,
  });

  /**
   * Der Auslöser: die Kyogre-Karte druckt „AR", die Quelle meldet „Mega Hyper
   * Rare" — dasselbe Etikett wie alle 37 Sonderkarten des Sets.
   */
  it("verschweigt ein Sammel-Etikett, statt der Karte zu widersprechen", () => {
    const f = p.cardFacts("M6-080", "de")!;
    expect(f.name).toBe("Kyogre");
    expect(f.rarity).toBe("");
    expect(herkunftsZeile(f, "de")).not.toMatch(/Rare/);
  });

  it("gilt auch für internationale Sets mit demselben Fehler", () => {
    // Evolving Skies: 34 Sonderkarten, ein einziges Etikett.
    expect(p.cardFacts("swsh7-215", "de")!.rarity).toBe("");
  });

  it("behält echte Seltenheiten — auch bei japanischen Karten", () => {
    expect(p.cardFacts("sv04-199", "de")!.rarity).toBe("Illustration Rare");
    expect(p.cardFacts("sv04-001", "de")!.rarity).toBe("Common");
    const jp = p.cardFacts("SM1M-067", "de")!;
    expect(jp.region).toBe("jp");
    expect(jp.rarity).toBe("Hyper Rare");
  });

  /** Dieselbe Seltenheit, japanischer Name — danach suchen JP-Sammler. */
  it("hängt japanischen Karten ihr Kürzel an", () => {
    expect(herkunftsZeile(p.cardFacts("SM1M-067", "de")!, "de")).toContain("Hyper Rare (UR)");
    expect(herkunftsZeile(p.cardFacts("SM1M-006", "de")!, "de")).toContain("Double Rare (RR)");
    // Internationale Karten bekommen kein Kürzel.
    expect(herkunftsZeile(p.cardFacts("sv04-199", "de")!, "de")).not.toContain("(AR)");
  });

  it("nennt die gedruckte Nummer, nicht die tatsächliche Setgröße", () => {
    // Auf der Karte steht „080/076", die Quelle kennt 113 Karten.
    expect(herkunftsZeile(p.cardFacts("M6-080", "de")!, "de")).toContain("080/076");
  });

  it("räumt auf", () => { p.close(); sqlite.close(); expect(true).toBe(true); });
});

