/** Dependency-free HTML helpers: text extraction, robots.txt, plain fetch. */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", euro: "€", copy: "©",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<head[\s\S]*?<\/head>/i, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|title)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

export function extractMetaDescription(html: string): string {
  const m = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html);
  return m?.[1] ? decodeEntities(m[1]).trim() : "";
}

export const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36 MarketingPilot/0.1 (+https://agi-empire.com/mp/)";

export interface FetchedPage { url: string; finalUrl: string; status: number; title: string; text: string; html: string }

export async function fetchPage(url: string, opts: { maxChars?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<FetchedPage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "de-DE,de;q=0.9,en;q=0.7" },
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const html = (await res.text()).slice(0, 2_000_000);
  const text = htmlToText(html).slice(0, opts.maxChars ?? 20_000);
  return { url, finalUrl: res.url || url, status: res.status, title: extractTitle(html), text, html };
}

/** Minimal robots.txt: honours the most specific matching group (our UA, else `*`). */
export interface Robots { isAllowed(path: string): boolean; crawlDelayMs: number | null }

export function parseRobots(txt: string, ua = "marketingpilot"): Robots {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay: number | null }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [], delay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.disallow.push(value);
    else if (key === "allow" && value) current.allow.push(value);
    else if (key === "crawl-delay") { const n = Number(value); if (Number.isFinite(n)) current.delay = n * 1000; }
  }
  const group = groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  const matches = (rule: string, path: string): boolean => {
    const re = new RegExp("^" + rule.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$"));
    return re.test(path);
  };
  return {
    crawlDelayMs: group?.delay ?? null,
    isAllowed(path: string): boolean {
      if (!group) return true;
      const allow = group.allow.filter((r) => matches(r, path)).sort((a, b) => b.length - a.length)[0];
      const dis = group.disallow.filter((r) => matches(r, path)).sort((a, b) => b.length - a.length)[0];
      if (!dis) return true;
      if (!allow) return false;
      return allow.length >= dis.length;
    },
  };
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
