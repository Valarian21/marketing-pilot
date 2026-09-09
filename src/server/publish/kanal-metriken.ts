/**
 * Was die Plattformen über den **Kanal** melden — Follower, Aufrufe,
 * Reichweite, Profilaufrufe, Tag für Tag.
 *
 * `metrics.ts` beantwortet „wie lief dieser Beitrag?", dieses Modul „wie läuft
 * dieses Konto?". Ohne die zweite Frage sind die Zahlen der ersten nicht
 * einzuordnen: ein Konto bekommt auch an Tagen Aufrufe, an denen der Pilot
 * nichts gepostet hat (Profil, Suche, alte Beiträge), und ein Beitrag, der
 * Follower bringt, sieht in seinen eigenen Zahlen aus wie jeder andere.
 *
 * **Was Meta wirklich herausgibt** (gemessen am 09.09.2026 gegen Graph v21 mit
 * den Tokens des Binderplan-Kontos, nicht aus der Doku abgeschrieben):
 *
 * | Plattform | Tagesreihe | nur als Summe über ein Zeitfenster |
 * |---|---|---|
 * | Instagram | `reach` | `views`, `profile_views`, `website_clicks`, `accounts_engaged`, `total_interactions` (alle mit `metric_type=total_value`) |
 * | Facebook-Seite | `page_views_total`, `page_post_engagements`, `page_daily_follows`, `page_video_views`, `page_follows` | – |
 *
 * Facebook hat damit **keine Aufrufe je Seite mehr**: `page_video_views` zählt
 * nur Videos, und ein Foto-Beitrag taucht darin gar nicht auf. Die Zahl wird
 * deshalb als `videoAufrufe` geführt und nicht in die Aufrufe gemischt — sonst
 * stünde bei einer Seite mit Bildbeiträgen eine Null, die wie „niemand hat es
 * gesehen" aussieht, obwohl Meta die Zahl schlicht nicht mehr herausgibt.
 * | Threads | `views` (= Profilaufrufe) | `likes`, `replies`, `reposts`, `quotes`, `followers_count` |
 *
 * Abgeschafft und deshalb nicht abgefragt: `page_impressions*`, `page_fans`,
 * `page_fan_adds` („The value must be a valid insights metric"), und
 * `follower_count` auf Instagram liefert für kleine Konten leere Daten.
 *
 * Daraus folgt der Aufbau: die Tagesreihen füllen bis zu 30 Tage rückwirkend
 * in einem Aufruf, die Summen-Metriken brauchen **je Tag** ein eigenes
 * Zeitfenster. Deshalb holt ein Lauf nur die jüngsten fehlenden Tage nach
 * (`MAX_NACHHOLEN`) — nach ein paar Läufen ist die Historie voll, und ab dann
 * schreibt der Pilot sie selbst fort, auch wenn Meta die Vergangenheit längst
 * nicht mehr herausgibt.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import * as t from "../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../db/index.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const THREADS = "https://graph.threads.net/v1.0";
const TIMEOUT = 30_000;
const TAG_MS = 86_400_000;
/** Weiter zurück gibt Meta ohnehin nichts heraus. */
const RUECKBLICK_TAGE = 30;
/** Fenster-Abrufe je Lauf und Plattform — ein Request je Tag, deshalb gedeckelt. */
const MAX_NACHHOLEN = 8;

/**
 * Die Kanalzahlen eines Tages, plattformunabhängig benannt.
 *
 * Jede Plattform füllt nur, was sie kennt; `null` gibt es hier nicht, ein
 * fehlendes Feld bleibt schlicht weg. Das ist der Unterschied zwischen „null
 * Aufrufe" und „diese Plattform kennt keine Aufrufe", und beides muss die
 * Anzeige auseinanderhalten können.
 */
export interface KanalWerte {
  /** Bestand am Ende des Tages, nicht der Zuwachs. */
  follower?: number | undefined;
  /** Zuwachs des Tages, wo die Plattform ihn nennt (Facebook). */
  neueFollower?: number | undefined;
  /** Konten, die etwas des Kanals gesehen haben. */
  reichweite?: number | undefined;
  /** Aufrufe/Wiedergaben aller Inhalte des Kanals. */
  aufrufe?: number | undefined;
  profilaufrufe?: number | undefined;
  /** Likes, Kommentare, Speichern, Teilen zusammen. */
  interaktionen?: number | undefined;
  /** Tipps auf den Link im Profil. */
  linkklicks?: number | undefined;
  /** Konten, die interagiert haben (Instagram). */
  engagierteKonten?: number | undefined;
  /** Nur Videos (Facebook) — ausdrücklich nicht dasselbe wie `aufrufe`. */
  videoAufrufe?: number | undefined;
  /** Anzahl Beiträge auf dem Konto (Bestand). */
  beitraege?: number | undefined;
}

export interface KanalTag { tag: string; werte: KanalWerte }
export interface KanalErgebnis { platform: string; tage: number; fehler?: string }

const zahl = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const datum = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const sek = (ms: number): number => Math.floor(ms / 1000);

interface GraphEintrag { name?: string; values?: { value?: unknown; end_time?: string }[]; total_value?: { value?: unknown } }
interface GraphAntwort { data?: GraphEintrag[]; error?: { message?: string; code?: number } }

async function graph<T>(f: typeof fetch, url: string): Promise<T> {
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

/**
 * Aus einer Tagesreihe `{name, values:[{value, end_time}]}` das Tagesraster.
 *
 * Meta stempelt einen Tageswert mit dem **Ende** des Tages in der Zeitzone des
 * Kontos (hier 07:00 UTC, also amerikanische Westküste). Der Wert gehört
 * deshalb zum Vortag dieses Stempels — und genau dieses Raster wird auch für
 * die Fenster der Summen-Metriken wiederverwendet, damit beide Zahlenarten
 * denselben Tag meinen.
 */
export function raster(eintrag: GraphEintrag | undefined): { tag: string; endeMs: number; wert: number | undefined }[] {
  return (eintrag?.values ?? []).flatMap((v) => {
    const endeMs = Date.parse(v.end_time ?? "");
    if (!Number.isFinite(endeMs)) return [];
    return [{ tag: datum(endeMs - TAG_MS), endeMs, wert: zahl(v.value) }];
  });
}

/** Erster Eintrag mit diesem Namen. */
const nach = (b: GraphAntwort, name: string): GraphEintrag | undefined => (b.data ?? []).find((e) => e.name === name);

/** Summen-Metriken einer Antwort als `{name: wert}`. */
function summen(b: GraphAntwort): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of b.data ?? []) {
    const v = zahl(e.total_value?.value);
    if (e.name && v !== undefined) out[e.name] = v;
  }
  return out;
}

/** Werte zweier Quellen für denselben Tag zusammenlegen; gesetzte Felder gewinnen. */
const misch = (a: KanalWerte, b: KanalWerte): KanalWerte => ({ ...a, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) });

interface Abruf {
  creds: Record<string, string>;
  f: typeof fetch;
  /** Tage, für die noch Fenster-Werte fehlen (neueste zuerst), mit ihrem Raster. */
  fehlend: (tag: string) => boolean;
  heute: string;
}

// --- Instagram ---------------------------------------------------------------

export async function instagramKanal({ creds, f, fehlend, heute }: Abruf): Promise<KanalTag[]> {
  const user = creds["igUserId"] ?? "";
  const token = encodeURIComponent(creds["accessToken"] ?? "");
  if (!user || !token) throw new Error("Instagram: igUserId oder Zugriffstoken fehlt.");
  const jetzt = Date.now();
  const je = new Map<string, KanalWerte>();

  // 1. Bestand: Follower und Anzahl Beiträge gelten für heute.
  const konto = await graph<{ followers_count?: number; media_count?: number }>(f, `${GRAPH}/${user}?fields=followers_count,media_count&access_token=${token}`);
  je.set(heute, { follower: zahl(konto.followers_count), beitraege: zahl(konto.media_count) });

  // 2. Reichweite als Tagesreihe — die einzige Metrik, die Instagram je Tag herausgibt.
  const reihe = await graph<GraphAntwort>(f, `${GRAPH}/${user}/insights?metric=reach&period=day&since=${sek(jetzt - RUECKBLICK_TAGE * TAG_MS)}&until=${sek(jetzt)}&access_token=${token}`);
  const tage = raster(nach(reihe, "reach"));
  for (const r of tage) if (r.wert !== undefined) je.set(r.tag, misch(je.get(r.tag) ?? {}, { reichweite: r.wert }));

  // 3. Alles andere nur je Zeitfenster, also ein Request pro Tag. Neueste zuerst,
  //    gedeckelt — der nächste Lauf holt den Rest.
  const offen = tage.filter((r) => fehlend(r.tag)).sort((a, b) => b.endeMs - a.endeMs).slice(0, MAX_NACHHOLEN);
  for (const r of offen) {
    const b = await graph<GraphAntwort>(f, `${GRAPH}/${user}/insights?metric=views,profile_views,website_clicks,accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${sek(r.endeMs - TAG_MS)}&until=${sek(r.endeMs)}&access_token=${token}`);
    const s = summen(b);
    je.set(r.tag, misch(je.get(r.tag) ?? {}, {
      aufrufe: s["views"], profilaufrufe: s["profile_views"], linkklicks: s["website_clicks"],
      engagierteKonten: s["accounts_engaged"], interaktionen: s["total_interactions"],
    }));
  }
  return [...je.entries()].map(([tag, werte]) => ({ tag, werte }));
}

// --- Facebook-Seite ----------------------------------------------------------

/** Alle noch gültigen Tagesmetriken der Seite. Was Meta abgeschafft hat, steht bewusst nicht hier. */
const FB_REIHEN: Record<string, keyof KanalWerte> = {
  page_views_total: "profilaufrufe",
  page_post_engagements: "interaktionen",
  page_daily_follows: "neueFollower",
  page_video_views: "videoAufrufe",
  page_follows: "follower",
};

export async function facebookKanal({ creds, f, heute }: Abruf): Promise<KanalTag[]> {
  const page = creds["pageId"] ?? "";
  const token = encodeURIComponent(creds["accessToken"] ?? "");
  if (!page || !token) throw new Error("Facebook: pageId oder Seiten-Zugriffstoken fehlt.");
  const jetzt = Date.now();
  const je = new Map<string, KanalWerte>();

  const konto = await graph<{ followers_count?: number; fan_count?: number }>(f, `${GRAPH}/${page}?fields=followers_count,fan_count&access_token=${token}`);
  const follower = zahl(konto.followers_count) ?? zahl(konto.fan_count);
  if (follower !== undefined) je.set(heute, { follower });

  const b = await graph<GraphAntwort>(f, `${GRAPH}/${page}/insights?metric=${Object.keys(FB_REIHEN).join(",")}&period=day&since=${sek(jetzt - RUECKBLICK_TAGE * TAG_MS)}&until=${sek(jetzt)}&access_token=${token}`);
  for (const [metrik, feld] of Object.entries(FB_REIHEN)) {
    for (const r of raster(nach(b, metrik))) {
      if (r.wert === undefined) continue;
      je.set(r.tag, misch(je.get(r.tag) ?? {}, { [feld]: r.wert }));
    }
  }
  return [...je.entries()].map(([tag, werte]) => ({ tag, werte }));
}

// --- Threads -----------------------------------------------------------------

export async function threadsKanal({ creds, f, fehlend, heute }: Abruf): Promise<KanalTag[]> {
  const user = creds["userId"] ?? "";
  const token = encodeURIComponent(creds["accessToken"] ?? "");
  if (!user || !token) throw new Error("Threads: userId oder Zugriffstoken fehlt.");
  const jetzt = Date.now();
  const je = new Map<string, KanalWerte>();

  // `views` heißt bei Threads auf Kontoebene ausdrücklich „so oft wurde dein
  // Profil aufgerufen" — also Profilaufrufe, nicht Inhalts-Aufrufe.
  const reihe = await graph<GraphAntwort>(f, `${THREADS}/${user}/threads_insights?metric=views&since=${sek(jetzt - RUECKBLICK_TAGE * TAG_MS)}&until=${sek(jetzt)}&access_token=${token}`);
  const tage = raster(nach(reihe, "views"));
  for (const r of tage) if (r.wert !== undefined) je.set(r.tag, misch(je.get(r.tag) ?? {}, { profilaufrufe: r.wert }));

  const offen = tage.filter((r) => fehlend(r.tag)).sort((a, b) => b.endeMs - a.endeMs).slice(0, MAX_NACHHOLEN);
  for (const r of offen) {
    const b = await graph<GraphAntwort>(f, `${THREADS}/${user}/threads_insights?metric=likes,replies,reposts,quotes&since=${sek(r.endeMs - TAG_MS)}&until=${sek(r.endeMs)}&access_token=${token}`);
    const s = summen(b);
    const interaktionen = ["likes", "replies", "reposts", "quotes"].reduce<number | undefined>((sum, k) => (s[k] === undefined ? sum : (sum ?? 0) + s[k]!), undefined);
    je.set(r.tag, misch(je.get(r.tag) ?? {}, { interaktionen }));
  }

  // Follower-Bestand: Threads gibt ihn nur als Summe, ohne Verlauf.
  const stand = await graph<GraphAntwort>(f, `${THREADS}/${user}/threads_insights?metric=followers_count&access_token=${token}`);
  const follower = zahl(summen(stand)["followers_count"]);
  if (follower !== undefined) je.set(heute, misch(je.get(heute) ?? {}, { follower }));

  return [...je.entries()].map(([tag, werte]) => ({ tag, werte }));
}

const ABRUFE: Record<string, (a: Abruf) => Promise<KanalTag[]>> = {
  instagram: instagramKanal,
  facebook: facebookKanal,
  threads: threadsKanal,
};

/** Kanäle, deren Zahlen der Pilot selbst holen kann. */
export const MESSBARE_KANAELE = Object.keys(ABRUFE);

// --- Speicher ----------------------------------------------------------------

export function leseKanalTage(db: Db, projectId: string, seitTag: string): (typeof t.mpKanalStats.$inferSelect & { parsed: KanalWerte })[] {
  return db.select().from(t.mpKanalStats)
    .where(and(eq(t.mpKanalStats.projectId, projectId), gte(t.mpKanalStats.tag, seitTag)))
    .all().map((r) => ({ ...r, parsed: parseJson<KanalWerte>(r.werte, {}) }));
}

/**
 * Einen Tag schreiben. Vorhandene Felder bleiben stehen, wenn der neue Abruf
 * sie nicht kennt — sonst würde der Nachlauf der Reichweite die Aufrufe des
 * Vortags löschen.
 */
export function schreibeKanalTag(db: Db, projectId: string, platform: string, tag: string, werte: KanalWerte, now = new Date()): void {
  const alt = db.select().from(t.mpKanalStats)
    .where(and(eq(t.mpKanalStats.projectId, projectId), eq(t.mpKanalStats.platform, platform), eq(t.mpKanalStats.tag, tag))).get();
  const neu = misch(alt ? parseJson<KanalWerte>(alt.werte, {}) : {}, werte);
  if (alt) db.update(t.mpKanalStats).set({ werte: toJson(neu), abgerufenAt: now.toISOString() }).where(eq(t.mpKanalStats.id, alt.id)).run();
  else db.insert(t.mpKanalStats).values({ id: newId(), projectId, platform, tag, werte: toJson(neu), quelle: "api", abgerufenAt: now.toISOString() }).run();
}

/** Letzter Lauf und letzter Fehler je Plattform — steht wörtlich im UI. */
export interface KanalStatus { letzterLauf: string | null; fehler: Record<string, string> }
const statusKey = (projectId: string) => `kanalstats:${projectId}`;

export function leseKanalStatus(db: Db, projectId: string): KanalStatus {
  const row = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, statusKey(projectId))).get();
  // Der Fallback von `parseJson` greift nur bei kaputtem JSON — ein fehlender
  // Eintrag ergibt ein leeres Objekt, und dessen `fehler` wäre `undefined`.
  // Deshalb die Felder hier ausdrücklich auffüllen.
  const roh = parseJson<Partial<KanalStatus>>(row?.value ?? "{}", {});
  return { letzterLauf: roh.letzterLauf ?? null, fehler: roh.fehler ?? {} };
}

function schreibeKanalStatus(db: Db, projectId: string, status: KanalStatus): void {
  const wert = toJson(status);
  db.insert(t.mpSettings).values({ key: statusKey(projectId), value: wert, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: wert, updatedAt: nowIso() } }).run();
}

export interface KanalContext {
  db: Db;
  creds: (platform: string) => Record<string, string>;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
  now?: () => Date;
}

/**
 * Einen Durchlauf über alle eingerichteten Kanäle machen.
 *
 * Ein Kanal, dessen Token abgelaufen ist, darf die anderen nicht aufhalten:
 * der Fehler landet im Status und wird im UI neben dem Kanal angezeigt, statt
 * den ganzen Lauf zu beenden.
 */
export async function holeKanalStats(ctx: KanalContext, projectId: string): Promise<KanalErgebnis[]> {
  const now = ctx.now?.() ?? new Date();
  const f = ctx.fetchImpl ?? fetch;
  const heute = datum(now.getTime());
  const out: KanalErgebnis[] = [];
  const status: KanalStatus = { letzterLauf: now.toISOString(), fehler: {} };

  for (const [platform, abruf] of Object.entries(ABRUFE)) {
    const creds = ctx.creds(platform);
    if (!creds["accessToken"]) continue;
    // Welche Tage schon Fenster-Werte haben: alles, was `interaktionen` kennt,
    // wurde bereits einzeln abgefragt.
    const bekannt = new Set(db_tageMitFensterwerten(ctx.db, projectId, platform));
    try {
      const tage = await abruf({ creds, f, heute, fehlend: (tag) => !bekannt.has(tag) && tag !== heute });
      for (const { tag, werte } of tage) schreibeKanalTag(ctx.db, projectId, platform, tag, werte, now);
      out.push({ platform, tage: tage.length });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      ctx.log?.(`Kanalzahlen ${platform}: ${text}`);
      status.fehler[platform] = text.slice(0, 300);
      out.push({ platform, tage: 0, fehler: text.slice(0, 300) });
    }
  }
  schreibeKanalStatus(ctx.db, projectId, status);
  return out;
}

/**
 * Tage, für die schon ein Fenster-Abruf lief.
 *
 * Der laufende Tag zählt bewusst nicht dazu: seine Zahlen wachsen noch, er
 * wird bei jedem Lauf neu geholt.
 */
function db_tageMitFensterwerten(db: Db, projectId: string, platform: string): string[] {
  return db.select().from(t.mpKanalStats)
    .where(and(eq(t.mpKanalStats.projectId, projectId), eq(t.mpKanalStats.platform, platform)))
    .orderBy(desc(t.mpKanalStats.tag)).all()
    .filter((r) => {
      const w = parseJson<KanalWerte>(r.werte, {});
      return w.interaktionen !== undefined || w.aufrufe !== undefined;
    })
    .map((r) => r.tag);
}
