/**
 * Web search behind SearchProvider. `MP_SEARCH_PROVIDER=brave|serper` with a
 * key uses that API; anything else falls back to DuckDuckGo's HTML endpoint
 * (no key, slower, politely rate-limited).
 */
import type { Env } from "../env.js";
import type { SearchHit, SearchProvider } from "./index.js";
import { USER_AGENT, decodeEntities, sleep } from "./html.js";

export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const strip = (x: string) => decodeEntities(x.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(linkRe)];
  matches.forEach((m, i) => {
    let href = decodeEntities(m[1] ?? "");
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg?.[1]) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href) || href.includes("duckduckgo.com/y.js")) return;
    const title = strip(m[2] ?? "");
    const chunk = html.slice((m.index ?? 0) + m[0].length, matches[i + 1]?.index ?? html.length);
    const sn = /<(a|div)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/\1>/.exec(chunk);
    const snippet = strip(sn?.[2] ?? "");
    if (title && !hits.some((h) => h.url === href)) hits.push({ title, url: href, snippet });
  });
  return hits;
}

export class DuckDuckGoSearch implements SearchProvider {
  private last = 0;
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly minGapMs = 1500) {}

  async search(query: string, opts: { limit?: number } = {}): Promise<SearchHit[]> {
    const wait = this.last + this.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
    const res = await this.fetchImpl("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "de-DE,de;q=0.9,en;q=0.7" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const hits = parseDuckDuckGoHtml(await res.text());
    return hits.slice(0, opts.limit ?? 10);
  }
}

export class BraveSearch implements SearchProvider {
  constructor(private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async search(query: string, opts: { limit?: number } = {}): Promise<SearchHit[]> {
    const res = await this.fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${opts.limit ?? 10}`, {
      headers: { "X-Subscription-Token": this.key, Accept: "application/json" }, signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Brave Search ${res.status}`);
    const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
  }
}

export class SerperSearch implements SearchProvider {
  constructor(private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async search(query: string, opts: { limit?: number } = {}): Promise<SearchHit[]> {
    const res = await this.fetchImpl("https://google.serper.dev/search", {
      method: "POST", headers: { "X-API-KEY": this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: opts.limit ?? 10, gl: "de", hl: "de" }), signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const data = (await res.json()) as { organic?: { title: string; link: string; snippet?: string }[] };
    return (data.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
  }
}

export function createSearchProvider(env: Env): { provider: SearchProvider; name: string } {
  const key = env.MP_SEARCH_API_KEY;
  if (env.MP_SEARCH_PROVIDER === "brave" && key) return { provider: new BraveSearch(key), name: "brave" };
  if (env.MP_SEARCH_PROVIDER === "serper" && key) return { provider: new SerperSearch(key), name: "serper" };
  return { provider: new DuckDuckGoSearch(), name: "duckduckgo-html" };
}
