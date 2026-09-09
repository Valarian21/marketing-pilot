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
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import { assetToken, ASSET_TTL_MS, readAssetToken } from "../src/server/publish/asset-tokens.js";
import { linkFacets, blueskyPoster, telegramPoster, instagramPoster, threadsPoster, threadsTopic } from "../src/server/publish/posters.js";
import { platformStatus, posterFor, saveCredentials } from "../src/server/publish/index.js";
import { duePosts, nextFreeSlot, recordExternPost, runScheduledPost, schedulePiece } from "../src/server/publish/schedule.js";
import { PLATFORM_POSTING } from "../src/server/publish/types.js";
import { loadProfiles, patchChannel, saveProfiles } from "../src/server/channels.js";
import { fullProfile } from "../src/shared/channels.js";
import { autoScheduleBundle } from "../src/server/publish/auto.js";
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
    if (u.includes("fields=status_code")) return ok({ status_code: "FINISHED" });
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
  it("kann Threads automatisch bedienen, sobald der Zugang steht", () => {
    expect(PLATFORM_POSTING["threads"]!.mode).toBe("needs_setup");
    expect(posterFor("threads")).not.toBeNull();
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
  it("merkt sich, wann ein Zugang eingetragen wurde, und warnt vor dem Ablauf", () => {
    saveCredentials(built.db, pid, { threads: { userId: "9", accessToken: "tok" } });
    const frisch = platformStatus(built.db, pid).find((x) => x.platform === "threads")!;
    expect(frisch.tokenAgeDays).toBe(0);
    expect(frisch.warning).toBe("");
    // 55 Tage spaeter: Vorwarnung. 61 Tage spaeter: abgelaufen.
    const in55 = new Date(Date.now() + 55 * 86_400_000);
    expect(platformStatus(built.db, pid, in55).find((x) => x.platform === "threads")!.warning).toContain("läuft in 5 Tagen ab");
    const in61 = new Date(Date.now() + 61 * 86_400_000);
    expect(platformStatus(built.db, pid, in61).find((x) => x.platform === "threads")!.warning).toContain("abgelaufen");
    // Bluesky-Passwoerter laufen nicht ab - dort gibt es keine Warnung.
    expect(platformStatus(built.db, pid, in61).find((x) => x.platform === "bluesky")!.warning).toBe("");
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

describe("Pipeline: Freigabe = Einplanen", () => {
  // Die Kanal-Tests weiter unten erwarten ein Projekt ohne Profile — was hier
  // gesetzt wird, muss hinterher wieder weg.
  let profileVorher: ReturnType<typeof loadProfiles> = [];
  beforeAll(() => { profileVorher = loadProfiles(built.db, pid); });
  afterAll(() => { saveProfiles(built.db, pid, profileVorher); });
  it("legt ein freigegebenes Stück auf den nächsten Slot und zeigt es grün", async () => {
    const { pipelineView } = await import("../src/server/publish/pipeline.js");
    // Bluesky auf „Freigeben" mit Slots — der Zugang steht aus dem Test oben.
    // Nur diesen Kanal anfassen — `saveProfiles` ersetzt die ganze Liste und
    // würde den Kanal-Tests weiter unten die Kanäle wegnehmen.
    patchChannel(built.db, pid, "bluesky", { stage: "approve", slots: [{ day: "mon", hour: 9 }, { day: "tue", hour: 9 }, { day: "wed", hour: 9 }, { day: "thu", hour: 9 }, { day: "fri", hour: 9 }, { day: "sat", hour: 9 }, { day: "sun", hour: 9 }] });
    built.db.run(`INSERT INTO mp_content_pieces (id, project_id, task_id, channel, format, title, body, assets, status, human_edited, published_at, external_url, utm, meta, ai_tell_score, ai_tell_notes, rejection_reason, created_at, updated_at)
      VALUES ('pipe1', '${pid}', NULL, 'bluesky', 'data_carousel', 'Pipeline-Probe', 'Text', '["a1"]', 'review', 0, NULL, NULL, '{}', '{"platform":"bluesky"}', NULL, '', '', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')` as never);
    // Vorher: gelb — es wartet in der Freigabe und würde auf den ersten freien Slot fallen.
    const vorher = pipelineView(built.db, pid).rows.find((r) => r.platform === "bluesky")!;
    expect(vorher.slots.some((s) => s.state === "review" && s.pieceId === "pipe1")).toBe(true);
    // Freigeben — ohne „& einplanen". Die Pipeline plant selbst.
    const res = await built.app.inject({ method: "PATCH", url: "/api/mp/content/pipe1", headers: auth, payload: { status: "approved" } });
    expect(res.statusCode).toBe(200);
    const queued = built.db.select().from((await import("../src/server/db/schema.js")).mpScheduledPosts).all().filter((x) => x.pieceId === "pipe1" && x.status === "queued");
    expect(queued).toHaveLength(1);
    // Nachher: grün — und derselbe Slot, den die Projektion vorhergesagt hat.
    const nachher = pipelineView(built.db, pid).rows.find((r) => r.platform === "bluesky")!;
    const gruen = nachher.slots.find((s) => s.pieceId === "pipe1");
    expect(gruen?.state).toBe("queued");
    expect(gruen?.at).toBe(queued[0]!.scheduledAt);
  });
  it("lässt Kanäle auf „Vorbereiten“ in Ruhe — dort postet der Mensch", async () => {
    const { autoScheduleOnApprove } = await import("../src/server/publish/pipeline.js");
    patchChannel(built.db, pid, "instagram", { stage: "prepare" });
    built.db.run(`INSERT INTO mp_content_pieces (id, project_id, task_id, channel, format, title, body, assets, status, human_edited, published_at, external_url, utm, meta, ai_tell_score, ai_tell_notes, rejection_reason, created_at, updated_at)
      VALUES ('pipe2', '${pid}', NULL, 'instagram', 'data_carousel', 'Hand-Probe', 'Text', '["a1"]', 'approved', 0, NULL, NULL, '{}', '{"platform":"instagram"}', NULL, '', '', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')` as never);
    const out = autoScheduleOnApprove(built.db, "pipe2", { id: "t", name: "Test" });
    expect(out.at).toBeNull();
    expect(out.note).toContain("Vorbereiten");
  });
});

describe("Facebook-Seite", () => {
  it("hängt mehrere Bilder als ein Beitrag zusammen statt nur das erste zu posten", async () => {
    const { facebookPoster } = await import("../src/server/publish/posters.js");
    const rufe: { url: string; body: string }[] = [];
    let n = 0;
    const impl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      rufe.push({ url: u, body: String(init?.body ?? "") });
      n += 1;
      return new Response(JSON.stringify({ id: u.includes("/feed") ? "post-1" : `foto-${n}` }),
        { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const bild = (k: string) => ({ path: `/${k}.png`, url: `https://x/${k}`, mime: "image/png", alt: "", kind: "image" as const });
    const res = await facebookPoster.post({
      platform: "facebook", text: "Top 8", title: "Top 8", link: null,
      creds: { pageId: "1", accessToken: "t" }, fetchImpl: impl,
      assets: [bild("cover"), bild("a"), bild("cta")],
    });
    expect(res.ref).toBe("post-1");
    // Drei Uploads unveröffentlicht, dann ein Beitrag, der sie zusammenfasst.
    expect(rufe.filter((r) => r.url.includes("/photos"))).toHaveLength(3);
    expect(rufe.every((r) => !r.url.includes("/photos") || r.body.includes("published=false"))).toBe(true);
    const feed = rufe.find((r) => r.url.includes("/feed"))!;
    expect(feed.body).toContain("attached_media");
    expect(feed.body).toContain("foto-1");
  }, 30_000);
});

describe("Bilder-Limit der Plattform", () => {
  it("kürzt in der Mitte — Deckseite und Auflösung bleiben", async () => {
    const { aufLimit } = await import("../src/server/publish/posters.js");
    const a = (n: string) => ({ path: `/${n}.png`, url: `https://x/${n}`, mime: "image/png", alt: "", kind: "image" as const });
    // Cover, Rang 15 bis 1 (Countdown), CTA — genau die Reihenfolge eines Carousels.
    const alle = [a("cover"), ...Array.from({ length: 15 }, (_, i) => a(`rang${15 - i}`)), a("cta")];
    const kurz = aufLimit(alle, 10);
    expect(kurz).toHaveLength(10);
    expect(kurz[0]!.url).toContain("cover");
    // Ohne diese Regel schnitte `slice(0, 10)` Platz 1 bis 6 und den Abschluss ab.
    expect(kurz.at(-1)!.url).toContain("cta");
    expect(kurz.some((x) => x.url.endsWith("rang1"))).toBe(true);
    // Passt alles, bleibt alles.
    expect(aufLimit(alle.slice(0, 5), 10)).toHaveLength(5);
  });
});

describe("Instagram-Reel", () => {
  it("veröffentlicht erst, wenn die Plattform das Video fertig verarbeitet hat", async () => {
    const zustaende = ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"];
    let abrufe = 0;
    let container = "";
    const impl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("fields=status_code")) { abrufe += 1; return ok({ status_code: zustaende[Math.min(abrufe - 1, zustaende.length - 1)] }); }
      if (u.includes("/media_publish")) return ok({ id: "reel-1" });
      container = String((init as RequestInit | undefined)?.body ?? "");
      return ok({ id: "container-1" });
    }) as unknown as typeof fetch;
    const res = await instagramPoster.post({
      platform: "instagram", text: "Top 10", title: "Top 10", link: null,
      creds: { igUserId: "1", accessToken: "t" }, fetchImpl: impl,
      assets: [{ path: "/tmp/x.mp4", url: "https://example.test/x.mp4", mime: "video/mp4", alt: "", kind: "video" }],
    });
    expect(res.ref).toBe("reel-1");
    // Ohne dieses Warten lehnt Meta jede Reel-Veröffentlichung ab.
    expect(abrufe).toBeGreaterThanOrEqual(3);
    // Das Vorschaubild darf nicht der erste Frame sein — der ist eingeblendet
    // und damit schwarz.
    expect(container).toContain("thumb_offset");
  }, 30_000);
});

describe("Signierte Asset-Adressen", () => {
  it("liefert PNG als JPEG aus — Instagram nimmt nichts anderes", async () => {
    const { jpegFuerMeta } = await import("../src/server/publish/asset-tokens.js");
    const png = path.join(DATA, "probe.png");
    fs.writeFileSync(png, PNG);
    const jpeg = jpegFuerMeta(png);
    expect(jpeg.endsWith(".meta.jpg")).toBe(true);
    expect(fs.existsSync(jpeg)).toBe(true);
    // Zweiter Aufruf nutzt die vorhandene Datei, statt erneut zu wandeln.
    const vorher = fs.statSync(jpeg).mtimeMs;
    expect(jpegFuerMeta(png)).toBe(jpeg);
    expect(fs.statSync(jpeg).mtimeMs).toBe(vorher);
  }, 30_000);

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
    // Echte Asset-IDs sind UUIDs, damit werden die Token über 100 Zeichen lang —
    // Fastifys Standardgrenze für Routen-Parameter. Ohne `maxParamLength`
    // antwortet die Route mit 414, und Meta meldet daraufhin einen Medientyp-
    // Fehler, weil es JSON statt eines Bildes bekommt.
    const langerToken = assetToken(built.db, "11111111-2222-3333-4444-555555555555");
    expect(langerToken.length).toBeGreaterThan(100);
    expect((await built.app.inject({ method: "GET", url: `/go/a/${langerToken}` })).statusCode).toBe(404);
    // Ausgeliefert wird JPEG, auch wenn die Datei ein PNG ist: diese Adresse
    // ruft nur Meta ab, und Instagram nimmt kein PNG an.
    expect(ok.headers["content-type"]).toContain("image/jpeg");
    expect((await built.app.inject({ method: "GET", url: "/go/a/erfunden" })).statusCode).toBe(404);
  });
});

describe("Stufen je Kanal (Content-Pilot)", () => {
  it("leitet die Stufe aus alten Profilen ab und den publishMode aus der Stufe", () => {
    expect(fullProfile({ platform: "bluesky", publishMode: "scheduled" }).stage).toBe("approve");
    expect(fullProfile({ platform: "bluesky", publishMode: "auto" }).stage).toBe("auto");
    expect(fullProfile({ platform: "bluesky", publishMode: "manual" }).stage).toBe("prepare");
    expect(fullProfile({ platform: "bluesky", stage: "off" }).publishMode).toBe("manual");
    expect(fullProfile({ platform: "bluesky", stage: "approve" }).publishMode).toBe("scheduled");
    // Die Stufe gewinnt, wenn beides da ist.
    expect(fullProfile({ platform: "bluesky", stage: "auto", publishMode: "manual" }).publishMode).toBe("auto");
  });

  it("zeigt jede Plattform als Karte mit Stufe, Grenze und dem, was fehlt", async () => {
    const res = await built.app.inject({ method: "GET", url: `/api/mp/projects/${pid}/publish`, headers: auth });
    expect(res.statusCode).toBe(200);
    const board = res.json().board as { platform: string; stage: string; maxStage: string; requirements: { id: string; ok: boolean; blocking: boolean }[]; ready: boolean; nextMissing: string[] }[];
    expect(board.length).toBeGreaterThanOrEqual(12);
    // Ohne Profil steht alles auf „Aus" und ist damit trivial bereit.
    expect(board.every((c) => c.stage === "off" && c.ready)).toBe(true);
    // X und Reddit kommen nie über das Vorbereiten hinaus; Bluesky darf bis ganz nach oben.
    expect(board.find((c) => c.platform === "x")!.maxStage).toBe("prepare");
    expect(board.find((c) => c.platform === "reddit")!.maxStage).toBe("prepare");
    expect(board.find((c) => c.platform === "bluesky")!.maxStage).toBe("auto");
    // Was für die nächste Stufe („Vorbereiten") fehlt: der Brief — das Projekt hat keinen.
    expect(board.find((c) => c.platform === "bluesky")!.nextMissing).toContain("Produkt-Brief bestätigt");
  });

  it("nennt auf „Freigeben“ ohne Zugang genau das als Blocker", async () => {
    // Der vorige Block hat Bluesky eingerichtet — für diesen Test ist der Zugang weg und kommt am Ende zurück.
    saveCredentials(built.db, pid, { bluesky: { handle: "", appPassword: "" } });
    const res = await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}/publish/channel/bluesky`, headers: auth, payload: { stage: "approve" } });
    expect(res.statusCode).toBe(200);
    const card = res.json().board.find((c: { platform: string }) => c.platform === "bluesky");
    expect(card.stage).toBe("approve");
    expect(card.ready).toBe(false);
    const creds = card.requirements.find((r: { id: string }) => r.id === "creds");
    expect(creds.ok).toBe(false);
    expect(creds.blocking).toBe(true);
    expect(creds.action).toBe("credentials");
    // Zugang eintragen → der Blocker ist weg.
    await built.app.inject({ method: "PUT", url: `/api/mp/projects/${pid}/publish/credentials`, headers: auth, payload: { bluesky: { handle: "bp.bsky.social", appPassword: "abcd-efgh" } } });
    const after = (await built.app.inject({ method: "GET", url: `/api/mp/projects/${pid}/publish`, headers: auth })).json().board.find((c: { platform: string }) => c.platform === "bluesky");
    expect(after.requirements.find((r: { id: string }) => r.id === "creds").ok).toBe(true);
    // Der Brief fehlt weiterhin — Bluesky bleibt „nicht bereit", aber aus dem richtigen Grund.
    expect(after.ready).toBe(false);
    expect(after.requirements.filter((r: { ok: boolean; blocking: boolean }) => !r.ok && r.blocking).map((r: { id: string }) => r.id)).toEqual(["brief", "worker"]);
    // Zurück auf Aus, damit die folgenden Tests ihren eigenen Zustand setzen.
    await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}/publish/channel/bluesky`, headers: auth, payload: { stage: "off" } });
    saveCredentials(built.db, pid, { bluesky: { handle: "neu.bsky.social", appPassword: "abcd-efgh" } });
  });

  it("lässt X nicht über das Vorbereiten hinaus", async () => {
    const res = await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}/publish/channel/x`, headers: auth, payload: { stage: "approve" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("Vorbereiten");
    const ok = await built.app.inject({ method: "PATCH", url: `/api/mp/projects/${pid}/publish/channel/x`, headers: auth, payload: { stage: "prepare", url: "https://x.com/binderplan" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profiles.find((p: { platform: string }) => p.platform === "x").url).toBe("https://x.com/binderplan");
  });

  it("plant über die API nur ein, was auf „Freigeben“ oder höher steht", async () => {
    saveProfiles(built.db, pid, [{ platform: "bluesky", stage: "prepare" }]);
    const no = await built.app.inject({ method: "POST", url: `/api/mp/content/${pieceId}/publish/schedule`, headers: auth, payload: { platforms: ["bluesky"] } });
    expect(no.statusCode).toBe(400);
    expect(no.json().detail).toContain("postest du selbst");
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

  it("plant dasselbe Stück je Kanal nur einmal ein und verschiebt bei ausdrücklichem Termin", async () => {
    const schema = await import("../src/server/db/schema.js");
    saveCredentials(built.db, pid, { bluesky: { identifier: "a", appPassword: "b" } });
    const erst = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], origin: "auto" });
    const zweit = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], origin: "auto" });
    expect(zweit[0]!.id).toBe(erst[0]!.id);
    const offen = built.db.select().from(schema.mpScheduledPosts).all().filter((r) => r.pieceId === pieceId && r.platform === "bluesky" && r.status === "queued");
    expect(offen).toHaveLength(1);
    const verschoben = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], origin: "auto", at: "2026-10-01T10:00:00.000Z" });
    expect(verschoben[0]!.id).toBe(erst[0]!.id);
    expect(verschoben[0]!.scheduledAt).toBe("2026-10-01T10:00:00.000Z");
    // aufräumen, damit der Slot-Test darunter frei planen kann
    built.db.delete(schema.mpScheduledPosts).where(eq(schema.mpScheduledPosts.id, erst[0]!.id)).run();
  });

  it("verweigert das Einplanen dort, wo bewusst nicht gepostet wird", () => {
    expect(() => schedulePiece(built.db, pid, { pieceId, platforms: ["reddit"] })).toThrowError(/bewusst keinen automatischen Weg/);
    expect(() => schedulePiece(built.db, pid, { pieceId, platforms: ["x"] })).toThrowError(/bewusst keinen automatischen Weg/);
  });

  it("verweigert das Einplanen ohne Zugangsdaten", () => {
    expect(() => schedulePiece(built.db, pid, { pieceId, platforms: ["mastodon"] })).toThrowError(/Zugangsdaten fehlen/);
  });

  /**
   * TikTok laesst sich ohne Content-Posting-Audit nicht bespielen — trotzdem
   * gehen dort taeglich zwei Reels raus, von Hand vorgeplant. Der Eintrag macht
   * sie sichtbar, ohne dass der Pilot je versucht, sie abzusetzen.
   */
  it("merkt sich von Hand vorgeplante Beiträge und postet sie nie selbst", () => {
    const at = "2026-11-04T12:00:00.000Z";
    const eintrag = recordExternPost(built.db, pid, { pieceId, platform: "tiktok", scheduledAt: at, externalUrl: "", posted: false });
    expect(eintrag.origin).toBe("extern");
    expect(eintrag.status).toBe("queued");
    // laengst faellig, taucht aber nie in der Warteschlange des Posters auf
    expect(duePosts(built.db, new Date("2026-11-05T00:00:00Z")).some((d) => d.id === eintrag.id)).toBe(false);

    // Ein zweiter Aufruf verschiebt den Termin, statt einen zweiten Eintrag anzulegen.
    const spaeter = recordExternPost(built.db, pid, { pieceId, platform: "tiktok", scheduledAt: "2026-11-05T12:00:00.000Z", externalUrl: "", posted: false });
    expect(spaeter.id).toBe(eintrag.id);
    expect(spaeter.scheduledAt).toBe("2026-11-05T12:00:00.000Z");
  });

  it("verweigert einen externen Eintrag für ein fremdes Stück", () => {
    expect(() => recordExternPost(built.db, pid, { pieceId: "gibtsnicht", platform: "tiktok", scheduledAt: "2026-11-04T12:00:00.000Z", externalUrl: "", posted: false }))
      .toThrowError(/nicht gefunden/);
  });

  /**
   * Eigenes Zeitfenster, weit weg von den anderen Faellen: die Tests dieser
   * Datei teilen sich eine Datenbank, und ein Eintrag aus einem frueheren Fall
   * belegte hier sonst genau den Slot, dessen Freibleiben geprueft wird.
   */
  it("plant je Kanal einen Eintrag und belegt einen Slot nur einmal", async () => {
    const schema = await import("../src/server/db/schema.js");
    const now = new Date("2026-10-01T08:00:00Z");   // Donnerstag
    const a = schedulePiece(built.db, pid, { pieceId, platforms: ["bluesky"], now });
    expect(a[0]!.scheduledAt).toBe("2026-10-07T07:00:00.000Z");
    // Ein zweites Stück, denn dasselbe Stück wird je Kanal nur einmal eingeplant.
    const quelle = built.db.select().from(schema.mpContentPieces).all().find((x) => x.id === pieceId)!;
    built.db.insert(schema.mpContentPieces).values({ ...quelle, id: "zweites-stueck" }).run();
    const b = schedulePiece(built.db, pid, { pieceId: "zweites-stueck", platforms: ["bluesky"], now });
    // derselbe Slot ist belegt - der naechste Mittwoch
    expect(b[0]!.scheduledAt).toBe("2026-10-14T07:00:00.000Z");
    expect(duePosts(built.db, now).filter((d) => d.scheduledAt >= "2026-10-01")).toEqual([]);
    expect(duePosts(built.db, new Date("2026-10-07T08:00:00Z")).filter((d) => d.scheduledAt >= "2026-10-01").length).toBe(1);
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

  /** Live gescheitert am 06. und 07.09.: ohne dieses Warten antwortet Meta mit „Media ID is not available". */
  it("wartet auch bei einer Bild-Story, bis der Container fertig ist", async () => {
    const reihenfolge: string[] = [];
    let abrufe = 0;
    const impl = (async (url: string | URL) => {
      const u = String(url);
      const body = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("fields=status_code")) { abrufe += 1; reihenfolge.push("status"); return body({ status_code: abrufe < 2 ? "IN_PROGRESS" : "FINISHED" }); }
      if (u.includes("/media_publish")) { reihenfolge.push("publish"); return body({ id: "ig-story-1" }); }
      reihenfolge.push("container");
      return body({ id: "c1" });
    }) as unknown as typeof fetch;
    const out = await instagramPoster.post({
      platform: "instagram", kind: "story", text: "", link: null, title: "", creds: { igUserId: "1789", accessToken: "tok" }, fetchImpl: impl,
      assets: [{ path: "x", url: "https://agi-empire.test/go/a/tok", mime: "image/png", alt: "", kind: "image" as const }],
    });
    expect(reihenfolge).toEqual(["container", "status", "status", "publish"]);
    expect(out.ref).toBe("ig-story-1");
  });

  /** Liefert die Plattform gar kein `status_code`, gibt es nichts zu warten — sonst haengt jeder Bildbeitrag bis zur Frist. */
  it("veröffentlicht sofort, wenn die Plattform keinen Status meldet", async () => {
    const reihenfolge: string[] = [];
    const impl = (async (url: string | URL) => {
      const u = String(url);
      const body = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("fields=status_code")) { reihenfolge.push("status"); return body({ id: "c1" }); }
      if (u.includes("/media_publish")) { reihenfolge.push("publish"); return body({ id: "ig-post-2" }); }
      reihenfolge.push("container");
      return body({ id: "c1" });
    }) as unknown as typeof fetch;
    await instagramPoster.post({
      platform: "instagram", text: "Caption", link: null, title: "", creds: { igUserId: "1789", accessToken: "tok" }, fetchImpl: impl,
      assets: [{ path: "x", url: "https://agi-empire.test/go/a/tok", mime: "image/png", alt: "", kind: "image" as const }],
    });
    expect(reihenfolge).toEqual(["container", "status", "publish"]);
  });

  it("postet auf Threads über Container und Veröffentlichung", async () => {
    const calls: string[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const u = String(url);
      calls.push(`${u.split("?")[0]}|${String(init.body ?? "")}`);
      if (u.includes("threads_publish")) return new Response(JSON.stringify({ id: "th-1" }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("fields=permalink")) return new Response(JSON.stringify({ permalink: "https://www.threads.net/@binderplan/post/abc" }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ id: `c${calls.length}` }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const out = await threadsPoster.post({
      platform: "threads", text: "Die teuersten Karten.", link: null, title: "", creds: { userId: "9", accessToken: "tok" }, fetchImpl: impl,
      assets: [1, 2].map(() => ({ path: "x", url: "https://agi-empire.test/go/a/t", mime: "image/png", alt: "", kind: "image" as const })),
    });
    // Zwischen den Containern stehen jetzt die Status-Abfragen — deshalb wird
    // die Reihenfolge auf der gefilterten Liste geprueft, nicht auf allen Aufrufen.
    const container = calls.filter((c) => c.includes("/threads|"));
    expect(container.length).toBe(3);   // 2 Kinder + Sammel-Container
    expect(container[2]).toContain("media_type=CAROUSEL");
    expect(out.ref).toBe("th-1");
    expect(out.externalUrl).toContain("threads.net");
  });

  it("fragt bei Threads nie nach status_code — die echte API antwortet darauf mit 400", async () => {
    // Attrappe der echten Threads-API: sie kennt `status`, und jede Abfrage, die
    // `status_code` auch nur nennt, lehnt sie ab. Genau daran scheiterte am
    // 09.09.2026 jeder Threads-Beitrag mit Bild — die alte Attrappe antwortete
    // auf alles mit `{ id }` und deckte den Fehler zu.
    const statusAbfragen: string[] = [];
    const impl = (async (url: string | URL) => {
      const u = String(url);
      const body = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
      if (u.includes("fields=")) {
        const felder = decodeURIComponent(new URL(u).searchParams.get("fields") ?? "");
        if (felder.includes("permalink")) return body({ permalink: "https://www.threads.net/@binderplan/post/abc" });
        statusAbfragen.push(felder);
        if (felder.includes("status_code")) {
          return body({ error: { message: "Tried accessing nonexisting field (status_code)", code: 100, type: "THApiException" } }, 400);
        }
        return body({ id: "c1", status: "FINISHED" });
      }
      if (u.includes("threads_publish")) return body({ id: "th-2" });
      return body({ id: "c1" });
    }) as unknown as typeof fetch;
    const out = await threadsPoster.post({
      platform: "threads", text: "Zwei Karten, ein Bild.", link: null, title: "", creds: { userId: "9", accessToken: "tok" }, fetchImpl: impl,
      assets: [{ path: "x", url: "https://agi-empire.test/go/a/t", mime: "image/png", alt: "", kind: "image" as const }],
    });
    expect(statusAbfragen.length).toBeGreaterThan(0);
    expect(statusAbfragen.some((f) => f.includes("status_code"))).toBe(false);
    expect(out.ref).toBe("th-2");
  });

  it("kürzt für Threads auf 500 Zeichen", async () => {
    const bodies: string[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      bodies.push(String(init.body ?? ""));
      return new Response(JSON.stringify({ id: "x" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await threadsPoster.post({ platform: "threads", text: "wort ".repeat(200), assets: [], link: null, title: "", creds: { userId: "9", accessToken: "t" }, fetchImpl: impl });
    const text = new URLSearchParams(bodies[0]!).get("text")!;
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text.endsWith("…")).toBe(true);
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


describe("Voll automatisch", () => {
  const user = { id: "test", name: "test" };
  /** Ein Bündel wie es eine Serie hinterlässt: Leit-Stück plus ein Mitglied. */
  const bundle = (id: string, format: string, seriesId: string | null, status = "review") => {
    built.db.run(`INSERT INTO mp_content_pieces (id, project_id, task_id, channel, format, title, body, assets, status, human_edited, published_at, external_url, utm, meta, ai_tell_score, ai_tell_notes, rejection_reason, created_at, updated_at)
      VALUES ('${id}', '${pid}', NULL, 'bluesky', '${format}', 'Serie ${id}', 'Text', '[]', '${status}', 0, NULL, NULL, '{}',
      '${JSON.stringify({ bundleId: id, bundleLead: true, platform: "bluesky", ...(seriesId ? { request: { seriesId } } : {}) }).replace(/'/g, "''")}',
      NULL, '', '', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')` as never);
    return id;
  };

  it("rührt nichts an, solange der Kanal auf manuell steht", () => {
    saveProfiles(built.db, pid, [{ platform: "bluesky", label: "Bluesky", url: "", slots: [{ day: "wed", hour: 9 }], publishMode: "scheduled", autoWeeklyCap: 5 }]);
    const id = bundle("auto1", "data_carousel", "s1");
    expect(autoScheduleBundle(built.db, pid, id, { user }).scheduled).toBe(0);
  });

  it("plant Serien-Carousels und Serien-Reels ein, sobald der Kanal auf auto steht", () => {
    saveProfiles(built.db, pid, [{ platform: "bluesky", label: "Bluesky", url: "", slots: [{ day: "wed", hour: 9 }], publishMode: "auto", autoWeeklyCap: 5 }]);
    const carousel = autoScheduleBundle(built.db, pid, bundle("auto2", "data_carousel", "s1"), { user });
    expect(carousel.scheduled).toBe(1);
    // Das Reel kommt erst nach dem Render hier an - dann aber genauso.
    const reel = autoScheduleBundle(built.db, pid, bundle("auto3", "data_reel", "s1"), { user });
    expect(reel.scheduled).toBe(1);
  });

  it("fasst Handarbeit nie an, auch nicht auf einem Auto-Kanal", () => {
    const ohneSerie = autoScheduleBundle(built.db, pid, bundle("auto4", "data_carousel", null), { user });
    expect(ohneSerie.scheduled).toBe(0);
    // ein Text-Stück aus einer Serie waere ebenfalls tabu
    const text = autoScheduleBundle(built.db, pid, bundle("auto5", "text", "s1"), { user });
    expect(text.scheduled).toBe(0);
  });

  it("hält den Wochendeckel ein und sagt es", () => {
    saveProfiles(built.db, pid, [{ platform: "bluesky", label: "Bluesky", url: "", slots: [{ day: "wed", hour: 9 }], publishMode: "auto", autoWeeklyCap: 2 }]);
    // zwei sind aus dem vorherigen Test schon geplant
    const res = autoScheduleBundle(built.db, pid, bundle("auto6", "data_carousel", "s1"), { user });
    expect(res.scheduled).toBe(0);
    expect(res.notes.join(" ")).toContain("Wochendeckel");
  });
});

describe("ZIP-Schreiber", () => {
  it("baut ein Archiv, das ein Standard-Werkzeug lesen kann", async () => {
    const { buildZip, crc32, safeName } = await import("../src/server/util/zip.js");
    const zip = buildZip([{ name: "a.txt", data: Buffer.from("hallo") }, { name: "unter/b.bin", data: PNG }]);
    // Signaturen an den richtigen Stellen
    expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(zip.includes(Buffer.from("504b0102", "hex"))).toBe(true);   // Zentralverzeichnis
    expect(zip.subarray(-22, -18).toString("hex")).toBe("504b0506");   // Ende
    expect(zip.readUInt16LE(zip.length - 14)).toBe(2);                 // zwei Einträge
    expect(zip.includes(Buffer.from("hallo"))).toBe(true);
    // Gegen Nodes eigene Implementierung geprüft, statt gegen eine abgeschriebene Konstante
    const zlib = await import("node:zlib");
    for (const probe of ["", "hallo", "Binderplan", "x".repeat(1000)]) {
      expect(crc32(Buffer.from(probe))).toBe(zlib.crc32(probe));
    }
    expect(safeName("Binderplan · Süß/Fies")).toBe("Binderplan-Suess-Fies");
  });
});

describe("Social-Kit", () => {
  it("erzeugt alle Formate, ersetzt den alten Satz und packt sie mit Anleitung", async () => {
    const { generateSocialKit, socialKit, socialKitView, socialKitZip, SOCIAL_FORMATS } = await import("../src/server/agents/studio/socialkit.js");
    const rendered: string[] = [];
    const renderer = async (jobs: { html: string; file: string }[]) => {
      for (const j of jobs) { fs.mkdirSync(path.dirname(j.file), { recursive: true }); fs.writeFileSync(j.file, PNG); rendered.push(j.html); }
    };
    const { assets: items } = await generateSocialKit(built.db, DATA, pid, { renderer: renderer as never });
    expect(items.length).toBe(SOCIAL_FORMATS.length);
    expect(items.map((x) => x.format)).toContain("banner-youtube");
    // Ohne Logo im Brand-Kit entsteht ein Monogramm
    expect(rendered[0]).toContain(">B<");
    // Der YouTube-Banner setzt den Text in die sichtbare Zone
    expect(rendered.find((h) => h.includes("2560px"))).toContain("width:1546px");

    // Ein zweiter Lauf ersetzt, statt zu häufen
    await generateSocialKit(built.db, DATA, pid, { renderer: renderer as never });
    expect(socialKit(built.db, pid).length).toBe(SOCIAL_FORMATS.length);
    // Ohne LLM bleibt der Textteil leer — die Bilder stehen trotzdem
    expect(socialKitView(built.db, pid).texts.profiles).toEqual([]);

    const zip = socialKitZip(built.db, DATA, pid)!;
    expect(zip.name).toContain("social-kit.zip");
    expect(zip.data.subarray(0, 4).toString("hex")).toBe("504b0304");
    // Die Kurzanleitung liegt mit im Archiv
    expect(zip.data.includes(Buffer.from("WOHIN-GEHOERT-WAS.txt"))).toBe(true);
    expect(zip.data.includes(Buffer.from("1546 × 423", "utf8"))).toBe(true);
  }, 60_000);

  it("kürzt Bios an der Wortgrenze auf die Zeichenzahl der Plattform", async () => {
    const { fitLength, PROFILE_TARGETS } = await import("../src/server/agents/studio/socialkit.js");
    // Was passt, bleibt unangetastet
    expect(fitLength("  Kurz   und   knapp ", 80)).toBe("Kurz und knapp");
    // TikTok zaehlt 80 Zeichen - danach ist Schluss, aber nicht mitten im Wort
    const lang = "Du planst deinen Pokémon-Binder Fach für Fach, siehst echte Cardmarket-Preise und druckst Platzhalter.";
    const kurz = fitLength(lang, 80);
    expect(kurz.length).toBeLessThanOrEqual(80);
    expect(lang.startsWith(kurz.slice(0, -1))).toBe(true);
    // Passt ein ganzer Satz, endet die Bio auch wie einer - ohne Auslassungszeichen
    expect(fitLength("Plane Fach für Fach. Sieh echte Preise. Drucke Platzhalter.", 45)).toBe("Plane Fach für Fach. Sieh echte Preise.");
    // Passt kein Satz, wird an der Satzteil-Grenze aufgehoert statt mitten im Gedanken
    expect(fitLength("Plane deine Sammelalben, sieh Preise und drucke Platzhalter für fehlende Karten.", 60))
      .toBe("Plane deine Sammelalben, sieh Preise.");
    // Jede Plattform hat eine Grenze, und keine ist versehentlich null
    expect(PROFILE_TARGETS.every((t) => t.limit > 0 && t.nameLimit > 0)).toBe(true);
  });
});

describe("Threads-Thema", () => {
  it("macht aus dem ersten Hashtag das Topic und räumt alle aus dem Text", () => {
    const r = threadsTopic("Wo hört die Karte auf?\nZwei Karten, ein Bild.\n\n#PokemonTCG #Binder");
    expect(r.topic).toBe("PokemonTCG");
    expect(r.text).toBe("Wo hört die Karte auf?\nZwei Karten, ein Bild.");
  });
  it("lässt Text ohne Hashtag unverändert", () => {
    expect(threadsTopic("Nur Text, Nr. 5 von 9.")).toEqual({ text: "Nur Text, Nr. 5 von 9.", topic: null });
  });
});

