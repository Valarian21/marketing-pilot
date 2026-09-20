/**
 * YouTube über das Studio bespielen — Shorts und lange Videos, ohne Google-Projekt.
 *
 * Die Data API bräuchte ein Cloud-Projekt, eine App-Prüfung und ein Kontingent
 * von sechs Uploads am Tag. Stattdessen derselbe Weg wie bei TikTok: der Mensch
 * meldet sich im Anmelde-Browser (studio-browser.ts) bei Google an, danach
 * trägt dieser Lauf die freigegebenen Beiträge in studio.youtube.com ein —
 * Titel, Beschreibung mit Kurzlink, Schlagwörter, „nicht für Kinder", Termin.
 *
 * Was von YouTube kommt und nicht von uns:
 * - **Shorts bekommen auf dem Desktop kein eigenes Vorschaubild.** YouTube
 *   nimmt ein Bild aus dem Video. Unsere Reels beginnen schwarz (Titelkarte ab
 *   ~0,5 s), deshalb legt `uploadVideo()` die Titelkarte über die ersten
 *   Zehntelsekunden — dann ist jedes Bild, das YouTube wählt, ein gutes.
 * - Der Termin lässt sich nur in Viertelstunden setzen; wir runden ab.
 * - Titel höchstens 100 Zeichen, Beschreibung höchstens 5.000.
 *
 * Die Oberfläche des Studios ist ein Polymer-Baukasten mit stabilen `id`s
 * (#title-textarea, #next-button, #schedule-radio-button …); bei jedem Fehler
 * liegt ein Bildschirmfoto in data/youtube-logs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Page } from "playwright";
import * as t from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";
import {
  aktuelleSitzung, berlin, logOrdner, schuss as schussAllgemein, sitzungOeffnen, sitzungSchliessen,
  type Lauf, type PlanStatus, type PlanZeile,
} from "./studio-browser.js";

export type { Lauf, PlanStatus, PlanZeile } from "./studio-browser.js";

const DIENST = "youtube" as const;
/** Kurzlink für die Beschreibung — der Weg, den die Herkunftsmessung zählt. */
const KURZLINK = "https://binderplan.app/yt";
const STUDIO_URL = "https://studio.youtube.com/";
const TITEL_MAX = 100;
const BESCHREIBUNG_MAX = 5000;

// --- Sitzung ---------------------------------------------------------------

export async function sitzungStarten(env: Env): Promise<{ passwort: string }> {
  const s = await sitzungOeffnen(env, DIENST, STUDIO_URL);
  return { passwort: s.passwort };
}

/** Angemeldet, sobald Google seine Sitzungscookies gesetzt hat. */
async function angemeldet(): Promise<boolean> {
  const ctx = aktuelleSitzung(DIENST)?.ctx;
  if (!ctx) return false;
  try {
    const cookies = await ctx.cookies(["https://youtube.com", "https://studio.youtube.com", "https://google.com"]);
    return cookies.some((c) => (c.name === "SAPISID" || c.name === "__Secure-3PAPISID" || c.name === "LOGIN_INFO") && !!c.value);
  } catch { return false; }
}

export async function sitzungStatus(env: Env): Promise<{
  laeuft: boolean; angemeldet: boolean; passwort: string | null; gestartetAm: string | null; lauf: Lauf | null;
}> {
  void env;
  const s = aktuelleSitzung(DIENST);
  return {
    laeuft: !!s?.ctx,
    angemeldet: await angemeldet(),
    passwort: s?.passwort ?? null,
    gestartetAm: s?.gestartetAm ?? null,
    lauf: s?.lauf ?? null,
  };
}

export async function sitzungBeenden(env: Env): Promise<void> {
  if (!aktuelleSitzung(DIENST)) return;
  await sitzungSchliessen(env);
}

// --- Was ist zu planen? ----------------------------------------------------

export type Auftrag = {
  pieceId: string;
  titel: string;
  beschreibung: string;
  schlagworte: string[];
  video: string;
  /** Titelkarte fürs Upload-Video — das Video selbst wird erst im Lauf gerechnet. */
  cover: string | null;
  geplantAm: string;
};

function stueckDateien(db: Db, env: Env, pieceId: string): { video: string | null; cover: string | null } {
  const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  let ids: string[] = [];
  try { ids = JSON.parse(stueck?.assets ?? "[]") as string[]; } catch { ids = []; }
  let video: string | null = null;
  let cover: string | null = null;
  for (const assetId of ids) {
    const asset = db.select().from(t.mpAssets).where(eq(t.mpAssets.id, assetId)).get();
    if (!asset?.path) continue;
    const voll = path.join(env.MP_DATA_DIR, asset.path);
    if (!fs.existsSync(voll)) continue;
    if (asset.path.endsWith(".mp4") && !video) video = voll;
    if (/-thumb\.(png|jpg)$/.test(asset.path) && !cover) cover = voll;
  }
  // Die Titelkarte liegt oft neben dem Video, ohne eigenen Asset-Eintrag.
  if (video && !cover) {
    for (const endung of ["-thumb.jpg", "-thumb.png"]) {
      const daneben = video.replace(/\.mp4$/, endung);
      if (fs.existsSync(daneben)) { cover = daneben; break; }
    }
  }
  return { video, cover };
}

/**
 * Das Video, das hochgeladen wird.
 *
 * Für Hochformat mit Titelkarte: die Karte über die ersten 0,6 s legen, damit
 * YouTubes automatisches Vorschaubild nie das schwarze erste Bild trifft.
 * Querformat (das lange Anleitungsvideo) geht unverändert hoch — dort setzt
 * das Studio ein eigenes Vorschaubild, wenn eines da ist.
 */
function uploadVideo(env: Env, pieceId: string, video: string, cover: string | null): string {
  if (!cover) return video;
  const ziel = path.join(logOrdner(env, DIENST), `upload-${pieceId}.mp4`);
  if (fs.existsSync(ziel) && fs.statSync(ziel).mtimeMs >= fs.statSync(video).mtimeMs) return ziel;
  const r = spawnSync("ffmpeg", [
    "-y", "-i", video, "-i", cover,
    "-filter_complex", "[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[c];[0:v][c]overlay=enable='lt(t,0.6)'[v]",
    "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", ziel, "-loglevel", "error",
  ]);
  return r.status === 0 && fs.existsSync(ziel) ? ziel : video;
}

/** „Drei Slabs. Oder eine Seite. · shorts" → „Drei Slabs. Oder eine Seite." */
function titelAus(stueckTitel: string): string {
  const t1 = stueckTitel.replace(/\s*·\s*(shorts|youtube|instagram|tiktok)\s*$/i, "").trim();
  return t1.length > TITEL_MAX ? `${t1.slice(0, TITEL_MAX - 1).trimEnd()}…` : t1;
}

function schlagworteAus(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) tags.add(m[1]!.toLowerCase());
  for (const fest of ["pokemon", "pokemonkarten", "binderplan"]) tags.add(fest);
  return [...tags].slice(0, 12);
}

/** Beschreibung: der Beitragstext, darunter der Kurzlink — auf YouTube ist er klickbar. */
function beschreibungAus(text: string): string {
  const b = `${text.trim()}\n\nBinderseiten planen: ${KURZLINK}`;
  return b.length > BESCHREIBUNG_MAX ? b.slice(0, BESCHREIBUNG_MAX) : b;
}

/**
 * Alles, was auf YouTube wartet: freigegeben, Termin gesetzt, noch nicht im
 * Studio, Video vorhanden, Termin nicht zu nah.
 */
export function offeneAuftraege(db: Db, env: Env, projectId: string): { auftraege: Auftrag[]; uebersprungen: PlanZeile[] } {
  const termine = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.platform, "youtube"))).all()
    .filter((x) => x.status === "queued")
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));

  const auftraege: Auftrag[] = [];
  const uebersprungen: PlanZeile[] = [];
  for (const termin of termine) {
    const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, termin.pieceId)).get();
    if (!stueck) continue;
    const titel = titelAus(stueck.title ?? "(ohne Titel)");
    const zeile = (meldung: string): PlanZeile =>
      ({ pieceId: termin.pieceId, titel, geplantAm: termin.scheduledAt ?? null, status: "uebersprungen", meldung });

    if (termin.providerRef === "youtube-studio") { uebersprungen.push(zeile("liegt schon im Studio")); continue; }
    if (stueck.status !== "approved" && stueck.status !== "published") { uebersprungen.push(zeile("nicht freigegeben")); continue; }
    const wann = new Date(String(termin.scheduledAt)).getTime();
    if (wann < Date.now() + 20 * 60_000) { uebersprungen.push(zeile("Termin liegt in der Vergangenheit oder zu nah")); continue; }
    const { video, cover } = stueckDateien(db, env, termin.pieceId);
    if (!video) { uebersprungen.push(zeile("kein fertiges Video")); continue; }
    auftraege.push({
      pieceId: termin.pieceId, titel,
      beschreibung: beschreibungAus(stueck.body ?? ""),
      schlagworte: schlagworteAus(stueck.body ?? ""),
      video, cover,
      geplantAm: String(termin.scheduledAt),
    });
  }
  return { auftraege, uebersprungen };
}

// --- Der Lauf im Studio ----------------------------------------------------

const schuss = (seite: Page, env: Env, name: string) => schussAllgemein(seite, env, DIENST, name);

/** Zeitwahl im Studio: Viertelstunden, deshalb abrunden. */
function viertelstunde(minute: string): string {
  return String(Math.floor(Number(minute) / 15) * 15).padStart(2, "0");
}

/** In ein Polymer-Textfeld tippen: markieren, löschen, Zeile für Zeile schreiben. */
async function tippen(seite: Page, feld: ReturnType<Page["locator"]>, text: string): Promise<void> {
  await feld.click();
  await seite.keyboard.press("Control+A");
  await seite.keyboard.press("Delete");
  const zeilen = text.split("\n");
  for (let i = 0; i < zeilen.length; i++) {
    if (zeilen[i]) await seite.keyboard.type(zeilen[i]!, { delay: 8 });
    if (i < zeilen.length - 1) await seite.keyboard.press("Shift+Enter");
  }
}

/**
 * Ein Stück hochladen und terminieren. Vier Seiten des Assistenten: Details,
 * Videoelemente, Prüfung, Sichtbarkeit — die mittleren zwei werden nur mit
 * „Weiter" durchlaufen.
 */
async function einesPlanen(seite: Page, env: Env, auftrag: Auftrag, probe: boolean): Promise<PlanZeile> {
  const zeile = (status: PlanStatus, meldung: string): PlanZeile =>
    ({ pieceId: auftrag.pieceId, titel: auftrag.titel, geplantAm: auftrag.geplantAm, status, meldung });
  const fehlt = async (was: string, name: string) => {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-${name}`);
    return zeile("fehler", `${was} — Bildschirmfoto in youtube-logs`);
  };

  // 1. Upload-Dialog öffnen (?d=ud öffnet ihn direkt) und Datei wählen.
  await seite.goto(`${STUDIO_URL}channel/UC/videos/upload?d=ud`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await seite.waitForTimeout(4000);
  let dateiFeld = seite.locator('ytcp-uploads-file-picker input[type="file"], input[type="file"]').first();
  if (!(await dateiFeld.count())) {
    // Ohne Dialog: über den „Erstellen"-Knopf gehen.
    const erstellen = seite.locator("#create-icon, ytcp-button#create-icon").first();
    if (await erstellen.count()) {
      await erstellen.click();
      await seite.waitForTimeout(1500);
      await seite.locator("#text-item-0, tp-yt-paper-item#text-item-0").first().click().catch(() => {});
      await seite.waitForTimeout(2500);
    }
    dateiFeld = seite.locator('input[type="file"]').first();
  }
  if (!(await dateiFeld.count())) return fehlt("Upload-Dialog nicht gefunden", "upload");
  /**
   * Das Upload-Video erst hier rechnen, nicht in der Ansicht: `uploadVideo()`
   * ruft ffmpeg synchron und blockiert damit den ganzen Dienst. Am 21.09.2026
   * hing der Pilot beim ersten Öffnen der YouTube-Karte minutenlang, weil die
   * Ansicht 29 wartende Shorts auf einmal vorbereitete — der Anmelde-Knopf
   * wirkte tot, weil keine Anfrage mehr durchkam.
   */
  await dateiFeld.setInputFiles(uploadVideo(env, auftrag.pieceId, auftrag.video, auftrag.cover));

  // 2. Details: Titel, Beschreibung. Das Titelfeld erscheint, sobald der
  //    Upload angenommen ist — YouTube füllt es mit dem Dateinamen vor.
  const titelFeld = seite.locator("#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea #textbox").first();
  try { await titelFeld.waitFor({ state: "visible", timeout: 120_000 }); }
  catch { return fehlt("Detailseite nach dem Upload nicht erschienen", "details"); }
  await seite.waitForTimeout(2500);
  await tippen(seite, titelFeld, auftrag.titel);
  await seite.waitForTimeout(600);

  const beschreibungFeld = seite.locator("#description-textarea #textbox, ytcp-social-suggestions-textbox#description-textarea #textbox").first();
  if (await beschreibungFeld.count()) {
    await tippen(seite, beschreibungFeld, auftrag.beschreibung);
    await seite.waitForTimeout(600);
  }

  // 3. Zielgruppe: nicht für Kinder — Pflichtangabe, ohne sie geht „Weiter" nicht.
  const nichtKinder = seite.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], #audience tp-yt-paper-radio-button').last();
  if (await nichtKinder.count()) { await nichtKinder.scrollIntoViewIfNeeded(); await nichtKinder.click().catch(() => {}); }
  await seite.waitForTimeout(600);

  // 4. Schlagwörter stehen hinter „Mehr anzeigen". Ohne sie geht es auch — nichts abbrechen.
  try {
    const mehr = seite.locator("#toggle-button, ytcp-button#toggle-button").first();
    if (await mehr.count()) { await mehr.scrollIntoViewIfNeeded(); await mehr.click(); await seite.waitForTimeout(1200); }
    const tagFeld = seite.locator("#tags-container input, ytcp-free-text-chip-bar input").first();
    if (await tagFeld.count()) {
      await tagFeld.scrollIntoViewIfNeeded();
      await tagFeld.click();
      for (const tag of auftrag.schlagworte) { await seite.keyboard.type(`${tag},`, { delay: 8 }); await seite.waitForTimeout(150); }
    }
  } catch { /* Schlagwörter sind Zugabe */ }
  await schuss(seite, env, `details-${auftrag.pieceId}`);

  // 5. Weiter, Weiter, Weiter — Videoelemente und Prüfung überspringen.
  const weiter = seite.locator("#next-button").first();
  for (let i = 0; i < 3; i++) {
    if (!(await weiter.count())) return fehlt("„Weiter“-Knopf nicht gefunden", `weiter${i}`);
    await weiter.click();
    await seite.waitForTimeout(2500);
  }

  // 6. Sichtbarkeit: planen. Datum als Text ins Feld, Uhrzeit aus der Liste.
  const planen = seite.locator("#schedule-radio-button, tp-yt-paper-radio-button[name=\"SCHEDULE\"]").first();
  if (!(await planen.count())) return fehlt("Umschalter „Planen“ nicht gefunden", "schalter");
  await planen.click();
  await seite.waitForTimeout(1500);

  const { datum, stunde, minute } = berlin(auftrag.geplantAm);
  const min15 = viertelstunde(minute);
  const datumDe = `${datum.slice(8, 10)}.${datum.slice(5, 7)}.${datum.slice(0, 4)}`;

  const datumKnopf = seite.locator("#datepicker-trigger").first();
  if (await datumKnopf.count()) {
    await datumKnopf.click();
    await seite.waitForTimeout(1000);
    const datumFeld = seite.locator("ytcp-date-picker input, tp-yt-paper-dialog input").first();
    if (await datumFeld.count()) {
      await datumFeld.click();
      await seite.keyboard.press("Control+A");
      await seite.keyboard.type(datumDe, { delay: 20 });
      await seite.keyboard.press("Enter");
      await seite.waitForTimeout(1000);
    }
    await seite.keyboard.press("Escape").catch(() => {});
    await seite.waitForTimeout(500);
  }

  const zeitKnopf = seite.locator("#time-of-day-trigger").first();
  if (await zeitKnopf.count()) {
    await zeitKnopf.click();
    await seite.waitForTimeout(1000);
    const eintrag = seite.locator("tp-yt-paper-item, ytcp-text-menu tp-yt-paper-item").filter({ hasText: new RegExp(`^\\s*${stunde}:${min15}\\s*$`) }).first();
    if (await eintrag.count()) { await eintrag.scrollIntoViewIfNeeded(); await eintrag.click(); }
    else await seite.keyboard.press("Escape");
    await seite.waitForTimeout(1000);
  }

  // Gegenprobe: was zeigt das Studio? Lieber nichts abschicken als den falschen Tag.
  const gesetztDatum = ((await datumKnopf.textContent().catch(() => "")) ?? "").trim();
  const gesetztZeit = ((await seite.locator("#time-of-day-trigger input, #time-of-day-trigger").first().inputValue().catch(async () =>
    (await zeitKnopf.textContent().catch(() => "")) ?? "")) ?? "").trim();
  const tagNr = String(Number(datum.slice(8, 10)));
  const datumPasst = gesetztDatum.includes(datumDe) || (gesetztDatum.includes(tagNr) && gesetztDatum.includes(datum.slice(0, 4)));
  const zeitPasst = gesetztZeit.includes(`${stunde}:${min15}`);
  await schuss(seite, env, `vor-absenden-${auftrag.pieceId}`);
  if (!datumPasst || !zeitPasst) {
    return zeile("fehler", `Termin sitzt nicht: Studio zeigt „${gesetztDatum} ${gesetztZeit}“ statt ${datumDe} ${stunde}:${min15} — Bildschirmfoto in youtube-logs`);
  }

  if (probe) return zeile("uebersprungen", `Probelauf — ausgefüllt für ${datumDe} ${stunde}:${min15}, nicht abgeschickt`);

  // 7. Abschicken. Danach zeigt das Studio den Teilen-Dialog mit dem Link —
  //    daraus kommt die Video-Id, die der Pilot für die Zahlen je Video braucht.
  const fertig = seite.locator("#done-button").first();
  if (!(await fertig.count())) return fehlt("„Planen“-Knopf nicht gefunden", "knopf");
  await fertig.click();
  let link = "";
  for (let i = 0; i < 20 && !link; i++) {
    await seite.waitForTimeout(1500);
    const a = seite.locator("ytcp-video-share-dialog a, #share-url, a[href*='youtu.be/'], a[href*='youtube.com/shorts/']").first();
    if (await a.count()) link = ((await a.getAttribute("href").catch(() => null)) ?? (await a.textContent().catch(() => "")) ?? "").trim();
  }
  await schuss(seite, env, `nach-absenden-${auftrag.pieceId}`);
  const schliessen = seite.locator("#close-button, ytcp-button#close-button").first();
  if (await schliessen.count()) await schliessen.click().catch(() => {});
  await seite.waitForTimeout(1000);
  if (!link) return zeile("geplant", `im Studio terminiert auf ${datumDe} ${stunde}:${min15} (Link nicht gelesen)`);
  return zeile("geplant", `im Studio terminiert auf ${datumDe} ${stunde}:${min15} · ${link}`);
}

export async function planenStarten(db: Db, env: Env, projectId: string, probe: boolean): Promise<Lauf> {
  const s = aktuelleSitzung(DIENST);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet())) throw new Error("Im Browser ist niemand bei YouTube angemeldet.");
  if (s.lauf?.laeuft) throw new Error("Es läuft schon ein Planungslauf.");

  const { auftraege, uebersprungen } = offeneAuftraege(db, env, projectId);
  const lauf: Lauf = {
    laeuft: true, probe, gestartetAm: new Date().toISOString(), fertigAm: null,
    gesamt: auftraege.length, erledigt: 0, aktuell: null, zeilen: [...uebersprungen],
  };
  s.lauf = lauf;

  void (async () => {
    const ctx = s.ctx;
    if (!ctx) return;
    const seite = ctx.pages()[0] ?? (await ctx.newPage());
    for (const auftrag of auftraege) {
      lauf.aktuell = auftrag.titel;
      try {
        lauf.zeilen.push(await einesPlanen(seite, env, auftrag, probe));
      } catch (e) {
        await schuss(seite, env, `fehler-${auftrag.pieceId}`);
        lauf.zeilen.push({
          pieceId: auftrag.pieceId, titel: auftrag.titel, geplantAm: auftrag.geplantAm,
          status: "fehler", meldung: e instanceof Error ? e.message.slice(0, 300) : String(e),
        });
      }
      lauf.erledigt += 1;
      // Im Probelauf bleibt der Assistent offen — schließen, sonst blockiert er den nächsten.
      if (probe) {
        const schliessen = seite.locator("#close-button, ytcp-button#close-button").first();
        if (await schliessen.count()) await schliessen.click().catch(() => {});
        await seite.waitForTimeout(1500);
        const verwerfen = seite.getByRole("button", { name: /Verwerfen|Discard|Löschen|Delete/i }).first();
        if (await verwerfen.count()) await verwerfen.click().catch(() => {});
      }
      await seite.waitForTimeout(4000);
    }
    lauf.aktuell = null;
    lauf.laeuft = false;
    lauf.fertigAm = new Date().toISOString();
  })();

  return lauf;
}

/**
 * Nach einem echten Lauf vermerken, was im Studio liegt: `providerRef`
 * markiert den Termin als erledigt, `externalUrl` trägt den Videolink —
 * daran hängt später die Zahl je Video.
 */
export function laufVermerken(db: Db, projectId: string): number {
  const lauf = aktuelleSitzung(DIENST)?.lauf;
  if (!lauf || lauf.laeuft || lauf.probe) return 0;
  let n = 0;
  for (const z of lauf.zeilen.filter((x) => x.status === "geplant")) {
    const termin = db.select().from(t.mpScheduledPosts)
      .where(and(eq(t.mpScheduledPosts.pieceId, z.pieceId), eq(t.mpScheduledPosts.platform, "youtube"))).all()
      .find((x) => x.status === "queued" && x.projectId === projectId);
    if (!termin) continue;
    const link = /https?:\/\/\S+/.exec(z.meldung)?.[0] ?? "";
    db.update(t.mpScheduledPosts).set({ providerRef: "youtube-studio", externalUrl: link || termin.externalUrl })
      .where(eq(t.mpScheduledPosts.id, termin.id)).run();
    n += 1;
  }
  return n;
}
