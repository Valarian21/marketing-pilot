/**
 * Geschäftszahlen des beworbenen Produkts: Konten, zahlende Kunden, Umsatz.
 *
 * Ohne sie ist die Übersicht eine Reichweitenanzeige. Die Frage, auf die es
 * hinausläuft, lautet nicht „wie viele Aufrufe hatte das Reel", sondern „hat
 * die Woche Konten und Kunden gebracht" — und die beantwortet nur das Produkt.
 *
 * Quelle ist derselbe stündliche Schnappschuss, aus dem schon die Kartendaten
 * kommen (`product-data.binderplan.ts`): eine root-eigene Kopie von Binderplans
 * `app.db`, `readonly` geöffnet. Kein zweiter Zugang, kein Admin-Schlüssel,
 * kein Netzweg — und deshalb auch nichts, was kaputtgehen kann, wenn Binderplan
 * gerade neu startet. Der Preis dafür: die Zahlen sind bis zu eine Stunde alt,
 * was `stand` mitteilt.
 *
 * Bewusst **nicht** von hier: Stripe. Die Auszahlungen stehen in Binderplans
 * eigener Betreiber-Übersicht (`/api/admin/uebersicht`, im Empire-Dashboard
 * unter „Binderplan"), brauchen einen Admin-Schlüssel und sagen über die
 * Wirkung des Marketings nichts, was `bestellungen` nicht auch sagt.
 */
import fs from "node:fs";
import Database from "better-sqlite3";

/** Ein Tag in der Zeitreihe. Alle Zahlen sind Tageswerte, keine Bestände — außer `konten`/`zahlende`. */
export interface GeschaeftsTag {
  tag: string;
  /** Neue Konten an diesem Tag. */
  neueKonten: number;
  /** Konten insgesamt am Ende des Tages. */
  konten: number;
  /** Bezahlte Bestellungen an diesem Tag (Abo-Abschlüsse und Kreditpakete). */
  kaeufe: number;
  /** Umsatz des Tages in Euro (brutto, ohne Stripe-Gebühr). */
  umsatz: number;
}

export interface GeschaeftsZahlen {
  /** Wann der Schnappschuss entstanden ist — die Zahlen sind so alt wie er. */
  stand: string | null;
  konten: number;
  /** Konten mit laufendem Abo. Der Betreiber selbst (`lifetime`) zählt nicht mit. */
  zahlende: number;
  /** Monatlich wiederkehrender Umsatz aus laufenden Abos, in Euro. */
  mrr: number;
  umsatzGesamt: number;
  /** Konten je Tarif, absteigend. */
  tarife: { tarif: string; anzahl: number }[];
  verlauf: GeschaeftsTag[];
}

/** Tarife, die Geld bringen. `lifetime` ist der Betreiberzugang, kein Kunde. */
const ZAHLTARIFE = new Set(["plus", "pro"]);
/** Monatspreise in Euro, aus Binderplans Bestellungen abgeleitet — nur Rückfall, wenn keine Bestellung vorliegt. */
const PREIS: Record<string, number> = { plus: 3.99, pro: 7.99 };

const tagVon = (s: string | null | undefined): string => (s ?? "").slice(0, 10);

/**
 * Zahlen für einen Zeitraum lesen.
 *
 * `seitTag`/`bisTag` sind Kalendertage (YYYY-MM-DD) in Binderplans eigener
 * Zeitrechnung — dessen `created_at` ist naives UTC, und ein Tagesversatz von
 * bis zu zwei Stunden gegenüber Berlin ist hier belanglos: es geht um Verläufe
 * über Wochen, nicht um die Frage, ob eine Anmeldung um 01:30 zum Vortag zählt.
 */
export function geschaeftsZahlen(dbPath: string, seitTag: string, bisTag: string): GeschaeftsZahlen | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const stand = fs.statSync(dbPath).mtime.toISOString();
    const nutzer = db.prepare("SELECT plan, abo_status, created_at FROM users").all() as { plan: string | null; abo_status: string | null; created_at: string | null }[];
    const bestellungen = db.prepare("SELECT art, variante, betrag, status, created_at FROM bestellungen WHERE status = 'bezahlt'").all() as
      { art: string | null; variante: string | null; betrag: number | null; status: string; created_at: string | null }[];

    const zahlendeKonten = nutzer.filter((u) => ZAHLTARIFE.has(u.plan ?? "") && (u.abo_status ?? "active") !== "canceled");
    // MRR aus dem, was zuletzt tatsächlich gezahlt wurde; nur wenn es zu einem
    // Tarif gar keine Bestellung gibt, greift die Preistabelle.
    const letzterPreis = new Map<string, number>();
    for (const b of bestellungen) if (b.art && b.betrag) letzterPreis.set(b.art, b.betrag);
    const mrr = zahlendeKonten.reduce((s, u) => s + (letzterPreis.get(u.plan ?? "") ?? PREIS[u.plan ?? ""] ?? 0), 0);

    const tarife = [...nutzer.reduce((m, u) => m.set(u.plan ?? "free", (m.get(u.plan ?? "free") ?? 0) + 1), new Map<string, number>())]
      .map(([tarif, anzahl]) => ({ tarif, anzahl })).sort((a, b) => b.anzahl - a.anzahl);

    // Verlauf: für jeden Tag des Zeitraums die Zugänge, dazu der mitlaufende Bestand.
    const neuJeTag = new Map<string, number>();
    for (const u of nutzer) { const t = tagVon(u.created_at); if (t) neuJeTag.set(t, (neuJeTag.get(t) ?? 0) + 1); }
    const kaufJeTag = new Map<string, { n: number; summe: number }>();
    for (const b of bestellungen) {
      const t = tagVon(b.created_at); if (!t) continue;
      const cur = kaufJeTag.get(t) ?? { n: 0, summe: 0 };
      kaufJeTag.set(t, { n: cur.n + 1, summe: cur.summe + (b.betrag ?? 0) });
    }
    // Bestand zu Beginn des Zeitraums: alles, was davor angelegt wurde.
    let bestand = nutzer.filter((u) => tagVon(u.created_at) && tagVon(u.created_at) < seitTag).length;
    const verlauf: GeschaeftsTag[] = [];
    for (const tag of tageZwischen(seitTag, bisTag)) {
      const neu = neuJeTag.get(tag) ?? 0;
      bestand += neu;
      const kauf = kaufJeTag.get(tag) ?? { n: 0, summe: 0 };
      verlauf.push({ tag, neueKonten: neu, konten: bestand, kaeufe: kauf.n, umsatz: Math.round(kauf.summe * 100) / 100 });
    }

    return {
      stand,
      konten: nutzer.length,
      zahlende: zahlendeKonten.length,
      mrr: Math.round(mrr * 100) / 100,
      umsatzGesamt: Math.round(bestellungen.reduce((s, b) => s + (b.betrag ?? 0), 0) * 100) / 100,
      tarife, verlauf,
    };
  } finally {
    db.close();
  }
}

/** Alle Kalendertage von `von` bis `bis` einschließlich. */
export function tageZwischen(von: string, bis: string): string[] {
  const out: string[] = [];
  for (let d = Date.parse(`${von}T00:00:00Z`); d <= Date.parse(`${bis}T00:00:00Z`); d += 86_400_000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}
