/** Shot 3: helpers (png marking, markdown, utm, palette), critic loop, generation per format, brand kit, voice profile, publish package, directories. */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { ImageProvider, LlmMessage, LlmProvider, LlmResult } from "../src/server/providers/index.js";
import type { Renderer } from "../src/server/agents/studio/render.js";
import type { BrandExtractor } from "../src/server/agents/studio/brandkit.js";
import { markPng, pngSize, readPngTextChunks } from "../src/server/util/png.js";
import { markdownToHtml } from "../src/shared/markdown.js";
import { buildUtmUrl, deepLinkFor, platformFromChannel, slugify } from "../src/server/util/utm.js";
import { pickPalette } from "../src/server/agents/studio/brandkit.js";
import { parseDuckDuckGoHtml } from "../src/server/providers/search.js";
import { criticPrompt, directoryPrompt, textPostPrompt } from "../src/server/agents/prompts/studio.js";
import type { Brief } from "../src/shared/schemas.js";
import { fakeHost } from "./helpers.js";

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const usage = { tokensIn: 40, tokensOut: 20, costUsd: 0.001 };
const json = (o: unknown): LlmResult => ({ text: JSON.stringify(o), model: "fake", usage });
const brief: Brief = { productName: "Beispielwerk", oneLiner: "Arbeitsblätter in Minuten.", category: "worksheet generator", language: "de", features: ["Generator"], pricing: [{ plan: "Free", price: "0 €", notes: "" }], usp: ["Lehrplan"], tone: "Du", targetAudience: "Lehrkräfte", keywords: [], sources: [] };

let criticScores = [5, 8];   // first check low -> rewrite -> second check high
const fakeLlm: LlmProvider = {
  async chat(_model: string, messages: LlmMessage[]): Promise<LlmResult> {
    const task = /^\[task:([a-z-]+)\]/.exec(messages.find((m) => m.role === "system")?.content ?? "")?.[1];
    switch (task) {
      case "voice-profile": return json({ summary: "Kurz, direkt, du.", address: "du", sentenceLength: "kurz", favoriteWords: ["ehrlich"], humor: "trocken", typicalOpeners: ["Kurz gesagt:"], noGos: ["Emojis"], promptBlock: "Write short sentences. Use du. Example: 'Kurz gesagt: das klappt.'" });
      case "ai-tell-critic": { const score = criticScores.shift() ?? 9; return json({ score, issues: score < 7 ? ["'Game-Changer' - Floskel"] : [], suggestions: score < 7 ? ["Floskel streichen"] : [] }); }
      case "rewrite": return json({ body: "Überarbeitet: Sonntag gehört wieder dir. Ich bau das Tool selbst." });
      case "text-post": return json({ title: "LinkedIn: Sonntag", body: "Erster Entwurf mit Game-Changer.", altText: "Screenshot der App" });
      case "carousel": return json({ title: "Carousel Sonntag", caption: "Warum Sonntag frei bleibt.", slides: [{ kind: "text", headline: "Sonntag frei", body: "in 10 Minuten" }, { kind: "screenshot", headline: "So sieht es aus", body: "", screenshotId: "" }, { kind: "text", headline: "Probier es", body: "beispielwerk.test" }] });
      case "pin": return json({ title: "Arbeitsblatt in 10 Minuten", description: "So sparst du den Sonntagabend.", overlay: "Sonntag frei", altText: "Pin" });
      case "directory": return json({ tagline: "Arbeitsblätter in Minuten, lehrplangenau für dein Bundesland und mehr", descriptionShort: "kurz", descriptionMedium: "mittel", descriptionLong: "lang lang lang", categories: ["Education"], tags: ["teachers"], alternatives: ["RivalTool"], firstComment: "Hi, ich bin der Maker." });
      case "article-comparison": return json({ title: "Beispielwerk vs RivalTool", slug: "beispielwerk-vs-rivaltool", metaDescription: "Vergleich.", markdown: "# Beispielwerk vs RivalTool\n\nKurz: beide erstellen Arbeitsblätter.\n\n| Kriterium | Beispielwerk | RivalTool |\n|---|---|---|\n| Preis | 0 € | 9 € |\n\n## FAQ\n\n### Ist Beispielwerk kostenlos?\n\nJa, es gibt einen Free-Plan.\n" + "x".repeat(120), faq: [{ q: "Ist Beispielwerk kostenlos?", a: "Ja." }], jsonLd: [] });
      default: return { text: "irrelevant", model: "fake", usage };
    }
  },
};
const rendered: string[] = [];
const fakeRenderer: Renderer = async (jobs) => { for (const j of jobs) { fs.mkdirSync(path.dirname(j.file), { recursive: true }); fs.writeFileSync(j.file, PNG); rendered.push(j.html); } };
const fakeImage: ImageProvider = { async generate(_req, outDir) { fs.mkdirSync(outDir, { recursive: true }); const p = path.join(outDir, "img.png"); fs.writeFileSync(p, PNG); return { path: p, model: "fake-image", usage }; } };
const fakeExtractor: BrandExtractor = async () => ({ colors: ["#3D7A4E", "#1E2A20", "#FFFFFF"], primary: "#3D7A4E", ink: "#1E2A20", background: "#FFFFFF", logoUrl: null, fonts: ["Gabarito"] });

const DATA = path.resolve("data/test-studio");
let built: Awaited<ReturnType<typeof buildApp>>;
const auth = { authorization: "Bearer test-token" };
let pid = "";

beforeAll(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA }), { host: fakeHost(), dbFile: ":memory:", logger: false, services: { llm: fakeLlm, renderer: fakeRenderer, image: fakeImage, brandExtractor: fakeExtractor } });
  pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Beispielwerk", url: "https://beispielwerk.test" } })).json().id;
  await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}`, headers: auth, payload: { brief } });
  // a product screenshot as the crawl would leave it
  const shotDir = path.join(DATA, "assets", pid, "crawl"); fs.mkdirSync(shotDir, { recursive: true }); fs.writeFileSync(path.join(shotDir, "01-home.png"), PNG);
  built.db.run(`INSERT INTO mp_assets (id, project_id, content_piece_id, kind, path, meta, created_at) VALUES ('shot1', '${pid}', NULL, 'screenshot', 'assets/${pid}/crawl/01-home.png', '{"kind":"home","aiGenerated":false}', '2026-08-26T00:00:00.000Z')` as never);
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("helpers", () => {
  it("marks PNGs as AI-generated (idempotent) and reads size", () => {
    const f = path.join(DATA, "mark.png"); fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f, PNG);
    markPng(f, { aiGenerated: true, generator: "Marketing Pilot", model: "m" });
    markPng(f, { aiGenerated: true, generator: "Marketing Pilot", model: "m" });
    expect(readPngTextChunks(f)).toMatchObject({ "AI-generated": "true", Software: "Marketing Pilot (m)" });
    expect(pngSize(f)).toEqual({ width: 1, height: 1 });
    expect(fs.readFileSync(f).toString("latin1").split("XML:com.adobe.xmp").length).toBe(2);
  });
  it("renders markdown with tables, lists and headings", () => {
    const html = markdownToHtml("# T\n\nHallo **fett** [l](https://x.test)\n\n- a\n- b\n\n| K | V |\n|---|---|\n| 1 | 2 |\n\n1. eins");
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain('<a href="https://x.test" rel="noopener">l</a>');
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<table><thead><tr><th>K</th><th>V</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
    expect(html).toContain("<ol><li>eins</li></ol>");
  });
  it("builds utm links, slugs and deep links", () => {
    expect(buildUtmUrl("https://x.test/?a=1", { source: "linkedin", medium: "social", campaign: "start", content: "p1" })).toBe("https://x.test/?a=1&utm_source=linkedin&utm_medium=social&utm_campaign=start&utm_content=p1");
    expect(slugify("Beispielwerk vs. Rival Tool!")).toBe("beispielwerk-vs-rival-tool");
    expect(platformFromChannel("YouTube Shorts")).toBe("youtube");
    expect(platformFromChannel("Twitter/X")).toBe("x");
    expect(deepLinkFor("pinterest")?.url).toContain("pinterest.com");
  });
  it("picks a saturated primary over greys", () => {
    const counts = new Map([["#FFFFFF", 500], ["#222222", 200], ["#3D7A4E", 40], ["#CCCCCC", 90]]);
    expect(pickPalette(counts, ["#3D7A4E"], "#FFFFFF", "#222222")).toMatchObject({ primary: "#3D7A4E", ink: "#222222", background: "#FFFFFF" });
    expect(pickPalette(new Map([["#888888", 5]]), [], null, null).primary).toBeNull();
  });
  it("prompt snapshots carry the ban list", () => {
    expect(textPostPrompt({ brief, platform: "x", limit: 280, topic: "t", hint: "", coreMessage: null, voiceProfile: "Use du.", screenshotsAvailable: 1 })).toMatchSnapshot();
    expect(criticPrompt({ text: "x", language: "de", voiceProfile: null, format: "text" })[0]?.content).toContain("Game-Changer");
    expect(directoryPrompt({ brief, directory: { name: "SaaSHub", taglineMax: 60, fields: [], notes: "" }, competitors: ["RivalTool"], voiceProfile: null })).toMatchSnapshot();
    expect(parseDuckDuckGoHtml("")).toEqual([]);
  });
});

describe("studio API", () => {
  it("extracts the brand kit and derives a voice profile from samples", async () => {
    const kit = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/brandkit/extract`, headers: auth })).json();
    expect(kit).toMatchObject({ primary: "#3D7A4E", fonts: ["Gabarito"] });
    expect((await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}/brandkit`, headers: auth, payload: { primary: "#336842" } })).json().primary).toBe("#336842");
    expect((await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/voice/derive`, headers: auth })).statusCode).toBe(400);
    for (const t of ["Kurz gesagt: ich bau das selbst und es klappt meistens.", "Sonntagabend, 22 Uhr, drei Arbeitsblätter fehlen noch. Kenne ich.", "Ehrlich: die erste Version war Mist. Die zweite auch."]) {
      expect((await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/voice/samples`, headers: auth, payload: { text: t, source: "Post" } })).statusCode).toBe(201);
    }
    const profile = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/voice/derive`, headers: auth })).json();
    expect(profile).toMatchObject({ address: "du", sampleCount: 3 });
    const view = (await built.app.inject({ url: `/api/mp/projects/${pid}/studio`, headers: auth })).json();
    expect(view.brandKit.voiceProfile.promptBlock).toContain("Use du");
    expect(view.directories.map((d: { slug: string }) => d.slug)).toContain("producthunt");
  });

  it("text post: critic loop rewrites below 7 and stores score + notes", async () => {
    criticScores = [5, 8];
    const res = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth, payload: { format: "text", platform: "x", topic: "Sonntag" } });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p).toMatchObject({ format: "text", status: "review", channel: "x", aiTellScore: 8, humanEdited: false });
    expect(p.body).toContain("Überarbeitet");
    expect(p.aiTellNotes).toContain("Runde 0: 5/10");
    expect(p.meta).toMatchObject({ platform: "x", limit: 280, overLimit: false });
    const pkg = (await built.app.inject({ url: `/api/mp/content/${p.id}/package`, headers: auth })).json();
    expect(pkg.deepLink).toBe("https://x.com/compose/post");
    expect(pkg.utmLink).toContain("utm_source=x");
    expect(pkg.text).toContain("utm_content=" + p.id);
    expect(pkg.postizAvailable).toBe(false);
  });

  it("carousel renders both sizes with brand tokens and a screenshot slide", async () => {
    criticScores = [9];
    rendered.length = 0;
    const p = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth, payload: { format: "carousel", template: "bold", topic: "Sonntag" } })).json();
    expect(p.assets).toHaveLength(6);   // 3 slides x 2 sizes
    expect(rendered[0]).toContain("--b-primary:#336842");
    expect(rendered.some((h) => h.includes("data:image/png;base64"))).toBe(true);
    const pkg = (await built.app.inject({ url: `/api/mp/content/${p.id}/package`, headers: auth })).json();
    expect(pkg.assets.every((a: { aiGenerated: boolean }) => a.aiGenerated)).toBe(true);
    expect(pkg.notes.join(" ")).toContain("AI-generated");
    const file = await built.app.inject({ url: pkg.assets[0].url, headers: auth });
    expect(file.headers["content-type"]).toBe("image/png");
  });

  it("pin, image and directory entry", async () => {
    criticScores = [9, 9];
    const pin = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth, payload: { format: "pin", topic: "Sonntag frei" } })).json();
    expect(pin).toMatchObject({ format: "pin", channel: "pinterest" });
    expect(pin.meta.targetUrl).toContain("utm_source=pinterest");
    const img = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth, payload: { format: "image", topic: "Hintergrund" } })).json();
    expect(img.assets).toHaveLength(1);
    expect(img.body).toContain("nie als Ersatz für Produkt-Screenshots");
    const dir = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/directories/producthunt/prepare`, headers: auth });
    expect(dir.statusCode).toBe(201);
    const d = dir.json();
    expect(d.meta.fields.tagline.length).toBeLessThanOrEqual(60);
    expect(d.meta.deepLink).toContain("producthunt.com");
    expect(d.assets).toHaveLength(1);  // one screenshot x one required size
    const view = (await built.app.inject({ url: `/api/mp/projects/${pid}/studio`, headers: auth })).json();
    expect(view.directories.find((x: { slug: string }) => x.slug === "producthunt")).toMatchObject({ pieceId: d.id, pieceStatus: "review" });
    await built.app.inject({ method: "PATCH", url: `/api/mp/content/${d.id}`, headers: auth, payload: { status: "approved" } });
    await built.app.inject({ method: "PATCH", url: `/api/mp/content/${d.id}`, headers: auth, payload: { status: "published", externalUrl: "https://www.producthunt.com/posts/beispielwerk" } });
    const view2 = (await built.app.inject({ url: `/api/mp/projects/${pid}/studio`, headers: auth })).json();
    expect(view2.directories.find((x: { slug: string }) => x.slug === "producthunt").submittedUrl).toBe("https://www.producthunt.com/posts/beispielwerk");
    expect((await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth, payload: { format: "video" } })).statusCode).toBe(400);
  });

  it("GEO article with JSON-LD and HTML export; regenerate resets human edits", async () => {
    criticScores = [9, 9];
    const a = (await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth, payload: { format: "article", articleKind: "comparison", competitor: "RivalTool" } })).json();
    expect(a.meta.slug).toBe("beispielwerk-vs-rivaltool");
    expect(a.meta.jsonLd[0]["@type"]).toBe("FAQPage");
    const html = await built.app.inject({ url: `/api/mp/content/${a.id}/export.html`, headers: auth });
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain('<script type="application/ld+json">');
    expect(html.body).toContain("<table>");
    const edited = (await built.app.inject({ method: "PATCH", url: `/api/mp/content/${a.id}`, headers: auth, payload: { body: a.body + "\n\nMein Zusatz." } })).json();
    expect(edited.humanEdited).toBe(true);
    const regen = (await built.app.inject({ method: "POST", url: `/api/mp/content/${a.id}/regenerate`, headers: auth, payload: { hint: "kürzer" } })).json();
    expect(regen).toMatchObject({ id: a.id, humanEdited: false, status: "review" });
    const audit = (await built.app.inject({ url: `/api/mp/audit?projectId=${pid}`, headers: auth })).json();
    expect(audit[0]).toMatchObject({ action: "content.regenerate", content: { hint: "kürzer" } });
    const rejected = (await built.app.inject({ method: "PATCH", url: `/api/mp/content/${a.id}`, headers: auth, payload: { status: "rejected", reason: "zu lang" } })).json();
    expect(rejected.rejectionReason).toBe("zu lang");
    expect((await built.app.inject({ method: "POST", url: `/api/mp/content/${a.id}/schedule`, headers: auth, payload: { date: "2026-09-01T09:00:00.000Z" } })).statusCode).toBe(400);
  });
});
