import { describe, expect, it } from "vitest";
import { htmlToText, parseRobots, extractTitle } from "../src/server/providers/html.js";
import { parseDuckDuckGoHtml } from "../src/server/providers/search.js";
import { extractJson } from "../src/server/agents/runner.js";
import { classifyUrl, normalizeUrl } from "../src/server/agents/analysis/crawl.js";
import { OpenRouterProvider } from "../src/server/providers/openrouter.js";

describe("html helpers", () => {
  it("strips scripts, keeps text, decodes entities", () => {
    const t = htmlToText("<html><head><title>T &amp; U</title><script>x()</script><style>a{}</style></head><body><h1>Hallo</h1><p>Welt&nbsp;&auml;</p></body></html>");
    expect(t).toBe("Hallo\nWelt ä");
    expect(extractTitle("<title> T &amp; U </title>")).toBe("T & U");
  });
  it("parses robots.txt groups with longest-match allow/disallow", () => {
    const r = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public\nCrawl-delay: 2\n\nUser-agent: Googlebot\nDisallow: /");
    expect(r.isAllowed("/")).toBe(true);
    expect(r.isAllowed("/admin/secret")).toBe(false);
    expect(r.isAllowed("/admin/public/x")).toBe(true);
    expect(r.crawlDelayMs).toBe(2000);
    expect(parseRobots("").isAllowed("/anything")).toBe(true);
  });
});

describe("duckduckgo html parser", () => {
  it("decodes uddg redirect links and pairs snippets", () => {
    const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.teachany.com%2Fde%2Ftools&amp;rut=abc">Arbeitsblatt-Generator | TeachAny</a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Mühelos <b>druckbare</b> Arbeitsblätter</a>
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.canva.com%2Fde_de%2F&amp;rut=def">Canva</a>`;
    const hits = parseDuckDuckGoHtml(html);
    expect(hits).toEqual([
      { title: "Arbeitsblatt-Generator | TeachAny", url: "https://www.teachany.com/de/tools", snippet: "Mühelos druckbare Arbeitsblätter" },
      { title: "Canva", url: "https://www.canva.com/de_de/", snippet: "" },
    ]);
  });
});

describe("crawl helpers", () => {
  it("classifies and normalises urls", () => {
    expect(classifyUrl("https://x.test/")).toBe("home");
    expect(classifyUrl("https://x.test/preise")).toBe("pricing");
    expect(classifyUrl("https://x.test/docs/start")).toBe("docs");
    expect(classifyUrl("https://apps.apple.com/de/app/x/id1")).toBe("appstore");
    expect(normalizeUrl("https://x.test/a/?utm_source=z#top")).toBe("https://x.test/a");
    expect(normalizeUrl("mailto:a@b.c")).toBeNull();
  });
});

describe("json extraction", () => {
  it("handles fences and prose", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"b":[1,2]} hope this helps')).toEqual({ b: [1, 2] });
    expect(() => extractJson("nothing here")).toThrow();
  });
});

describe("openrouter provider", () => {
  it("sends usage.include and maps cost", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenRouterProvider("key", { fetchImpl });
    const res = await p.chat("m", [{ role: "user", content: "x" }], { json: true });
    expect(res).toEqual({ text: "hi", model: "m", usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.001 } });
    expect(body["usage"]).toEqual({ include: true });
    expect(body["response_format"]).toEqual({ type: "json_object" });
  });
  it("retries on 429 then surfaces the error", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response("slow down", { status: 429 }); }) as unknown as typeof fetch;
    await expect(new OpenRouterProvider("k", { fetchImpl }).chat("m", [{ role: "user", content: "x" }])).rejects.toThrow(/429/);
    expect(calls).toBe(3);
  }, 15_000);
});
