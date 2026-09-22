/**
 * Kanalzahlen aus einem Export einspielen — für Plattformen ohne Lese-API.
 *
 * TikTok gibt ohne Content-Posting-Audit keine Zahlen heraus, aber jeder
 * Kanalbetreiber kann im Analytics-Bereich einen Export ziehen (Übersicht,
 * Inhalte, Follower — als XLSX oder CSV). Dieses Modul liest so einen Export
 * und legt ihn als Tageszeilen in `mp_kanal_stats` ab, mit `quelle: "hand"`,
 * damit die Übersicht dieselben Regeln anwenden kann wie bei den API-Kanälen.
 *
 * Zwei Dinge sind nicht offensichtlich:
 *
 * - **Das Datum trägt kein Jahr.** TikTok schreibt in der deutschen Oberfläche
 *   „2. September", in der englischen „Sep 2". Das Jahr ergibt sich aus dem
 *   Tag des Einspielens: ein Export enthält nie die Zukunft, also gehört ein
 *   Datum, das nach heute läge, ins Vorjahr.
 * - **XLSX ohne Bibliothek.** Eine XLSX ist eine ZIP mit XML darin. Der Pilot
 *   hat keine ZIP- oder Tabellen-Abhängigkeit, und für Exporte mit einem
 *   Blatt und sechs Spalten braucht es keine — Node bringt `inflateRaw` mit,
 *   das Zentralverzeichnis der ZIP ist vierzig Zeilen, und die Zellen stehen
 *   als `<c r="A1" t="s"><v>0</v></c>` im Blatt. Was nicht gelesen wird:
 *   Formeln, Formate, mehrere Blätter (nur das erste zählt).
 */
import { inflateRawSync } from "node:zlib";
import type { KanalTag, KanalWerte } from "./kanal-metriken.js";
import { schreibeKanalTag } from "./kanal-metriken.js";
import type { Db } from "../db/index.js";

// --- XLSX lesen --------------------------------------------------------------

/** Alle Einträge einer ZIP als `{name: Inhalt}` — nur gespeichert (0) und deflate (8). */
export function zipEintraege(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // Das Ende des Zentralverzeichnisses steht am Dateiende, davor höchstens 64 KB Kommentar.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Keine ZIP-Datei — eine XLSX beginnt intern mit einem Zentralverzeichnis.");
  const anzahl = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < anzahl; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const methode = buf.readUInt16LE(pos + 10);
    const komprimiert = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const kommentarLen = buf.readUInt16LE(pos + 32);
    const lokal = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    // Der lokale Kopf wiederholt Name und Extra in eigener Länge.
    const lNameLen = buf.readUInt16LE(lokal + 26);
    const lExtraLen = buf.readUInt16LE(lokal + 28);
    const start = lokal + 30 + lNameLen + lExtraLen;
    const roh = buf.subarray(start, start + komprimiert);
    if (methode === 0) out.set(name, Buffer.from(roh));
    else if (methode === 8) out.set(name, inflateRawSync(roh));
    pos += 46 + nameLen + extraLen + kommentarLen;
  }
  return out;
}

const entXml = (s: string): string => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** Alle `<t>`-Texte eines Knotens aneinander — Rich-Text-Zellen bestehen aus mehreren Läufen. */
const texte = (xml: string): string => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => entXml(m[1] ?? "")).join("");

/** Spaltenbuchstaben → Index: A=0, Z=25, AA=26. */
const spaltenIndex = (r: string): number => {
  const buchstaben = /^[A-Z]+/.exec(r)?.[0] ?? "";
  let n = 0;
  for (const ch of buchstaben) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Das erste Tabellenblatt einer XLSX als Zeilen aus Zeichenketten. Leere Zellen sind "". */
export function liesXlsx(buf: Buffer): string[][] {
  const eintraege = zipEintraege(buf);
  const shared = [...(eintraege.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texte(m[1] ?? ""));
  const blattName = [...eintraege.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))[0];
  if (!blattName) throw new Error("Die XLSX enthält kein Tabellenblatt.");
  const blatt = eintraege.get(blattName)!.toString("utf8");
  const zeilen: string[][] = [];
  for (const zeile of blatt.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const zellen: string[] = [];
    let naechste = 0;
    for (const zelle of (zeile[1] ?? "").matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = zelle[1] ?? "";
      const inhalt = zelle[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attr)?.[1];
      const idx = ref ? spaltenIndex(ref) : naechste;
      const typ = /\bt="([^"]+)"/.exec(attr)?.[1];
      let wert = "";
      if (typ === "s") wert = shared[Number(/<v>([^<]*)<\/v>/.exec(inhalt)?.[1] ?? -1)] ?? "";
      else if (typ === "inlineStr") wert = texte(inhalt);
      else wert = entXml(/<v>([^<]*)<\/v>/.exec(inhalt)?.[1] ?? "");
      while (zellen.length < idx) zellen.push("");
      zellen[idx] = wert;
      naechste = idx + 1;
    }
    zeilen.push(zellen);
  }
  return zeilen;
}

// --- CSV lesen ---------------------------------------------------------------

/** CSV mit Komma, Semikolon oder Tab; Anführungszeichen nach RFC 4180. */
export function liesCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "");
  const kopf = t.split(/\r?\n/, 1)[0] ?? "";
  const trenner = [";", "\t", ","].map((z) => ({ z, n: kopf.split(z).length })).sort((a, b) => b.n - a.n)[0]!.z;
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let inAnf = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (inAnf) {
      if (ch === "\"") { if (t[i + 1] === "\"") { feld += "\""; i++; } else inAnf = false; }
      else feld += ch;
    } else if (ch === "\"") inAnf = true;
    else if (ch === trenner) { zeile.push(feld); feld = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      zeile.push(feld); feld = "";
      if (zeile.some((f) => f.trim())) zeilen.push(zeile);
      zeile = [];
    } else feld += ch;
  }
  zeile.push(feld);
  if (zeile.some((f) => f.trim())) zeilen.push(zeile);
  return zeilen;
}

// --- Spalten und Werte deuten -------------------------------------------------

/** Was eine Spalte des Exports im Piloten bedeutet. `tag` ist das Datum. */
export type ExportFeld = keyof KanalWerte | "tag";

/**
 * Spaltennamen der Exporte, deutsch und englisch. Vergleich nach dem
 * Normalisieren (Kleinbuchstaben, ohne Satzzeichen), deshalb reicht je
 * Schreibweise ein Eintrag. Unbekannte Spalten werden gemeldet, nicht geraten.
 */
const SPALTEN: [RegExp, ExportFeld][] = [
  [/^(date|datum|day|tag)$/, "tag"],
  [/^(video ?views|videoaufrufe|video ?aufrufe|views|aufrufe|wiedergaben)$/, "aufrufe"],
  [/^(profile ?views|profilaufrufe|profil ?aufrufe)$/, "profilaufrufe"],
  [/^(likes|gefallt mir|gefallt mir angaben|likes gesamt)$/, "likes"],
  [/^(comments|kommentare)$/, "kommentare"],
  [/^(shares|geteilt|teilen|weitergeleitet)$/, "geteilt"],
  [/^(reach|reichweite|unique viewers|einzelne zuschauer)$/, "reichweite"],
  [/^(engagement|engagements|interaktionen)$/, "interaktionen"],
  [/^(new followers|net followers|neue follower|netto follower|follower zuwachs|net follower growth)$/, "neueFollower"],
  [/^(followers|follower|total followers|follower gesamt|follower insgesamt)$/, "follower"],
];

const normal = (s: string): string => s.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function deuteSpalte(name: string): ExportFeld | null {
  const n = normal(name);
  for (const [re, feld] of SPALTEN) if (re.test(n)) return feld;
  return null;
}

/** „1.234", „1,234", „1234", „12,5" → Zahl; leer oder Prozent → undefined. */
export function deuteZahl(s: string): number | undefined {
  const t = s.replace(/\s/g, "");
  if (!t || /%$/.test(t)) return undefined;
  const tausender = /^-?\d{1,3}([.,]\d{3})+$/.test(t) ? t.replace(/[.,]/g, "") : t.replace(",", ".");
  const n = Number(tausender);
  return Number.isFinite(n) ? n : undefined;
}

const MONATE: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const monat = (name: string): number | undefined => MONATE[normal(name).slice(0, 3)];
const iso = (j: number, m: number, t: number): string | null => {
  if (m < 1 || m > 12 || t < 1 || t > 31) return null;
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCMonth() === m - 1 ? d.toISOString().slice(0, 10) : null;
};

/**
 * Ein Datum aus dem Export als `YYYY-MM-DD`.
 *
 * Fehlt das Jahr, gilt das jüngste, in dem der Tag nicht nach `heute` liegt —
 * ein Export kennt keine Zukunft. Ein Excel-Datum (Zahl der Tage seit 1900)
 * wird ebenfalls verstanden, falls ein Blatt die Spalte als Datum formatiert.
 */
export function deuteDatum(s: string, heute: string): string | null {
  const t = s.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return iso(+m[1]!, +m[2]!, +m[3]!);
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) return iso(+m[3]!, +m[2]!, +m[1]!);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) return iso(+m[3]!, +m[1]!, +m[2]!);
  if (/^\d{4,6}$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86_400_000); return d.toISOString().slice(0, 10); }
  let tagNr: number | undefined, mon: number | undefined, jahr: number | undefined;
  if ((m = /^(\d{1,2})\.?\s*([A-Za-zÄÖÜäöü]+)\.?(?:,?\s*(\d{4}))?$/.exec(t))) { tagNr = +m[1]!; mon = monat(m[2]!); jahr = m[3] ? +m[3] : undefined; }
  else if ((m = /^([A-Za-zÄÖÜäöü]+)\.?\s+(\d{1,2})(?:\.|,)?(?:\s*(\d{4}))?$/.exec(t))) { mon = monat(m[1]!); tagNr = +m[2]!; jahr = m[3] ? +m[3] : undefined; }
  if (tagNr === undefined || mon === undefined) return null;
  if (jahr !== undefined) return iso(jahr, mon, tagNr);
  const heuteJahr = Number(heute.slice(0, 4));
  const kandidat = iso(heuteJahr, mon, tagNr);
  if (!kandidat) return null;
  return kandidat > heute ? iso(heuteJahr - 1, mon, tagNr) : kandidat;
}

export interface ExportDeutung {
  tage: KanalTag[];
  /** Spaltenname des Exports → Feld im Piloten. */
  erkannt: Record<string, ExportFeld>;
  unbekannt: string[];
  hinweise: string[];
}

/**
 * Zeilen eines Exports in Tageswerte übersetzen.
 *
 * Die Kopfzeile ist die erste Zeile mit einer erkannten Datumsspalte — TikTok
 * setzt manchmal einen Titel darüber. Doppelte Tage werden zusammengeführt,
 * der spätere gewinnt. `interaktionen` entsteht aus Likes, Kommentaren und
 * Teilen, wenn der Export sie nicht selbst nennt.
 */
export function deuteExport(zeilen: string[][], heute: string): ExportDeutung {
  const kopfIdx = zeilen.findIndex((z) => z.some((c) => deuteSpalte(c) === "tag"));
  if (kopfIdx < 0) throw new Error(`Keine Datumsspalte gefunden — erwartet wird eine Kopfzeile mit „Date" oder „Datum".`);
  const kopf = zeilen[kopfIdx]!;
  const erkannt: Record<string, ExportFeld> = {};
  const unbekannt: string[] = [];
  const felder: (ExportFeld | null)[] = kopf.map((name) => {
    const n = name.trim();
    if (!n) return null;
    const f = deuteSpalte(n);
    if (f) erkannt[n] = f; else unbekannt.push(n);
    return f;
  });
  const tagSpalte = felder.indexOf("tag");
  const je = new Map<string, KanalWerte>();
  const hinweise: string[] = [];
  let unlesbar = 0;
  for (const z of zeilen.slice(kopfIdx + 1)) {
    const tag = deuteDatum(z[tagSpalte] ?? "", heute);
    if (!tag) { if ((z[tagSpalte] ?? "").trim()) unlesbar++; continue; }
    const w: KanalWerte = { ...(je.get(tag) ?? {}) };
    felder.forEach((f, i) => {
      if (!f || f === "tag") return;
      const v = deuteZahl(z[i] ?? "");
      if (v !== undefined) w[f] = v;
    });
    if (w.interaktionen === undefined) {
      const teile = [w.likes, w.kommentare, w.geteilt].filter((x): x is number => typeof x === "number");
      if (teile.length) w.interaktionen = teile.reduce((a, b) => a + b, 0);
    }
    je.set(tag, w);
  }
  if (unlesbar) hinweise.push(`${unlesbar} Zeilen hatten ein unlesbares Datum und wurden übersprungen.`);
  if (unbekannt.length) hinweise.push(`Nicht zugeordnet: ${unbekannt.join(", ")} — diese Spalten bleiben unberücksichtigt.`);
  if (!Object.values(erkannt).some((f) => f !== "tag")) hinweise.push("Außer dem Datum wurde keine Spalte erkannt — der Export enthält keine Zahlen, die der Pilot kennt.");
  const tage = [...je.entries()].map(([tag, werte]) => ({ tag, werte })).sort((a, b) => a.tag.localeCompare(b.tag));
  if (!tage.length) hinweise.push("Keine Tageszeile gefunden.");
  return { tage, erkannt, unbekannt, hinweise };
}

/**
 * Datei als XLSX, CSV oder ZIP lesen und deuten.
 *
 * TikTok liefert die CSV-Ausgabe **als ZIP** mit einer einzigen `Overview.csv`
 * darin (22.09.2026 gemessen). Eine XLSX ist ebenfalls ein ZIP — sie erkennt
 * man an `xl/workbook.xml`. Alles andere wird ausgepackt und der erste
 * Tabelleneintrag gelesen; damit versteht auch der Handeinwurf die Datei, die
 * im Browser ankommt, ohne dass jemand sie vorher entpacken muss.
 */
export function liesExport(datei: Buffer, name: string, heute: string): ExportDeutung {
  const istZip = datei.length > 4 && datei.readUInt32LE(0) === 0x04034b50;
  if (istZip && !/\.xlsx$/i.test(name)) {
    const eintraege = zipEintraege(datei);
    if (!eintraege.has("xl/workbook.xml")) {
      const treffer = [...eintraege.entries()].find(([k]) => /\.(csv|xlsx)$/i.test(k) && !k.startsWith("__MACOSX"));
      if (!treffer) throw new Error(`Das ZIP enthält weder CSV noch XLSX (${[...eintraege.keys()].slice(0, 5).join(", ")}).`);
      return liesExport(treffer[1], treffer[0], heute);
    }
  }
  const zeilen = /\.xlsx$/i.test(name) || istZip ? liesXlsx(datei) : liesCsv(datei.toString("utf8"));
  return deuteExport(zeilen, heute);
}

/** Tage einer Plattform als Handeintrag speichern; gibt die Zahl der Tage zurück. */
export function speichereExport(db: Db, projectId: string, platform: string, tage: KanalTag[], now = new Date()): number {
  for (const { tag, werte } of tage) schreibeKanalTag(db, projectId, platform, tag, werte, now, "hand");
  return tage.length;
}
