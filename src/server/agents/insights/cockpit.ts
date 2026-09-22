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
import { kanalEingerichtet, leseHandStand, leseKanalStatus, leseKanalTage, MESSBARE_KANAELE, SELBST_GEMESSEN, type KanalWerte } from "../../publish/kanal-metriken.js";
import { loadCredentials } from "../../publish/index.js";
import { BIO_CODE, berlinTag } from "../../shortlinks.js";
import { geschaeftsZahlen, tageZwischen, type GeschaeftsTag } from "../../providers/geschaeft.binderplan.js";
import { loadDataSource } from "../../data-source.js";
import { berlinParts } from "../series/time.js";
import { postArtOf } from "../../../shared/postarten.js";

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

/**
 * Der Satz unter einer Kanalkarte ohne Aufrufe.
 *
 * YouTube zählt über Bestände: der erste Lauf speichert nur den Stand, der
 * Tageswert entsteht als Zuwachs beim zweiten. Das ist etwas anderes als eine
 * Plattform, die Aufrufe je Kanal gar nicht herausgibt (Facebook seit 2026).
 */
function aufrufeHinweis(platform: string, werte: (KanalWerte | undefined)[]): string {
  if (werte.some((w) => typeof w?.aufrufe === "number")) return "";
  const bestand = werte.reduce<number | undefined>((n, w) => (typeof w?.aufrufeGesamt === "number" ? w.aufrufeGesamt : n), undefined);
  if (bestand !== undefined) {
    return `Erster Stand gespeichert: ${bestand.toLocaleString("de-DE")} Aufrufe insgesamt. `
      + "Ab dem nächsten Abruf steht hier, wie viele davon am Tag dazukamen.";
  }
  return MESSBARE_KANAELE.includes(platform) ? "Diese Plattform meldet keine Aufrufe je Kanal." : "";
  // (Studio-Kanäle liefern Aufrufe, brauchen hier also keinen Satz.)
}

/**
 * Auf welchem Weg die Zahlen eines Kanals hereinkommen.
 *
 * Steht hier und nicht im Frontend, weil es eine Aussage über den Code ist:
 * ändert sich der Weg, ändert sich diese Tabelle mit. Die Takte entsprechen
 * `kanalStatsJob` (Worker, täglich) und den Tagesläufen in `app.ts`.
 */
const VERSORGUNGSWEG: Record<string, { weg: "api" | "studio" | "export" | "keine"; automatisch: boolean; takt: string }> = {
  instagram: { weg: "api", automatisch: true, takt: "Täglich über die Graph-API." },
  facebook: { weg: "api", automatisch: true, takt: "Täglich über die Graph-API." },
  threads: { weg: "api", automatisch: true, takt: "Täglich über die Threads-API." },
  youtube: { weg: "studio", automatisch: true, takt: "Täglich: offener Feed für den Kanal, angemeldetes Studio für Video- und 28-Tage-Zahlen." },
  tiktok: { weg: "studio", automatisch: true, takt: "Täglich zwischen 12 und 20 Uhr: Export aus dem angemeldeten Studio (keine Lese-API)." },
  pinterest: { weg: "keine", automatisch: false, takt: "Pinnen läuft über den Anmelde-Browser, Zahlen holt der Pilot dort noch nicht." },
};

/** Die Größen, auf die eine Kanalversorgung geprüft wird — gemessen, nicht behauptet. */
const GROESSEN: [keyof KanalWerte, string][] = [
  ["aufrufe", "Aufrufe"], ["reichweite", "Reichweite"], ["interaktionen", "Interaktionen"],
  ["profilaufrufe", "Profilaufrufe"], ["follower", "Follower"], ["linkklicks", "Link-Klicks"],
];

/** Der Tag davor, als `YYYY-MM-DD`. */
const vorTag = (tag: string): string => new Date(Date.parse(`${tag}T00:00:00Z`) - TAG_MS).toISOString().slice(0, 10);

/**
 * Der jüngste gemessene Followerstand bis einschließlich `bisTag`.
 *
 * Follower sind ein Bestand: fehlt für einen Tag die Messung, gilt der letzte
 * bekannte Wert weiter. Ohne dieses Fortschreiben gäbe es für jeden Kanal, der
 * seine Followerzahl nur unregelmäßig mitschickt, keinen Vergleichswert.
 */
function letzterFollowerBis(tage: Map<string, KanalWerte> | undefined, bisTag: string): number | null {
  if (!tage) return null;
  let out: number | null = null;
  for (const tag of [...tage.keys()].sort()) {
    if (tag > bisTag) break;
    const f = tage.get(tag)?.follower;
    if (typeof f === "number") out = f;
  }
  return out;
}

/** Erster Tag mit einer Followerzahl — „gemessen seit". */
function ersterFollowerTag(tage: Map<string, KanalWerte> | undefined): string | null {
  if (!tage) return null;
  for (const tag of [...tage.keys()].sort()) if (typeof tage.get(tag)?.follower === "number") return tag;
  return null;
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
  /**
   * Kanäle, deren Zahlen zählen: die API-Kanäle plus alle, für die ein Export
   * eingespielt wurde (TikTok). Ein Export-Kanal folgt denselben Regeln — ein
   * Tageswert ist ein Tageswert, egal ob Meta ihn geschickt oder Marcel ihn
   * hochgeladen hat.
   */
  const handStand = leseHandStand(db, projectId);
  // Nur messbare Kanäle, die es hier auch gibt: seit YouTube über die bloße
  // Kanaladresse misst (12.09.2026), stünde sonst in jedem Projekt ohne
  // YouTube-Kanal eine leere Karte.
  const zaehlKanaele = [...new Set([
    ...MESSBARE_KANAELE.filter((p) => kanalEingerichtet(p, creds[p], profile.find((x) => x.platform === p)?.url) || jeKanal.has(p)),
    // Alles, wofür Tage gespeichert sind: seit der Pilot TikTok selbst abruft,
    // steht dieser Kanal nicht mehr unter `handStand`, gehört aber weiter in
    // die Summen. Eine leere Karte entsteht dadurch nicht — ohne Tage taucht
    // eine Plattform hier gar nicht auf.
    ...jeKanal.keys(),
    ...handStand.keys(),
  ])];

  // --- Beiträge ---------------------------------------------------------------
  const stuecke = new Map(db.select({ id: t.mpContentPieces.id, title: t.mpContentPieces.title, format: t.mpContentPieces.format, meta: t.mpContentPieces.meta })
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
        postArt: stueck ? postArtOf({ format: stueck.format, meta: parseJson<Record<string, unknown>>(stueck.meta, {}) }) : "",
        stunde: p.postedAt ? berlinParts(new Date(p.postedAt)).hour : null,
        folgen: typeof m?.roh?.["follows"] === "number" ? m.roh["follows"] : null,
        profilbesuche: typeof m?.roh?.["profile_visits"] === "number" ? m.roh["profile_visits"] : null,
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
  // Aufrufe der Link-in-Bio-Seite sind keine Klicks auf einen Beitrag: getrennt
  // gezählt, getrennt angezeigt.
  const klickJeTag = new Map<string, number>();
  for (const k of klickTage.filter((x) => x.code !== BIO_CODE)) klickJeTag.set(k.tag, (klickJeTag.get(k.tag) ?? 0) + k.klicks);
  const bioIn = (vonTag: string, bisTag: string): number =>
    klickTage.filter((k) => k.code === BIO_CODE && k.tag >= vonTag && k.tag <= bisTag).reduce((n, k) => n + k.klicks, 0);

  /**
   * Follower sind ein Bestand: der letzte bekannte Wert je Plattform gilt weiter.
   *
   * Summiert wird erst, wenn **jeder** eingerichtete Kanal einen Stand hat.
   * Sonst entsteht der Anschein von Wachstum, wo nur eine Messung dazukam:
   * Facebook meldet seinen Stand rückwirkend, Instagram erst ab dem ersten
   * eigenen Abruf — die Summe spränge dann von 0 auf 7, ohne dass jemand
   * gefolgt ist.
   */
  const eingerichteteKanaele = [
    ...MESSBARE_KANAELE.filter((p) => kanalEingerichtet(p, creds[p], profile.find((x) => x.platform === p)?.url)),
    // Ein Export-Kanal zählt beim Follower-Bestand nur mit, wenn der Export
    // überhaupt Follower nennt — TikToks Übersicht tut das nicht.
    ...[...handStand.keys()].filter((p) => !MESSBARE_KANAELE.includes(p) && [...(jeKanal.get(p)?.values() ?? [])].some((w) => typeof w.follower === "number")),
  ];
  const followerStand = new Map<string, number>();
  const followerSumme = (): number | null =>
    eingerichteteKanaele.length && eingerichteteKanaele.every((p) => followerStand.has(p))
      ? eingerichteteKanaele.reduce((n, p) => n + (followerStand.get(p) ?? 0), 0)
      : null;
  const verlauf: s.CockpitTag[] = tage.map((tag) => {
    const werte = zaehlKanaele.map((p) => jeKanal.get(p)?.get(tag));
    for (const p of zaehlKanaele) {
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
  const kanalNamen = [...new Set([...zaehlKanaele, ...profile.filter((p) => p.stage !== "off").map((p) => p.platform), ...posts.map((p) => p.platform)])];
  const kanaele: s.CockpitKanal[] = kanalNamen.map((platform) => {
    const tageDesKanals = jeKanal.get(platform);
    const imRaum = tage.map((tag) => ({ tag, w: tageDesKanals?.get(tag) }));
    const eigenePosts = imZeitraum.filter((p) => p.platform === platform);
    const metriken = eigenePosts.map((p) => leseMetriken(p));
    const profil = profile.find((p) => p.platform === platform);
    let letzterFollower: number | null = null;
    for (const { w } of imRaum) if (typeof w?.follower === "number") letzterFollower = w.follower;
    // Der Stand **vor** dem Zeitraum ist der letzte bekannte davor, nicht der
    // letzte innerhalb des Vorzeitraums: eine Plattform, die nur gelegentlich
    // eine Followerzahl mitschickt (TikTok nennt sie erst seit dem 22.09.),
    // hätte sonst nie einen Vergleichswert — und die Anzeige stand dauerhaft
    // auf „–" statt auf dem Zuwachs, nach dem eigentlich gefragt war.
    const followerDavor = letzterFollowerBis(tageDesKanals, vorTag(von));
    const followerSeit = ersterFollowerTag(tageDesKanals);
    // Fehlt die Grundlinie, weil dieser Kanal erst im Zeitraum zum ersten Mal
    // gemessen wurde, zählt der Zuwachs ab dem ersten Messtag. Sonst stünde
    // bei Instagram „+0 in 30 Tagen", obwohl es von 6 auf 21 gewachsen ist —
    // eine Null, die wie Stillstand aussieht, ist schlechter als ein Zuwachs
    // mit Datum daneben.
    const startImRaum = followerSeit && followerSeit >= von ? followerSeit : null;
    const followerStart = followerDavor ?? (startImRaum ? tageDesKanals?.get(startImRaum)?.follower ?? null : null);
    const followerStartTag = followerDavor !== null ? vorTag(von) : startImRaum;
    const neueFollower = letzterFollower !== null && followerStart !== null ? letzterFollower - followerStart : null;
    const hand = handStand.get(platform);
    return {
      platform,
      label: PLATFORMS[platform]?.label ?? platform,
      eingerichtet: kanalEingerichtet(platform, creds[platform], profil?.url) || Boolean(creds[platform]?.["accessToken"]) || Boolean(hand),
      messbar: SELBST_GEMESSEN.includes(platform),
      vonHand: Boolean(hand),
      standBis: hand?.bisTag ?? null,
      profilUrl: profil?.url || null,
      follower: letzterFollower,
      followerDavor,
      neueFollower,
      followerStartTag,
      followerExakt: followerDavor !== null,
      followerSeit,
      aufrufe: summe(imRaum.map(({ w }) => w?.aufrufe)),
      reichweite: summe(imRaum.map(({ w }) => w?.reichweite)),
      interaktionen: summe(imRaum.map(({ w }) => w?.interaktionen)),
      profilaufrufe: summe(imRaum.map(({ w }) => w?.profilaufrufe)),
      beitraege: eigenePosts.length,
      beitragsAufrufe: summe(metriken.map((m) => m?.aufrufe)),
      beitragsInteraktionen: summe(metriken.flatMap((m) => [m?.likes, m?.kommentare, m?.saves, m?.shares])),
      letzterAbruf: hand?.eingespieltAt ?? status.letzterLauf,
      fehler: status.fehler[platform] ?? "",
      aufrufeHinweis: aufrufeHinweis(platform, imRaum.map(({ w }) => w)),
      verlauf: imRaum.map(({ tag, w }) => ({ tag, aufrufe: w?.aufrufe ?? null, interaktionen: w?.interaktionen ?? null, follower: w?.follower ?? null })),
    };
  })
    // Ein Kanal ohne Zahlen und ohne Beitrag ist eine leere Zeile, die nur
    // Platz kostet — er steht auf der Kanäle-Seite, nicht in der Übersicht.
    .filter((k) => k.messbar || k.vonHand || k.beitraege > 0)
    .sort((a, b) => (b.aufrufe ?? -1) - (a.aufrufe ?? -1) || b.beitraege - a.beitraege);

  // --- Kennzahlen mit Vorperiode ----------------------------------------------
  const zeitraumSumme = (feld: keyof KanalWerte, vonTag: string, bisTag: string): number | null =>
    summe(tageZwischen(vonTag, bisTag).flatMap((tag) => zaehlKanaele.map((p) => jeKanal.get(p)?.get(tag)?.[feld])));
  const klicksIn = (vonTag: string, bisTag: string): number =>
    klickTage.filter((k) => k.code !== BIO_CODE && k.tag >= vonTag && k.tag <= bisTag).reduce((s2, k) => s2 + k.klicks, 0);
  const anmeldungenIn = (vonTag: string, bisTag: string): number =>
    [...anmeldungJeTag.entries()].filter(([tag]) => tag >= vonTag && tag <= bisTag).reduce((s2, [, n]) => s2 + n, 0);
  const gestern = berlinTag(new Date(Date.parse(`${von}T00:00:00Z`) - TAG_MS));

  // Follower gesamt: der Bestand über alle Kanäle, die einen nennen. Der
  // Vergleichswert zählt nur, wenn **jeder** dieser Kanäle auch einen Stand von
  // vorher hat — sonst sähe ein Kanal, der gerade erst zum ersten Mal gemessen
  // wurde, wie ein Zuwachs von null auf fünfundzwanzig aus.
  const mitFollower = kanaele.filter((k) => k.follower !== null);
  const follower = mitFollower.length ? summe(mitFollower.map((k) => k.follower)) : null;
  const followerVorher = mitFollower.length && mitFollower.every((k) => k.followerDavor !== null)
    ? summe(mitFollower.map((k) => k.followerDavor))
    : null;
  // Der Zuwachs dagegen lässt sich auch dann angeben, wenn ein Kanal noch keine
  // Grundlinie von vor dem Zeitraum hat — er zählt dann ab seinem ersten
  // Messtag, und der Hinweis nennt ihn.
  const ohneGrundlinie = mitFollower.filter((k) => !k.followerExakt && k.neueFollower !== null);
  const neueFollower = summe(mitFollower.map((k) => k.neueFollower));
  const beitragsAufrufe = summe(beitraege.map((b) => b.aufrufe));
  const beitragsAufrufeDavor = summe(davor.map((p) => leseMetriken(p)?.aufrufe));

  const kennzahlen: s.CockpitKennzahl[] = [
    { id: "aufrufe", label: "Aufrufe", wert: zeitraumSumme("aufrufe", von, bis), davor: zeitraumSumme("aufrufe", vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Wie oft Inhalte der Kanäle abgespielt oder angezeigt wurden — auch ältere Beiträge." },
    { id: "interaktionen", label: "Interaktionen", wert: zeitraumSumme("interaktionen", von, bis), davor: zeitraumSumme("interaktionen", vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Likes, Kommentare, Speichern und Teilen zusammen." },
    { id: "follower", label: "Follower gesamt", wert: follower, davor: followerVorher, einheit: "zahl", art: "bestand",
      hinweis: `Bestand über alle Kanäle, die eine Followerzahl nennen (${mitFollower.map((k) => k.label).join(", ") || "keiner"}).` },
    { id: "neueFollower", label: "Neue Follower", wert: neueFollower, davor: null, einheit: "zahl", art: "summe",
      hinweis: ohneGrundlinie.length
        ? `Zuwachs im Zeitraum. ${ohneGrundlinie.map((k) => `${k.label} erst ab ${k.followerStartTag}`).join(", ")} — dort ist der Zuwachs eher zu klein als zu groß.`
        : "Zuwachs im Zeitraum über alle Kanäle zusammen." },
    { id: "beitraege", label: "Beiträge", wert: imZeitraum.length, davor: davor.length, einheit: "zahl", art: "summe", hinweis: "Was der Pilot in diesem Zeitraum veröffentlicht hat." },
    { id: "beitragsaufrufe", label: "Aufrufe dieser Beiträge", wert: beitragsAufrufe, davor: beitragsAufrufeDavor, einheit: "zahl", art: "summe", hinweis: "Gesamtstand der im Zeitraum veröffentlichten Beiträge — Meta liefert je Beitrag keine Tageswerte." },
    { id: "klicks", label: "Klicks auf die Seite", wert: klicksIn(von, bis), davor: klicksIn(vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Klicks auf die Kurzlinks des Piloten." },
    { id: "bioaufrufe", label: "Profil-Link geöffnet", wert: bioIn(von, bis), davor: bioIn(vorherVon, gestern), einheit: "zahl", art: "summe", hinweis: "Aufrufe der Link-in-Bio-Seite — auf Instagram und Threads der einzige Weg zur Seite." },
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
    { id: "bio", label: "Profil-Link geöffnet", wert: bioIn(von, bis) || null, erklaerung: "Die Link-in-Bio-Seite — auf Instagram und Threads der einzige Weg weiter." },
    { id: "klicks", label: "Klicks auf die Seite", wert: klicksIn(von, bis), erklaerung: "Über die Kurzlinks des Piloten." },
    { id: "konten", label: "Neue Konten", wert: neueKonten ?? (anmeldungenIn(von, bis) || null), erklaerung: geschaeft ? "Neu angelegte Konten laut Produktdatenbank." : "Anmeldungen aus dem Webhook — ohne Produktdatenquelle die einzige Quelle." },
    { id: "kaeufe", label: "Käufe", wert: geschaeft ? summe(verlauf.map((v) => v.kaeufe)) : (bezahltImZeitraum || null), erklaerung: "Bezahlte Bestellungen im Zeitraum — Abos und Kreditpakete zusammen." },
  ];

  // --- Hinweise ---------------------------------------------------------------
  const ohneZugang = kanaele.filter((k) => k.messbar && !k.eingerichtet).map((k) => k.label);
  if (ohneZugang.length) hinweise.push(`Ohne hinterlegten Zugang keine Zahlen: ${ohneZugang.join(", ")}. Auf der Kanäle-Seite eintragen.`);
  const nichtMessbar = kanaele.filter((k) => !k.messbar && !k.vonHand && k.beitraege > 0).map((k) => k.label);
  // „Der Export ist alt" gilt nur, wenn wirklich jemand einen einspielen muss.
  if (nichtMessbar.length) hinweise.push(`Zahlen nur über einen Export: ${nichtMessbar.join(", ")} — dort gibt es keine Lese-API. Den Analytics-Export unten bei „Kanäle" einspielen.`);
  // „gestern" oben ist der Tag vor dem Zeitraum; hier zählt der Tag vor heute.
  const vortag = berlinTag(new Date(now.getTime() - TAG_MS));
  for (const k of kanaele.filter((x) => x.vonHand && x.standBis && x.standBis < vortag)) {
    const bis = `${k.standBis!.slice(8, 10)}.${k.standBis!.slice(5, 7)}.`;
    hinweise.push(k.messbar
      // Seit der Pilot TikTok selbst abruft, wäre „bitte einen neueren Export
      // einspielen" eine falsche Aufforderung: da muss niemand mehr hin.
      ? `${k.label}: Zahlen aus dem Export reichen bis ${bis} — neuere holt der Tageslauf selbst.`
      : `${k.label}: Zahlen aus dem Export reichen bis ${bis} — neuere Tage fehlen, bis der nächste Export eingespielt ist.`);
  }
  if (!status.letzterLauf) hinweise.push("Die Kanalzahlen wurden noch nie abgerufen. Der Sammler läuft täglich, oder oben von Hand starten.");
  if (kanaele.some((k) => k.platform === "facebook" && k.beitraege > 0)) hinweise.push("Facebook nennt seit Graph v21 keine Aufrufe je Seite mehr (nur Videoaufrufe). Für die Facebook-Seite stehen deshalb Interaktionen und Seitenaufrufe, aber keine Reichweite.");
  const verschwunden = beitraege.filter((b) => /Nicht mehr abrufbar/.test(b.fehler)).length;
  if (verschwunden) hinweise.push(`${verschwunden} Beiträge liefern keine Zahlen mehr — Stories sind nach 24 Stunden weg, und Meta gibt danach auch ihre Zahlen nicht mehr heraus. Wer Story-Zahlen braucht, muss sie am selben Tag abrufen.`);
  if (klicksIn(von, bis) === 0 && bioIn(von, bis) === 0 && imZeitraum.length > 0) hinweise.push("Weder ein Klick auf einen Kurzlink noch ein Aufruf der Bio-Seite. Auf Instagram und Threads sind Links im Text nicht anklickbar — steht die Bio-Seite im Profil?");
  for (const [platform, fehler] of Object.entries(status.fehler)) hinweise.push(`${PLATFORMS[platform]?.label ?? platform}: ${fehler}`);

  // --- Nach Sorte und Uhrzeit ---------------------------------------------------
  // Schnitt je Kanal und Gruppe über die Beiträge mit Zahlen. Stories bleiben
  // draußen: ihre Zahlen sind nach 24 Stunden weg und würden jede Stunde nach
  // unten ziehen, in der eine Story lief.
  const schnitte = (schluessel: (b: s.CockpitBeitrag) => string | null): s.CockpitSchnitt[] => {
    const gruppen = new Map<string, s.CockpitBeitrag[]>();
    for (const b of beitraege) {
      if (b.format === "story" || (b.aufrufe === null && b.reichweite === null)) continue;
      const k = schluessel(b); if (k === null) continue;
      const id = `${b.platform}|${k}`;
      gruppen.set(id, [...(gruppen.get(id) ?? []), b]);
    }
    const mittel = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((a, c) => a + c, 0) / v.length) : null; };
    return [...gruppen.entries()].map(([id, bs]) => {
      const [platform, schluessel] = id.split("|") as [string, string];
      const q = bs.map((b) => b.quote).filter((x): x is number => x !== null);
      return { platform, schluessel, n: bs.length, aufrufe: mittel(bs.map((b) => b.aufrufe)), reichweite: mittel(bs.map((b) => b.reichweite)), quote: q.length ? rund(q.reduce((a, c) => a + c, 0) / q.length, 4) : null };
    }).sort((a, b) => a.platform.localeCompare(b.platform) || (b.aufrufe ?? b.reichweite ?? -1) - (a.aufrufe ?? a.reichweite ?? -1));
  };
  const nachSorte = schnitte((b) => b.postArt || null);
  const nachStunde = schnitte((b) => (b.stunde === null ? null : String(b.stunde).padStart(2, "0")));

  // --- Datenversorgung ----------------------------------------------------------
  // Beantwortet die Frage „kommen die Zahlen eigentlich von selbst?" — und zwar
  // je Kanal, mit Rückstand. Ohne sie fiel im September drei Tage lang nicht
  // auf, dass TikTok gar nicht mehr gemessen wurde.
  /**
   * Was im Zeitraum draußen ist — gepostet **oder** über den Anmelde-Browser
   * eingeplant. Maßgeblich ist der Zeitpunkt, an dem es erscheinen sollte.
   */
  const veroeffentlicht = db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.projectId, projectId)).all()
    .filter((p2) => p2.status === "posted" || (p2.providerRef && p2.status !== "cancelled" && p2.status !== "failed"))
    .filter((p2) => { const stempel = p2.postedAt ?? p2.scheduledAt; const tg = berlinTag(new Date(stempel)); return tg >= von && tg <= bis; });
  const versorgung: s.CockpitVersorgung[] = kanaele.map((k) => {
    const art = VERSORGUNGSWEG[k.platform] ?? { weg: "keine" as const, automatisch: false, takt: "Für diesen Kanal holt der Pilot keine Zahlen." };
    const tageDesKanals = jeKanal.get(k.platform);
    const datenBis = tageDesKanals
      ? [...tageDesKanals.entries()].filter(([, w]) => Object.keys(w).length > 0).map(([tag]) => tag).sort().at(-1) ?? null
      : null;
    const rueckstand = datenBis ? Math.max(0, Math.round((Date.parse(`${vortag}T00:00:00Z`) - Date.parse(`${datenBis}T00:00:00Z`)) / TAG_MS)) : null;
    const hatWert = (feld: keyof KanalWerte): boolean =>
      [...(tageDesKanals?.values() ?? [])].some((w) => typeof w[feld] === "number");
    const liefert: string[] = [];
    const fehlt: string[] = [];
    for (const [feld, name] of GROESSEN) (hatWert(feld) ? liefert : fehlt).push(name);
    // Nicht nur `status === "posted"`: TikTok und YouTube werden über den
    // Anmelde-Browser **vorgeplant** und bleiben dort absichtlich auf
    // „geplant" stehen (siehe `laufVermerken`). Zählte man nur Gepostetes,
    // stünde ausgerechnet bei den beiden Kanälen, um die es hier geht, „–".
    const eigene = veroeffentlicht.filter((p2) => p2.platform === k.platform);
    const mitZahlen = eigene.filter((p2) => { const m = leseMetriken(p2); return typeof m?.aufrufe === "number"; }).length;
    const status2: "ok" | "spaet" | "fehlt" =
      art.weg === "keine" || !k.eingerichtet ? "fehlt"
        : rueckstand === null || rueckstand > 1 ? "spaet"
          : "ok";
    return {
      platform: k.platform, label: k.label, weg: art.weg, automatisch: art.automatisch, takt: art.takt,
      letzterAbruf: k.letzterAbruf, datenBis, rueckstand, status: status2,
      liefert, fehlt, beitraegeMitZahlen: mitZahlen, beitraegeGesamt: eigene.length,
    };
  });
  const nichtAutomatisch = versorgung.filter((v) => v.status !== "fehlt" && !v.automatisch).map((v) => v.label);
  if (nichtAutomatisch.length) hinweise.push(`Kommt nicht von selbst herein: ${nichtAutomatisch.join(", ")}.`);
  // Kanalzahlen und Beitragszahlen sind zweierlei: TikTok liefert den Kanal
  // vollständig und je Beitrag gar nichts.
  for (const v of versorgung.filter((x) => x.beitraegeGesamt >= 3 && x.beitraegeMitZahlen === 0)) {
    hinweise.push(`${v.label}: für keinen der ${v.beitraegeGesamt} Beiträge im Zeitraum gibt es Zahlen je Beitrag — dort misst der Pilot nur den Kanal als Ganzes.`);
  }
  for (const v of versorgung.filter((x) => x.automatisch && x.status === "spaet")) {
    hinweise.push(`${v.label}: der Stand reicht nur bis ${v.datenBis ? `${v.datenBis.slice(8, 10)}.${v.datenBis.slice(5, 7)}.` : "nirgendwohin"} — der Tageslauf holt dort gerade nichts.`);
  }

  return {
    zeitraum: { von, bis, tage: opts.tage },
    kennzahlen, verlauf, kanaele, beitraege, trichter, produkt, hinweise,
    kanalStatus: { letzterLauf: status.letzterLauf, laeuft: false },
    nachSorte, nachStunde, versorgung,
  };
}

/** Wie viele Tage der Verlauf überhaupt hergibt — für den Hinweis „erst seit X Tagen gemessen". */
export function ersterMesstag(db: Db, projectId: string): string | null {
  const rows = db.select({ tag: t.mpKanalStats.tag }).from(t.mpKanalStats).where(eq(t.mpKanalStats.projectId, projectId)).all();
  return rows.length ? rows.map((r) => r.tag).sort()[0]! : null;
}

export { parseJson };
