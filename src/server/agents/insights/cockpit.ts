/**
 * Die Übersicht: alle Zahlen des Piloten auf einer Zeitachse.
 *
 * Bis hierher lagen sie in fünf Ecken und in fünf Einheiten: Kanalzahlen je
 * Tag (`mp_kanal_stats`), Beitragszahlen je Beitrag (`mp_scheduled_posts`),
 * Klicks je Kurzlink (`mp_klick_tage`), Anmeldungen je Event (`mp_events`) und
 * Konten/Umsatz in der Datenbank des Produkts. Dieses Modul legt sie auf
 * dieselbe Zeitachse und beantwortet damit die Frage, für die der Pilot
 * gebaut wurde: bringt das, was wir posten, Nutzer und Kunden?
 *
 * Drei Regeln, die durchgehalten werden, weil sonst falsche Zahlen entstehen:
 *
 * 1. **Tageswert oder Bestand.** Aufrufe eines Tages darf man addieren,
 *    Follower nicht. Bestände werden fortgeschrieben (der letzte bekannte Wert
 *    gilt weiter), Tageswerte bleiben lückenhaft, wenn nichts gemessen wurde.
 * 2. **`null` ist nicht `0`.** Fehlt eine Messung, steht `null` — die Anzeige
 *    zeigt dann einen Strich und keine Null, die wie ein Misserfolg aussieht.
 * 3. **Der Zeitraum der Beitragszahlen ist die Lebenszeit.** Meta liefert je
 *    Beitrag nur einen Gesamtstand. „Aufrufe der Beiträge dieses Zeitraums"
 *    heißt deshalb: was die in diesem Zeitraum veröffentlichten Beiträge bis
 *    heute gesammelt haben.
 */
import { and, eq, gte } from "drizzle-orm";
import type * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { parseJson, type Db } from "../../db/index.js";
import { PLATFORMS } from "../../../shared/channels.js";
import { loadProfiles } from "../../channels.js";
import { leseMetriken } from "../../publish/metrics.js";
import { leseKanalStatus, leseKanalTage, MESSBARE_KANAELE, type KanalWerte } from "../../publish/kanal-metriken.js";
import { loadCredentials } from "../../publish/index.js";
import { berlinTag } from "../../shortlinks.js";
import { geschaeftsZahlen, tageZwischen, type GeschaeftsTag } from "../../providers/geschaeft.binderplan.js";
import { loadDataSource } from "../../data-source.js";

const TAG_MS = 86_400_000;

/** Summe, die `null` bleibt, solange kein einziger Wert vorlag. */
function summe(werte: (number | null | undefined)[]): number | null {
  let out: number | null = null;
  for (const w of werte) if (typeof w === "number") out = (out ?? 0) + w;
  return out;
}

const rund = (x: number | null, stellen = 2): number | null => (x === null ? null : Math.round(x * 10 ** stellen) / 10 ** stellen);

export interface CockpitOptions {
  /** Länge des Zeitraums in Tagen (einschließlich heute). */
  tage: number;
  /** Pfad zum Schnappschuss der Produktdatenbank, falls das Projekt eine Datenquelle hat. */
  produktDbPfad?: string | undefined;
  now?: Date;
}

export function cockpitView(db: Db, projectId: string, opts: CockpitOptions): s.CockpitView {
  const now = opts.now ?? new Date();
  const bis = berlinTag(now);
  const von = berlinTag(new Date(now.getTime() - (opts.tage - 1) * TAG_MS));
  const vorherVon = berlinTag(new Date(now.getTime() - (2 * opts.tage - 1) * TAG_MS));
  const tage = tageZwischen(von, bis);
  const hinweise: string[] = [];

  // --- Kanalzahlen ------------------------------------------------------------
  const profile = loadProfiles(db, projectId);
  const creds = loadCredentials(db, projectId);
  const status = leseKanalStatus(db, projectId);
  const rohTage = leseKanalTage(db, projectId, vorherVon);
  /** platform -> tag -> Werte */
  const jeKanal = new Map<string, Map<string, KanalWerte>>();
  for (const r of rohTage) {
    const m = jeKanal.get(r.platform) ?? new Map<string, KanalWerte>();
    m.set(r.tag, r.parsed);
    jeKanal.set(r.platform, m);
  }

  // --- Beiträge ---------------------------------------------------------------
  const stuecke = new Map(db.select({ id: t.mpContentPieces.id, title: t.mpContentPieces.title, format: t.mpContentPieces.format })
    .from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all().map((p) => [p.id, p]));
  const klicksJeStueck = new Map<string, number>();
  const klickTage = db.select().from(t.mpKlickTage).where(and(eq(t.mpKlickTage.projectId, projectId), gte(t.mpKlickTage.tag, vorherVon))).all();
  for (const k of klickTage) if (k.pieceId) klicksJeStueck.set(k.pieceId, (klicksJeStueck.get(k.pieceId) ?? 0) + k.klicks);

  const posts = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.status, "posted"))).all()
    .filter((p) => p.postedAt);
  const imZeitraum = posts.filter((p) => berlinTag(new Date(p.postedAt!)) >= von);
  const davor = posts.filter((p) => { const tg = berlinTag(new Date(p.postedAt!)); return tg >= vorherVon && tg < von; });

  const beitraege: s.CockpitBeitrag[] = imZeitraum
    .map((p) => {
      const m = leseMetriken(p);
      const stueck = stuecke.get(p.pieceId);
      const interaktionen = summe([m?.likes, m?.kommentare, m?.saves, m?.shares]);
      return {
        id: p.id, pieceId: p.pieceId, titel: stueck?.title ?? "", platform: p.platform, format: stueck?.format ?? "",
        postedAt: p.postedAt, externalUrl: p.externalUrl,
        aufrufe: m?.aufrufe ?? null, reichweite: m?.reichweite ?? null, likes: m?.likes ?? null,
        kommentare: m?.kommentare ?? null, saves: m?.saves ?? null, shares: m?.shares ?? null,
        klicks: klicksJeStueck.get(p.pieceId) ?? 0,
        quote: interaktionen !== null && m?.aufrufe ? rund(interaktionen / m.aufrufe, 4) : null,
        metricsAt: p.metricsAt, fehler: m?.fehler ?? "",
      };
    })
    .sort((a, b) => (b.aufrufe ?? -1) - (a.aufrufe ?? -1) || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));

  // --- Anmeldungen aus dem Produkt-Webhook ------------------------------------
  const events = db.select().from(t.mpEvents).where(eq(t.mpEvents.projectId, projectId)).all();
  const anmeldungJeTag = new Map<string, number>();
  for (const e of events) {
    if (e.event !== "signup") continue;
    const tg = berlinTag(new Date(e.occurredAt));
    anmeldungJeTag.set(tg, (anmeldungJeTag.get(tg) ?? 0) + 1);
  }
  const bezahltImZeitraum = events.filter((e) => e.event === "paid" && berlinTag(new Date(e.occurredAt)) >= von).length;

  // --- Produktzahlen ----------------------------------------------------------
  const quelle = loadDataSource(db, projectId);
  const geschaeft = opts.produktDbPfad ? geschaeftsZahlen(opts.produktDbPfad, von, bis) : null;
  const geschaeftJeTag = new Map<string, GeschaeftsTag>((geschaeft?.verlauf ?? []).map((g) => [g.tag, g]));
  const produkt: s.CockpitView["produkt"] = geschaeft
    ? {
      verfuegbar: true, quelle: quelle.provider, stand: geschaeft.stand,
      konten: geschaeft.konten, zahlende: geschaeft.zahlende, mrr: geschaeft.mrr, umsatzGesamt: geschaeft.umsatzGesamt,
      tarife: geschaeft.tarife,
      hinweis: "Aus dem stündlichen Schnappschuss der Produktdatenbank — bis zu eine Stunde alt.",
    }
    : {
      verfuegbar: false, quelle: quelle.provider, stand: null, konten: null, zahlende: null, mrr: null, umsatzGesamt: null, tarife: [],
      hinweis: quelle.provider === "none"
        ? "Für dieses Projekt ist keine Produktdatenquelle hinterlegt — Konten und Umsatz kann der Pilot deshalb nicht zeigen."
        : "Der Schnappschuss der Produktdatenbank fehlt. Er entsteht über den systemd-Timer binderplan-snapshot.timer.",
    };
  if (!produkt.verfuegbar) hinweise.push(produkt.hinweis);

  // --- Zeitreihe --------------------------------------------------------------
  const beitragJeTag = new Map<string, number>();
  for (const p of posts) { const tg = berlinTag(new Date(p.postedAt!)); beitragJeTag.set(tg, (beitragJeTag.get(tg) ?? 0) + 1); }
  const klickJeTag = new Map<string, number>();
  for (const k of klickTage) klickJeTag.set(k.tag, (klickJeTag.get(k.tag) ?? 0) + k.klicks);

  /**
   * Follower sind ein Bestand: der letzte bekannte Wert je Plattform gilt weiter.
   *
   * Summiert wird erst, wenn **jeder** eingerichtete Kanal einen Stand hat.
   * Sonst entsteht der Anschein von Wachstum, wo nur eine Messung dazukam:
   * Facebook meldet seinen Stand rückwirkend, Instagram erst ab dem ersten
   * eigenen Abruf — die Summe spränge dann von 0 auf 7, ohne dass jemand
   * gefolgt ist.
   */
  const eingerichteteKanaele = MESSBARE_KANAELE.filter((p) => creds[p]?.["accessToken"]);
  const followerStand = new Map<string, number>();
  const followerSumme = (): number | null =>
    eingerichteteKanaele.length && eingerichteteKanaele.every((p) => followerStand.has(p))
      ? eingerichteteKanaele.reduce((n, p) => n + (followerStand.get(p) ?? 0), 0)
      : null;
  const verlauf: s.CockpitTag[] = tage.map((tag) => {
    const werte = MESSBARE_KANAELE.map((p) => jeKanal.get(p)?.get(tag));
    for (const p of MESSBARE_KANAELE) {
      const f = jeKanal.get(p)?.get(tag)?.follower;
      if (typeof f === "number") followerStand.set(p, f);
    }
    const g = geschaeftJeTag.get(tag);
    return {
      tag,
      aufrufe: summe(werte.map((w) => w?.aufrufe)),
      reichweite: summe(werte.map((w) => w?.reichweite)),
      interaktionen: summe(werte.map((w) => w?.interaktionen)),
      profilaufrufe: summe(werte.map((w) => w?.profilaufrufe)),
      follower: followerSumme(),
      beitraege: beitragJeTag.get(tag) ?? 0,
      klicks: klickJeTag.get(tag) ?? 0,
      anmeldungen: anmeldungJeTag.get(tag) ?? 0,
      neueKonten: g?.neueKonten ?? null,
      konten: g?.konten ?? null,
      kaeufe: g?.kaeufe ?? null,
      umsatz: g?.umsatz ?? null,
    };
  });

  // --- Kanäle -----------------------------------------------------------------
  const kanalNamen = [...new Set([...MESSBARE_KANAELE, ...profile.filter((p) => p.stage !== "off").map((p) => p.platform), ...posts.map((p) => p.platform)])];
  const kanaele: s.CockpitKanal[] = kanalNamen.map((platform) => {
    const tageDesKanals = jeKanal.get(platform);
    const imRaum = tage.map((tag) => ({ tag, w: tageDesKanals?.get(tag) }));
    const eigenePosts = imZeitraum.filter((p) => p.platform === platform);
    const metriken = eigenePosts.map((p) => leseMetriken(p));
    const profil = profile.find((p) => p.platform === platform);
    let letzterFollower: number | null = null;
    for (const { w } of imRaum) if (typeof w?.follower === "number") letzterFollower = w.follower;
    let followerDavor: number | null = null;
    for (const tag of tageZwischen(vorherVon, von)) { const f = tageDesKanals?.get(tag)?.follower; if (typeof f === "number") followerDavor = f; }
    return {
      platform,
      label: PLATFORMS[platform]?.label ?? platform,
      eingerichtet: Boolean(creds[platform]?.["accessToken"]),
      messbar: MESSBARE_KANAELE.includes(platform),
      profilUrl: profil?.url || null,
      follower: letzterFollower,
      followerDavor,
      aufrufe: summe(imRaum.map(({ w }) => w?.aufrufe)),
      reichweite: summe(imRaum.map(({ w }) => w?.reichweite)),
      interaktionen: summe(imRaum.map(({ w }) => w?.interaktionen)),
      profilaufrufe: summe(imRaum.map(({ w }) => w?.profilaufrufe)),
      beitraege: eigenePosts.length,
      beitragsAufrufe: summe(metriken.map((m) => m?.aufrufe)),
      beitragsInteraktionen: summe(metriken.flatMap((m) => [m?.likes, m?.kommentare, m?.saves, m?.shares])),
      letzterAbruf: status.letzterLauf,
      fehler: status.fehler[platform] ?? "",
      verlauf: imRaum.map(({ tag, w }) => ({ tag, aufrufe: w?.aufrufe ?? null, interaktionen: w?.interaktionen ?? null, follower: w?.follower ?? null })),
    };
  })
    // Ein Kanal ohne Zahlen und ohne Beitrag ist eine leere Zeile, die nur
    // Platz kostet — er steht auf der Kanäle-Seite, nicht in der Übersicht.
    .filter((k) => k.messbar || k.beitraege > 0)
    .sort((a, b) => (b.aufrufe ?? -1) - (a.aufrufe ?? -1) || b.beitraege - a.beitraege);

  // --- Kennzahlen mit Vorperiode ----------------------------------------------
  const zeitraumSumme = (feld: keyof KanalWerte, vonTag: string, bisTag: string): number | null =>
    summe(tageZwischen(vonTag, bisTag).flatMap((tag) => MESSBARE_KANAELE.map((p) => jeKanal.get(p)?.get(tag)?.[feld])));
  const klicksIn = (vonTag: string, bisTag: string): number =>
    klickTage.filter((k) => k.tag >= vonTag && k.tag <= bisTag).reduce((s2, k) => s2 + k.klicks, 0);
  const anmeldungenIn = (vonTag: string, bisTag: string): number =>
    [...anmeldungJeTag.entries()].filter(([tag]) => tag >= vonTag && tag <= bisTag).reduce((s2, [, n]) => s2 + n, 0);
  const gestern = berlinTag(new Date(Date.parse(`${von}T00:00:00Z`) - TAG_MS));

  const follower = verlauf.at(-1)?.follower ?? null;
  const followerVorher = kanaele.filter((k) => eingerichteteKanaele.includes(k.platform)).every((k) => k.followerDavor !== null)
    ? summe(kanaele.filter((k) => eingerichteteKanaele.includes(k.platform)).map((k) => k.followerDavor))
    : null;
  const beitragsAufrufe = summe(beitraege.map((b) => b.aufrufe));
  const beitragsAufrufeDavor = summe(davor.map((p) => leseMetriken(p)?.aufrufe));

  const kennzahlen: s.CockpitKennzahl[] = [
    { id: "aufrufe", label: "Aufrufe", wert: zeitraumSumme("aufrufe", von, bis), davor: zeitraumSumme("aufrufe", vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Wie oft Inhalte der Kanäle abgespielt oder angezeigt wurden — auch ältere Beiträge." },
    { id: "interaktionen", label: "Interaktionen", wert: zeitraumSumme("interaktionen", von, bis), davor: zeitraumSumme("interaktionen", vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Likes, Kommentare, Speichern und Teilen zusammen." },
    { id: "follower", label: "Follower", wert: follower, davor: followerVorher, einheit: "zahl", art: "bestand", hinweis: "Bestand über alle Kanäle, nicht der Zuwachs." },
    { id: "beitraege", label: "Beiträge", wert: imZeitraum.length, davor: davor.length, einheit: "zahl", art: "summe", hinweis: "Was der Pilot in diesem Zeitraum veröffentlicht hat." },
    { id: "beitragsaufrufe", label: "Aufrufe dieser Beiträge", wert: beitragsAufrufe, davor: beitragsAufrufeDavor, einheit: "zahl", art: "summe", hinweis: "Gesamtstand der im Zeitraum veröffentlichten Beiträge — Meta liefert je Beitrag keine Tageswerte." },
    { id: "klicks", label: "Klicks auf die Seite", wert: klicksIn(von, bis), davor: klicksIn(vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Klicks auf die Kurzlinks des Piloten." },
    { id: "anmeldungen", label: "Anmeldungen", wert: anmeldungenIn(von, bis), davor: anmeldungenIn(vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Aus dem Webhook des Produkts (utm-gestützt)." },
    { id: "konten", label: "Konten im Produkt", wert: produkt.konten, davor: null, einheit: "zahl", art: "bestand", hinweis: produkt.hinweis },
    { id: "zahlende", label: "Zahlende Kunden", wert: produkt.zahlende, davor: null, einheit: "zahl", art: "bestand", hinweis: "Konten mit laufendem Abo; der Betreiberzugang zählt nicht mit." },
    { id: "mrr", label: "Monatlich wiederkehrend", wert: produkt.mrr, davor: null, einheit: "euro", art: "bestand", hinweis: "Summe der laufenden Abos je Monat." },
  ];

  // --- Trichter ---------------------------------------------------------------
  const neueKonten = summe(verlauf.map((v) => v.neueKonten));
  const trichter = [
    { id: "aufrufe", label: "Aufrufe", wert: zeitraumSumme("aufrufe", von, bis), erklaerung: "So oft wurden Inhalte der Kanäle gesehen." },
    { id: "interaktionen", label: "Interaktionen", wert: zeitraumSumme("interaktionen", von, bis), erklaerung: "Davon reagiert: Like, Kommentar, Speichern, Teilen." },
    { id: "klicks", label: "Klicks auf die Seite", wert: klicksIn(von, bis), erklaerung: "Über die Kurzlinks des Piloten." },
    { id: "konten", label: "Neue Konten", wert: neueKonten ?? (anmeldungenIn(von, bis) || null), erklaerung: geschaeft ? "Neu angelegte Konten laut Produktdatenbank." : "Anmeldungen aus dem Webhook — ohne Produktdatenquelle die einzige Quelle." },
    { id: "kaeufe", label: "Käufe", wert: geschaeft ? summe(verlauf.map((v) => v.kaeufe)) : (bezahltImZeitraum || null), erklaerung: "Bezahlte Bestellungen im Zeitraum — Abos und Kreditpakete zusammen." },
  ];

  // --- Hinweise ---------------------------------------------------------------
  const ohneZugang = kanaele.filter((k) => k.messbar && !k.eingerichtet).map((k) => k.label);
  if (ohneZugang.length) hinweise.push(`Ohne hinterlegten Zugang keine Zahlen: ${ohneZugang.join(", ")}. Auf der Kanäle-Seite eintragen.`);
  const nichtMessbar = kanaele.filter((k) => !k.messbar && k.beitraege > 0).map((k) => k.label);
  if (nichtMessbar.length) hinweise.push(`Zahlen nur von Hand einzutragen: ${nichtMessbar.join(", ")} — dort gibt es keine Lese-API.`);
  if (!status.letzterLauf) hinweise.push("Die Kanalzahlen wurden noch nie abgerufen. Der Sammler läuft täglich, oder oben von Hand starten.");
  if (kanaele.some((k) => k.platform === "facebook" && k.beitraege > 0)) hinweise.push("Facebook nennt seit Graph v21 keine Aufrufe je Seite mehr (nur Videoaufrufe). Für die Facebook-Seite stehen deshalb Interaktionen und Seitenaufrufe, aber keine Reichweite.");
  const verschwunden = beitraege.filter((b) => /Nicht mehr abrufbar/.test(b.fehler)).length;
  if (verschwunden) hinweise.push(`${verschwunden} Beiträge liefern keine Zahlen mehr — Stories sind nach 24 Stunden weg, und Meta gibt danach auch ihre Zahlen nicht mehr heraus. Wer Story-Zahlen braucht, muss sie am selben Tag abrufen.`);
  if (klicksIn(von, bis) === 0 && imZeitraum.length > 0) hinweise.push("Kein einziger Klick auf einen Kurzlink. Auf Instagram und Threads sind Links im Text nicht anklickbar — dort führt nur der Link im Profil zur Seite.");
  for (const [platform, fehler] of Object.entries(status.fehler)) hinweise.push(`${PLATFORMS[platform]?.label ?? platform}: ${fehler}`);

  return {
    zeitraum: { von, bis, tage: opts.tage },
    kennzahlen, verlauf, kanaele, beitraege, trichter, produkt, hinweise,
    kanalStatus: { letzterLauf: status.letzterLauf, laeuft: false },
  };
}

/** Wie viele Tage der Verlauf überhaupt hergibt — für den Hinweis „erst seit X Tagen gemessen". */
export function ersterMesstag(db: Db, projectId: string): string | null {
  const rows = db.select({ tag: t.mpKanalStats.tag }).from(t.mpKanalStats).where(eq(t.mpKanalStats.projectId, projectId)).all();
  return rows.length ? rows.map((r) => r.tag).sort()[0]! : null;
}

export { parseJson };
