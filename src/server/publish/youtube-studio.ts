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
import { newId, nowIso, parseJson, toJson, type Db } from "../db/index.js";
import type { Env } from "../env.js";
import { loadProfiles } from "../channels.js";
import { schreibeKanalTag, youtubeKanalId } from "./kanal-metriken.js";
import { schreibeVerlauf } from "./metrics.js";
import {
  aktuelleSitzung, berlin, logOrdner, schritt as schrittAllgemein, schuss as schussAllgemein, sitzungOeffnen, sitzungSchliessen,
  type Lauf, type PlanStatus, type PlanZeile, type Schritt,
} from "./studio-browser.js";

export type { Lauf, PlanStatus, PlanZeile, Schritt } from "./studio-browser.js";

/** Fernsteuerung für die Einrichtung — dieselbe wie bei Pinterest. */
export const schritt = (env: Env, auftrag: Schritt) => schrittAllgemein(env, DIENST, auftrag);

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

/**
 * Die eigene Kanal-Id, einmal je Lauf aus der Studio-Adresse gelesen.
 *
 * `…/channel/UC/videos/upload` mit dem Platzhalter „UC" lädt eine **weiße
 * Seite** (21.09.2026 im Probelauf: „Upload-Dialog nicht gefunden"). Mit der
 * echten Id öffnet derselbe Weg den Dialog sofort.
 */
let gemerkteKanalId: string | null = null;
async function kanalIdHolen(seite: Page): Promise<string> {
  if (gemerkteKanalId) return gemerkteKanalId;
  const ausUrl = /\/channel\/(UC[\w-]+)/.exec(seite.url())?.[1];
  if (ausUrl) { gemerkteKanalId = ausUrl; return ausUrl; }
  gemerkteKanalId = await kanalIdAus(seite);
  return gemerkteKanalId;
}

/**
 * Klicken, ohne hängen zu bleiben.
 *
 * Das Studio zeichnet Knöpfe in Schatten-Bäumen; `scrollIntoViewIfNeeded()`
 * lief am 21.09.2026 dreißig Sekunden ins Leere und riss jeden Auftrag mit.
 * Kurze Frist, dann erzwungen, zuletzt per Skript — und nie eine Ausnahme.
 */
async function sanftKlicken(l: ReturnType<Page["locator"]>): Promise<boolean> {
  for (const versuch of [() => l.click({ timeout: 4000 }), () => l.click({ timeout: 4000, force: true }),
    () => l.evaluate((el) => (el as HTMLElement).click(), undefined, { timeout: 4000 })]) {
    try { await versuch(); return true; } catch { /* nächster Versuch */ }
  }
  return false;
}

/** Zeitwahl im Studio: Viertelstunden, deshalb abrunden. */
function viertelstunde(minute: string): string {
  return String(Math.floor(Number(minute) / 15) * 15).padStart(2, "0");
}

/**
 * In ein Polymer-Textfeld tippen: markieren, löschen, Zeile für Zeile schreiben.
 *
 * Der Klick geht über `sanftKlicken` — das Beschreibungsfeld liegt unter der
 * Falz, und ein gewöhnlicher Klick wartete am 21.09.2026 dreißig Sekunden auf
 * einen Treffer, den es nie gab.
 */
async function tippen(seite: Page, feld: ReturnType<Page["locator"]>, text: string): Promise<boolean> {
  if (!(await sanftKlicken(feld))) return false;
  await seite.keyboard.press("Control+A");
  await seite.keyboard.press("Delete");
  const zeilen = text.split("\n");
  for (let i = 0; i < zeilen.length; i++) {
    if (zeilen[i]) await seite.keyboard.type(zeilen[i]!, { delay: 8 });
    if (i < zeilen.length - 1) await seite.keyboard.press("Shift+Enter");
  }
  return true;
}

/**
 * Ein Stück hochladen und terminieren. Vier Seiten des Assistenten: Details,
 * Videoelemente, Prüfung, Sichtbarkeit — die mittleren zwei werden nur mit
 * „Weiter" durchlaufen.
 */
/** Titel vergleichbar machen: Groß/klein, Mehrfach-Leerzeichen, Kanal-Suffix. */
const titelSchluessel = (s2: string) => s2.toLowerCase().replace(/\s*·\s*(shorts|youtube)\s*$/i, "").replace(/\s+/g, " ").trim();

/**
 * Einen wartenden Entwurf mit diesem Titel im Studio öffnen.
 *
 * Gesucht wird in beiden Listen (Videos und Shorts); die Zeile trägt den
 * Knopf „Entwurf bearbeiten", der den Assistenten mit dem bereits
 * hochgeladenen Video öffnet. Findet sich nichts, bleibt alles wie es war.
 */
async function entwurfOeffnen(seite: Page, titel: string): Promise<"entwurf" | "geplant" | "nein"> {
  const kanalId = await kanalIdHolen(seite);
  for (const art of ["short", "upload"]) {
    await seite.goto(`${STUDIO_URL}channel/${kanalId}/videos/${art}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await seite.waitForTimeout(5000);
    const zeilen = await seite.locator("ytcp-video-row").count().catch(() => 0);
    for (let i = 0; i < zeilen; i++) {
      const row = seite.locator("ytcp-video-row").nth(i);
      const rowTitel = ((await row.locator("#video-title").first().innerText().catch(() => "")) ?? "").trim();
      if (titelSchluessel(rowTitel) !== titelSchluessel(titel)) continue;
      // Steht die Zeile schon auf „Geplant", ist nichts mehr zu tun.
      const zeilenText = ((await row.innerText().catch(() => "")) ?? "");
      if (/\bGeplant\b|\bScheduled\b/.test(zeilenText)) return "geplant";
      const knopf = row.locator("a, button").filter({ hasText: /Entwurf bearbeiten|Edit draft/i }).first();
      if (!(await knopf.count())) continue;
      if (!(await sanftKlicken(knopf))) continue;
      await seite.waitForTimeout(6000);
      return "entwurf";
    }
  }
  return "nein";
}

async function einesPlanen(seite: Page, env: Env, auftrag: Auftrag, probe: boolean): Promise<PlanZeile> {
  const zeile = (status: PlanStatus, meldung: string): PlanZeile =>
    ({ pieceId: auftrag.pieceId, titel: auftrag.titel, geplantAm: auftrag.geplantAm, status, meldung });
  const fehlt = async (was: string, name: string) => {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-${name}`);
    return zeile("fehler", `${was} — Bildschirmfoto in youtube-logs`);
  };

  /**
   * 1a. Liegt das Video schon als **Entwurf** im Studio? Dann wird es
   * fertiggestellt statt neu hochgeladen.
   *
   * Grund: YouTube begrenzt unbestätigte Kanäle auf wenige Uploads am Tag
   * („Tägliches Upload-Limit erreicht", 21.09.2026 nach 23 Probeläufen). Jeder
   * gescheiterte Assistent hätte sonst ein Kontingent verbrannt und das Video
   * doppelt abgelegt.
   */
  const schon = await entwurfOeffnen(seite, auftrag.titel);
  if (schon === "geplant") return zeile("uebersprungen", "liegt schon geplant im Studio");
  if (schon === "entwurf") return assistentFuellen(seite, env, auftrag, probe);

  // 1b. Upload-Dialog öffnen (?d=ud öffnet ihn direkt) und Datei wählen.
  const kanalId = await kanalIdHolen(seite);
  await seite.goto(`${STUDIO_URL}channel/${kanalId}/videos/upload?d=ud`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await seite.waitForTimeout(5000);
  let dateiFeld = seite.locator('ytcp-uploads-file-picker input[type="file"], input[type="file"]').first();
  if (!(await dateiFeld.count())) {
    // Ohne Dialog: über den „Erstellen"-Knopf gehen.
    const erstellen = seite.locator("#create-icon, ytcp-button#create-icon").first();
    if (await erstellen.count()) {
      await sanftKlicken(erstellen);
      await seite.waitForTimeout(1500);
      await sanftKlicken(seite.locator("#text-item-0, tp-yt-paper-item#text-item-0").first());
      await seite.waitForTimeout(2500);
    }
    dateiFeld = seite.locator('input[type="file"]').first();
  }
  if (!(await dateiFeld.count())) return fehlt("Upload-Dialog nicht gefunden", "upload");
  /**
   * YouTube deckelt unbestätigte Kanäle auf wenige Uploads am Tag. Ist das
   * Limit erreicht, legt das Studio einen grauen Schleier über den Assistenten
   * — jede weitere Eingabe läuft ins Leere, und der Auftrag scheiterte bisher
   * erst Schritte später mit einer irreführenden Meldung (21.09.2026).
   * Der Kanal lässt sich unter youtube.com/verify freischalten.
   */
  if (await seite.getByText(/Tägliches Upload-Limit erreicht|Daily upload limit reached/i).first().count()) {
    return zeile("uebersprungen", "YouTube: tägliches Upload-Limit erreicht — Kanal unter youtube.com/verify bestätigen");
  }
  /**
   * Das Upload-Video erst hier rechnen, nicht in der Ansicht: `uploadVideo()`
   * ruft ffmpeg synchron und blockiert damit den ganzen Dienst. Am 21.09.2026
   * hing der Pilot beim ersten Öffnen der YouTube-Karte minutenlang, weil die
   * Ansicht 29 wartende Shorts auf einmal vorbereitete — der Anmelde-Knopf
   * wirkte tot, weil keine Anfrage mehr durchkam.
   */
  await dateiFeld.setInputFiles(uploadVideo(env, auftrag.pieceId, auftrag.video, auftrag.cover));

  return assistentFuellen(seite, env, auftrag, probe);
}

/**
 * Der Assistent ab der Detailseite — für frische Uploads und für Entwürfe.
 */
async function assistentFuellen(seite: Page, env: Env, auftrag: Auftrag, probe: boolean): Promise<PlanZeile> {
  const zeile = (status: PlanStatus, meldung: string): PlanZeile =>
    ({ pieceId: auftrag.pieceId, titel: auftrag.titel, geplantAm: auftrag.geplantAm, status, meldung });
  const fehlt = async (was: string, name: string) => {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-${name}`);
    return zeile("fehler", `${was} — Bildschirmfoto in youtube-logs`);
  };

  // 2. Details: Titel, Beschreibung. Das Titelfeld erscheint, sobald der
  //    Upload angenommen ist — YouTube füllt es mit dem Dateinamen vor.
  const titelFeld = seite.locator("#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea #textbox").first();
  try { await titelFeld.waitFor({ state: "visible", timeout: 120_000 }); }
  catch { return fehlt("Detailseite nach dem Upload nicht erschienen", "details"); }
  await seite.waitForTimeout(2500);
  const titelJetzt = ((await titelFeld.innerText().catch(() => "")) ?? "").trim();
  if (titelSchluessel(titelJetzt) !== titelSchluessel(auftrag.titel)) {
    if (!(await tippen(seite, titelFeld, auftrag.titel))) return fehlt("Titelfeld ließ sich nicht anklicken", "titel");
    await seite.waitForTimeout(600);
  }

  const beschreibungFeld = seite.locator("#description-textarea #textbox, ytcp-social-suggestions-textbox#description-textarea #textbox").first();
  if (await beschreibungFeld.count()) {
    const jetzt = ((await beschreibungFeld.innerText().catch(() => "")) ?? "").trim();
    // Der Entwurf trägt den Text schon — dann nicht noch einmal tippen.
    if (jetzt.length < 20) { await tippen(seite, beschreibungFeld, auftrag.beschreibung); await seite.waitForTimeout(600); }
  }

  /**
   * 3. Zielgruppe: „Nein, nicht speziell für Kinder" — Pflichtangabe; ohne sie
   * bleibt „Weiter" grau und der Assistent steht still (21.09.2026 genau so
   * gesehen: drei Klicks auf „Weiter" bewirkten nichts).
   *
   * Gewählt wird über den **Text**, nicht über `name="VIDEO_MADE_FOR_KIDS_NOT_MFK"`:
   * Das Attribut trägt der Schalter im Studio nicht mehr, und `.last()` einer
   * gemischten Liste traf die falsche Zeile.
   */
  const nichtKinder = seite.locator("tp-yt-paper-radio-button")
    .filter({ hasText: /nicht speziell für Kinder|not made for kids/i }).first();
  if (!(await nichtKinder.count())) return fehlt("Zielgruppen-Frage nicht gefunden", "kinder");
  await sanftKlicken(nichtKinder);
  await seite.waitForTimeout(800);
  // Gegenprobe: ist der Schalter wirklich gesetzt? Sonst bleibt „Weiter" gesperrt.
  const gesetzt = await nichtKinder.getAttribute("aria-checked").catch(() => null);
  if (gesetzt !== "true") {
    await sanftKlicken(nichtKinder.locator("#radioLabel, div").first());
    await seite.waitForTimeout(800);
  }

  // 4. Schlagwörter stehen hinter „Mehr anzeigen". Ohne sie geht es auch — nichts abbrechen.
  try {
    const mehr = seite.locator("#toggle-button, ytcp-button#toggle-button").first();
    if (await mehr.count()) { await sanftKlicken(mehr); await seite.waitForTimeout(1200); }
    const tagFeld = seite.locator("#tags-container input, ytcp-free-text-chip-bar input").first();
    if (await tagFeld.count()) {
      await sanftKlicken(tagFeld);
      for (const tag of auftrag.schlagworte) { await seite.keyboard.type(`${tag},`, { delay: 8 }); await seite.waitForTimeout(150); }
    }
  } catch { /* Schlagwörter sind Zugabe */ }
  await schuss(seite, env, `details-${auftrag.pieceId}`);

  /**
   * 5. „Weiter", bis die Sichtbarkeitsseite da ist.
   *
   * Gezählt wird nicht, sondern **auf das Ziel geprüft**: Der Assistent hat je
   * nach Video drei oder vier Seiten, und ein gesperrter Knopf schluckt den
   * Klick lautlos. Am 21.09.2026 meldete eine Schrittzählung „bleibt stehen",
   * während der Assistent längst auf der Vorabprüfung war.
   */
  const weiter = seite.locator("#next-button").first();
  // Erkennungsmerkmal der Sichtbarkeitsseite — der Aufklapper für den Termin.
  const planenSchalter = () => seite.locator("#second-container-expand-button, #datepicker-trigger").first();
  let sichtbarkeitDa = false;
  for (let i = 0; i < 6 && !sichtbarkeitDa; i++) {
    if (await planenSchalter().count()) { sichtbarkeitDa = true; break; }
    if (!(await weiter.count())) return fehlt("„Weiter“-Knopf nicht gefunden", `weiter${i}`);
    await sanftKlicken(weiter);
    await seite.waitForTimeout(2500);
  }
  if (!sichtbarkeitDa && !(await planenSchalter().count())) return fehlt("Sichtbarkeitsseite nicht erreicht", "sichtbarkeit");

  // 6. Sichtbarkeit: planen. Datum als Text ins Feld, Uhrzeit aus der Liste.
  const { datum, stunde, minute } = berlin(auftrag.geplantAm);
  const min15 = viertelstunde(minute);
  const datumDe = `${datum.slice(8, 10)}.${datum.slice(5, 7)}.${datum.slice(0, 4)}`;

  /**
   * Der Terminblock liegt hinter dem Aufklapper „Veröffentlichungszeitpunkt
   * festlegen" (`#second-container-expand-button`). Darin: das Datum als
   * Auswahlknopf, die Uhrzeit als **Textfeld** — einen `#time-of-day-trigger`
   * gibt es nicht mehr (21.09.2026 am offenen Studio nachgesehen). Die
   * Überschrift lautet „Als ‚Öffentlich' planen"; die Sichtbarkeit ergibt sich
   * daraus, ein eigener Schalter ist nicht nötig.
   */
  if (!(await seite.locator("#datepicker-trigger").first().isVisible().catch(() => false))) {
    await sanftKlicken(seite.locator("#second-container-expand-button").first());
    await seite.waitForTimeout(1800);
  }

  const datumKnopf = seite.locator("#datepicker-trigger").first();
  if (!(await datumKnopf.count())) return fehlt("Datumsauswahl nicht gefunden", "datum");
  await sanftKlicken(datumKnopf);
  await seite.waitForTimeout(1200);
  // Genau dieses Feld: im geöffneten Kalender steht neben dem Datumsfeld auch
  // das Zeitfeld in einem `tp-yt-paper-dialog` — ein gemeinsamer Selektor traf
  // am 21.09.2026 das falsche und schrieb das Datum in die Uhrzeit.
  const datumFeld = seite.locator("ytcp-date-picker input").first();
  if (await datumFeld.count()) {
    await sanftKlicken(datumFeld);
    await seite.keyboard.press("Control+A");
    await seite.keyboard.type(datumDe, { delay: 25 });
    await seite.keyboard.press("Enter");
    await seite.waitForTimeout(1500);
  }

  // Nach dem Schließen des Kalenders ist das einzige Eingabefeld die Uhrzeit.
  const zeitFeld = seite.locator("ytcp-datetime-picker input").first();
  if (await zeitFeld.count()) {
    await sanftKlicken(zeitFeld);
    await seite.keyboard.press("Control+A");
    await seite.keyboard.type(`${stunde}:${min15}`, { delay: 30 });
    await seite.keyboard.press("Enter");
    await seite.waitForTimeout(1200);
  }

  // Gegenprobe: was zeigt das Studio? Lieber nichts abschicken als den falschen Tag.
  const gesetztDatum = ((await datumKnopf.innerText().catch(() => "")) ?? "").trim();
  const gesetztZeit = ((await zeitFeld.inputValue().catch(() => "")) ?? "").trim();
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
  if (!(await sanftKlicken(fertig))) return fehlt("„Planen“ ließ sich nicht klicken", "knopf");
  let link = "";
  for (let i = 0; i < 20 && !link; i++) {
    await seite.waitForTimeout(1500);
    const a = seite.locator("ytcp-video-share-dialog a, #share-url, a[href*='youtu.be/'], a[href*='youtube.com/shorts/']").first();
    if (await a.count()) link = ((await a.getAttribute("href").catch(() => null)) ?? (await a.textContent().catch(() => "")) ?? "").trim();
  }
  await schuss(seite, env, `nach-absenden-${auftrag.pieceId}`);
  // Beim Planen zeigt das Studio keinen Teilen-Dialog, sondern speichert still
  // („Alle Änderungen gespeichert", 21.09.2026). Der Videolink steht dann in
  // der Inhalte-Liste und kommt über `zahlenHolen()` nach.
  const schliessen = seite.locator("#close-button, ytcp-button#close-button").first();
  if (await schliessen.count()) await schliessen.click().catch(() => {});
  await seite.waitForTimeout(1000);
  if (!link) return zeile("geplant", `im Studio terminiert auf ${datumDe} ${stunde}:${min15} (Link nicht gelesen)`);
  return zeile("geplant", `im Studio terminiert auf ${datumDe} ${stunde}:${min15} · ${link}`);
}

export async function planenStarten(db: Db, env: Env, projectId: string, probe: boolean, hoechstens = 0): Promise<Lauf> {
  const s = aktuelleSitzung(DIENST);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet())) throw new Error("Im Browser ist niemand bei YouTube angemeldet.");
  if (s.lauf?.laeuft) throw new Error("Es läuft schon ein Planungslauf.");

  const alle = offeneAuftraege(db, env, projectId);
  // Ein Stapel lässt sich begrenzen — für Probeläufe und um YouTubes
  // Tagesgrenze nicht auf einmal auszureizen.
  const auftraege = hoechstens > 0 ? alle.auftraege.slice(0, hoechstens) : alle.auftraege;
  const uebersprungen = alle.uebersprungen;
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


// --- Zahlen aus dem Studio ---------------------------------------------------
//
// Ohne Google-Projekt gibt es keine Analytics-API; der öffentliche Feed nennt
// nur die Aufrufe der letzten 15 Videos. Mit der angemeldeten Sitzung liest
// dieser Lauf, was das Studio zeigt: je Video Aufrufe, Kommentare, Likes (aus
// der Inhalte-Liste, alle Seiten) und für den Kanal Abonnenten, Aufrufe und
// Wiedergabezeit der letzten 28 Tage (Kanal-Dashboard). Geschrieben wird in
// dieselben Tabellen wie bei den API-Kanälen — mp_kanal_stats (Tag) und die
// Metriken samt Verlauf der Termine —, damit die Übersicht nichts Neues lernen
// muss. Videos, die der Pilot nicht kennt (Handuploads), landen mit ihren
// Zahlen unter `youtube-studio:<projekt>` in den Einstellungen.

export type StudioVideo = { id: string; titel: string; datum: string; aufrufe: number | null; kommentare: number | null; likes: number | null };
export type StudioZahlen = {
  abgerufenAm: string;
  kanalId: string;
  kanal: { abonnenten: number | null; aufrufe28: number | null; wiedergabeStunden28: number | null };
  videos: StudioVideo[];
  zugeordnet: number;
};

/** „1.359" → 1359, „3,2" → 3.2, „–" → null. */
function zahlAus(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /-?\d[\d.]*(?:,\d+)?/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Die Kanal-Id aus der Studio-Adresse.
 *
 * `studio.youtube.com` leitet erst nach dem Laden auf `/channel/UC…` um, und
 * wie lange das dauert, haengt am Zustand der Sitzung: nach zwoelf Stunden
 * Leerlauf brauchte die Weiterleitung am 22.09.2026 laenger als die vier
 * Sekunden, die hier frueher fest gewartet wurden — der Tageslauf brach mit
 * „Kanal-Id nicht in der Studio-Adresse" ab, obwohl die Anmeldung stand.
 * Deshalb wird jetzt auf die Adresse gewartet, und wenn sie ausbleibt, dient
 * die Seite selbst als zweite Quelle (der Kanalwechsler nennt die Id im HTML).
 */
async function kanalIdAus(seite: Page): Promise<string> {
  const ausUrl = () => /\/channel\/(UC[\w-]+)/.exec(seite.url())?.[1] ?? null;
  if (!ausUrl()) {
    await seite.goto(STUDIO_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await seite.waitForURL(/\/channel\/UC[\w-]+/, { timeout: 45_000 }).catch(() => {});
  }
  const ausAdresse = ausUrl();
  if (ausAdresse) return ausAdresse;
  const html = await seite.content().catch(() => "");
  const imHtml = /"(?:channelId|externalChannelId)":"(UC[\w-]+)"/.exec(html)?.[1];
  if (imHtml) return imHtml;
  throw new Error(`Kanal-Id nicht in der Studio-Adresse (${seite.url()})`);
}

/** Kanal-Dashboard: Abonnenten, Aufrufe und Wiedergabezeit der letzten 28 Tage. */
async function kanalZahlen(seite: Page, env: Env, kanalId: string): Promise<StudioZahlen["kanal"]> {
  await seite.goto(`${STUDIO_URL}channel/${kanalId}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await seite.waitForTimeout(6000);
  const text = (await seite.locator("body").innerText().catch(() => "")).replace(/\u00a0/g, " ");
  await schuss(seite, env, "zahlen-dashboard");
  // Der Seitentext liegt neben dem Foto — für den Fall, dass eine Zahl daneben liegt.
  try { fs.writeFileSync(path.join(logOrdner(env, DIENST), "zahlen-dashboard.txt"), text); } catch { /* egal */ }
  const greif = (re: RegExp) => zahlAus(re.exec(text)?.[1] ?? null);
  // Die 28-Tage-Zahlen stehen in der Karte „Kanalanalysen" **nach** „Letzte 28 Tage";
  // davor nennt die Karte „Leistung des neuesten Shorts" ebenfalls „Aufrufe" (am 21.09. 9 statt 1.359 gelesen).
  const ab = text.split(/Letzte\s+28\s+Tage|Last\s+28\s+days/i)[1] ?? text;
  const greifAb = (re: RegExp) => zahlAus(re.exec(ab)?.[1] ?? null);
  return {
    abonnenten: greif(/Aktuelle Abonnenten\s*\n?\s*([\d.]+)/i) ?? greif(/Current subscribers\s*\n?\s*([\d,]+)/i),
    aufrufe28: greifAb(/Aufrufe\s*\n?\s*([\d.]+)/i) ?? greifAb(/Views\s*\n?\s*([\d,]+)/i),
    wiedergabeStunden28: greifAb(/Wiedergabezeit \(Stunden\)\s*\n?\s*([\d.,]+)/i) ?? greifAb(/Watch time \(hours\)\s*\n?\s*([\d.,]+)/i),
  };
}

/** Inhalte-Liste des Studios, Videos und Shorts, alle Seiten. */
async function videoListe(seite: Page, env: Env, kanalId: string): Promise<StudioVideo[]> {
  const aus: StudioVideo[] = [];
  for (const art of ["upload", "short"]) {
    await seite.goto(`${STUDIO_URL}channel/${kanalId}/videos/${art}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await seite.waitForTimeout(6000);
    for (let blatt = 0; blatt < 6; blatt++) {
      await seite.locator("ytcp-video-row").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      await schuss(seite, env, `zahlen-liste-${art}-${blatt}`);
      const zeilen = await seite.locator("ytcp-video-row").evaluateAll((rows) => rows.map((r) => {
        // Der Titel steht in #video-title; der erste Link der Zeile ist das
        // Vorschaubild, dessen Text die Dauer ist („0:20") — am 21.09. so gelaufen.
        const titelLink = r.querySelector("#video-title") as HTMLAnchorElement | null;
        const irgendein = r.querySelector("a[href*='/video/']") as HTMLAnchorElement | null;
        const zelle = (sel: string) => (r.querySelector(sel) as HTMLElement | null)?.innerText ?? "";
        return {
          href: titelLink?.getAttribute("href") ?? irgendein?.getAttribute("href") ?? "", titel: (titelLink?.innerText ?? "").trim(),
          datum: zelle(".tablecell-date"), aufrufe: zelle(".tablecell-views"), kommentare: zelle(".tablecell-comments"), likes: zelle(".tablecell-likes"),
        };
      })).catch(() => [] as { href: string; titel: string; datum: string; aufrufe: string; kommentare: string; likes: string }[]);
      for (const z of zeilen) {
        const id = /\/video\/([\w-]{6,})/.exec(z.href)?.[1];
        if (!id || aus.some((v) => v.id === id)) continue;
        // Die Likes-Zelle zeigt „100,0 %" und darunter die Zahl — die Zahl ist die letzte.
        const likesText = z.likes.split("\n").map((x) => x.trim()).filter((x) => x && !x.includes("%")).pop() ?? "";
        aus.push({ id, titel: z.titel, datum: z.datum.split("\n")[0]?.trim() ?? "", aufrufe: zahlAus(z.aufrufe), kommentare: zahlAus(z.kommentare), likes: zahlAus(likesText) });
      }
      const weiter = seite.locator("#navigate-after, ytcp-icon-button#navigate-after").first();
      if (!(await weiter.count()) || (await weiter.getAttribute("disabled")) !== null || !zeilen.length) break;
      await weiter.click();
      await seite.waitForTimeout(3500);
    }
  }
  return aus;
}

/** Ein Studio-Video seinem Termin im Piloten zuordnen — über den Videolink, sonst über den Titel. */
function terminFuerVideo(db: Db, projectId: string, v: StudioVideo): { id: string; pieceId: string } | null {
  const termine = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.platform, "youtube"))).all()
    .filter((x) => x.status !== "cancelled");
  const perLink = termine.find((x) => (x.externalUrl ?? "").includes(v.id));
  if (perLink) return { id: perLink.id, pieceId: perLink.pieceId };
  const norm = (s: string) => s.toLowerCase().replace(/\s*·\s*(shorts|youtube)\s*$/i, "").replace(/\s+/g, " ").trim();
  for (const x of termine) {
    const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, x.pieceId)).get();
    if (stueck && norm(stueck.title ?? "") === norm(v.titel)) return { id: x.id, pieceId: x.pieceId };
  }
  return null;
}

/**
 * Der Lauf: liest Dashboard und Inhalte-Liste, schreibt Kanaltag, Metriken und
 * Verlauf, merkt sich die ganze Liste in den Einstellungen.
 */
export async function zahlenHolen(db: Db, env: Env, projectId: string): Promise<StudioZahlen> {
  const s = aktuelleSitzung(DIENST);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet())) throw new Error("Im Browser ist niemand bei YouTube angemeldet.");
  if (s.lauf?.laeuft) throw new Error("Es läuft gerade ein Planungslauf.");
  const seite = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  const kanalId = await kanalIdAus(seite);
  await passtZumProjekt(db, projectId, kanalId);
  const kanal = await kanalZahlen(seite, env, kanalId);
  const videos = await videoListe(seite, env, kanalId);
  const now = new Date();
  const tag = now.toISOString().slice(0, 10);

  // Kanaltag: Bestand aus allen Videos, dazu die 28-Tage-Werte des Dashboards.
  const aufrufeGesamt = videos.reduce((n, v) => n + (v.aufrufe ?? 0), 0);
  const interaktionenGesamt = videos.reduce((n, v) => n + (v.likes ?? 0) + (v.kommentare ?? 0), 0);
  const werte: Record<string, number> = { aufrufeGesamt, interaktionenGesamt, beitraege: videos.length,
    likes: videos.reduce((n, v) => n + (v.likes ?? 0), 0), kommentare: videos.reduce((n, v) => n + (v.kommentare ?? 0), 0) };
  if (kanal.abonnenten !== null) werte["follower"] = kanal.abonnenten;
  if (kanal.aufrufe28 !== null) werte["aufrufe28Tage"] = kanal.aufrufe28;
  if (kanal.wiedergabeStunden28 !== null) werte["wiedergabeStunden28Tage"] = kanal.wiedergabeStunden28;
  schreibeKanalTag(db, projectId, "youtube", tag, werte, now, "api");

  // Je Video: Termin finden, Metriken und Verlauf schreiben, Link nachtragen.
  let zugeordnet = 0;
  for (const v of videos) {
    const termin = terminFuerVideo(db, projectId, v);
    if (!termin) continue;
    zugeordnet += 1;
    const m = { reichweite: null, aufrufe: v.aufrufe, likes: v.likes, kommentare: v.kommentare, saves: null, shares: null, quelle: "api" as const, roh: { studio: 1 } };
    const alt = db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.id, termin.id)).get();
    const link = alt?.externalUrl || `https://www.youtube.com/shorts/${v.id}`;
    db.update(t.mpScheduledPosts).set({ metrics: toJson(m), metricsAt: now.toISOString(), externalUrl: link }).where(eq(t.mpScheduledPosts.id, termin.id)).run();
    schreibeVerlauf(db, termin.id, m, now);
  }

  const ergebnis: StudioZahlen = { abgerufenAm: now.toISOString(), kanalId, kanal, videos, zugeordnet };
  const key = `youtube-studio:${projectId}`;
  db.insert(t.mpSettings).values({ key, value: toJson(ergebnis), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(ergebnis), updatedAt: nowIso() } }).run();
  return ergebnis;
}

/**
 * Gehört der angemeldete Kanal überhaupt zu diesem Projekt?
 *
 * Der Tageslauf schrieb am 21.09.2026 die Zahlen des Binderplan-Kanals unter
 * „Lehreule" fort: er lief über alle aktiven Projekte, und im Browser ist nun
 * einmal genau ein Konto angemeldet. Zahlen unter dem falschen Namen sind
 * schlimmer als gar keine — deshalb bricht der Lauf hier ab, statt zu raten.
 */
async function passtZumProjekt(db: Db, projectId: string, kanalId: string): Promise<void> {
  const url = (loadProfiles(db, projectId).find((p) => p.platform === "youtube")?.url ?? "").trim();
  if (!url) throw new Error("Für dieses Projekt ist auf der Kanäle-Seite kein YouTube-Kanal hinterlegt.");
  // Schlägt das Auflösen fehl (YouTube antwortet nicht), läuft der Abruf weiter:
  // ein hinterlegter Kanal ist die eigentliche Zusage, die Prüfung nur die Kür.
  const erwartet = await youtubeKanalId(fetch, url).catch(() => null);
  if (erwartet && erwartet !== kanalId) {
    throw new Error(`Im Browser ist der Kanal ${kanalId} angemeldet, dieses Projekt führt ${erwartet} (${url}).`);
  }
}

/** Der letzte Stand aus dem Studio, falls es einen gibt. */
export function studioZahlen(db: Db, projectId: string): StudioZahlen | null {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, `youtube-studio:${projectId}`)).get();
  return row ? parseJson<StudioZahlen | null>(row.value, null) : null;
}
