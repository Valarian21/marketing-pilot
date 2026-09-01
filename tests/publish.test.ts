/**
 * Shot 10: Veröffentlichen v2. Geprüft wird gegen Attrappen — kein echter
 * Account, kein Netz. Die wichtigsten Zusicherungen sind die Sperren: Reddit
 * bekommt keinen Poster, gesperrte und nur-manuelle Plattformen lassen sich
 * nicht einplanen, und eine signierte Asset-Adresse läuft ab.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import { assetToken, ASSET_TTL_MS, readAssetToken } from "../src/server/publish/asset-tokens.js";
import { linkFacets, blueskyPoster, telegramPoster, instagramPoster } from "../src/server/publish/posters.js";
import { platformStatus, posterFor, saveCredentials } from "../src/server/publish/index.js";
import { duePosts, nextFreeSlot, runScheduledPost, schedulePiece } from "../src/server/publish/schedule.js";
import { PLATFORM_POSTING } from "../src/server/publish/types.js";
import { saveProfiles } from "../src/server/channels.js";
import { fakeHost } from "./helpers.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "mp-publish-"));
const auth = { authorization: "Bearer test-token" };
let built: Awaited<ReturnType<typeof buildApp>>;
let pid = "";
let pieceId = "";

/** Merkt sich jeden Aufruf und antwortet, was die echte API antworten würde. */
function fakeNet() {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("createSession")) return ok({ accessJwt: "jwt", did: "did:plc:x", handle: "binderplan.bsky.social" });
    if (u.includes("uploadBlob")) return ok({ blob: { $type: "blob", ref: { $link: "cid1" } } });
    if (u.includes("createRecord")) return ok({ uri: "at://did:plc:x/app.bsky.feed.post/3kabc" });
    if (u.includes("api.telegram.org")) return ok({ result: { message_id: 42 } });
    if (u.includes("/media_publish")) return ok({ id: "ig-post-1" });
    if (u.includes("/media")) return ok({ id: `container-${calls.length}` });
    return ok({});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeAll(async () => {
  built = await buildApp(loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA, MP_PUBLIC_BASE: "https://agi-empire.test" }),
    { host: fakeHost(), dbFile: ":memory:", logger: false });
  pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Binderplan", url: "https://binderplan.app" } })).json().id;
  // ein freigegebenes Stück mit einem Bild
  const dir = path.join(DATA, "assets", pid, "pieces", "p1");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "slide.png"), PNG);
  built.db.run(`INSERT INTO mp_content_pieces (id, project_id, task_id, channel, format, title, body, assets, status, human_edited, published_at, external_url, utm, meta, ai_tell_score, ai_tell_notes, rejection_reason, created_at, updated_at)
    VALUES ('p1', '${pid}', NULL, 'bluesky', 'data_carousel', 'Top 5', 'Die teuersten Karten. https://agi-empire.test/go/abc123', '["a1"]', 'approved', 0, NULL, NULL, '{}', '{"platform":"bluesky"}', NULL, '', '', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')` as never);
  built.db.run(`INSERT INTO mp_assets (id, project_id, content_piece_id, kind, path, meta, created_at)
    VALUES ('a1', '${pid}', 'p1', 'render', 'assets/${pid}/pieces/p1/slide.png', '{"alt":"Platz 1"}', '2026-09-01T00:00:00.000Z')` as never);
  pieceId = "p1";
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("Was auf welcher Plattform erlaubt ist", () => {
  it("gibt Reddit keinen Poster — und zwar an der Stelle, an der es zählt", () => {
    expect(PLATFORM_POSTING["reddit"]!.mode).toBe("blocked");
    expect(posterFor("reddit")).toBeNull();
    expect(posterFor("REDDIT")).toBeNull();
  });
  it("lässt X, LinkedIn, TikTok und YouTube bewusst manuell — mit Begründung", () => {
    for (const p of ["x", "linkedin", "tiktok", "youtube"]) {
      expect(posterFor(p)).toBeNull();
      expect(PLATFORM_POSTING[p]!.reason.length).toBeGreaterThan(30);
    }
    expect(PLATFORM_POSTING["tiktok"]!.mode).toBe("needs_audit");
    expect(PLATFORM_POSTING["x"]!.mode).toBe("manual");
  });
  it("meldet einen Kanal erst als eingerichtet, wenn nichts mehr fehlt", () => {
    const vorher = platformStatus(built.db, pid).find((x) => x.platform === "bluesky")!;
    expect(vorher.configured).toBe(false);
    expect(vorher.mode).toBe("api");
    saveCredentials(built.db, pid, { bluesky: { handle: "binderplan.bsky.social", appPassword: "abcd-efgh" } });
    expect(platformStatus(built.db, pid).find((x) => x.platform === "bluesky")!.configured).toBe(true);
    // Instagram wechselt erst mit Zugang von „Zugang fehlt" auf „postet automatisch"
    expect(platformStatus(built.db, pid).find((x) => x.platform === "instagram")!.mode).toBe("needs_setup");
    saveCredentials(built.db, pid, { instagram: { igUserId: "1789", accessToken: "tok" } });
    expect(platformStatus(built.db, pid).find((x) => x.platform === "instagram")!.mode).toBe("api");
  });
  it("überschreibt gespeicherte Geheimnisse nicht mit Leere", () => {
    saveCredentials(built.db, pid, { bluesky: { handle: "", appPassword: "" } });
    // beide Felder leer -> beide geloescht; die Probe gilt dem Teil-Update:
    saveCredentials(built.db, pid, { bluesky: { handle: "binderplan.bsky.social", appPassword: "abcd-efgh" } });
    saveCredentials(built.db, pid, { bluesky: { handle: "neu.bsky.social" } });
    const st = platformStatus(built.db, pid).find((x) => x.platform === "bluesky")!;
    expect(st.configured).toBe(true);   // das Passwort steht noch
  });
});

describe("Signierte Asset-Adressen", () => {
  it("gibt die Asset-ID zurück und läuft danach ab", () => {
    const now = Date.now();
    const tok = assetToken(built.db, "a1", now);
    expect(readAssetToken(built.db, tok, now + 1000)).toBe("a1");
    expect(readAssetToken(built.db, tok, now + ASSET_TTL_MS + 1000)).toBeNull();
  });
  it("weist gefälschte und verdrehte Token ab", () => {
    const tok = assetToken(built.db, "a1");
    expect(readAssetToken(built.db, `${tok}x`)).toBeNull();
    expect(readAssetToken(built.db, tok.replace(/\.[^.]+$/, ".falschesig"))).toBeNull();
    expect(readAssetToken(built.db, "quatsch")).toBeNull();
  });
  it("liefert die Datei öffentlich aus — aber nur mit gültigem Token", async () => {
    const tok = assetToken(built.db, "a1");
    const ok = await built.app.inject({ method: "GET", url: `/go/a/${tok}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("image/png");
    expect((await built.app.inject({ method: "GET", url: "/go/a/erfunden" })).statusCode).toBe(404);
  });
});

describe("Slots und Zeitplan", () => {
  it("legt ohne Slot eine Stunde nach jetzt, mit Slot auf den nächsten freien", () => {
    const now = new Date("2026-09-01T08:00:00Z");   // Dienstag, 10:00 Berlin
    expect(nextFreeSlot(built.db, pid, "bluesky", now).getTime()).toBe(now.getTime() + 3600_000);
    saveProfiles(built.db, pid, [{ platform: "bluesky", label: "Bluesky", url: "", slots: [{ day: "wed", hour: 9 }], publishMode: "scheduled", autoWeeklyCap: 5 }]);
    // Mittwoch 9 Uhr Berlin = 07:00 UTC
    expect(nextFreeSlot(built.db, pid, "bluesky", now).toISOString()).toBe("2026-09-02T07:00:00.000Z");
  });

  it("verweigert das Einplanen dort, wo bewusst nicht gepostet wird", () => {
    expect(() => schedulePiece(built.db, pid, { pieceId, platforms: ["reddit"] })).toThrowError(/bewusst keinen automatischen Weg/);
    expect(() => schedulePiece(built.db, pid, { pieceId, platforms: ["x"] })).toThrowError(/bewusst keinen automatischen Weg/);
  });

  it("verweigert das Einplanen ohne Zugangsdaten", () => {
    expect(() => schedulePiece(built.db, pid, { pieceId, platforms: ["mastodon"] })).toThrowError(/Zugangsdaten fehlen/);
  });

  it("plant je Kanal einen Eintrag und belegt einen Slot nur einmal", () => {
    const now = new Date("2026-09-01T08:00:00Z");
    const a = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], now });
    expect(a[0]!.scheduledAt).toBe("2026-09-02T07:00:00.000Z");
    const b = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], now });
    // derselbe Slot ist belegt - der naechste Mittwoch
    expect(b[0]!.scheduledAt).toBe("2026-09-09T07:00:00.000Z");
    expect(duePosts(built.db, now)).toEqual([]);
    expect(duePosts(built.db, new Date("2026-09-02T08:00:00Z")).length).toBe(1);
  });
});

describe("Posten", () => {
  it("postet über Bluesky mit Bild und macht den Link klickbar", async () => {
    const net = fakeNet();
    const entry = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], at: "2026-09-01T09:00:00.000Z" })[0]!;
    const res = await runScheduledPost({ db: built.db, env: built.ctx?.env ?? loadEnv({ MP_DATA_DIR: DATA, MP_PUBLIC_BASE: "https://agi-empire.test" }), dataDir: DATA, log: () => undefined, fetchImpl: net.impl, now: () => new Date("2026-09-01T09:00:05.000Z") }, entry);
    expect(res.ok).toBe(true);

    const record = JSON.parse(String(net.calls.find((c) => c.url.includes("createRecord"))!.init.body)) as { record: { text: string; embed?: unknown; facets?: unknown[] } };
    expect(record.record.embed).toBeTruthy();
    expect(record.record.facets).toHaveLength(1);
    expect(net.calls.some((c) => c.url.includes("uploadBlob"))).toBe(true);

    // Das Stück ist danach veröffentlicht und weiß, worüber
    const piece = (await built.app.inject({ method: "GET", url: `/api/mp/content/${pieceId}`, headers: auth })).json();
    expect(piece.status).toBe("published");
    expect(piece.meta.postedVia).toBe("api:bluesky");
    expect(piece.externalUrl).toBe("https://bsky.app/profile/binderplan.bsky.social/post/3kabc");

    const audit = (await built.app.inject({ method: "GET", url: `/api/mp/audit?projectId=${pid}`, headers: auth })).json() as { action: string }[];
    expect(audit.some((a) => a.action === "publish.posted")).toBe(true);
  });

  it("erzeugt bei einem Fehlschlag eine Aufgabe statt eines stillen Verlusts", async () => {
    const boom = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    // Das Stück ist aus dem vorherigen Test veröffentlicht - für diese Probe wieder freigegeben.
    built.db.run(`UPDATE mp_content_pieces SET status = 'approved' WHERE id = '${pieceId}'` as never);
    const entry = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], at: "2026-09-01T09:00:00.000Z" })[0]!;
    const res = await runScheduledPost({ db: built.db, env: loadEnv({ MP_DATA_DIR: DATA }), dataDir: DATA, log: () => undefined, fetchImpl: boom }, entry);
    expect(res.ok).toBe(false);
    const tasks = (await built.app.inject({ method: "GET", url: `/api/mp/projects/${pid}/tasks`, headers: auth })).json() as { title: string; type: string }[];
    expect(tasks.some((t) => t.title.startsWith("Von Hand posten:"))).toBe(true);
    const audit = (await built.app.inject({ method: "GET", url: `/api/mp/audit?projectId=${pid}`, headers: auth })).json() as { action: string }[];
    expect(audit.some((a) => a.action === "publish.failed")).toBe(true);
  });

  it("kürzt für Bluesky auf 300 Zeichen, statt sich abschneiden zu lassen", async () => {
    const net = fakeNet();
    await blueskyPoster.post({ platform: "bluesky", text: "a ".repeat(200), assets: [], link: null, title: "", creds: { handle: "h", appPassword: "p" }, fetchImpl: net.impl });
    const record = JSON.parse(String(net.calls.find((c) => c.url.includes("createRecord"))!.init.body)) as { record: { text: string } };
    expect(record.record.text.length).toBeLessThanOrEqual(300);
    expect(record.record.text.endsWith("…")).toBe(true);
  });

  it("schickt bei Telegram Bild und Bildunterschrift in einem Aufruf", async () => {
    const net = fakeNet();
    const out = await telegramPoster.post({
      platform: "telegram", text: "Hallo", link: null, title: "", creds: { botToken: "123:abc", chatId: "@binderplan" }, fetchImpl: net.impl,
      assets: [{ path: path.join(DATA, "assets", pid, "pieces", "p1", "slide.png"), url: "", mime: "image/png", alt: "x", kind: "image" }],
    });
    expect(net.calls[0]!.url).toContain("/sendPhoto");
    expect(out.externalUrl).toBe("https://t.me/binderplan/42");
  });

  it("baut für Instagram Kind-Container, Sammel-Container und Veröffentlichung", async () => {
    const net = fakeNet();
    const assets = [1, 2, 3].map(() => ({ path: "x", url: "https://agi-empire.test/go/a/tok", mime: "image/png", alt: "", kind: "image" as const }));
    const out = await instagramPoster.post({ platform: "instagram", text: "Caption", assets, link: null, title: "", creds: { igUserId: "1789", accessToken: "tok" }, fetchImpl: net.impl });
    const media = net.calls.filter((c) => c.url.endsWith("/media"));
    expect(media.length).toBe(4);            // 3 Kinder + 1 Sammel-Container
    expect(String(media[0]!.init.body)).toContain("is_carousel_item=true");
    expect(String(media[3]!.init.body)).toContain("media_type=CAROUSEL");
    expect(out.ref).toBe("ig-post-1");
  });

  it("erkennt Links im Text byte-genau (Bluesky-Facetten)", () => {
    const f = linkFacets("Schau mal: https://agi-empire.test/go/abc – lohnt sich") as { index: { byteStart: number; byteEnd: number } }[];
    expect(f).toHaveLength(1);
    expect(f[0]!.index.byteStart).toBe(11);
    expect(f[0]!.index.byteEnd).toBe(11 + "https://agi-empire.test/go/abc".length);
  });
});

describe("Bio-Seite", () => {
  it("ist erst erreichbar, wenn sie eingeschaltet wurde", async () => {
    // Auf die Bio-Seite kommt nur, was veroeffentlicht ist.
    built.db.run(`UPDATE mp_content_pieces SET status = 'published', published_at = '2026-09-01T10:00:00.000Z' WHERE id = '${pieceId}'` as never);
    const off = await built.app.inject({ method: "PUT", url: `/api/mp/projects/${pid}/publish/bio`, headers: auth, payload: { headline: "Binderplan", enabled: false } });
    expect(off.json().bioUrl).toBeNull();
    const code = off.json().bio.code as string;
    expect((await built.app.inject({ method: "GET", url: `/go/bio/${code}` })).statusCode).toBe(404);

    const on = await built.app.inject({ method: "PUT", url: `/api/mp/projects/${pid}/publish/bio`, headers: auth, payload: { enabled: true, intro: "Alles aus meinem Binder." } });
    expect(on.json().bio.code).toBe(code);   // der Code aendert sich nie
    expect(on.json().bioUrl).toBe(`https://agi-empire.test/go/bio/${code}`);

    const page = await built.app.inject({ method: "GET", url: `/go/bio/${code}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Binderplan");
    expect(page.body).toContain("Alles aus meinem Binder.");
    // das veroeffentlichte Stueck steht mit Kurzlink drauf
    expect(page.body).toContain("Top 5");
    expect(page.body).toMatch(/https:\/\/agi-empire\.test\/go\/[a-z0-9]{6}/);
    expect(page.body).toContain("utm_source=bio");
  });
  it("zählt einen Klick auf der Bio-Seite wie jeden anderen Kurzlink", async () => {
    const page = await built.app.inject({ method: "GET", url: `/go/bio/${(await built.app.inject({ method: "GET", url: `/api/mp/projects/${pid}/publish`, headers: auth })).json().bio.code}` });
    const code = /\/go\/([a-z0-9]{6})/.exec(page.body)![1]!;
    const hit = await built.app.inject({ method: "GET", url: `/go/${code}` });
    expect(hit.statusCode).toBe(302);
    expect(hit.headers.location).toContain("utm_source=bio");
  });
});
