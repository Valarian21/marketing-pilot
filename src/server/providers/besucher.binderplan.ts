/**
 * Besucher der Webseite, ihre Herkunft und die Quote bis zur Anmeldung.
 *
 * Bis zum 22.09.2026 endete die Übersicht bei den Klicks auf die Kurzlinks des
 * Piloten — was danach geschah, stand nur im Produkt. Diese Datei schließt die
 * Lücke: sie liest Binderplans eigene Besuchszählung (`besuche_tag`) und die
 * Herkunft der Konten (`users.herkunft`) aus demselben stündlichen
 * Schnappschuss, aus dem schon die Geschäftszahlen kommen.
 *
 * **Was hier gezählt wird — und was nicht.** `besuche_tag` ist eine reine
 * Aggregation je Tag und Kanal: keine IP, keine Kennung, kein Cookie (das ist
 * der Grund, warum Binderplan ohne Cookie-Banner auskommt). Daraus folgt:
 *
 * - Es sind **Seitenaufrufe**, keine eindeutigen Besucher. Wer morgens und
 *   abends kommt, steht zweimal drin. Eine Entzerrung wäre ohne Wiedererkennung
 *   nicht möglich — und die gäbe es nur mit Einwilligung.
 * - Folgeseiten desselben Besuchs zählen nicht mit (Verweis von binderplan.app
 *   selbst wird verworfen), grobe Bots ebenso wenig.
 * - Die Quote „Besuch → Konto" ist deshalb eine **Größenordnung**, keine
 *   Kohorte: der Zähler kommt aus `users.herkunft`, der Nenner aus den
 *   Seitenaufrufen desselben Kanals im selben Zeitraum. Ein Konto, das drei
 *   Tage nach dem Besuch entsteht, zählt beim Kanal — aber sein Besuch liegt
 *   vielleicht vor dem Zeitraum.
 *
 * Wo eine Zahl fehlt, steht `null`, nicht 0. Die Übersicht zeigt dafür einen
 * Strich: „nicht gemessen" und „niemand" sind zwei verschiedene Aussagen.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { tageZwischen } from "./geschaeft.binderplan.js";

/** Grobe Einordnung einer Quelle — sie bestimmt Reihenfolge und Farbe im UI. */
export type HerkunftArt = "social" | "suche" | "ki" | "direkt" | "verweis";

export interface HerkunftZeile {
  /** Stabiler Schlüssel, z. B. `instagram` oder `referrer:www.google.com`. */
  id: string;
  label: string;
  art: HerkunftArt;
  /** Plattform-Kennung des Piloten, wenn es eine gibt — für Farbe und Verknüpfung. */
  platform: string | null;
  /** Seitenaufrufe im Zeitraum. */
  besuche: number;
  /** Konten, die diesen Kanal als Herkunft tragen (Anlagedatum im Zeitraum). */
  konten: number;
  /** Davon zahlend (Abo oder bezahlte Bestellung). */
  zahlende: number;
  /** konten / besuche, oder `null`, wenn es keine Besuche gab. */
  quote: number | null;
}

export interface BesucherZahlen {
  /** Wann der Schnappschuss entstand. */
  stand: string | null;
  /** Ab wann überhaupt gezählt wurde — davor ist die Zahl nicht „0", sondern unbekannt. */
  ersterTag: string | null;
  /** Seit wann Direktbesuche mitgezählt werden; davor fehlt ein Teil des Nenners. */
  direktSeit: string | null;
  besuche: number;
  /** Konten mit bekannter Herkunft, im Zeitraum angelegt. */
  kontenMitHerkunft: number;
  /** Im Zeitraum angelegte Konten insgesamt — auch ohne Herkunft. */
  kontenGesamt: number;
  /** Quote über alle Kanäle: Konten mit Herkunft / Besuche. */
  quote: number | null;
  herkunft: HerkunftZeile[];
  verlauf: { tag: string; besuche: number | null }[];
}

/**
 * Ab diesem Tag zählt Binderplan auch Besuche ohne erkennbare Quelle als
 * `(direkt)`. Vorher fehlten sie ganz, die Gesamtzahl war also zu klein und
 * jede Quote zu hoch. Die Übersicht sagt das dazu, statt es zu verschweigen.
 */
export const DIREKT_SEIT = "2026-09-22";

/** Die Kurzlink-Kürzel aus Binderplans Bio-Links und ihre ausgeschriebene Form. */
const KANAL: Record<string, { label: string; platform: string }> = {
  ig: { label: "Instagram", platform: "instagram" },
  instagram: { label: "Instagram", platform: "instagram" },
  tt: { label: "TikTok", platform: "tiktok" },
  tiktok: { label: "TikTok", platform: "tiktok" },
  yt: { label: "YouTube", platform: "youtube" },
  youtube: { label: "YouTube", platform: "youtube" },
  th: { label: "Threads", platform: "threads" },
  threads: { label: "Threads", platform: "threads" },
  fb: { label: "Facebook", platform: "facebook" },
  facebook: { label: "Facebook", platform: "facebook" },
  pin: { label: "Pinterest", platform: "pinterest" },
  pinterest: { label: "Pinterest", platform: "pinterest" },
  rd: { label: "Reddit", platform: "reddit" },
  reddit: { label: "Reddit", platform: "reddit" },
  dc: { label: "Discord", platform: "discord" },
  discord: { label: "Discord", platform: "discord" },
};

/** Verweis-Hosts, die keine Fremdseite sind, sondern ein anderer Weg zu uns. */
const EIGENE_HOSTS = /^(www\.)?binderplan\.(de|app)(:\d+)?$/i;
/**
 * Rücksprünge aus einem Vorgang, der auf unserer Seite begann: Stripe schickt
 * den Kunden nach der Zahlung zurück, PayPal ebenso. Das ist die Mitte eines
 * Besuchs, kein neuer — als „andere Seite" geführt sähe die Kasse aus wie ein
 * Kanal, der uns Besucher bringt.
 */
const RUECKSPRUNG = /^(checkout\.stripe\.com|.*\.paypal\.com|paypal\.com|pay\.google\.com|appleid\.apple\.com)$/i;
const SUCHE = /^(www\.)?(google|bing|duckduckgo|ecosia|yahoo|startpage|qwant|brave)\./i;
const KI = /(chatgpt\.com|chat\.openai|perplexity|claude\.ai|copilot\.microsoft|gemini\.google)/i;

/**
 * Eine Zeile aus `besuche_tag` auf einen Kanal abbilden.
 *
 * Die Tabelle kennt zwei Schreibweisen desselben Kanals: `instagram/bio` kommt
 * vom Kurzlink in der Profilbeschreibung, `ig/social` von einem UTM-Link in
 * einem Beitrag. Beides ist Instagram und gehört in dieselbe Zeile — getrennt
 * geführt sähe jeder Kanal halb so stark aus, wie er ist.
 */
export function kanalVon(quelle: string, medium: string): { id: string; label: string; art: HerkunftArt; platform: string | null } {
  const q = (quelle || "").toLowerCase().trim();
  const m = (medium || "").toLowerCase().trim();

  if (q === "(direkt)") return { id: "direkt", label: "Direkt (Adresse, Lesezeichen, App)", art: "direkt", platform: null };

  const k = KANAL[q];
  if (k) return { id: k.platform, label: k.label, art: "social", platform: k.platform };

  if (q === "referrer") {
    if (EIGENE_HOSTS.test(m)) return { id: "direkt", label: "Direkt (Adresse, Lesezeichen, App)", art: "direkt", platform: null };
    if (RUECKSPRUNG.test(m)) return { id: "ruecksprung", label: "Rücksprung von der Zahlung", art: "direkt", platform: null };
    const kk = Object.values(KANAL).find((x) => m.includes(x.platform) || m.includes(x.label.toLowerCase()));
    if (kk) return { id: kk.platform, label: kk.label, art: "social", platform: kk.platform };
    if (SUCHE.test(m)) return { id: `suche:${m}`, label: `Suche: ${m.replace(/^www\./, "")}`, art: "suche", platform: null };
    if (KI.test(m)) return { id: `ki:${m}`, label: `KI-Chat: ${m.replace(/^www\./, "")}`, art: "ki", platform: null };
    return { id: `referrer:${m}`, label: m || "unbekannter Verweis", art: "verweis", platform: null };
  }

  if (KI.test(q)) return { id: `ki:${q}`, label: `KI-Chat: ${q.replace(/^www\./, "")}`, art: "ki", platform: null };
  if (SUCHE.test(q)) return { id: `suche:${q}`, label: `Suche: ${q.replace(/^www\./, "")}`, art: "suche", platform: null };
  return { id: `sonst:${q}`, label: q || "ohne Angabe", art: "verweis", platform: null };
}

/** Wie viele der Konten überhaupt eine Herkunft tragen — entscheidet, ob es eine Quote gibt. */
function kontenMitHerkunftZaehlen(nutzer: { herkunft: string | null }[]): number {
  return nutzer.filter((u) => (u.herkunft ?? "").trim()).length;
}

/** Die Herkunft eines Kontos steht als `quelle/medium/kampagne/inhalt` am Datensatz. */
function kanalVonHerkunft(herkunft: string): { id: string; label: string; art: HerkunftArt; platform: string | null } {
  const [quelle = "", medium = ""] = (herkunft || "").split("/");
  return kanalVon(quelle, medium);
}

export function besucherZahlen(dbPath: string, seitTag: string, bisTag: string): BesucherZahlen | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // Ältere Schnappschüsse haben die Tabelle noch nicht — dann gibt es keine
    // Besucherzahlen, und das ist eine Aussage, kein Fehler.
    const hat = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='besuche_tag'").get();
    if (!hat) return null;

    const stand = fs.statSync(dbPath).mtime.toISOString();
    const ersterTag = (db.prepare("SELECT MIN(tag) AS t FROM besuche_tag").get() as { t: string | null }).t;

    const zeilen = db.prepare(
      "SELECT tag, quelle, medium, SUM(anzahl) AS n FROM besuche_tag WHERE tag >= ? AND tag <= ? GROUP BY tag, quelle, medium",
    ).all(seitTag, bisTag) as { tag: string; quelle: string; medium: string; n: number }[];

    const nutzer = db.prepare(
      "SELECT herkunft, plan, abo_status, created_at FROM users WHERE substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ?",
    ).all(seitTag, bisTag) as { herkunft: string | null; plan: string | null; abo_status: string | null; created_at: string | null }[];

    const proKanal = new Map<string, HerkunftZeile>();
    const hole = (k: ReturnType<typeof kanalVon>): HerkunftZeile => {
      const da = proKanal.get(k.id);
      if (da) return da;
      const neu: HerkunftZeile = { id: k.id, label: k.label, art: k.art, platform: k.platform, besuche: 0, konten: 0, zahlende: 0, quote: null };
      proKanal.set(k.id, neu);
      return neu;
    };

    const jeTag = new Map<string, number>();
    for (const z of zeilen) {
      const k = kanalVon(z.quelle, z.medium);
      if (k.id === "ruecksprung") continue;   // kein Besuch, sondern die Mitte eines Besuchs
      hole(k).besuche += z.n;
      jeTag.set(z.tag, (jeTag.get(z.tag) ?? 0) + z.n);
    }

    let kontenMitHerkunft = 0;
    for (const u of nutzer) {
      const h = (u.herkunft ?? "").trim();
      if (!h) continue;
      kontenMitHerkunft += 1;
      const zeile = hole(kanalVonHerkunft(h));
      zeile.konten += 1;
      if ((u.plan === "plus" || u.plan === "pro") && (u.abo_status ?? "active") !== "canceled") zeile.zahlende += 1;
    }

    // Trägt kein einziges Konto eine Herkunft, ist die Quote **unbekannt** und nicht
    // null: 0/74 sähe aus wie „gemessen, niemand meldet sich an", tatsächlich wurde
    // die Quelle gar nicht erfasst. Der Unterschied ist der ganze Punkt der Seite.
    const gemessen = kontenMitHerkunftZaehlen(nutzer) > 0;
    const herkunft = [...proKanal.values()]
      .map((z) => ({ ...z, quote: gemessen && z.besuche > 0 ? z.konten / z.besuche : null }))
      .sort((a, b) => b.besuche - a.besuche || b.konten - a.konten);

    const besuche = herkunft.reduce((s, z) => s + z.besuche, 0);
    // Vor dem ersten Zähltag gibt es keine Null, sondern keine Messung.
    const verlauf = tageZwischen(seitTag, bisTag).map((tag) => ({
      tag,
      besuche: ersterTag && tag >= ersterTag ? (jeTag.get(tag) ?? 0) : null,
    }));

    return {
      stand, ersterTag, direktSeit: DIREKT_SEIT,
      besuche,
      kontenMitHerkunft,
      kontenGesamt: nutzer.length,
      quote: gemessen && besuche > 0 ? kontenMitHerkunft / besuche : null,
      herkunft, verlauf,
    };
  } finally {
    db.close();
  }
}
