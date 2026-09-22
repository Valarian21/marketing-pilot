/**
 * Besucherzählung und Herkunft: die Zuordnung der Quellen und die Quote.
 *
 * Der Test legt eine kleine Datenbank im Speicher der Testdatei an, weil das
 * Verhalten an den echten Spaltennamen von Binderplans `besuche_tag` hängt —
 * ein Test gegen ein nachgebautes Objekt hätte den Tippfehler nicht gefunden,
 * der die Zählung im September stillschweigend leer ließ.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { besucherZahlen, kanalVon } from "../src/server/providers/besucher.binderplan.js";

const temp: string[] = [];
afterEach(() => { for (const f of temp.splice(0)) fs.rmSync(f, { force: true }); });

function baueDb(besuche: [string, string, string, string, number][], nutzer: [string | null, string, string][]): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mp-besuch-")), "app.db");
  temp.push(p);
  const db = new Database(p);
  db.exec(`CREATE TABLE besuche_tag (tag TEXT, quelle TEXT, medium TEXT, kampagne TEXT DEFAULT '', inhalt TEXT DEFAULT '', seite TEXT, anzahl INTEGER);
           CREATE TABLE users (herkunft TEXT, plan TEXT, abo_status TEXT, created_at TEXT);`);
  const bi = db.prepare("INSERT INTO besuche_tag (tag, quelle, medium, seite, anzahl) VALUES (?,?,?,?,?)");
  for (const z of besuche) bi.run(...z);
  const ui = db.prepare("INSERT INTO users (herkunft, plan, created_at) VALUES (?,?,?)");
  for (const u of nutzer) ui.run(...u);
  db.close();
  return p;
}

describe("Herkunft einer Quelle", () => {
  it("führt Kurzlink und UTM-Link desselben Kanals in einer Zeile", () => {
    // `instagram/bio` kommt aus der Profilbeschreibung, `ig/social` aus einem
    // Beitrag. Getrennt geführt sähe Instagram halb so stark aus.
    expect(kanalVon("instagram", "bio").id).toBe("instagram");
    expect(kanalVon("ig", "social").id).toBe("instagram");
    expect(kanalVon("tt", "bio").id).toBe("tiktok");
  });

  it("erkennt Suche, KI-Chat und Direktbesuch", () => {
    expect(kanalVon("referrer", "www.google.com").art).toBe("suche");
    expect(kanalVon("chatgpt.com", "").art).toBe("ki");
    expect(kanalVon("referrer", "chatgpt.com").art).toBe("ki");
    expect(kanalVon("(direkt)", "").art).toBe("direkt");
  });

  it("zählt die eigene Zweitdomain als Direktbesuch, nicht als fremden Verweis", () => {
    // binderplan.de leitet auf binderplan.app um: wer die Adresse aus einem Video
    // abtippt, erzeugt einen Verweis von der eigenen Domain. Als „andere Seite"
    // geführt sähe das wie ein Partner aus, der Besucher schickt.
    expect(kanalVon("referrer", "binderplan.de").id).toBe("direkt");
    expect(kanalVon("referrer", "www.binderplan.de").id).toBe("direkt");
    expect(kanalVon("referrer", "pokemon-fanseite.de").art).toBe("verweis");
  });
});

describe("besucherZahlen", () => {
  it("summiert Besuche je Kanal und rechnet die Quote bis zum Konto", () => {
    const p = baueDb(
      [
        ["2026-09-20", "instagram", "bio", "landing", 60],
        ["2026-09-20", "ig", "social", "app", 40],
        ["2026-09-21", "referrer", "www.google.com", "landing", 10],
        ["2026-09-21", "(direkt)", "", "landing", 5],
      ],
      [
        ["instagram/bio", "plus", "2026-09-20 10:00:00"],
        ["instagram/bio", "free", "2026-09-21 11:00:00"],
        [null, "free", "2026-09-21 12:00:00"],
      ],
    );
    const z = besucherZahlen(p, "2026-09-20", "2026-09-21")!;
    expect(z.besuche).toBe(115);
    expect(z.kontenGesamt).toBe(3);
    expect(z.kontenMitHerkunft).toBe(2);

    const ig = z.herkunft.find((h) => h.id === "instagram")!;
    expect(ig.besuche).toBe(100);      // beide Schreibweisen zusammen
    expect(ig.konten).toBe(2);
    expect(ig.zahlende).toBe(1);
    expect(ig.quote).toBeCloseTo(0.02);
    // Kanäle stehen nach Besuchen sortiert, der stärkste oben.
    expect(z.herkunft[0]!.id).toBe("instagram");
  });

  it("lässt Tage vor der ersten Messung unbekannt statt null", () => {
    const p = baueDb([["2026-09-21", "(direkt)", "", "landing", 3]], []);
    const z = besucherZahlen(p, "2026-09-19", "2026-09-21")!;
    expect(z.ersterTag).toBe("2026-09-21");
    expect(z.verlauf.map((v) => v.besuche)).toEqual([null, null, 3]);
  });

  it("gibt null zurück, wenn die Tabelle fehlt — ein alter Schnappschuss ist kein Fehler", () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mp-besuch-")), "alt.db");
    temp.push(p);
    const db = new Database(p);
    db.exec("CREATE TABLE users (herkunft TEXT, plan TEXT, abo_status TEXT, created_at TEXT)");
    db.close();
    expect(besucherZahlen(p, "2026-09-01", "2026-09-21")).toBeNull();
  });

  it("zählt ein Konto ohne Besuche seines Kanals, bildet aber keine Quote daraus", () => {
    // Wer heute ein Konto anlegt, kann letzte Woche auf der Seite gewesen sein.
    // Eine Quote von 2/0 wäre unendlich — sie fehlt lieber.
    const p = baueDb([["2026-09-21", "(direkt)", "", "landing", 8]], [["tiktok/bio", "free", "2026-09-21 09:00:00"]]);
    const z = besucherZahlen(p, "2026-09-21", "2026-09-21")!;
    const tt = z.herkunft.find((h) => h.id === "tiktok")!;
    expect(tt.konten).toBe(1);
    expect(tt.besuche).toBe(0);
    expect(tt.quote).toBeNull();
  });
});

describe("Grenzfälle, die eine Zahl vortäuschen würden", () => {
  it("führt den Rücksprung von der Bezahlseite nicht als Besuch", () => {
    // Stripe schickt den Kunden nach der Zahlung zurück. Als Verweis gezählt
    // wäre jede Bestellung ein zusätzlicher „Besucher" — und ausgerechnet die
    // Kasse stünde als bester Kanal in der Liste.
    const p = baueDb(
      [["2026-09-21", "(direkt)", "", "landing", 10], ["2026-09-21", "referrer", "checkout.stripe.com", "app", 3]],
      [],
    );
    const z = besucherZahlen(p, "2026-09-21", "2026-09-21")!;
    expect(z.besuche).toBe(10);
    expect(z.herkunft.some((h) => h.id === "ruecksprung")).toBe(false);
  });

  it("lässt die Quote offen, solange kein Konto eine Herkunft trägt", () => {
    // 0 von 74 sähe aus wie „gemessen, niemand meldet sich an". Tatsächlich
    // wurde die Quelle gar nicht erfasst — das ist keine Null, sondern nichts.
    const p = baueDb([["2026-09-21", "instagram", "bio", "landing", 74]], [[null, "free", "2026-09-21 10:00:00"]]);
    const z = besucherZahlen(p, "2026-09-21", "2026-09-21")!;
    expect(z.kontenGesamt).toBe(1);
    expect(z.kontenMitHerkunft).toBe(0);
    expect(z.quote).toBeNull();
    expect(z.herkunft.find((h) => h.id === "instagram")!.quote).toBeNull();
  });
});
