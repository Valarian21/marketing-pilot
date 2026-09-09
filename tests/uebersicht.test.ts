/**
 * Die Übersicht und die Kanalzahlen dahinter.
 *
 * Geprüft wird gegen Attrappen — kein Konto, kein Netz —, aber mit genau den
 * Antwortformen, die Meta am 09.09.2026 wirklich geliefert hat: Instagram
 * Tagesreihe für `reach` und `total_value` für alles andere, Facebook nur
 * Tagesreihen, Threads `total_value` auf eigenem Host.
 *
 * Die Zusicherungen, um die es geht, sind nicht die Zahlen selbst, sondern die
 * Regeln: ein Tageswert gehört zum Vortag seines Meta-Stempels, eine fehlende
 * Messung ist `null` und keine Null, und ein Bestand wird erst summiert, wenn
 * er für alle Kanäle bekannt ist.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { buildApp } from "../src/server/app.js";
import * as t from "../src/server/db/schema.js";
import { newId, nowIso } from "../src/server/db/index.js";
import { holeKanalStats, leseKanalTage, raster, schreibeKanalTag } from "../src/server/publish/kanal-metriken.js";
import { saveCredentials } from "../src/server/publish/index.js";
import { cockpitView } from "../src/server/agents/insights/cockpit.js";
import { fehlerKlartext } from "../src/server/publish/metrics.js";
import { zaehleTagesklick } from "../src/server/shortlinks.js";
import { todayView } from "../src/server/today.js";
import { raeumeAuf } from "../src/server/cleanup.js";
import { fakeHost } from "./helpers.js";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "mp-uebersicht-"));
const auth = { authorization: "Bearer test-token" };
let built: Awaited<ReturnType<typeof buildApp>>;
let pid = "";

/** Antworten in den Formen, die die echten Endpunkte liefern. */
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const reihe = (name: string, werte: [string, number][]) => ({ data: [{ name, period: "day", values: werte.map(([end_time, value]) => ({ value, end_time })) }] });
const summenAntwort = (paare: Record<string, number>) => ({ data: Object.entries(paare).map(([name, value]) => ({ name, period: "day", total_value: { value } })) });

beforeAll(async () => {
  const env = loadEnv({ MP_STANDALONE: "false", MP_DATA_DIR: DATA, OPENROUTER_API_KEY: "", MP_LLM_PAUSED: "false" });
  built = await buildApp(env, { host: fakeHost(), dbFile: ":memory:", logger: false });
  const res = await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Testprodukt", url: "https://example.test" } });
  pid = res.json().id;
});
afterAll(async () => { await built.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

describe("Tagesraster", () => {
  /**
   * Meta stempelt einen Tageswert mit dem **Ende** des Tages in der Zeitzone
   * des Kontos. Ohne diese Verschiebung landet jeder Wert einen Tag zu spät —
   * und der Tag, an dem ein Beitrag lief, hätte plötzlich keine Reichweite.
   */
  it("ordnet einen Wert dem Tag vor dem Stempel zu", () => {
    const r = raster({ name: "reach", values: [{ value: 12, end_time: "2026-09-08T07:00:00+0000" }, { value: 5, end_time: "2026-09-09T07:00:00+0000" }] });
    expect(r.map((x) => [x.tag, x.wert])).toEqual([["2026-09-07", 12], ["2026-09-08", 5]]);
  });

  it("überspringt Einträge ohne brauchbaren Stempel", () => {
    expect(raster({ name: "reach", values: [{ value: 1, end_time: "kaputt" }] })).toEqual([]);
    expect(raster(undefined)).toEqual([]);
  });
});

describe("Kanalzahlen holen", () => {
  it("holt Instagram, Facebook und Threads und legt sie je Tag ab", async () => {
    saveCredentials(built.db, pid, {
      instagram: { igUserId: "ig1", accessToken: "tok-ig" },
      facebook: { pageId: "fb1", accessToken: "tok-fb" },
      threads: { userId: "th1", accessToken: "tok-th" },
    });
    const gefragt: string[] = [];
    const impl = (async (url: string | URL) => {
      const u = String(url);
      gefragt.push(u);
      if (u.includes("graph.threads.net")) {
        if (u.includes("metric=views")) return ok(reihe("views", [["2026-09-08T07:00:00+0000", 9]]));
        if (u.includes("followers_count")) return ok(summenAntwort({ followers_count: 4 }));
        return ok(summenAntwort({ likes: 2, replies: 1, reposts: 0, quotes: 0 }));
      }
      if (u.includes("/ig1?")) return ok({ followers_count: 7, media_count: 11 });
      if (u.includes("/fb1?")) return ok({ followers_count: 3 });
      if (u.includes("/ig1/insights") && u.includes("metric=reach")) return ok(reihe("reach", [["2026-09-08T07:00:00+0000", 12]]));
      if (u.includes("/ig1/insights")) return ok(summenAntwort({ views: 40, profile_views: 6, website_clicks: 1, accounts_engaged: 3, total_interactions: 8 }));
      if (u.includes("/fb1/insights")) {
        return ok({
          data: [
            reihe("page_views_total", [["2026-09-08T07:00:00+0000", 5]]).data[0]!,
            reihe("page_post_engagements", [["2026-09-08T07:00:00+0000", 2]]).data[0]!,
            reihe("page_video_views", [["2026-09-08T07:00:00+0000", 0]]).data[0]!,
          ],
        });
      }
      return ok({});
    }) as unknown as typeof fetch;

    const res = await holeKanalStats({ db: built.db, creds: (p) => ({ instagram: { igUserId: "ig1", accessToken: "tok-ig" }, facebook: { pageId: "fb1", accessToken: "tok-fb" }, threads: { userId: "th1", accessToken: "tok-th" } }[p] ?? {}), fetchImpl: impl, now: () => new Date("2026-09-09T10:00:00Z") }, pid);
    expect(res.every((r) => !r.fehler)).toBe(true);

    const tage = leseKanalTage(built.db, pid, "2026-09-01");
    const ig = tage.find((x) => x.platform === "instagram" && x.tag === "2026-09-07");
    expect(ig?.parsed).toMatchObject({ reichweite: 12, aufrufe: 40, profilaufrufe: 6, interaktionen: 8 });
    // Der Bestand gehört zum heutigen Tag, nicht zum gemessenen Tageswert.
    expect(tage.find((x) => x.platform === "instagram" && x.tag === "2026-09-09")?.parsed).toMatchObject({ follower: 7, beitraege: 11 });
    // Facebook liefert keine Aufrufe mehr: `page_video_views` zählt nur Videos
    // und darf nicht als Aufrufe der Seite durchgehen.
    const fb = tage.find((x) => x.platform === "facebook" && x.tag === "2026-09-07");
    expect(fb?.parsed).toMatchObject({ profilaufrufe: 5, interaktionen: 2, videoAufrufe: 0 });
    expect(fb?.parsed.aufrufe).toBeUndefined();
    // Threads: `views` auf Kontoebene sind Profilaufrufe.
    expect(tage.find((x) => x.platform === "threads" && x.tag === "2026-09-07")?.parsed).toMatchObject({ profilaufrufe: 9 });
  });

  it("hält den Fehler eines Kanals von den anderen fern", async () => {
    const impl = (async (url: string | URL) => {
      if (String(url).includes("/ig1")) return new Response(JSON.stringify({ error: { message: "Error validating access token: Session has expired" } }), { status: 400 });
      return ok({ followers_count: 3 });
    }) as unknown as typeof fetch;
    const res = await holeKanalStats({ db: built.db, creds: (p) => (p === "instagram" ? { igUserId: "ig1", accessToken: "tok" } : p === "facebook" ? { pageId: "fb1", accessToken: "tok" } : {}), fetchImpl: impl, now: () => new Date("2026-09-09T10:00:00Z") }, pid);
    expect(res.find((r) => r.platform === "instagram")?.fehler).toMatch(/Session has expired/);
    expect(res.find((r) => r.platform === "facebook")?.fehler).toBeUndefined();
  });

  it("überschreibt beim Zusammenlegen keine Felder mit Lücken", () => {
    schreibeKanalTag(built.db, pid, "instagram", "2026-08-01", { aufrufe: 10, reichweite: 4 });
    schreibeKanalTag(built.db, pid, "instagram", "2026-08-01", { reichweite: 5 });
    const eintrag = leseKanalTage(built.db, pid, "2026-08-01").find((x) => x.tag === "2026-08-01" && x.platform === "instagram");
    expect(eintrag?.parsed).toMatchObject({ aufrufe: 10, reichweite: 5 });
  });
});

describe("Fehlermeldungen in Klartext", () => {
  it("erklärt die verschwundene Story statt der Graph-Meldung", () => {
    expect(fehlerKlartext("Unsupported get request. Object with ID '1814724' does not exist, cannot be loaded due to missing permissions"))
      .toMatch(/Stories verschwinden nach 24 Stunden/);
    expect(fehlerKlartext("(#10) Not enough viewers")).toMatch(/Mindestgröße/);
    expect(fehlerKlartext("")).toBe("");
  });
});

describe("Übersicht", () => {
  it("liefert Zeitreihe, Kanäle und Trichter über die API", async () => {
    const res = await built.app.inject({ url: `/api/mp/projects/${pid}/cockpit?tage=30`, headers: auth });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.verlauf).toHaveLength(30);
    expect(view.zeitraum.tage).toBe(30);
    expect(view.trichter.map((s: { id: string }) => s.id)).toEqual(["aufrufe", "interaktionen", "klicks", "konten", "kaeufe"]);
    // Ohne Produktdatenquelle sagt die Seite, warum Konten und Umsatz fehlen.
    expect(view.produkt.verfuegbar).toBe(false);
    expect(view.hinweise.join(" ")).toMatch(/keine Produktdatenquelle/);
  });

  /**
   * Der Kern der Ehrlichkeit: ein Tag ohne Messung ist `null`. Als `0`
   * gezeichnet sähe jeder nicht abgerufene Tag wie ein Einbruch aus.
   */
  it("unterscheidet nicht gemessen von null", () => {
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    schreibeKanalTag(built.db, pid, "instagram", heute, { aufrufe: 0 });
    const view = cockpitView(built.db, pid, { tage: 7 });
    const heutiger = view.verlauf.find((v) => v.tag === heute);
    expect(heutiger?.aufrufe).toBe(0);
    // Ein Tag ohne jede Zeile bleibt leer.
    expect(view.verlauf.find((v) => v.tag !== heute && v.aufrufe === null)).toBeTruthy();
  });

  /**
   * Follower sind ein Bestand. Solange ein eingerichteter Kanal seinen Stand
   * nicht gemeldet hat, gibt es keine Gesamtzahl — sonst spränge die Kurve,
   * sobald ein zweiter Kanal dazukommt, und sähe aus wie Wachstum.
   */
  it("summiert Follower erst, wenn jeder eingerichtete Kanal einen Stand hat", async () => {
    // Eigenes Projekt: die Frage ist der leere Ausgangszustand, und den hätten
    // die Zeilen der vorherigen Fälle längst gefüllt.
    const eigen = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Follower", url: "https://follower.test" } })).json().id as string;
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    saveCredentials(built.db, eigen, { instagram: { igUserId: "ig1", accessToken: "tok" }, facebook: { pageId: "fb1", accessToken: "tok" } });
    schreibeKanalTag(built.db, eigen, "instagram", heute, { follower: 7 });
    expect(cockpitView(built.db, eigen, { tage: 7 }).verlauf.find((v) => v.tag === heute)?.follower).toBeNull();
    schreibeKanalTag(built.db, eigen, "facebook", heute, { follower: 3 });
    expect(cockpitView(built.db, eigen, { tage: 7 }).verlauf.find((v) => v.tag === heute)?.follower).toBe(10);
  });

  it("zählt Klicks auf den Tag, an dem sie passiert sind", () => {
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    zaehleTagesklick(built.db, pid, null, "abc123");
    zaehleTagesklick(built.db, pid, null, "abc123");
    const view = cockpitView(built.db, pid, { tage: 7 });
    expect(view.verlauf.find((v) => v.tag === heute)?.klicks).toBe(2);
    expect(view.kennzahlen.find((k) => k.id === "klicks")?.wert).toBe(2);
  });

  it("zählt einen veröffentlichten Beitrag mit seinen Zahlen", () => {
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    const pieceId = newId();
    built.db.insert(t.mpContentPieces).values({ id: pieceId, projectId: pid, channel: "Instagram", format: "carousel", title: "Testbeitrag", status: "published", createdAt: nowIso(), updatedAt: nowIso() }).run();
    built.db.insert(t.mpScheduledPosts).values({
      id: newId(), projectId: pid, pieceId, platform: "instagram", scheduledAt: nowIso(), status: "posted",
      providerRef: "media-1", postedAt: new Date().toISOString(), createdAt: nowIso(),
      metrics: JSON.stringify({ reichweite: 20, aufrufe: 50, likes: 4, kommentare: 1, saves: 2, shares: 0, quelle: "api" }),
      metricsAt: nowIso(),
    }).run();
    const view = cockpitView(built.db, pid, { tage: 7 });
    expect(view.beitraege).toHaveLength(1);
    expect(view.beitraege[0]).toMatchObject({ titel: "Testbeitrag", platform: "instagram", aufrufe: 50 });
    // Quote = alle Reaktionen geteilt durch Aufrufe, nicht durch Reichweite.
    expect(view.beitraege[0]!.quote).toBeCloseTo(7 / 50, 4);
    expect(view.verlauf.find((v) => v.tag === heute)?.beitraege).toBe(1);
  });

  it("nimmt Kanäle ohne Zahlen und ohne Beiträge aus der Liste", () => {
    const view = cockpitView(built.db, pid, { tage: 7 });
    expect(view.kanaele.map((k) => k.platform).sort()).toEqual(["facebook", "instagram", "threads"]);
    expect(view.kanaele.find((k) => k.platform === "instagram")?.eingerichtet).toBe(true);
  });

  it("startet den Abruf nur, wenn der Worker lebt", async () => {
    const res = await built.app.inject({ method: "POST", url: `/api/mp/projects/${pid}/kanal-stats/run`, headers: auth });
    expect([202, 400]).toContain(res.statusCode);
    if (res.statusCode === 400) expect(res.json().detail).toMatch(/Worker/);
  });

  it("räumt die Testzeilen wieder ab", () => {
    built.db.delete(t.mpKanalStats).where(eq(t.mpKanalStats.projectId, pid)).run();
    expect(leseKanalTage(built.db, pid, "2026-01-01")).toHaveLength(0);
  });
});

/**
 * Welle 1: die Startseite trennt Arbeit von Zustand.
 *
 * Der Fehler, der hier nicht wiederkommen darf: „Posten" zeigte jedes
 * freigegebene Stück, auch die 83, für die der Pilot längst einen Termin hatte.
 * Wer die Liste abarbeitete, postete doppelt.
 */
describe("Heute trennt Handarbeit von Terminiertem", () => {
  it("nimmt eingeplante Stücke aus der Posten-Liste und zählt sie getrennt", async () => {
    const pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Stau", url: "https://stau.test" } })).json().id as string;
    const stueck = (kanal: string) => {
      const id = newId();
      built.db.insert(t.mpContentPieces).values({ id, projectId: pid, channel: kanal, format: "carousel", title: `Stück ${kanal}`, status: "approved", createdAt: nowIso(), updatedAt: nowIso(), meta: JSON.stringify({ platform: kanal }) }).run();
      return id;
    };
    const mitTermin = stueck("instagram");
    const ohneTermin = stueck("tiktok");
    const gepostet = stueck("facebook");
    built.db.insert(t.mpScheduledPosts).values({ id: newId(), projectId: pid, pieceId: mitTermin, platform: "instagram", scheduledAt: "2099-01-01T12:00:00.000Z", status: "queued", createdAt: nowIso() }).run();
    built.db.insert(t.mpScheduledPosts).values({ id: newId(), projectId: pid, pieceId: gepostet, platform: "facebook", scheduledAt: "2026-09-01T12:00:00.000Z", status: "posted", postedAt: "2026-09-01T12:00:05.000Z", createdAt: nowIso() }).run();

    const v = todayView(built.db, pid);
    expect(v.toPost.map((x) => x.piece.id)).toEqual([ohneTermin]);
    expect(v.eingeplant).toMatchObject({ anzahl: 1, naechsterAt: "2099-01-01T12:00:00.000Z", naechsterPlatform: "instagram" });
    expect(v.eingeplant.plattformen).toEqual([{ platform: "instagram", anzahl: 1 }]);
  });

  it("meldet gescheiterte Termine mit einem Grund, den man lesen kann", async () => {
    const pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Fehlschlag", url: "https://fehl.test" } })).json().id as string;
    const id = newId();
    built.db.insert(t.mpContentPieces).values({ id, projectId: pid, channel: "facebook", format: "carousel", title: "Gescheitert", status: "approved", createdAt: nowIso(), updatedAt: nowIso() }).run();
    built.db.insert(t.mpScheduledPosts).values({
      id: newId(), projectId: pid, pieceId: id, platform: "facebook", scheduledAt: new Date().toISOString(), status: "failed",
      error: 'Facebook-Album 400: {"error":{"message":"Bestätige deine Identität","code":368}}', createdAt: nowIso(),
    }).run();
    const v = todayView(built.db, pid);
    expect(v.gescheitert.anzahl).toBe(1);
    expect(v.gescheitert.grund).toMatch(/Identitätsprüfung/);
    // Das Stück selbst bleibt Handarbeit: der Pilot hat es nicht abgesetzt.
    expect(v.toPost).toHaveLength(1);
  });
});

/** Der Aufräum-Job: abgelehnte Stücke verlieren ihre Dateien, nicht ihren Text. */
describe("Aufräumen", () => {
  it("löscht nur, was älter ist als das Fenster, und merkt sich den Lauf", async () => {
    const pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Müll", url: "https://muell.test" } })).json().id as string;
    const alt = newId(), neu = newId();
    const vorTagen = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    built.db.insert(t.mpContentPieces).values({ id: alt, projectId: pid, channel: "instagram", format: "video", title: "alt", status: "rejected", createdAt: vorTagen(20), updatedAt: vorTagen(10) }).run();
    built.db.insert(t.mpContentPieces).values({ id: neu, projectId: pid, channel: "instagram", format: "video", title: "neu", status: "rejected", createdAt: vorTagen(1), updatedAt: vorTagen(1) }).run();
    raeumeAuf(built.db, DATA);
    const meta = (id: string) => JSON.parse(built.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, id)).get()!.meta) as Record<string, unknown>;
    expect(meta(alt)["dateienGeloescht"]).toBeTruthy();
    expect(meta(neu)["dateienGeloescht"]).toBeUndefined();
    // Der Text bleibt: die Ablehnung muss nachvollziehbar sein.
    expect(built.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, alt)).get()?.title).toBe("alt");
  });

  it("entfernt abgesagte Termine erst nach dreißig Tagen", async () => {
    const pid = (await built.app.inject({ method: "POST", url: "/api/mp/projects", headers: auth, payload: { name: "Absagen", url: "https://absage.test" } })).json().id as string;
    const piece = newId();
    built.db.insert(t.mpContentPieces).values({ id: piece, projectId: pid, channel: "instagram", format: "carousel", title: "x", status: "rejected", createdAt: nowIso(), updatedAt: nowIso() }).run();
    const eintrag = (tage: number) => {
      const id = newId();
      built.db.insert(t.mpScheduledPosts).values({ id, projectId: pid, pieceId: piece, platform: "instagram", scheduledAt: nowIso(), status: "cancelled", createdAt: new Date(Date.now() - tage * 86_400_000).toISOString() }).run();
      return id;
    };
    const alt = eintrag(40), jung = eintrag(5);
    raeumeAuf(built.db, DATA);
    const da = (id: string) => Boolean(built.db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.id, id)).get());
    expect(da(alt)).toBe(false);
    expect(da(jung)).toBe(true);
  });
});
