/**
 * TikTok über das Studio bespielen — der Weg ohne Veröffentlichungs-API.
 *
 * TikTok gibt uns keine Posting-API (siehe handarbeit.ts), und Zugangsdaten
 * nehmen wir bewusst nicht entgegen. Stattdessen läuft auf dem VPS ein echter
 * Chrome auf einem virtuellen Bildschirm: der Mensch klickt im Piloten auf
 * „Anmelden“, sieht dieses Chrome-Fenster im Browser (noVNC) und meldet sich
 * **selbst** an — Passwort und 2FA tippt er, wir sehen beides nie.
 *
 * Danach bleibt das Chrome-Profil unter data/tiktok-profil liegen. Der
 * Planungslauf benutzt dasselbe Profil weiter, also dieselbe IP und denselben
 * Fingerabdruck wie die Anmeldung — genau daran scheitern exportierte Cookies
 * sonst.
 *
 * Grenzen, die von TikTok kommen und nicht von uns:
 * - Das Studio plant höchstens **10 Tage** im Voraus. Was weiter weg liegt,
 *   bleibt liegen und wird beim nächsten Lauf nachgeholt.
 * - Bild-Karussells (data_carousel) gehen einen anderen Upload-Weg; sie werden
 *   hier übersprungen und bleiben Handarbeit.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Page } from "playwright";
import * as t from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";
import { loadProfiles } from "../channels.js";
import { deuteZahl, liesExport, speichereExport } from "./kanal-import.js";
import { schreibeKanalTag } from "./kanal-metriken.js";
import {
  aktuelleSitzung, berlin, logOrdner as logOrdnerAllgemein, schritt as schrittAllgemein, schuss as schussAllgemein,
  sitzungOeffnen, sitzungSchliessen,
  type Lauf, type PlanStatus, type PlanZeile, type Schritt,
} from "./studio-browser.js";

export type { Lauf, PlanStatus, PlanZeile } from "./studio-browser.js";

const DIENST = "tiktok" as const;

/** Fernsteuerung des Anmelde-Browsers — wie bei YouTube und Pinterest. */
export const schritt = (env: Env, auftrag: Schritt) => schrittAllgemein(env, DIENST, auftrag);
/** TikTok plant nicht weiter als zehn Tage voraus. */
const MAX_TAGE_VORAUS = 10;

const logOrdner = (env: Env) => logOrdnerAllgemein(env, DIENST);

// --- Sitzung ---------------------------------------------------------------
// Bildschirm, VNC und Chrome-Profil liegen in studio-browser.ts — YouTube
// nutzt denselben Weg. Hier bleibt nur, was TikTok-spezifisch ist.

/**
 * Anmelde-Sitzung starten: Bildschirm hoch, Chrome mit dem dauerhaften Profil
 * öffnen, TikTok laden. Läuft schon eine, wird sie ersetzt.
 */
export async function sitzungStarten(env: Env): Promise<{ passwort: string }> {
  const s = await sitzungOeffnen(env, DIENST, "https://www.tiktok.com/login");
  return { passwort: s.passwort };
}

/** Ist im laufenden Profil jemand angemeldet? Entscheidet das sessionid-Cookie. */
async function angemeldet(): Promise<boolean> {
  const ctx = aktuelleSitzung(DIENST)?.ctx;
  if (!ctx) return false;
  try {
    const cookies = await ctx.cookies("https://www.tiktok.com");
    return cookies.some((c) => c.name === "sessionid" && !!c.value);
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
  pieceId: string; titel: string; text: string; video: string; geplantAm: string;
  /** Titelkarte fuer das Cover — sonst nimmt TikTok das erste Bild, und das ist schwarz. */
  cover: string | null;
};

/**
 * Der fertige Renderpfad eines Stücks — ohne mp4 kann nichts hochgeladen werden.
 *
 * Achtung: die Dateien hängen **nicht** über `content_piece_id` am Stück. Ein
 * gerendertes Reel gehört dem Bündel, aus dem die Kanalfassungen entstanden
 * sind; das einzelne Stück verweist über seine `assets`-Liste darauf.
 */
function videoPfad(db: Db, env: Env, pieceId: string): string | null {
  const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  let ids: string[] = [];
  try { ids = JSON.parse(stueck?.assets ?? "[]") as string[]; } catch { ids = []; }
  for (const assetId of ids) {
    const asset = db.select().from(t.mpAssets).where(eq(t.mpAssets.id, assetId)).get();
    if (!asset?.path?.endsWith(".mp4")) continue;
    const voll = path.join(env.MP_DATA_DIR, asset.path);
    if (fs.existsSync(voll)) return voll;
  }
  return null;
}

/**
 * Alles, was auf TikTok wartet: freigegeben, Termin gesetzt, noch nicht
 * gepostet, Video vorhanden und innerhalb des Zehn-Tage-Fensters.
 */
export function offeneAuftraege(db: Db, env: Env, projectId: string): { auftraege: Auftrag[]; uebersprungen: PlanZeile[] } {
  const grenze = Date.now() + MAX_TAGE_VORAUS * 24 * 3600_000;
  const termine = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.platform, "tiktok"))).all()
    .filter((x) => x.status === "queued")
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));

  const auftraege: Auftrag[] = [];
  const uebersprungen: PlanZeile[] = [];
  for (const termin of termine) {
    const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, termin.pieceId)).get();
    if (!stueck) continue;
    const titel = stueck.title ?? "(ohne Titel)";
    const zeile = (meldung: string): PlanZeile =>
      ({ pieceId: termin.pieceId, titel, geplantAm: termin.scheduledAt ?? null, status: "uebersprungen", meldung });

    if (termin.providerRef === "tiktok-studio") {
      uebersprungen.push(zeile("liegt schon im Studio")); continue;
    }
    if (stueck.status !== "approved" && stueck.status !== "published") {
      uebersprungen.push(zeile("nicht freigegeben")); continue;
    }
    const wann = new Date(String(termin.scheduledAt)).getTime();
    if (wann > grenze) {
      uebersprungen.push(zeile(`liegt weiter als ${MAX_TAGE_VORAUS} Tage voraus — TikTok plant nicht so weit`)); continue;
    }
    if (wann < Date.now() + 20 * 60_000) {
      uebersprungen.push(zeile("Termin liegt in der Vergangenheit oder zu nah")); continue;
    }
    const video = videoPfad(db, env, termin.pieceId);
    if (!video) {
      uebersprungen.push(zeile("kein fertiges Video (Bild-Karussell bleibt Handarbeit)")); continue;
    }
    auftraege.push({
      pieceId: termin.pieceId, titel, text: stueck.body ?? "", video,
      geplantAm: String(termin.scheduledAt), cover: coverPfad(db, env, termin.pieceId),
    });
  }
  return { auftraege, uebersprungen };
}

/**
 * Die Titelkarte eines Stuecks.
 *
 * Ohne Cover nimmt TikTok das erste Bild des Videos — und unsere Reels
 * beginnen mit einem schwarzen Bild, die Titelkarte steht erst ab etwa 0,5 s.
 * In der Beitragsliste sah das am 14.09. nach neun schwarzen Kacheln aus.
 * Gibt es kein gerendertes `-thumb.png`, schneiden wir das Bild bei 1,0 s aus
 * dem Video; dort steht die Karte sicher.
 */
function coverPfad(db: Db, env: Env, pieceId: string): string | null {
  const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  let ids: string[] = [];
  try { ids = JSON.parse(stueck?.assets ?? "[]") as string[]; } catch { ids = []; }
  for (const assetId of ids) {
    const asset = db.select().from(t.mpAssets).where(eq(t.mpAssets.id, assetId)).get();
    if (!asset?.path?.endsWith("-thumb.png")) continue;
    const voll = path.join(env.MP_DATA_DIR, asset.path);
    if (fs.existsSync(voll)) return voll;
  }
  const video = videoPfad(db, env, pieceId);
  if (!video) return null;
  const ziel = path.join(logOrdner(env), `cover-${pieceId}.png`);
  const r = spawnSync("ffmpeg", ["-y", "-ss", "1.0", "-i", video, "-frames:v", "1", "-q:v", "2", ziel, "-loglevel", "error"]);
  return r.status === 0 && fs.existsSync(ziel) ? ziel : null;
}

// --- Der Lauf im Studio ----------------------------------------------------

const schuss = (seite: Page, env: Env, name: string) => schussAllgemein(seite, env, DIENST, name);

/**
 * Ein Stück hochladen und terminieren. Die Oberfläche des Studios ändert sich
 * oft, deshalb steht hinter jedem Schritt eine Auswahl von Beschriftungen in
 * Deutsch und Englisch — und bei jedem Fehler liegt ein Bildschirmfoto in
 * data/tiktok-logs.
 */
async function einesPlanen(seite: Page, env: Env, auftrag: Auftrag, probe: boolean): Promise<PlanZeile> {
  const zeile = (status: PlanStatus, meldung: string): PlanZeile =>
    ({ pieceId: auftrag.pieceId, titel: auftrag.titel, geplantAm: auftrag.geplantAm, status, meldung });

  await seite.goto("https://www.tiktok.com/tiktokstudio/upload?from=webapp", { waitUntil: "domcontentloaded" });
  await seite.waitForTimeout(3000);

  // 1. Datei wählen
  const dateiFeld = seite.locator('input[type="file"]').first();
  await dateiFeld.waitFor({ state: "attached", timeout: 30_000 });
  await dateiFeld.setInputFiles(auftrag.video);

  // 2. Warten bis TikTok die Datei angenommen hat — der Textkasten erscheint erst dann.
  const textKasten = seite.locator('div[contenteditable="true"]').first();
  await textKasten.waitFor({ state: "visible", timeout: 180_000 });
  await seite.waitForTimeout(2000);

  // TikTok schiebt gelegentlich ein Hinweisfenster ueber die Maske.
  const verstanden = seite.getByRole("button", { name: /^(Verstanden|Got it|OK)$/i }).first();
  if (await verstanden.count()) await verstanden.click().catch(() => {});
  await seite.waitForTimeout(1000);

  // 3. Beschreibung setzen: alten Inhalt (TikTok füllt den Dateinamen ein) leeren,
  //    dann tippen. Nach Hashtags schlägt TikTok Begriffe vor — Escape schließt das.
  await textKasten.click();
  await seite.keyboard.press("Control+A");
  await seite.keyboard.press("Delete");
  for (const teil of auftrag.text.split("\n")) {
    await seite.keyboard.type(teil, { delay: 12 });
    await seite.keyboard.press("Escape");
    await seite.keyboard.press("Enter");
  }
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(1000);

  // 3b. Coverbild setzen. Ohne das nimmt TikTok das erste Videobild — schwarz.
  if (auftrag.cover) {
    const coverKnopf = seite.getByText(/Cover bearbeiten|Edit cover/i).first();
    if (await coverKnopf.count()) {
      await coverKnopf.scrollIntoViewIfNeeded();
      await coverKnopf.click();
      await seite.waitForTimeout(3000);
      await seite.locator('input[type="file"]').last().setInputFiles(auftrag.cover);
      await seite.waitForTimeout(4500);
      const speichern = seite.getByRole("button", { name: /^(Speichern|Save)$/ }).first();
      if (await speichern.count()) { await speichern.click(); await seite.waitForTimeout(3000); }
      else {
        await schuss(seite, env, `fehler-${auftrag.pieceId}-cover`);
        return zeile("fehler", "Cover ließ sich nicht speichern — Bildschirmfoto in tiktok-logs");
      }
    }
  }

  // 4. Auf „Zeitplan" umschalten. Der Schalter heisst so — nicht
  //    „Terminieren", wie zuerst geraten (am 14.09. am Objekt nachgesehen).
  const zeitplan = seite.getByText(/^Zeitplan$/).first();
  if (!(await zeitplan.count())) {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-schalter`);
    return zeile("fehler", "Umschalter „Zeitplan“ nicht gefunden — Bildschirmfoto in tiktok-logs");
  }
  await zeitplan.scrollIntoViewIfNeeded();
  await zeitplan.click();
  await seite.waitForTimeout(2000);

  // 5. Uhrzeit und Datum. Beide Felder sind keine Textfelder, sondern oeffnen
  //    eine Auswahl: die Uhrzeit zwei Spalten (Stunde links, Minute rechts, in
  //    Fuenf-Minuten-Schritten), das Datum einen Kalender, in dem nur Tage mit
  //    der Klasse `valid` anklickbar sind.
  const { datum, stunde, minute } = berlin(auftrag.geplantAm);
  const felder = seite.locator("input.TUXTextInputCore-input");

  await felder.nth(0).click();
  await seite.waitForTimeout(1200);
  const stundeWahl = seite.locator(".tiktok-timepicker-option-text.tiktok-timepicker-left", { hasText: new RegExp(`^${stunde}$`) }).first();
  await stundeWahl.scrollIntoViewIfNeeded();
  await stundeWahl.click();
  await seite.waitForTimeout(800);
  const minuteWahl = seite.locator(".tiktok-timepicker-option-text.tiktok-timepicker-right", { hasText: new RegExp(`^${minute}$`) }).first();
  await minuteWahl.scrollIntoViewIfNeeded();
  await minuteWahl.click();
  await seite.waitForTimeout(800);

  await felder.nth(1).click();
  await seite.waitForTimeout(1200);
  const tag = String(Number(datum.slice(8, 10)));
  await seite.locator(".calendar-wrapper .day.valid").filter({ hasText: new RegExp(`^${tag}$`) }).last().click();
  await seite.waitForTimeout(1200);

  // Gegenprobe: lieber nichts abschicken als etwas auf den falschen Tag legen.
  const gesetztZeit = await felder.nth(0).inputValue();
  const gesetztDatum = await felder.nth(1).inputValue();
  if (gesetztDatum !== datum || gesetztZeit !== `${stunde}:${minute}`) {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-termin`);
    return zeile("fehler", `Termin sitzt nicht: Studio zeigt ${gesetztDatum} ${gesetztZeit} statt ${datum} ${stunde}:${minute}`);
  }
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(600);
  await schuss(seite, env, `vor-absenden-${auftrag.pieceId}`);

  if (probe) return zeile("uebersprungen", "Probelauf — alles ausgefüllt, aber nicht abgeschickt");

  // 6. Abschicken mit Geduld statt mit Zeitlimit.
  //
  // TikToks „Kurze Inhaltsprüfung" braucht mal 30 Sekunden, mal die 10 Minuten,
  // die sie selbst ankündigt — einmal hing sie ganz. Auf ihren Text zu warten
  // war deshalb untauglich. Stattdessen drücken wir „Planen" und lesen die
  // Rückfrage „Weiter und veröffentlichen?" als „noch nicht fertig": abbrechen,
  // warten, noch einmal. Deren Knopf heißt „Jetzt veröffentlichen" — den drücken
  // wir bei einem Termin nie, sonst ginge der Beitrag sofort raus.
  //
  // Bleibt die Prüfung auch nach der Hälfte der Versuche stehen, schalten wir
  // sie ab. Sie ist ein Zusatz, der vorab auf Probleme hinweist; TikToks
  // eigentliche Prüfung läuft davon unberührt weiter.
  const knopf = seite.getByRole("button", { name: /^Planen$/ }).first();
  if (!(await knopf.count())) {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-knopf`);
    return zeile("fehler", "Absende-Knopf nicht gefunden — Bildschirmfoto in tiktok-logs");
  }
  await seite.getByText(/Keine Probleme gefunden|No issues found/i).first()
    .waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});

  const MAX_VERSUCHE = 10;
  let abgeschickt = false;
  for (let versuch = 0; versuch < MAX_VERSUCHE && !abgeschickt; versuch++) {
    await knopf.click({ timeout: 15_000 }).catch(() => {});
    await seite.waitForTimeout(6000);
    if (seite.url().includes("/tiktokstudio/content")) { abgeschickt = true; break; }
    const abbrechen = seite.getByRole("button", { name: /^(Abbrechen|Cancel)$/ }).last();
    if (await abbrechen.count()) {
      await abbrechen.click().catch(() => {});
      await seite.waitForTimeout(25_000);
    } else {
      await seite.waitForTimeout(10_000);
    }
    if (versuch === Math.floor(MAX_VERSUCHE / 2)) {
      const schalter = seite.locator("input.Switch__input").last();
      if (await schalter.count()) {
        await schalter.click({ force: true }).catch(() => {});
        await seite.waitForTimeout(3000);
      }
    }
  }
  if (!abgeschickt) {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-absenden`);
    return zeile("fehler", `Planen ging nach ${MAX_VERSUCHE} Versuchen nicht durch — Bildschirmfoto in tiktok-logs`);
  }
  await schuss(seite, env, `nach-absenden-${auftrag.pieceId}`);
  return zeile("geplant", `im Studio terminiert auf ${datum} ${stunde}:${minute}`);
}

/**
 * Den ganzen Stapel durchgehen. Läuft im Hintergrund; der Fortschritt steht in
 * der Sitzung und wird von der Status-Abfrage mitgeliefert.
 */
export async function planenStarten(db: Db, env: Env, projectId: string, probe: boolean): Promise<Lauf> {
  const s = aktuelleSitzung(DIENST);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet())) throw new Error("Im Browser ist niemand bei TikTok angemeldet.");
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
      // Zwischen zwei Uploads eine Pause: ein Stakkato fällt auf.
      await seite.waitForTimeout(5000);
    }
    lauf.aktuell = null;
    lauf.laeuft = false;
    lauf.fertigAm = new Date().toISOString();
  })();

  return lauf;
}

/**
 * Nach einem echten Lauf vermerken, was im Studio liegt.
 *
 * Der Status bleibt bewusst `queued`: gepostet hat TikTok noch nichts, der
 * Beitrag steht dort nur terminiert. Die Markierung ist `providerRef` — daran
 * erkennt die Handarbeits-Ansicht, dass dieses Stück nicht mehr von Hand
 * hochgeladen werden muss.
 */
export function laufVermerken(db: Db, projectId: string): number {
  const lauf = aktuelleSitzung(DIENST)?.lauf;
  if (!lauf || lauf.laeuft || lauf.probe) return 0;
  let n = 0;
  for (const zeile of lauf.zeilen.filter((z) => z.status === "geplant")) {
    const termin = db.select().from(t.mpScheduledPosts)
      .where(and(eq(t.mpScheduledPosts.pieceId, zeile.pieceId), eq(t.mpScheduledPosts.platform, "tiktok"))).all()
      .find((x) => x.status === "queued" && x.projectId === projectId);
    if (!termin) continue;
    db.update(t.mpScheduledPosts).set({ providerRef: "tiktok-studio" })
      .where(eq(t.mpScheduledPosts.id, termin.id)).run();
    n += 1;
  }
  return n;
}

// --- Zahlen aus dem Studio ---------------------------------------------------
//
// TikTok gibt ohne Content-Posting-Audit keine Zahlen über eine API heraus.
// Bis zum 22.09.2026 hieß das: jemand lädt im Studio von Hand einen Export
// herunter und spielt ihn im Piloten ein — zuletzt am 18.09., danach niemand
// mehr, und in der Übersicht klaffte eine Lücke von drei Tagen.
//
// Dieser Lauf macht denselben Weg allein: er öffnet die Analyse-Seite mit dem
// gewünschten Zeitraum (der steht in der Adresse, die Auswahlliste braucht es
// nicht), klickt „Daten herunterladen", fängt die Datei ab und schickt sie
// durch **denselben** Leser wie der Handeinwurf (`kanal-import.ts`). Damit
// gibt es nur eine Stelle, die Exportspalten deutet, und der automatische Weg
// kann sich nicht anders verhalten als der von Hand.
//
// Der Kontoname kommt von der Studio-Startseite: dort stehen Handle und
// Followerzahl. Der Handle ist zugleich die Probe, ob der angemeldete Kanal
// überhaupt zu diesem Projekt gehört — sonst landen fremde Zahlen unter dem
// eigenen Namen, wie es bei YouTube am 21.09. passiert ist.

const STUDIO_START = "https://www.tiktok.com/tiktokstudio";
const ANALYSE_URL = "https://www.tiktok.com/tiktokstudio/analytics";

export type TiktokZahlen = {
  abgerufenAm: string;
  konto: string | null;
  follower: number | null;
  tage: number;
  von: string | null;
  bis: string | null;
  erkannt: Record<string, string>;
  unbekannt: string[];
  hinweise: string[];
};

/** `https://www.tiktok.com/@binderplan.app` → `binderplan.app`. */
const handleAus = (text: string): string | null =>
  /@([A-Za-z0-9._]+)/.exec(text.trim())?.[1]?.toLowerCase() ?? null;

/**
 * Handle und Followerzahl von der Studio-Startseite.
 *
 * Der Handle steht in den Profillinks der Seite (`/@name`); genommen wird der
 * häufigste, weil die Seite auch auf fremde Konten verlinken kann (Kommentare,
 * Inspiration). Die Followerzahl steht als „Follower*innen 25" im Text.
 */
async function kontoAus(seite: Page, env: Env): Promise<{ handle: string | null; follower: number | null }> {
  await seite.goto(STUDIO_START, { waitUntil: "domcontentloaded" }).catch(() => {});
  await seite.waitForTimeout(7000);
  await schuss(seite, env, "zahlen-start");
  const hrefs = await seite.locator('a[href^="/@"]').evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? "")).catch(() => [] as string[]);
  const zaehler = new Map<string, number>();
  for (const h of hrefs) {
    const name = handleAus(h);
    if (name) zaehler.set(name, (zaehler.get(name) ?? 0) + 1);
  }
  const handle = [...zaehler.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const text = (await seite.locator("body").innerText().catch(() => "")).replace(/\u00a0/g, " ");
  const roh = /Follower\*?innen\s*\n?\s*([\d.,]+)/i.exec(text)?.[1] ?? /Followers\s*\n?\s*([\d.,]+)/i.exec(text)?.[1] ?? null;
  const follower = roh ? deuteZahl(roh) ?? null : null;
  return { handle, follower };
}

/**
 * Den Übersicht-Export herunterladen und als Datei zurückgeben.
 *
 * Der Zeitraum steht in der Adresse (`dateRange={"type":"fixed","pastDay":60}`),
 * damit die Auswahlliste nicht angeklickt werden muss. Im Dialog wird CSV
 * gewählt: eine Textdatei lässt sich im Fehlerfall lesen, eine XLSX nicht.
 * Klappt der Klick auf CSV nicht, bleibt XLSX stehen — beides versteht
 * `liesExport`, der Lauf scheitert daran also nicht.
 */
async function exportHolen(seite: Page, env: Env, tageZurueck: number): Promise<{ name: string; datei: Buffer }> {
  const bereich = encodeURIComponent(JSON.stringify({ type: "fixed", pastDay: tageZurueck }));
  await seite.goto(`${ANALYSE_URL}?dateRange=${bereich}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await seite.waitForTimeout(9000);
  await schuss(seite, env, "zahlen-analyse");

  const knopf = seite.getByText("Daten herunterladen", { exact: false }).first();
  await knopf.click({ timeout: 15_000 });
  await seite.waitForTimeout(2500);
  await seite.getByText("CSV", { exact: true }).first().click({ timeout: 6000 }).catch(() => { /* XLSX geht auch */ });
  await seite.waitForTimeout(800);
  await schuss(seite, env, "zahlen-dialog");

  // Der Bestätigungsknopf heißt „Herunterladen" — der Auslöser darüber
  // „Daten herunterladen". `getByText` fände beide, deshalb der genaue Text.
  const [download] = await Promise.all([
    seite.waitForEvent("download", { timeout: 90_000 }),
    seite.getByText("Herunterladen", { exact: true }).last().click({ timeout: 15_000 }),
  ]);
  const name = download.suggestedFilename();
  const ziel = path.join(logOrdner(env), `export-${Date.now()}-${name.replace(/[^\w.-]+/g, "_")}`);
  await download.saveAs(ziel);
  const datei = fs.readFileSync(ziel);
  return { name, datei };
}

/**
 * Der Lauf: Konto prüfen, Export ziehen, Tageszeilen schreiben.
 *
 * `tageZurueck` ist bewusst großzügig (60): der Export kostet einen Klick,
 * egal wie viele Tage drinstehen, und ein Lauf, der ein paar Tage ausfällt,
 * holt die Lücke beim nächsten Mal von selbst nach.
 */
export async function zahlenHolen(db: Db, env: Env, projectId: string, tageZurueck = 60): Promise<TiktokZahlen> {
  const s = aktuelleSitzung(DIENST);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet())) throw new Error("Im Browser ist niemand bei TikTok angemeldet.");
  if (s.lauf?.laeuft) throw new Error("Es läuft gerade ein Planungslauf.");
  const seite = s.ctx.pages()[0] ?? (await s.ctx.newPage());

  const konto = await kontoAus(seite, env);
  const erwartet = handleAus(loadProfiles(db, projectId).find((p) => p.platform === "tiktok")?.url ?? "");
  if (!erwartet) throw new Error("Für dieses Projekt ist auf der Kanäle-Seite kein TikTok-Konto hinterlegt.");
  if (konto.handle && konto.handle !== erwartet) {
    throw new Error(`Im Browser ist @${konto.handle} angemeldet, dieses Projekt führt @${erwartet}.`);
  }

  const { name, datei } = await exportHolen(seite, env, tageZurueck);
  const now = new Date();
  const heute = berlin(now.toISOString()).datum;
  const deutung = liesExport(datei, name, heute);
  if (deutung.tage.length) speichereExport(db, projectId, "tiktok", deutung.tage, now);
  // Follower sind ein Bestand, kein Tageswert — der Export nennt sie nicht,
  // die Startseite schon. Sie gehören an den jüngsten Tag, den es gibt.
  if (konto.follower !== null) {
    schreibeKanalTag(db, projectId, "tiktok", deutung.tage.at(-1)?.tag ?? heute, { follower: konto.follower }, now, "hand");
  }

  const ergebnis: TiktokZahlen = {
    abgerufenAm: now.toISOString(), konto: konto.handle, follower: konto.follower,
    tage: deutung.tage.length, von: deutung.tage[0]?.tag ?? null, bis: deutung.tage.at(-1)?.tag ?? null,
    erkannt: deutung.erkannt, unbekannt: deutung.unbekannt, hinweise: deutung.hinweise,
  };
  const key = `tiktok-studio:${projectId}`;
  db.insert(t.mpSettings).values({ key, value: JSON.stringify(ergebnis), updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: JSON.stringify(ergebnis), updatedAt: new Date().toISOString() } }).run();
  return ergebnis;
}

/** Der letzte Stand aus dem Studio, falls es einen gibt. */
export function tiktokZahlen(db: Db, projectId: string): TiktokZahlen | null {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, `tiktok-studio:${projectId}`)).get();
  if (!row) return null;
  try { return JSON.parse(row.value) as TiktokZahlen; } catch { return null; }
}
