/**
 * Shot 7: Daten-Carousel und Plattform-Bündel.
 *
 * Gearbeitet wird gegen dieselbe Art Fixture-Datenbank wie in Shot 6 und gegen
 * einen vorgefüllten Bildcache — so laufen die Tests ohne Netz. Die wichtigste
 * Zusicherung steht ganz unten: **die Zahlen auf den Slides sind exakt die aus
 * der Datenbank.**
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import type { LlmMessage, LlmProvider, LlmResult } from "../src/server/providers/index.js";
import type { Renderer } from "../src/server/agents/studio/render.js";
import type { Brief, ContentPiece, PublishPackage } from "../src/shared/schemas.js";
import { applyHashtagPolicy } from "../src/server/hashtags.js";
import { hashtagPolicy, linkRuleFor } from "../src/shared/channels.js";
import { PLATFORM_LIMITS } from "../src/server/util/utm.js";
import { processNextJob, writeHeartbeat } from "../src/server/jobs.js";
import { renderSlideshowJob } from "../src/server/agents/video/slideshow.js";
import type { VideoContext } from "../src/server/agents/video/pipeline.js";
import { fakeHost } from "./helpers.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const usage = { tokensIn: 40, tokensOut: 20, costUsd: 0.001 };
const json = (o: unknown): LlmResult => ({ text: JSON.stringify(o), model: "fake", usage });

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "mp-data-content-"));
const FIXTURE = path.join(DATA, "cache", "binderplan.db");
const IMAGES = path.join(DATA, "cache", "cards", "binderplan");

/** Die Preise, die auch auf den Slides stehen müssen — cent-genau, ungerundet. */
const PRICES: Record<string, number> = {
  "swsh12-1": 626.08, "swsh12-2": 411.5, "swsh12-3": 199.99, "swsh12-4": 88.4, "swsh12-5": 42.05,
  "swsh12-6": 21.3, "swsh12-7": 12.75, "swsh12-8": 9.1,
};

const FILLERS: string[] = [];

function buildFixture(): void {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  const db = new Database(FIXTURE);
  db.exec(`
    CREATE TABLE sets (id TEXT PRIMARY KEY, name TEXT, name_en TEXT, serie_id TEXT, serie_name TEXT,
                       release_date TEXT, total INTEGER, official INTEGER, symbol TEXT, serie_name_en TEXT, region TEXT, symbol_alt TEXT);
    CREATE TABLE cards (id TEXT PRIMARY KEY, set_id TEXT, local_id TEXT, local_num INTEGER, name_de TEXT, name_en TEXT,
                        name_ja TEXT, rarity TEXT, illustrator TEXT, region TEXT, image_de TEXT, image_en TEXT,
                        image_alt TEXT, kinds TEXT, release_date TEXT);
    CREATE TABLE card_prices (card_id TEXT PRIMARY KEY, eur REAL, updated_at TEXT, eur_holo REAL);
    CREATE TABLE price_history (card_id TEXT, datum TEXT, eur REAL);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare("INSERT INTO sets (id,name,name_en,serie_id,serie_name,release_date,total,region) VALUES (?,?,?,?,?,?,?,?)")
    .run("swsh12", "Silberne Sturmwinde", "Silver Tempest", "swsh", "Schwert & Schild", "2022-11-11", 215, "intl");
  const card = db.prepare(`INSERT INTO cards (id,set_id,local_id,local_num,name_de,name_en,name_ja,rarity,illustrator,region,image_de,image_en,image_alt,kinds,release_date)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const price = db.prepare("INSERT INTO card_prices (card_id,eur,updated_at,eur_holo) VALUES (?,?,?,?)");
  // Preise, die frisch genug sind, damit nichts nachgeladen wird (kein Netz im Test).
  const fresh = new Date(Date.now() - 3600_000).toISOString().slice(0, 19).replace("T", " ");
  Object.entries(PRICES).forEach(([id, eur], i) => {
    card.run(id, "swsh12", String(180 + i), 180 + i, `Karte ${i + 1}`, `Card ${i + 1}`, null, "Ultra Rare", "Illu A", "intl",
      `https://img/de/${id}`, `https://img/en/${id}`, null, "[]", "2022-11-11");
    price.run(id, eur, fresh, null);
  });
  // Guenstige Fuellkarten: sie taucht keine Top-Liste auf, machen aber ein langes
  // Reel moeglich (Test der 60-Sekunden-Grenze).
  for (let i = 1; i <= 20; i++) {
    const id = `swsh12-f${i}`;
    card.run(id, "swsh12", String(i), i, `Fuellkarte ${i}`, `Filler ${i}`, null, "Common", "Illu B", "intl",
      `https://img/de/${id}`, null, null, "[]", "2022-11-11");
    price.run(id, 2 + i / 100, fresh, null);
    FILLERS.push(id);
  }
  db.close();
  // Bildcache vorfuellen: cardImage findet die Dateien lokal und geht nie ins Netz.
  fs.mkdirSync(IMAGES, { recursive: true });
  for (const id of [...Object.keys(PRICES), ...FILLERS]) for (const lang of ["de", "en"]) fs.writeFileSync(path.join(IMAGES, `${id}.${lang}.webp`), PNG);
}

const brief: Brief = { productName: "Binderplan", oneLiner: "Binder planen.", category: "collection planner", language: "de", features: ["Binder"], pricing: [], usp: [], tone: "Du", targetAudience: "Sammler", keywords: [], sources: [] };

const CAPTIONS = [
  { platform: "instagram", caption: "Platz 1 kostet 626,08 €.\nKein offizielles Pokémon-Produkt.", hashtags: ["#pokemontcg", "#silbernesturmwinde", "#sammeln"] },
  { platform: "tiktok", caption: "Die teuersten Karten aus Silberne Sturmwinde.", hashtags: ["#pokemon", "#tcg", "#karten", "#sammeln", "#binder", "#preise", "#zuviel"] },
  { platform: "pinterest", caption: "Teuerste Karten aus Silberne Sturmwinde — mit Preisen.", hashtags: ["#pokemon", "#tcg"] },
  { platform: "linkedin", caption: "Was Sammlerdaten über Preise verraten.", hashtags: ["#daten", "#pokemon", "#tcg", "#markt"] },
];

/** Alles, was ans Modell ging - fuer die Probe, dass die Zahlen fertig formatiert ankommen. */
const seenPrompts: string[] = [];
const fakeLlm: LlmProvider = {
  async chat(_model: string, messages: LlmMessage[]): Promise<LlmResult> {
    seenPrompts.push(messages.map((m) => m.content).join("\n"));
    const task = /^\[task:([a-z-]+)\]/.exec(messages.find((m) => m.role === "system")?.content ?? "")?.[1];
    switch (task) {
      case "data-content": return json({ title: "Top 5 Silberne Sturmwinde", coverTitle: "Die 5 teuersten Karten aus Silberne Sturmwinde", hook: "Platz 1 ist 626,08 € wert.", ctaLine: "Sortier deinen Binder mit Binderplan.", captions: CAPTIONS });
      case "hashtag-pools": return json({ brand: ["binderplan", "binderplanapp"], topics: { sammeln: ["sammlerstueck", "kartensammlung"] }, byLanguage: { de: ["pokemondeutschland", "kartenpreise"], en: ["pokemoncards"] } });
      case "ai-tell-critic": return json({ score: 9, issues: [], suggestions: [] });
      case "rewrite": return json({ body: "Überarbeitet." });
      default: return { text: "irrelevant", model: "fake", usage };
    }
  },
};

const rendered = new Map<string, string>();
const fakeRenderer: Renderer = async (jobs) => {
  for (const j of jobs) {
    fs.mkdirSync(path.dirname(j.file), { recursive: true });
    fs.writeFileSync(j.file, PNG);
    rendered.set(path.basename(j.file), j.html);
  }
};

let built: Awaited<ReturnType<typeof buildApp>>;
const auth = { authorization: "Bearer test-token" };
let pid = "";
let lead: ContentPiece;
let bundle: ContentPiece[] = [];

beforeAll(async () => {
  buildFixture();
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA, MP_BINDERPLAN_DB: FIXTURE, MP_PUBLIC_BASE: "https://agi-empire.test" }),
    { host: fakeHost(), dbFile: ":memory:", logger: false, services: { llm: fakeLlm, renderer: fakeRenderer, image: null } });
  pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Binderplan", url: "https://binderplan.app" } })).json().id;
  await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}`, headers: auth, payload: { brief } });
  await built.app.inject({ method: "PUT", url: `/api/mp/projects/${pid}/data-source`, headers: auth, payload: { provider: "binderplan" } });
  await built.app.inject({ method: "PUT", url: `/api/mp/projects/${pid}/hashtags`, headers: auth, payload: { brand: ["binderplan"], topics: { sammeln: ["sammlerstueck", "kartensammlung", "binderseite"] }, byLanguage: { de: ["pokemondeutschland", "kartenpreise", "sammelkarten"], en: [] }, suggestedAt: null } });
}, 60_000);
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("Plattform-Politik", () => {
  it("kennt TikTok und YouTube als Textlängen", () => {
    expect(PLATFORM_LIMITS["tiktok"]).toBe(2200);
    expect(PLATFORM_LIMITS["youtube"]).toBe(5000);
  });
  it("gibt jeder Plattform ihre eigene Hashtag-Zahl", () => {
    expect(hashtagPolicy("instagram")).toMatchObject({ min: 6, max: 10 });
    expect(hashtagPolicy("linkedin").max).toBe(2);
    expect(hashtagPolicy("pinterest").max).toBe(0);
    expect(hashtagPolicy("unbekannt").max).toBe(2);
  });
  it("stutzt auf das Maximum und füllt nur bis zum Minimum aus dem Vorrat", () => {
    const pools = { brand: ["marke"], topics: { a: ["thema1", "thema2"] }, byLanguage: { de: ["de1", "de2", "de3", "de4"], en: [] }, suggestedAt: null };
    expect(applyHashtagPolicy(["#a", "#b", "#c"], pools, "instagram", "de")).toEqual(["#a", "#b", "#c", "#marke", "#de1", "#de2"]);
    expect(applyHashtagPolicy(["#a", "#b", "#c", "#d"], pools, "linkedin", "de")).toEqual(["#a", "#b"]);
    expect(applyHashtagPolicy(["#a"], pools, "pinterest", "de")).toEqual([]);
    // doppelte und leere Eingaben fliegen raus
    expect(applyHashtagPolicy(["#a", "a", "#A", " "], pools, "tiktok", "de")).toEqual(["#a", "#marke", "#de1"]);
  });
  it("weiß, wo ein Link im Text nicht klickbar ist", () => {
    expect(linkRuleFor("instagram")).toBe("bio");
    expect(linkRuleFor("tiktok")).toBe("bio");
    expect(linkRuleFor("linkedin")).toBe("link");
  });
});

describe("Daten-Bündel", () => {
  it("erzeugt aus einem Lauf ein Stück je Plattform", async () => {
    const res = await built.app.inject({
      method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth,
      payload: { format: "data_carousel", language: "de", bundlePlatforms: ["instagram", "tiktok", "pinterest", "linkedin"], dataQuery: { kind: "top", set: "swsh12", n: 5, countdown: true } },
    });
    expect(res.statusCode).toBe(201);
    lead = res.json();
    expect(lead.format).toBe("data_carousel");
    expect(lead.channel).toBe("instagram");
    expect(lead.status).toBe("review");

    bundle = (await built.app.inject({ method: "GET", url: `/api/mp/content/${lead.id}/bundle`, headers: auth })).json();
    expect(bundle.map((p) => p.channel)).toEqual(["instagram", "linkedin", "pinterest", "tiktok"]);
    expect(bundle[0]!.id).toBe(lead.id);
    for (const p of bundle) expect(p.meta["bundleId"]).toBe(lead.id);
  }, 60_000);

  it("gibt jeder Plattform ihre eigene Größe, Caption und Hashtag-Zahl", () => {
    const by = (p: string) => bundle.find((x) => x.channel === p)!;
    expect(by("instagram").meta["size"]).toBe("1080x1350");
    expect(by("tiktok").meta["size"]).toBe("1080x1920");
    expect(by("pinterest").meta["size"]).toBe("1000x1500");

    // Instagram: 3 Vorschlaege, aufgefuellt auf das Minimum von 6.
    expect((by("instagram").meta["hashtags"] as string[]).length).toBe(6);
    expect((by("tiktok").meta["hashtags"] as string[]).length).toBe(6);
    expect(by("pinterest").meta["hashtags"]).toEqual([]);
    expect((by("linkedin").meta["hashtags"] as string[]).length).toBe(2);
    // Die Tags stehen im Text, nicht nur in den Metadaten.
    expect(by("instagram").body).toContain("#pokemontcg");
    expect(by("pinterest").body).not.toContain("#");
    // Link-Regel je Plattform
    expect(by("instagram").meta["linkRule"]).toBe("bio");
    expect(by("linkedin").meta["linkRule"]).toBe("link");
  });

  it("teilt die Slides: 5 Karten + Cover + CTA, dieselben Dateien für gleiche Größe", () => {
    const by = (p: string) => bundle.find((x) => x.channel === p)!;
    expect(by("instagram").assets.length).toBe(7);
    expect(by("tiktok").assets.length).toBe(7);
    // instagram (bio) und linkedin (link) teilen 6 Slides, nur die CTA-Slide unterscheidet sich
    const shared = by("instagram").assets.filter((a) => by("linkedin").assets.includes(a));
    expect(shared.length).toBe(6);
  });

  it("druckt die Zahlen der Datenbank unverändert auf die Slides", () => {
    const slides = [...rendered.entries()].filter(([f]) => f.startsWith("de-1080x1350-") && f.includes("rang"));
    expect(slides.length).toBe(5);
    const top5 = Object.entries(PRICES).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [, eur] of top5) {
      const label = `${eur.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
      expect(slides.some(([, html]) => html.includes(label))).toBe(true);
    }
    // Countdown: die erste Slide nach dem Cover traegt den letzten Platz.
    expect(slides.find(([f]) => f.includes("-01-"))?.[0]).toContain("rang5");
    // Fusszeile mit Quelle und Stand-Datum auf jeder Slide, auch auf Cover und CTA.
    const heute = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    for (const [, html] of rendered) expect(html).toContain(`Preise: Cardmarket-Trend · Stand ${heute} · binderplan.app`);
  });

  it("gibt dem Modell die Zahlen fertig formatiert (es soll zitieren, nicht rechnen)", () => {
    const prompt = seenPrompts.find((p) => p.includes("[task:data-content]"))!;
    const liste = prompt.slice(prompt.indexOf("RANKING"));
    expect(liste).toContain("— 626,08 €");
    expect(liste).not.toContain("626.08");
    expect(prompt).toContain("Copy them character for character");
  });

  it("beschriftet die CTA-Slide nach der Link-Regel der Plattform", () => {
    expect(rendered.get("de-1080x1350-99-cta-bio.png")).toContain("Link in Bio");
    expect(rendered.get("de-1080x1350-99-cta-link.png")).toContain("binderplan.app");
    expect(rendered.get("de-1080x1350-99-cta-link.png")).not.toContain("Link in Bio");
  });

  it("legt die Zahlen zusätzlich als Prüfspur ans Stück", () => {
    const cards = lead.meta["cards"] as { rank: number; priceEur: number }[];
    expect(cards.length).toBe(5);
    expect(cards[0]!.priceEur).toBe(626.08);
    expect(cards[0]!.rank).toBe(1);
    expect(lead.meta["totalEur"]).toBe(Object.values(PRICES).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0));
    expect(lead.meta["scopeLabel"]).toContain("Silberne Sturmwinde");
  });

  it("liefert jedem Bündel-Mitglied sein Publish-Paket samt Assets", async () => {
    const tiktok = bundle.find((x) => x.channel === "tiktok")!;
    const pkg: PublishPackage = (await built.app.inject({ method: "GET", url: `/api/mp/content/${tiktok.id}/package`, headers: auth })).json();
    expect(pkg.platform).toBe("tiktok");
    expect(pkg.assets.length).toBe(7);
    expect(pkg.appOnly).toBe(true);
    expect(pkg.notes.join(" ")).toContain("Link in Bio");
  });

  it("gibt das ganze Bündel mit einem Klick frei", async () => {
    const res = await built.app.inject({ method: "POST", url: `/api/mp/content/${lead.id}/bundle/status`, headers: auth, payload: { status: "approved", reason: "" } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ContentPiece[]).every((p) => p.status === "approved")).toBe(true);
    const audit = (await built.app.inject({ method: "GET", url: `/api/mp/audit?projectId=${pid}`, headers: auth })).json() as { action: string }[];
    expect(audit.some((a) => a.action === "content.bundle.approved")).toBe(true);
  });

  it("verweigert ein Bündel ohne Datenquelle", async () => {
    const other = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Ohne Daten", url: "https://ohne.test" } })).json().id;
    await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${other}`, headers: auth, payload: { brief } });
    const res = await built.app.inject({ method: "POST", url: `/api/mp/projects/${other}/content`, headers: auth, payload: { format: "data_carousel", dataQuery: { kind: "top", set: "swsh12" } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("Produktdatenquelle");
  });
});

describe("Hashtag-Vorräte", () => {
  it("schlägt Vorräte vor und behält vorhandene Themen", async () => {
    const res = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/hashtags/suggest`, headers: auth });
    expect(res.statusCode).toBe(200);
    const pools = res.json();
    expect(pools.brand).toContain("binderplan");
    expect(pools.byLanguage.de).toContain("kartenpreise");
    expect(pools.suggestedAt).not.toBeNull();
  });
  it("speichert ohne „#“ und ohne Dubletten", async () => {
    const res = await built.app.inject({ method: "PUT", url: `/api/mp/projects/${pid}/hashtags`, headers: auth,
      payload: { brand: ["#Marke", "marke", " "], topics: { leer: [] }, byLanguage: { de: ["#a"], en: [] }, suggestedAt: null } });
    expect(res.json().brand).toEqual(["marke"]);
    expect(res.json().topics).toEqual({});
  });
});


describe("Daten-Reel (Shot 8)", () => {
  /** ffmpeg-Attrappe: schreibt Platzhalter-Dateien und merkt sich jeden Aufruf. */
  const calls: string[][] = [];
  const fakeFfmpeg = async (args: string[]): Promise<string> => {
    calls.push(args);
    const out = args[args.length - 1]!;
    if (/\.(mp4|mp3|png)$/.test(out)) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, PNG); }
    return "";
  };
  let reelLead: ContentPiece;

  it("erzeugt ein Reel-Bündel als Entwurf und stellt den Render-Job ein", async () => {
    writeHeartbeat(built.db);   // ohne lebenden Worker lehnt die API bewusst ab
    const res = await built.app.inject({
      method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth,
      payload: { format: "data_reel", language: "de", bundlePlatforms: ["instagram", "tiktok"], reel: { voiceover: false, music: "none", secondsPerCard: 1.8 },
        dataQuery: { kind: "top", set: "swsh12", n: 5, countdown: true } },
    });
    expect(res.statusCode).toBe(201);
    reelLead = res.json();
    expect(reelLead.format).toBe("data_reel");
    // Bis die MP4 existiert, ist das Stück ein Entwurf - sonst stünde es freigabefertig ohne Video da.
    expect(reelLead.status).toBe("draft");
    const members: ContentPiece[] = (await built.app.inject({ method: "GET", url: `/api/mp/content/${reelLead.id}/bundle`, headers: auth })).json();
    // Reels sind immer 1080x1920 - auch das Instagram-Stück
    expect(members.every((p) => p.meta["size"] === "1080x1920")).toBe(true);
    expect(members.every((p) => p.assets.length === 7)).toBe(true);
  }, 60_000);

  it("baut aus den Slides ein Video und hängt es an alle Stücke des Bündels", async () => {
    const ctx: VideoContext = {
      db: built.db, env: loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA, MP_BINDERPLAN_DB: FIXTURE }),
      dataDir: DATA, log: () => undefined, voice: null, renderer: fakeRenderer, ffmpeg: fakeFfmpeg,
    };
    const did = await processNextJob(ctx, { "video.slideshow": renderSlideshowJob });
    expect(did).toBe(true);

    const members: ContentPiece[] = (await built.app.inject({ method: "GET", url: `/api/mp/content/${reelLead.id}/bundle`, headers: auth })).json();
    expect(members.length).toBe(2);
    for (const p of members) {
      expect(p.status).toBe("review");
      // Nach dem Render zählt das Video, nicht mehr die 7 Slides.
      expect(p.assets.length).toBe(2);
      expect(p.meta["durationMs"]).toBe(members[0]!.meta["durationMs"]);
    }
    // Alle Mitglieder zeigen auf dieselbe Datei
    expect(members[0]!.assets).toEqual(members[1]!.assets);

    const pkg: PublishPackage = (await built.app.inject({ method: "GET", url: `/api/mp/content/${members[1]!.id}/package`, headers: auth })).json();
    expect(pkg.assets.map((a) => a.filename).sort()).toEqual(["reel-thumb.png", "reel.mp4"]);
  }, 60_000);

  it("baut ein Segment je Slide, in Anzeigereihenfolge, und setzt am Ende zusammen", () => {
    const segs = calls.filter((a) => a.includes("-filter_complex") && a[a.length - 1]!.includes("seg-"));
    // Hook + Cover + 5 Karten + CTA
    expect(segs.length).toBe(8);
    expect(segs[0]![a0(segs[0]!)]).toContain("hook.png");
    expect(segs[1]![a0(segs[1]!)]).toContain("00-cover.png");
    // Countdown: die erste Karte im Video ist Platz 5
    expect(segs[2]![a0(segs[2]!)]).toContain("rang5");
    expect(segs[6]![a0(segs[6]!)]).toContain("rang1");
    expect(segs[7]![a0(segs[7]!)]).toContain("cta");

    const concat = calls.find((a) => a.includes("concat") && a.includes("-safe"));
    expect(concat).toBeTruthy();
    const compose = calls.find((a) => a.join(" ").includes("data slideshow"));
    expect(compose).toBeTruthy();
    // stumm gerendert: keine Sprachdatei, nur Stille je Segment
    const filter = compose![compose!.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("concat=n=8:v=0:a=1[voice]");
    expect(filter).not.toContain("sidechaincompress");
  });

  it("hält die 60-Sekunden-Grenze ein", async () => {
    const members: ContentPiece[] = (await built.app.inject({ method: "GET", url: `/api/mp/content/${reelLead.id}/bundle`, headers: auth })).json();
    const plan = members[0]!.meta["reelPlan"] as { secondsPerCard: number; dropped: string[]; totalMs: number };
    expect(plan.totalMs).toBeLessThanOrEqual(60_000);
    expect(plan.dropped).toEqual([]);
    expect(plan.secondsPerCard).toBe(1.8);
    expect(members[0]!.meta["durationMs"]).toBe(plan.totalMs);
  });

  it("kürzt die Liste VOR dem Modellaufruf, wenn sie mit Stimme nicht in 60 s passt", async () => {
    writeHeartbeat(built.db);
    const res = await built.app.inject({
      method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth,
      payload: { format: "data_reel", bundlePlatforms: ["tiktok"], reel: { voiceover: true, music: "none", secondsPerCard: 2.5 },
        dataQuery: { kind: "top", set: "swsh12", n: 20, countdown: true } },
    });
    expect(res.statusCode).toBe(201);
    const piece: ContentPiece = res.json();
    const cards = piece.meta["cards"] as { rank: number }[];
    // Das Modell darf gar nicht erst „die Top 20" schreiben, wenn nur ein Teil ins Video passt.
    expect(cards.length).toBeLessThan(20);
    expect(cards[0]!.rank).toBe(1);
    expect(cards[cards.length - 1]!.rank).toBe(cards.length);
    expect(piece.aiTellNotes).toContain("passt mit dieser Standzeit und Voiceover nicht in 60 Sekunden");
    // die Slides zeigen genau diese Karten: Cover + Karten + CTA
    expect(piece.assets.length).toBe(cards.length + 2);
  }, 60_000);

  it("lehnt ein Reel ohne laufenden Worker ab, bevor das Modell Geld kostet", async () => {
    built.db.run("DELETE FROM mp_settings WHERE key = 'worker:heartbeat'" as never);
    const res = await built.app.inject({
      method: "POST", url: `/api/mp/projects/${pid}/content`, headers: auth,
      payload: { format: "data_reel", bundlePlatforms: ["tiktok"], dataQuery: { kind: "top", set: "swsh12", n: 5 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("Render-Worker");
  });
});

/** Index des Eingabe-Dateinamens in einem ffmpeg-Aufruf (das Argument nach dem letzten `-i`). */
function a0(args: string[]): number {
  return args.lastIndexOf("-i", args.indexOf("-filter_complex")) + 1;
}
