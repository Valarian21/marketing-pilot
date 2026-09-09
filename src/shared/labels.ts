/**
 * Die Namen der Dinge — einmal, für Server und Client.
 *
 * Vorher hatte jede Seite ihr eigenes Wörterbuch: sechs Kopien im Frontend, die
 * einander widersprachen. `data_carousel` hieß auf der Freigabe-Seite
 * „Rangliste", im Studio „Daten-Carousel", im Speicher `DATA_CAROUSEL` und in
 * der Pipeline gar nichts. Wer zwei Seiten nebeneinander legte, sah drei Namen
 * für dieselbe Sache und musste raten, ob es dieselbe ist.
 *
 * Die Regel dahinter: **eine Kennung, ein Wort.** Kennungen wie `rejected` oder
 * `data_reel` sind Datenbankwerte und gehören nie in die Oberfläche — dort steht
 * das deutsche Wort. Fehlt eine Übersetzung, fällt der Code auf die Kennung
 * zurück, statt leer zu bleiben: sichtbar falsch ist besser als unsichtbar weg.
 */

/** Format eines Stücks. Kurz genug für eine Tabellenzelle, eindeutig genug für eine Liste. */
export const FORMAT_NAMEN: Record<string, string> = {
  text: "Text-Post",
  carousel: "Carousel",
  image: "Bild",
  pin: "Pinterest-Pin",
  video: "Video",
  article: "Artikel",
  directory_entry: "Verzeichnis-Eintrag",
  community_reply: "Community-Antwort",
  ad_creative: "Anzeigenbild",
  data_carousel: "Rangliste",
  data_reel: "Rangliste als Reel",
  showcase_carousel: "Binderseiten",
  artwork_carousel: "Kunstseite",
  artwork_reel: "Kunstseite als Reel",
  story: "Story (24 h)",
};

/** Zustand eines Stücks im Ablauf. */
export const STATUS_NAMEN: Record<string, string> = {
  draft: "Entwurf",
  review: "in Freigabe",
  approved: "freigegeben",
  published: "veröffentlicht",
  rejected: "abgelehnt",
};

/** Zustand eines Zeitplan-Eintrags. */
export const TERMIN_NAMEN: Record<string, string> = {
  queued: "wartet",
  posted: "gepostet",
  failed: "gescheitert",
  cancelled: "abgesagt",
};

/** Zustand eines Hintergrund-Auftrags und seiner Schritte. */
export const JOB_NAMEN: Record<string, string> = {
  queued: "wartet",
  running: "läuft",
  done: "fertig",
  failed: "gescheitert",
  cancelled: "abgebrochen",
  pending: "offen",
  skipped: "übersprungen",
};

/** Art einer Aufgabe. */
export const AUFGABEN_NAMEN: Record<string, string> = {
  research: "Recherche",
  strategy: "Strategie",
  content: "Content",
  publish: "Posten",
  community: "Community",
  ads: "Anzeigen",
  measure: "Messen",
  setup: "Einrichtung",
};

/** Was ein Hintergrund-Auftrag tut — die Job-Art im Klartext. */
export const JOBART_NAMEN: Record<string, string> = {
  "video.render": "Video rendern",
  "video.slideshow": "Reel bauen",
  "series.run": "Serie ausführen",
  "publish.due": "fällige Beiträge posten",
  "metrics.fetch": "Zahlen je Beitrag holen",
  "kanal.stats": "Kanalzahlen holen",
  "community.scan": "Community durchsuchen",
  "weekly.report": "Wochenbericht schreiben",
  "geo.measure": "GEO-Sichtbarkeit messen",
  "cleanup.run": "aufräumen",
};

const nachschlagen = (buch: Record<string, string>, wert: string | null | undefined): string =>
  (wert ? buch[wert] ?? wert : "–");

export const formatName = (f: string | null | undefined): string => nachschlagen(FORMAT_NAMEN, f);
export const statusName = (s: string | null | undefined): string => nachschlagen(STATUS_NAMEN, s);
export const terminName = (s: string | null | undefined): string => nachschlagen(TERMIN_NAMEN, s);
export const jobName = (s: string | null | undefined): string => nachschlagen(JOB_NAMEN, s);
export const aufgabenName = (t: string | null | undefined): string => nachschlagen(AUFGABEN_NAMEN, t);
export const jobartName = (k: string | null | undefined): string => nachschlagen(JOBART_NAMEN, k);

/** Formate, die eine Bewegtbild-Datei erzeugen — für Filter „nur Videos". */
export const BEWEGTE_FORMATE = ["video", "data_reel", "artwork_reel", "story"] as const;
