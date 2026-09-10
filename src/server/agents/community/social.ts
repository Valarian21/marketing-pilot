/**
 * Fremde Beiträge auf Threads und Instagram finden — und auf Threads antworten.
 *
 * Der Radar (`radar.ts`) las bisher Reddit, Hacker News und RSS: Quellen ohne
 * Zugangsdaten, bei denen Antworten grundsätzlich Handarbeit bleibt. Dieses
 * Modul ergänzt die beiden Kanäle, auf denen unser Publikum wirklich sitzt —
 * mit einem entscheidenden Unterschied zwischen ihnen, der im Code sichtbar
 * bleiben muss:
 *
 * | Plattform | Beiträge finden | Kommentar posten |
 * |---|---|---|
 * | Threads | `GET /keyword_search` (2.200 Abfragen/24 h) | **ja**, `reply_to_id` (1.000 Antworten/24 h) |
 * | Instagram | `business_discovery` (öffentliche Beiträge genannter Konten) | **nein** |
 *
 * Metas Doku zur Stichwortsuche sagt ausdrücklich, man dürfe mit den so
 * gefundenen öffentlichen Beiträgen interagieren — antworten, zitieren,
 * teilen. Das ist die Grundlage für `antworteAufThread()`.
 *
 * Auf **Instagram gibt es keinen Endpunkt, um fremde Medien zu kommentieren** —
 * `POST /<IG_COMMENT_ID>/replies` gilt nur für die eigenen. Lesen geht über
 * `business_discovery`, und genau dabei bleibt es hier: der Pilot findet die
 * Reels und schreibt den Entwurf, gepostet wird von Hand. Wer das ändern will,
 * müsste eine eingeloggte Browser-Sitzung fernsteuern — das verstößt gegen die
 * Nutzungsbedingungen und setzt das Konto aufs Spiel, an dem auch das gesamte
 * Posting des Piloten hängt. Deshalb steht es nicht hier.
 *
 * TikTok fehlt ganz: dort gibt es weder eine Lese- noch eine Schreib-API für
 * Kommentare (nur die Research-API für Hochschulen und die Business-API für
 * Werbeanzeigen).
 */
import type * as s from "../../../shared/schemas.js";
import type { Env } from "../../env.js";
import type { Thread } from "./radar.js";

const THREADS = "https://graph.threads.net/v1.0";
const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT = 20_000;

/** Beiträge je Quelle und Lauf — mehr braucht niemand zu lesen. */
const MAX_JE_QUELLE = 25;

interface GraphFehler { error?: { message?: string; code?: number; error_subcode?: number; type?: string } }

async function hole<T>(f: typeof fetch, url: string, was: string): Promise<T> {
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const body = (await res.json().catch(() => ({}))) as T & GraphFehler;
  if (!res.ok || body.error) throw new Error(`${was}: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body;
}

/** Schreibender Aufruf — Parameter im Rumpf, nicht in der Adresse. */
async function sende<T>(f: typeof fetch, url: string, params: Record<string, string>, was: string): Promise<T> {
  const res = await f(url, { method: "POST", body: new URLSearchParams(params), signal: AbortSignal.timeout(TIMEOUT) });
  const body = (await res.json().catch(() => ({}))) as T & GraphFehler;
  if (!res.ok || body.error) throw new Error(`${was}: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body;
}

/**
 * Fehlt dem Token ein Recht, antwortet Meta mit einem Text, der nach einem
 * allgemeinen Fehler aussieht. Hier wird daraus die einzige Anweisung, die
 * wirklich hilft — welches Recht fehlt und wo man es holt.
 */
const TOKEN_ERNEUERN = "Im Meta-App-Dashboard (App „Binderplan Threads“) im Tester-Token-Generator einen neuen Token erzeugen — dabei das Recht ankreuzen — und unter Kanäle → Threads eintragen.";

export function rechteHinweis(fehler: string): string | null {
  const m = /threads_(keyword_search|manage_replies|content_publish)/.exec(fehler);
  if (m) return `Dem Threads-Token fehlt das Recht „threads_${m[1]}“. ${TOKEN_ERNEUERN}`;
  if (/permission|scope|OAuth/i.test(fehler) && /keyword|search/i.test(fehler)) return `Die Stichwortsuche verlangt das Recht „threads_keyword_search“ — der aktuelle Token hat es nicht. ${TOKEN_ERNEUERN}`;
  // Gemessen am 10.09.2026 mit einem gültigen Token ohne dieses Recht: die
  // Suche antwortet **HTTP 500 mit leerem Rumpf** — kein OAuthException, kein
  // Code, nichts. Derselbe Token beantwortet `/me` und
  // `threads_publishing_limit` einwandfrei. Ohne diese Zeile sucht man den
  // Fehler stundenlang bei Meta statt beim eigenen Token.
  if (/^Threads-Suche:.*(HTTP 500|HTTP 400)/.test(fehler)) return `Die Stichwortsuche antwortet mit ${/500/.test(fehler) ? "500" : "400"} und leerem Rumpf — das ist bei diesem Endpunkt das Zeichen für das fehlende Recht „threads_keyword_search“, nicht für eine Störung. ${TOKEN_ERNEUERN}`;
  return null;
}

// --- Threads: Stichwortsuche -------------------------------------------------

interface ThreadsTreffer {
  id: string; text?: string; username?: string; permalink?: string; timestamp?: string;
  media_type?: string; is_reply?: boolean; is_quote_post?: boolean; has_replies?: boolean;
}

/**
 * Öffentliche Threads zu einem Stichwort.
 *
 * `search_type=RECENT` statt `TOP`: unter einem zwei Wochen alten Beitrag zu
 * kommentieren bringt nichts, und die Antwortgeschwindigkeit ist auf Threads
 * das stärkste Signal. Aus demselben Grund die Fenstergrenze `since` — was
 * älter als zwei Tage ist, wird gar nicht erst geholt.
 *
 * Ausgesiebt wird gleich hier, weil es sonst Modell-Token kostet: eigene
 * Beiträge (man kommentiert sich nicht selbst), Antworten und Zitate (dort
 * hängt man in einem fremden Gespräch) und alles ohne Text.
 */
export async function sucheThreads(opts: {
  f: typeof fetch; token: string; stichwort: string; eigenerName: string;
  seitMs?: number; jetzt?: number; limit?: number;
}): Promise<Thread[]> {
  const jetzt = opts.jetzt ?? Date.now();
  const seit = Math.floor((jetzt - (opts.seitMs ?? 2 * 86_400_000)) / 1000);
  const q = new URLSearchParams({
    q: opts.stichwort,
    search_type: "RECENT",
    since: String(seit),
    limit: String(opts.limit ?? MAX_JE_QUELLE),
    fields: "id,text,username,permalink,timestamp,media_type,is_reply,is_quote_post,has_replies",
    access_token: opts.token,
  });
  const body = await hole<{ data?: ThreadsTreffer[] }>(opts.f, `${THREADS}/keyword_search?${q}`, "Threads-Suche");
  const eigen = opts.eigenerName.trim().toLowerCase().replace(/^@/, "");
  return (body.data ?? [])
    .filter((x) => x.text?.trim() && !x.is_reply && !x.is_quote_post)
    .filter((x) => (x.username ?? "").toLowerCase() !== eigen)
    .map((x) => ({
      platform: "threads",
      community: `@${x.username ?? "?"}`,
      url: x.permalink ?? `https://www.threads.net/t/${x.id}`,
      title: (x.text ?? "").slice(0, 120),
      excerpt: x.text ?? "",
      externalId: x.id,
      createdAt: x.timestamp ?? new Date(jetzt).toISOString(),
    }));
}

// --- Threads: antworten ------------------------------------------------------

/** Was das Konto heute noch senden darf — `null`, wenn Meta die Auskunft verweigert. */
export async function antwortBudget(f: typeof fetch, userId: string, token: string): Promise<{ genutzt: number; grenze: number } | null> {
  try {
    const body = await hole<{ data?: { reply_quota_usage?: number; reply_config?: { quota_total?: number } }[] }>(
      f, `${THREADS}/${userId}/threads_publishing_limit?fields=reply_quota_usage,reply_config&access_token=${encodeURIComponent(token)}`, "Threads-Limit");
    const d = body.data?.[0];
    if (!d || typeof d.reply_quota_usage !== "number") return null;
    return { genutzt: d.reply_quota_usage, grenze: d.reply_config?.quota_total ?? 1000 };
  } catch { return null; }
}

/**
 * Eine Antwort unter einen fremden Thread setzen.
 *
 * Zweistufig wie jeder Threads-Beitrag: Container anlegen, dann
 * veröffentlichen. Der einzige Unterschied zu einem eigenen Beitrag ist
 * `reply_to_id`. Ein Musikbett, Bilder oder ein `topic_tag` gehören hier
 * ausdrücklich nicht hin — eine Antwort ist Text.
 */
export async function antworteAufThread(opts: {
  f: typeof fetch; userId: string; token: string; replyToId: string; text: string;
}): Promise<{ id: string; permalink: string | null }> {
  const text = opts.text.trim().slice(0, 500);
  if (!text) throw new Error("Leerer Antworttext.");
  const container = await sende<{ id: string }>(opts.f, `${THREADS}/${opts.userId}/threads`, {
    media_type: "TEXT", text, reply_to_id: opts.replyToId, access_token: opts.token,
  }, "Threads-Antwort");
  const pub = await sende<{ id: string }>(opts.f, `${THREADS}/${opts.userId}/threads_publish`, {
    creation_id: container.id, access_token: opts.token,
  }, "Threads-Antwort-Publish");
  let permalink: string | null = null;
  try {
    const info = await hole<{ permalink?: string }>(opts.f, `${THREADS}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(opts.token)}`, "Threads-Permalink");
    permalink = info.permalink ?? null;
  } catch { /* die Antwort steht, der Link ist Kür */ }
  return { id: pub.id, permalink };
}

// --- Instagram: fremde Reels lesen -------------------------------------------

interface IgMedia {
  id: string; caption?: string; permalink?: string; timestamp?: string;
  media_product_type?: string; like_count?: number; comments_count?: number;
}

/**
 * Die jüngsten Beiträge eines fremden Kontos.
 *
 * `business_discovery` ist der einzige offizielle Weg an fremde Instagram-
 * Beiträge und funktioniert nur für **Business- oder Creator-Konten**; ein
 * privates Konto liefert „Invalid user id“, was hier bewusst als lesbarer Satz
 * durchgereicht wird statt als Meta-Codenummer.
 *
 * `media_product_type` trennt `REELS`, `FEED`, `STORY` und `AD`. Zurück kommen
 * **Reels und Feed-Beiträge**, Stories und Anzeigen nicht: gemessen am
 * 10.09.2026 sind bei @pokemon 16 von 25 Beiträgen Reels, bei @pokemontcg nur
 * 9 von 25 — eine harte Reel-Beschränkung würde bei den kleineren Konten zwei
 * Drittel der Gelegenheiten wegwerfen, und ein Kommentar unter einem Carousel
 * wirkt genauso. Die Art steht im Auszug, damit sie beim Lesen sichtbar bleibt.
 */
export async function holeFremdeReels(opts: {
  f: typeof fetch; igUserId: string; token: string; konto: string; limit?: number; nurReels?: boolean;
}): Promise<Thread[]> {
  const konto = opts.konto.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(konto)) throw new Error(`„${opts.konto}“ ist kein Instagram-Nutzername.`);
  const felder = `business_discovery.username(${konto}){followers_count,media.limit(${opts.limit ?? 10}){id,caption,permalink,timestamp,media_product_type,like_count,comments_count}}`;
  const q = new URLSearchParams({ fields: felder, access_token: opts.token });
  let body: { business_discovery?: { followers_count?: number; media?: { data?: IgMedia[] } } };
  try {
    body = await hole(opts.f, `${GRAPH}/${opts.igUserId}?${q}`, "Instagram-Discovery");
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/does not exist|user not found|cannot be loaded/i.test(text)) throw new Error(`@${konto}: kein öffentliches Business-/Creator-Konto — business_discovery erreicht nur diese.`);
    throw e;
  }
  const medien = body.business_discovery?.media?.data ?? [];
  const erlaubt = opts.nurReels ? ["REELS"] : ["REELS", "FEED"];
  return medien
    .filter((m) => erlaubt.includes(m.media_product_type ?? "FEED"))
    .filter((m) => m.caption?.trim())
    .map((m) => ({
      platform: "instagram",
      community: `@${konto}`,
      url: m.permalink ?? `https://www.instagram.com/p/${m.id}/`,
      title: (m.caption ?? "").split("\n")[0]!.slice(0, 120),
      excerpt: `${m.caption ?? ""}\n\n[${m.media_product_type === "REELS" ? "Reel" : "Beitrag"}, ${m.like_count ?? 0} Likes, ${m.comments_count ?? 0} Kommentare]`,
      externalId: m.id,
      createdAt: m.timestamp ?? new Date().toISOString(),
    }));
}

// --- Anbindung an den Radar --------------------------------------------------

export type CredsLeser = (platform: string) => Record<string, string>;

/** Quelle „Threads-Stichwort“ — `value` ist das Stichwort. */
export async function fetchThreadsQuelle(source: s.CommunitySource, _env: Env, log: (m: string) => void, creds: CredsLeser): Promise<Thread[]> {
  const c = creds("threads");
  if (!c["accessToken"] || !c["userId"]) throw new Error("Threads-Zugang fehlt (Kanäle → Threads).");
  const eigenerName = c["username"] ?? "binderplan";
  const treffer = await sucheThreads({ f: fetch, token: c["accessToken"], stichwort: source.value, eigenerName });
  log(`threads „${source.value}“: ${treffer.length} Beiträge`);
  return treffer;
}

/** Quelle „Instagram-Konto“ — `value` ist der Nutzername ohne @. */
export async function fetchInstagramQuelle(source: s.CommunitySource, _env: Env, log: (m: string) => void, creds: CredsLeser): Promise<Thread[]> {
  const c = creds("instagram");
  if (!c["accessToken"] || !c["igUserId"]) throw new Error("Instagram-Zugang fehlt (Kanäle → Instagram).");
  const treffer = await holeFremdeReels({ f: fetch, igUserId: c["igUserId"], token: c["accessToken"], konto: source.value });
  log(`instagram @${source.value}: ${treffer.length} Reels`);
  return treffer;
}

/** Kanäle, unter denen der Pilot selbst antworten kann. Alles andere ist Handarbeit. */
export const ANTWORT_KANAELE = ["threads"] as const;
export const kannSelbstAntworten = (platform: string): boolean => (ANTWORT_KANAELE as readonly string[]).includes(platform);
