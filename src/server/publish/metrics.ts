/**
 * Was die Plattform über einen abgesetzten Beitrag meldet.
 *
 * Bis hierher wusste der Pilot nur, was **er** gemessen hat: Klicks auf den
 * Kurzlink und Signups über UTM. Beides sagt nichts darüber, ob ein Beitrag
 * überhaupt gesehen wurde — ein Reel mit 40.000 Aufrufen und null Klicks und
 * eines mit 200 Aufrufen und null Klicks sehen in der Insights-Seite gleich
 * aus, sind aber zwei völlig verschiedene Befunde.
 *
 * Die Einheit ist der **Beitrag auf der Plattform** (`mp_scheduled_posts`),
 * nicht das Stück: dasselbe Carousel läuft auf Instagram und Facebook und hat
 * dort zwei verschiedene Reichweiten. Die Media-ID dafür steht seit Shot 10
 * ohnehin schon als `provider_ref` in der Zeile.
 *
 * **Berechtigungen.** Ohne `instagram_manage_insights` bzw. `read_insights`
 * antwortet Meta mit 400, und zwar für jeden Beitrag gleich. Der Abruf
 * schreibt das dann einmal je Eintrag als `error` in die Metriken, statt es
 * stumm zu schlucken — sonst sucht man den Grund im Code.
 */
import { and, eq } from "drizzle-orm";
import * as t from "../db/schema.js";
import { newId, parseJson, toJson, type Db } from "../db/index.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT = 30_000;
const DAY = 86_400_000;

/**
 * Die Zahlen eines Beitrags, plattformunabhängig benannt.
 *
 * Meta nennt dasselbe je nach Medientyp anders (`reach` beim Carousel,
 * `views` beim Reel, `post_media_view` auf der Seite). Übersetzt wird
 * hier, damit die Anzeige eine Tabelle bleibt und nicht drei.
 */
export interface PostMetrics {
  /** Wie viele Konten den Beitrag gesehen haben. */
  reichweite: number | null;
  /** Aufrufe/Wiedergaben — bei Videos die aussagekräftigere Zahl. */
  aufrufe: number | null;
  likes: number | null;
  kommentare: number | null;
  /** Gespeichert — auf Instagram das stärkste Signal für „nützlich". */
  saves: number | null;
  shares: number | null;
  /** Was nicht übersetzt wurde, unverändert. Für Nachschauen, nicht für die Anzeige. */
  roh?: Record<string, number>;
  /** Gesetzt, wenn der Abruf scheiterte — der Text steht wörtlich im UI. */
  fehler?: string;
  /** `api` oder `hand` — von wem die Zahlen stammen. */
  quelle: "api" | "hand";
}

export const LEERE_METRIKEN: PostMetrics = { reichweite: null, aufrufe: null, likes: null, kommentare: null, saves: null, shares: null, quelle: "api" };

const zahl = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Instagram-Metriken je Medium.
 *
 * Die Namensliste ist absichtlich zweistufig: Meta lehnt eine **ganze**
 * Abfrage ab, sobald eine einzige Metrik zum Medientyp nicht passt (Fehler
 * 100, „metric[0] must be one of the following values"). Ein Reel kennt
 * `views`, ein Bild nicht; ein Carousel kennt kein `saved`. Deshalb erst der
 * volle Satz, und bei genau diesem Fehler noch einmal mit dem kleinsten
 * gemeinsamen Nenner.
 */
const IG_VOLL = ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions"];
const IG_SPARSAM = ["reach", "likes", "comments"];

// Meta hat `post_impressions*` für Beiträge abgeschafft (Graph v21, gemessen
// am 08.09.2026: „must be a valid insights metric"). Übrig bleiben Aufrufe des
// Mediums und Klicks; eine eindeutige Reichweite je Beitrag gibt es nicht mehr.
const FB_METRIKEN = ["post_media_view", "post_clicks"];

interface Graph { data?: { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[]; error?: { message?: string; code?: number } }

async function graph(f: typeof fetch, url: string): Promise<Graph> {
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const body = (await res.json().catch(() => ({}))) as Graph;
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

/** Aus der Graph-Antwort ein flaches `{name: zahl}`. */
export function flach(body: Graph): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of body.data ?? []) {
    // Instagram und Facebook antworten mit `values`, Threads mit `total_value`.
    const wert = e.values?.[0]?.value ?? e.total_value?.value;
    if (e.name && typeof wert === "number") out[e.name] = wert;
  }
  return out;
}

export async function instagramMetriken(mediaId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PostMetrics> {
  const hol = async (metriken: string[]) =>
    flach(await graph(fetchImpl, `${GRAPH}/${mediaId}/insights?metric=${metriken.join(",")}&access_token=${encodeURIComponent(token)}`));
  let roh: Record<string, number>;
  try { roh = await hol(IG_VOLL); }
  catch (e) {
    // Nur der Metrik-Streit rechtfertigt einen zweiten Versuch. Ein fehlendes
    // Recht bleibt ein fehlendes Recht, egal wie kurz die Liste ist.
    const text = e instanceof Error ? e.message : String(e);
    // Fehler 10 „Not enough viewers": Meta hält die Zahlen zurück, bis ein
    // Beitrag genug Konten erreicht hat. Das ist kein Rechteproblem und wird
    // beim nächsten fälligen Abruf einfach noch einmal versucht.
    if (/not enough viewers/i.test(text)) return { ...LEERE_METRIKEN, fehler: "Noch zu wenige Zuschauer — Meta zeigt Zahlen erst ab einer Mindestgröße." };
    if (!/must be one of|does not support|not available/i.test(text)) throw e;
    roh = await hol(IG_SPARSAM);
  }
  return {
    reichweite: zahl(roh["reach"]),
    aufrufe: zahl(roh["views"]),
    likes: zahl(roh["likes"]),
    kommentare: zahl(roh["comments"]),
    saves: zahl(roh["saved"]),
    shares: zahl(roh["shares"]),
    roh, quelle: "api",
  };
}

export async function facebookMetriken(postId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PostMetrics> {
  const roh = flach(await graph(fetchImpl, `${GRAPH}/${postId}/insights?metric=${FB_METRIKEN.join(",")}&access_token=${encodeURIComponent(token)}`));
  // Reaktionen und Kommentare stehen nicht in den Insights, sondern am Beitrag selbst.
  let likes: number | null = null, kommentare: number | null = null, shares: number | null = null;
  try {
    const res = await graph(fetchImpl, `${GRAPH}/${postId}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares&access_token=${encodeURIComponent(token)}`) as unknown as {
      reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number };
    };
    likes = zahl(res.reactions?.summary?.total_count);
    kommentare = zahl(res.comments?.summary?.total_count);
    shares = zahl(res.shares?.count);
  } catch { /* Insights stehen, die Zaehlwerte sind Kuer */ }
  return {
    reichweite: null,
    aufrufe: zahl(roh["post_media_view"]),
    likes, kommentare, saves: null, shares,
    roh, quelle: "api",
  };
}

const THREADS = "https://graph.threads.net/v1.0";

/**
 * Threads-Beiträge.
 *
 * Eigener Host, eigenes Token, und die Zahlen kommen als `total_value` statt
 * als Zeitreihe. „Views" ist hier die Wiedergabe des Beitrags — anders als auf
 * Kontoebene, wo dasselbe Wort die Profilaufrufe meint. Eine Reichweite je
 * Beitrag kennt Threads nicht.
 */
export async function threadsMetriken(mediaId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PostMetrics> {
  const body = await graph(fetchImpl, `${THREADS}/${mediaId}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${encodeURIComponent(token)}`);
  const roh = flach(body);
  return {
    reichweite: null,
    aufrufe: zahl(roh["views"]),
    likes: zahl(roh["likes"]),
    kommentare: zahl(roh["replies"]),
    saves: null,
    // Reposts und Zitate sind beides Weitergaben; getrennt anzuzeigen hilft
    // niemandem, der drei Plattformen nebeneinander liest.
    shares: [roh["reposts"], roh["quotes"], roh["shares"]].reduce<number | null>((s, v) => (typeof v === "number" ? (s ?? 0) + v : s), null),
    roh, quelle: "api",
  };
}

/**
 * Welche Einträge einen Abruf brauchen.
 *
 * Zahlen wachsen nach dem Posten schnell und danach kaum noch. Deshalb: die
 * ersten sieben Tage täglich, danach ein letzter Abruf nach 30 Tagen, und dann
 * nie wieder — ein Beitrag von 2026 muss nicht jede Nacht abgefragt werden.
 */
export function faelligeMetriken(db: Db, projectId: string, now = new Date()): (typeof t.mpScheduledPosts.$inferSelect)[] {
  return db.select().from(t.mpScheduledPosts).where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.status, "posted"))).all()
    .filter((r) => {
      if (!r.providerRef || !r.postedAt) return false;
      const alter = now.getTime() - Date.parse(r.postedAt);
      if (!Number.isFinite(alter) || alter < 0 || alter > 31 * DAY) return false;
      if (!r.metricsAt) return true;
      const seit = now.getTime() - Date.parse(r.metricsAt);
      return alter <= 7 * DAY ? seit >= 20 * 3600_000 : seit >= 7 * DAY;
    });
}

export function schreibeMetriken(db: Db, id: string, m: PostMetrics, now = new Date()): void {
  db.update(t.mpScheduledPosts).set({ metrics: toJson(m), metricsAt: now.toISOString() })
    .where(eq(t.mpScheduledPosts.id, id)).run();
  schreibeVerlauf(db, id, m, now);
}

/**
 * Einen Punkt in den Verlauf legen — höchstens einen je Beitrag und Tag.
 *
 * Der Stand in `mp_scheduled_posts` wird bei jedem Abruf überschrieben; ohne
 * diese Spur ließe sich nie sagen, ob ein Beitrag am ersten Tag lief oder erst
 * eine Woche später. Gescheiterte Abrufe kommen nicht hinein: eine Lücke ist
 * ehrlicher als eine Null.
 */
export function schreibeVerlauf(db: Db, postId: string, m: PostMetrics, now = new Date()): void {
  if (m.fehler) return;
  const werte = { reichweite: m.reichweite, aufrufe: m.aufrufe, likes: m.likes, kommentare: m.kommentare, saves: m.saves, shares: m.shares };
  if (Object.values(werte).every((v) => v === null || v === undefined)) return;
  const tag = now.toISOString().slice(0, 10);
  const vorhanden = db.select().from(t.mpPostVerlauf).where(eq(t.mpPostVerlauf.postId, postId)).all()
    .find((r) => r.gemessenAm.slice(0, 10) === tag);
  if (vorhanden) db.update(t.mpPostVerlauf).set({ werte: toJson(werte), gemessenAm: now.toISOString() }).where(eq(t.mpPostVerlauf.id, vorhanden.id)).run();
  else db.insert(t.mpPostVerlauf).values({ id: newId(), postId, gemessenAm: now.toISOString(), werte: toJson(werte) }).run();
}

/**
 * Was Meta meldet, in einem Satz, der weiterhilft.
 *
 * Die Rohmeldungen sind für Entwickler geschrieben und stehen sonst in voller
 * Länge in der Tabelle: „Unsupported get request. Object with ID '1784…' does
 * not exist, cannot be loaded due to missing permissions…" — dahinter steckt
 * fast immer eine Story, die nach 24 Stunden samt ihren Zahlen verschwunden
 * ist. Übersetzt wird beim **Lesen**, damit auch alte Einträge davon
 * profitieren; der Rohtext bleibt in der Datenbank.
 */
export function fehlerKlartext(text: string): string {
  if (!text) return "";
  if (/does not exist|cannot be loaded/i.test(text)) return "Nicht mehr abrufbar — Stories verschwinden nach 24 Stunden, ihre Zahlen mit ihnen.";
  if (/not enough viewers/i.test(text)) return "Noch zu wenige Zuschauer — Meta zeigt Zahlen erst ab einer Mindestgröße.";
  if (/instagram_manage_insights|read_insights|permission/i.test(text)) return "Dem Zugang fehlt ein Recht: Instagram braucht instagram_manage_insights, die Seite read_insights.";
  if (/expired|session has been invalidated|access token/i.test(text)) return "Der Zugang ist abgelaufen — Token neu holen und auf der Kanäle-Seite eintragen.";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function leseMetriken(row: { metrics: string }): PostMetrics | null {
  const m = parseJson<Partial<PostMetrics>>(row.metrics, {});
  if (!Object.keys(m).length) return null;
  const out: PostMetrics = { ...LEERE_METRIKEN, ...m };
  if (out.fehler) out.fehler = fehlerKlartext(out.fehler);
  return out;
}

export interface MetrikContext {
  db: Db;
  /** Zugangsdaten je Plattform des Projekts. */
  creds: (platform: string) => Record<string, string>;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
  now?: () => Date;
}

/**
 * Einen Durchlauf machen. Ein Fehler an einem Beitrag hält die anderen nicht
 * auf — er wird an dem Beitrag vermerkt, an dem er auftrat.
 */
export async function holeMetriken(ctx: MetrikContext, projectId: string): Promise<{ geholt: number; gescheitert: number }> {
  const now = ctx.now?.() ?? new Date();
  const f = ctx.fetchImpl ?? fetch;
  let geholt = 0, gescheitert = 0;
  for (const row of faelligeMetriken(ctx.db, projectId, now)) {
    const token = ctx.creds(row.platform)["accessToken"] ?? "";
    if (!token) continue;
    try {
      const m = row.platform === "instagram" ? await instagramMetriken(row.providerRef!, token, f)
        : row.platform === "facebook" ? await facebookMetriken(row.providerRef!, token, f)
          : row.platform === "threads" ? await threadsMetriken(row.providerRef!, token, f)
            : null;
      if (!m) continue;
      schreibeMetriken(ctx.db, row.id, m, now);
      geholt++;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      ctx.log?.(`${row.platform} ${row.providerRef}: ${text}`);
      schreibeMetriken(ctx.db, row.id, { ...LEERE_METRIKEN, fehler: text.slice(0, 300) }, now);
      gescheitert++;
    }
  }
  return { geholt, gescheitert };
}

/**
 * Zahlen von Hand eintragen.
 *
 * Der einzige Weg für TikTok: ohne bestandenen Content-Posting-Audit gibt es
 * dort keine API, weder zum Posten noch zum Lesen. Die Zahlen stehen im
 * TikTok-Analytics-Bildschirm und werden hier abgeschrieben — `quelle: "hand"`
 * hält den Unterschied fest, damit niemand sie später für gemessen hält.
 */
export function metrikenVonHand(db: Db, id: string, werte: { [K in keyof PostMetrics]?: PostMetrics[K] | undefined }, now = new Date()): PostMetrics {
  const row = db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.id, id)).get();
  if (!row) throw Object.assign(new Error("Eintrag nicht gefunden."), { statusCode: 404 });
  // Nicht mitgeschickte Felder behalten ihren Wert: wer nur die Aufrufe
  // nachtraegt, soll nicht die Likes von gestern loeschen.
  const gesetzt = Object.fromEntries(Object.entries(werte).filter(([, v]) => v !== undefined));
  const m: PostMetrics = { ...LEERE_METRIKEN, ...leseMetriken(row), ...gesetzt, quelle: "hand" };
  delete m.fehler;
  schreibeMetriken(db, id, m, now);
  return m;
}
