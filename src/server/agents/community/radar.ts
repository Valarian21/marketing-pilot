/**
 * Community radar: read-only scan of subreddits (official OAuth API when
 * REDDIT_CLIENT_ID/SECRET are set, otherwise the public JSON endpoints with a
 * slow, polite rate limit), Hacker News (Algolia API) and RSS feeds. Threads
 * are scored against persona pains; >= 60 becomes a CommunityLead with a draft
 * reply that respects the community rules. Posting is not built - by design.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import type { Env } from "../../env.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, withRun, type AgentContext } from "../runner.js";
import { replyDraftPrompt, scoreThreadsPrompt, type ThreadCandidate } from "../prompts/community.js";
import { getProject } from "../../repo/projects.js";
import { listPersonas } from "../analysis/personas.js";
import { listChannels } from "../analysis/attention.js";
import { loadBrandKit } from "../studio/brandkit.js";
import { voiceBlock } from "../studio/voice.js";
import { decodeEntities, htmlToText, sleep, USER_AGENT } from "../../providers/html.js";
import type { JobHandler } from "../../jobs.js";

export const LEAD_THRESHOLD = 60;
const SOURCES_KEY = (pid: string) => `community_sources:${pid}`;
const LAST_SCAN_KEY = (pid: string) => `community_last_scan:${pid}`;

// --- sources -----------------------------------------------------------------

/** Pull r/… names and forum/feed URLs out of the analysis (persona hangouts, attention map). */
export function deriveSources(personas: s.Persona[], channels: s.Channel[]): s.CommunitySource[] {
  const out = new Map<string, s.CommunitySource>();
  const texts = [...personas.flatMap((p) => p.whereTheyHangOut), ...channels.map((c) => c.platform)];
  for (const txt of texts) {
    for (const m of txt.matchAll(/\br\/([A-Za-z0-9_]{2,30})/g)) out.set(`reddit:${m[1]!.toLowerCase()}`, { type: "reddit", value: m[1]!, label: `r/${m[1]}`, enabled: true });
    for (const m of txt.matchAll(/https?:\/\/[^\s,)]+\.(?:rss|xml|atom)[^\s,)]*/gi)) out.set(`rss:${m[0]}`, { type: "rss", value: m[0], label: m[0], enabled: true });
    if (/hacker ?news|\bHN\b/i.test(txt)) out.set("hn:", { type: "hn", value: "", label: "Hacker News", enabled: true });
  }
  return [...out.values()];
}

export function loadSources(db: Db, projectId: string): s.CommunitySource[] {
  const row = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, SOURCES_KEY(projectId))).get();
  const parsed = z.array(s.CommunitySource).safeParse(parseJson(row?.value ?? "null", null));
  return parsed.success ? parsed.data : [];
}
export function saveSources(db: Db, projectId: string, sources: s.CommunitySource[]): void {
  db.insert(t.mpSettings).values({ key: SOURCES_KEY(projectId), value: toJson(sources), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(sources), updatedAt: nowIso() } }).run();
}
export function lastScanAt(db: Db, projectId: string): string | null {
  return db.select().from(t.mpSettings).where(eq(t.mpSettings.key, LAST_SCAN_KEY(projectId))).get()?.value ?? null;
}

// --- fetchers ------------------------------------------------------------------

export interface Thread { platform: string; community: string; url: string; title: string; excerpt: string; externalId: string; createdAt: string }
export type Fetcher = (source: s.CommunitySource, env: Env, log: (m: string) => void) => Promise<Thread[]>;

let redditToken: { token: string; exp: number } | null = null;
async function redditAuthHeader(env: Env): Promise<Record<string, string>> {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return {};
  if (redditToken && redditToken.exp > Date.now() + 60_000) return { Authorization: `Bearer ${redditToken.token}` };
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": env.REDDIT_USER_AGENT ?? "marketing-pilot/0.1 (read-only radar)" },
    body: "grant_type=client_credentials", signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Reddit OAuth ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  redditToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return { Authorization: `Bearer ${redditToken.token}` };
}

interface RedditListing { data?: { children?: { data: { id: string; title: string; selftext?: string; permalink: string; created_utc: number; subreddit: string; num_comments?: number; over_18?: boolean } }[] } }

export const fetchReddit: Fetcher = async (source, env, log) => {
  const auth: Record<string, string> = await redditAuthHeader(env).catch((e: unknown) => { log(`reddit oauth: ${e instanceof Error ? e.message : String(e)}`); return {} as Record<string, string>; });
  const oauth = Boolean(auth["Authorization"]);
  const base = oauth ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const ua = env.REDDIT_USER_AGENT ?? "marketing-pilot/0.1 (read-only radar; +https://agi-empire.com/mp/)";
  const out: Thread[] = [];
  for (const sort of ["new", "hot"]) {
    const res = await fetch(`${base}/r/${encodeURIComponent(source.value)}/${sort}.json?limit=40&raw_json=1`, { headers: { ...auth, "User-Agent": ua, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) { log(`reddit r/${source.value}: rate limited`); await sleep(5000); continue; }
    if (!res.ok) { log(`reddit r/${source.value}: HTTP ${res.status}`); continue; }
    const data = (await res.json()) as RedditListing;
    for (const c of data.data?.children ?? []) {
      const d = c.data;
      if (d.over_18) continue;
      out.push({ platform: "reddit", community: `r/${d.subreddit}`, url: `https://www.reddit.com${d.permalink}`, title: d.title, excerpt: (d.selftext ?? "").slice(0, 1200), externalId: `reddit:${d.id}`, createdAt: new Date(d.created_utc * 1000).toISOString() });
    }
    await sleep(oauth ? 1000 : 2500);
  }
  return out;
};

export async function fetchRedditRules(sub: string, env: Env): Promise<{ text: string; linksAllowed: boolean }> {
  try {
    const auth: Record<string, string> = await redditAuthHeader(env).catch(() => ({} as Record<string, string>));
    const base = auth["Authorization"] ? "https://oauth.reddit.com" : "https://www.reddit.com";
    const res = await fetch(`${base}/r/${encodeURIComponent(sub)}/about/rules.json?raw_json=1`, { headers: { ...auth, "User-Agent": env.REDDIT_USER_AGENT ?? "marketing-pilot/0.1 (read-only radar)" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { text: "", linksAllowed: true };
    const data = (await res.json()) as { rules?: { short_name: string; description?: string }[] };
    const text = (data.rules ?? []).map((r, i) => `${i + 1}. ${r.short_name}${r.description ? ` - ${r.description.slice(0, 300)}` : ""}`).join("\n");
    const linksAllowed = !/no (self[- ]?promo|links?|advertis|spam)|keine (werbung|links?|eigenwerbung)|self-promotion/i.test(text);
    return { text, linksAllowed };
  } catch { return { text: "", linksAllowed: true }; }
}

interface HnHit { objectID: string; title?: string; story_text?: string; url?: string; created_at: string; num_comments?: number }
export const fetchHackerNews: Fetcher = async (source, _env, log) => {
  const q = encodeURIComponent(source.value || "teachers worksheet");
  const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=(story,ask_hn)&hitsPerPage=40`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { log(`hn: HTTP ${res.status}`); return []; }
  const data = (await res.json()) as { hits?: HnHit[] };
  return (data.hits ?? []).filter((h) => h.title).map((h) => ({ platform: "hackernews", community: "Hacker News", url: `https://news.ycombinator.com/item?id=${h.objectID}`, title: h.title ?? "", excerpt: htmlToText(h.story_text ?? "").slice(0, 1200), externalId: `hn:${h.objectID}`, createdAt: h.created_at }));
};

/** Minimal RSS/Atom parser (title, link, description/summary, date). */
export function parseFeed(xml: string, feedUrl: string): Thread[] {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const pick = (block: string, tag: string) => { const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block); return m?.[1] ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : ""; };
  const host = (() => { try { return new URL(feedUrl).hostname; } catch { return feedUrl; } })();
  return items.map((b) => {
    const linkAttr = /<link\b[^>]*href="([^"]+)"/i.exec(b)?.[1];
    const link = linkAttr ?? pick(b, "link");
    const title = htmlToText(pick(b, "title"));
    return { platform: "forum", community: host, url: link, title, excerpt: htmlToText(pick(b, "description") || pick(b, "summary") || pick(b, "content")).slice(0, 1200), externalId: `rss:${link || title}`, createdAt: pick(b, "pubDate") || pick(b, "published") || pick(b, "updated") || nowIso() };
  }).filter((x) => x.title && x.url);
}
export const fetchRss: Fetcher = async (source, _env, log) => {
  const res = await fetch(source.value, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, text/xml, */*" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { log(`rss ${source.value}: HTTP ${res.status}`); return []; }
  return parseFeed(await res.text(), source.value);
};

export const FETCHERS: Record<s.CommunitySource["type"], Fetcher> = { reddit: fetchReddit, hn: fetchHackerNews, rss: fetchRss };

// --- scan job ------------------------------------------------------------------

export interface CommunityContext extends AgentContext { fetchers?: Partial<Record<s.CommunitySource["type"], Fetcher>>; rulesFetcher?: (sub: string, env: Env) => Promise<{ text: string; linksAllowed: boolean }> }

const Scores = z.object({ scores: z.array(z.object({ id: z.string(), score: z.number().min(0).max(100), reason: z.string().default(""), askingForTools: z.boolean().default(false) })) });
const Reply = z.object({ reply: z.string().min(1), rulesNote: z.string().default(""), mentionsProduct: z.boolean().default(false) });

export function listLeads(db: Db, projectId: string): s.CommunityLead[] {
  return db.select().from(t.mpCommunityLeads).where(eq(t.mpCommunityLeads.projectId, projectId)).orderBy(desc(t.mpCommunityLeads.score), desc(t.mpCommunityLeads.createdAt)).all()
    .map((r) => ({ ...r, status: r.status as s.CommunityLead["status"], meta: parseJson<Record<string, unknown>>(r.meta, {}) }));
}

export async function scanCommunity(ctx: CommunityContext, projectId: string, opts: { maxThreads?: number; maxLeads?: number } = {}): Promise<{ scanned: number; scored: number; leads: number; warnings: string[] }> {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new Error("Projekt nicht gefunden");
  const brief = s.Brief.safeParse(project.brief);
  if (!brief.success) throw new Error("Kein Brief - erst die Analyse ausführen.");
  const personas = listPersonas(ctx, projectId);
  let sources = loadSources(ctx.db, projectId);
  if (!sources.length) { sources = deriveSources(personas, listChannels(ctx, projectId)); saveSources(ctx.db, projectId, sources); }
  const warnings: string[] = [];
  const known = new Set(ctx.db.select({ url: t.mpCommunityLeads.url }).from(t.mpCommunityLeads).where(eq(t.mpCommunityLeads.projectId, projectId)).all().map((r) => r.url));
  const threads: Thread[] = [];
  for (const src of sources.filter((x) => x.enabled)) {
    const fetcher = ctx.fetchers?.[src.type] ?? FETCHERS[src.type];
    try {
      const got = await fetcher(src, ctx.env, ctx.log);
      threads.push(...got.filter((x) => !known.has(x.url)));
      ctx.log(`community ${src.label || src.value}: ${got.length} Threads`);
    } catch (e) { warnings.push(`${src.label || src.value}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const fresh = threads.filter((x, i, arr) => arr.findIndex((y) => y.url === x.url) === i).slice(0, opts.maxThreads ?? 120);
  if (!fresh.length) { ctx.db.insert(t.mpSettings).values({ key: LAST_SCAN_KEY(projectId), value: nowIso(), updatedAt: nowIso() }).onConflictDoUpdate({ target: t.mpSettings.key, set: { value: nowIso(), updatedAt: nowIso() } }).run(); return { scanned: 0, scored: 0, leads: 0, warnings }; }

  const cheap = modelFor("scoring");
  const candidates: ThreadCandidate[] = fresh.map((x, i) => ({ id: `t${i}`, platform: x.platform, url: x.url, title: x.title, excerpt: x.excerpt, community: x.community }));
  const scored: { c: ThreadCandidate; score: number; reason: string; asking: boolean }[] = [];
  const { result } = await withRun(ctx.db, { task: "community.score", model: cheap, projectId }, async (usage) => {
    for (let i = 0; i < candidates.length; i += 25) {
      const batch = candidates.slice(i, i + 25);
      const out = await chatJson(ctx.llm, cheap, Scores, scoreThreadsPrompt({ brief: brief.data, personas, threads: batch }), usage, { maxTokens: 3000 });
      for (const sc of out.scores) { const c = batch.find((x) => x.id === sc.id); if (c) scored.push({ c, score: Math.round(sc.score), reason: sc.reason, asking: sc.askingForTools }); }
    }
    return scored.length;
  });
  const hits = scored.filter((x) => x.score >= LEAD_THRESHOLD).sort((a, b) => b.score - a.score).slice(0, opts.maxLeads ?? 15);
  const voice = voiceBlock(loadBrandKit(ctx.db, projectId));
  const rulesCache = new Map<string, { text: string; linksAllowed: boolean }>();
  let created = 0;
  if (hits.length) {
    await withRun(ctx.db, { task: "community.reply-drafts", model: modelFor("community"), projectId }, async (usage) => {
      for (const h of hits) {
        let rules = { text: "", linksAllowed: true };
        if (h.c.platform === "reddit") {
          const sub = h.c.community.replace(/^r\//, "");
          if (!rulesCache.has(sub)) rulesCache.set(sub, await (ctx.rulesFetcher ?? fetchRedditRules)(sub, ctx.env));
          rules = rulesCache.get(sub)!;
        }
        try {
          const draft = await chatJson(ctx.llm, modelFor("community"), Reply, replyDraftPrompt({ brief: brief.data, ...(personas[0] ? { persona: personas[0] } : {}), thread: h.c, rules: rules.text, linksAllowed: rules.linksAllowed, voiceProfile: voice, productUrl: project.url }), usage, { maxTokens: 1500, temperature: 0.5 });
          ctx.db.insert(t.mpCommunityLeads).values({ id: newId(), projectId, platform: h.c.platform, url: h.c.url, title: h.c.title, excerpt: h.c.excerpt.slice(0, 600), score: h.score, draftReply: draft.reply, status: "drafted", meta: toJson({ community: h.c.community, reason: h.reason, askingForTools: h.asking, rulesNote: draft.rulesNote, mentionsProduct: draft.mentionsProduct, linksAllowed: rules.linksAllowed, rules: rules.text.slice(0, 1500) }), createdAt: nowIso() }).run();
          created++;
        } catch (e) { warnings.push(`${h.c.url}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      return created;
    });
  }
  ctx.db.insert(t.mpSettings).values({ key: LAST_SCAN_KEY(projectId), value: nowIso(), updatedAt: nowIso() }).onConflictDoUpdate({ target: t.mpSettings.key, set: { value: nowIso(), updatedAt: nowIso() } }).run();
  return { scanned: fresh.length, scored: result, leads: created, warnings };
}

export const communityScanJob: JobHandler<CommunityContext> = async (ctx, job, progress) => {
  const projectId = String(job.payload["projectId"] ?? job.projectId ?? "");
  progress("scan", { status: "running", startedAt: nowIso() });
  const r = await scanCommunity(ctx, projectId);
  progress("scan", { status: "done", finishedAt: nowIso(), detail: `${r.scanned} Threads, ${r.leads} neue Leads${r.warnings.length ? `, ${r.warnings.length} Warnungen` : ""}` });
  return { ...r };
};

export function updateLead(db: Db, id: string, patch: s.CommunityLeadPatch): s.CommunityLead | null {
  const row = db.select().from(t.mpCommunityLeads).where(eq(t.mpCommunityLeads.id, id)).get();
  if (!row) return null;
  const meta = parseJson<Record<string, unknown>>(row.meta, {});
  const set: Partial<typeof t.mpCommunityLeads.$inferInsert> = {};
  if (patch.draftReply !== undefined) { set.draftReply = patch.draftReply; meta["humanEdited"] = true; }
  if (patch.status) { set.status = patch.status; if (patch.status === "answered") meta["answeredAt"] = nowIso(); }
  if (patch.externalUrl !== undefined) meta["answeredUrl"] = patch.externalUrl;
  set.meta = toJson(meta);
  db.update(t.mpCommunityLeads).set(set).where(eq(t.mpCommunityLeads.id, id)).run();
  const r = db.select().from(t.mpCommunityLeads).where(eq(t.mpCommunityLeads.id, id)).get()!;
  return { ...r, status: r.status as s.CommunityLead["status"], meta: parseJson<Record<string, unknown>>(r.meta, {}) };
}

export function isScanning(db: Db, projectId: string): boolean {
  return db.select().from(t.mpJobs).where(and(eq(t.mpJobs.projectId, projectId), eq(t.mpJobs.kind, "community.scan"))).all().some((j) => j.status === "queued" || j.status === "running");
}
