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
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import patchright from "patchright";
import type { BrowserContext, Page } from "playwright";
import * as t from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";

const { chromium } = patchright as unknown as typeof import("playwright");

const DISPLAY = ":99";
const VNC_PORT = 5901;
const WEB_PORT = 6080;
/** TikTok plant nicht weiter als zehn Tage voraus. */
const MAX_TAGE_VORAUS = 10;

export type PlanStatus = "geplant" | "uebersprungen" | "fehler";

export type PlanZeile = {
  pieceId: string;
  titel: string;
  geplantAm: string | null;
  status: PlanStatus;
  meldung: string;
};

export type Lauf = {
  laeuft: boolean;
  probe: boolean;
  gestartetAm: string;
  fertigAm: string | null;
  gesamt: number;
  erledigt: number;
  aktuell: string | null;
  zeilen: PlanZeile[];
};

type Sitzung = {
  passwort: string;
  gestartetAm: string;
  ctx: BrowserContext | null;
  lauf: Lauf | null;
};

let sitzung: Sitzung | null = null;

// --- Bildschirm, VNC, Web-Brücke -------------------------------------------

function laeuftProzess(muster: string): boolean {
  return spawnSync("pgrep", ["-f", muster], { encoding: "utf8" }).stdout.trim().length > 0;
}

function starteHintergrund(befehl: string, args: string[], logDatei: string): void {
  const log = fs.openSync(logDatei, "a");
  const p = spawn(befehl, args, { detached: true, stdio: ["ignore", log, log] });
  p.unref();
}

function logOrdner(env: Env): string {
  const d = path.join(env.MP_DATA_DIR, "tiktok-logs");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Virtuellen Bildschirm, VNC-Server und die noVNC-Brücke hochziehen. */
function bildschirmStarten(env: Env): string {
  const logs = logOrdner(env);
  if (!laeuftProzess(`Xvfb ${DISPLAY}`)) {
    starteHintergrund("Xvfb", [DISPLAY, "-screen", "0", "1400x1000x24"], path.join(logs, "xvfb.log"));
    spawnSync("sleep", ["2"]);
  }
  // Passwort je Sitzung neu würfeln: es schützt die VNC-Sicht zusätzlich zur
  // Anmeldung des Piloten, falls jemand die Adresse errät.
  const passwort = Math.random().toString(36).slice(2, 10);
  const passDatei = path.join(logs, "vncpass");
  spawnSync("x11vnc", ["-storepasswd", passwort, passDatei]);
  fs.chmodSync(passDatei, 0o600);

  toeten("x11vnc -display");
  starteHintergrund("x11vnc", [
    "-display", DISPLAY, "-rfbport", String(VNC_PORT), "-localhost",
    "-rfbauth", passDatei, "-forever", "-shared", "-quiet",
  ], path.join(logs, "x11vnc.log"));

  if (!laeuftProzess(`websockify --web /usr/share/novnc ${WEB_PORT}`)) {
    starteHintergrund("websockify", ["--web", "/usr/share/novnc", String(WEB_PORT), `localhost:${VNC_PORT}`],
      path.join(logs, "websockify.log"));
  }
  spawnSync("sleep", ["1"]);
  return passwort;
}

/** Prozesse beenden, ohne den eigenen Dienst zu treffen. */
function toeten(muster: string): void {
  const pids = spawnSync("pgrep", ["-f", muster], { encoding: "utf8" }).stdout.trim().split(/\s+/).filter(Boolean);
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try { process.kill(Number(pid), "SIGTERM"); } catch { /* schon weg */ }
  }
}

// --- Sitzung ---------------------------------------------------------------

function profilOrdner(env: Env): string {
  const d = path.join(env.MP_DATA_DIR, "tiktok-profil");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/**
 * Anmelde-Sitzung starten: Bildschirm hoch, Chrome mit dem dauerhaften Profil
 * öffnen, TikTok laden. Läuft schon eine, wird sie ersetzt.
 */
export async function sitzungStarten(env: Env): Promise<{ passwort: string }> {
  await sitzungBeenden(env);
  const passwort = bildschirmStarten(env);
  const profil = profilOrdner(env);
  // Reste einer abgestürzten Sitzung: sonst meldet Chrome „profile already in use“.
  for (const datei of fs.readdirSync(profil)) {
    if (datei.startsWith("Singleton")) fs.rmSync(path.join(profil, datei), { force: true });
  }

  const ctx = await chromium.launchPersistentContext(profil, {
    channel: "chrome",
    headless: false,
    viewport: null,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    env: { ...process.env, DISPLAY } as Record<string, string>,
    // Die Wiederherstellen-Blase nach einem harten Beenden verdeckt sonst die
    // Anmeldemaske, und wegklicken kann sie im VNC-Fenster nur der Mensch.
    args: ["--start-maximized", "--disable-gpu", "--hide-crash-restore-bubble"],
  });
  const seite = ctx.pages()[0] ?? (await ctx.newPage());
  await seite.goto("https://www.tiktok.com/login", { waitUntil: "domcontentloaded" }).catch(() => {});

  sitzung = { passwort, gestartetAm: new Date().toISOString(), ctx, lauf: null };
  return { passwort };
}

/** Ist im laufenden Profil jemand angemeldet? Entscheidet das sessionid-Cookie. */
async function angemeldet(ctx: BrowserContext | null): Promise<boolean> {
  if (!ctx) return false;
  try {
    const cookies = await ctx.cookies("https://www.tiktok.com");
    return cookies.some((c) => c.name === "sessionid" && !!c.value);
  } catch { return false; }
}

export async function sitzungStatus(env: Env): Promise<{
  laeuft: boolean; angemeldet: boolean; passwort: string | null; gestartetAm: string | null; lauf: Lauf | null;
}> {
  const laeuft = !!sitzung?.ctx;
  return {
    laeuft,
    angemeldet: await angemeldet(sitzung?.ctx ?? null),
    passwort: sitzung?.passwort ?? null,
    gestartetAm: sitzung?.gestartetAm ?? null,
    lauf: sitzung?.lauf ?? null,
  };
}

export async function sitzungBeenden(env: Env): Promise<void> {
  if (sitzung?.lauf?.laeuft) throw new Error("Es läuft gerade ein Planungslauf.");
  try { await sitzung?.ctx?.close(); } catch { /* egal */ }
  sitzung = null;
  toeten(`user-data-dir=${profilOrdner(env)}`);
  toeten("x11vnc -display");
  toeten(`websockify --web /usr/share/novnc ${WEB_PORT}`);
}

// --- Was ist zu planen? ----------------------------------------------------

export type Auftrag = { pieceId: string; titel: string; text: string; video: string; geplantAm: string };

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
    auftraege.push({ pieceId: termin.pieceId, titel, text: stueck.body ?? "", video, geplantAm: String(termin.scheduledAt) });
  }
  return { auftraege, uebersprungen };
}

// --- Der Lauf im Studio ----------------------------------------------------

/** Berliner Datum und Uhrzeit aus einem ISO-Zeitpunkt (UTC+2 im Sommer). */
function berlin(iso: string): { datum: string; uhrzeit: string } {
  const d = new Date(new Date(iso).getTime() + 2 * 3600_000);
  const s = d.toISOString();
  return { datum: `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`, uhrzeit: s.slice(11, 16) };
}

async function schuss(seite: Page, env: Env, name: string): Promise<void> {
  try { await seite.screenshot({ path: path.join(logOrdner(env), `${name}.png`) }); } catch { /* egal */ }
}

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

  // 4. Auf „terminieren" umschalten
  const terminSchalter = seite.getByText(/^(Terminieren|Schedule|Geplant|Zeitplan)$/i).first();
  if (await terminSchalter.count()) {
    await terminSchalter.click({ timeout: 10_000 }).catch(() => {});
    await seite.waitForTimeout(1500);
  } else {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-schalter`);
    return zeile("fehler", "Umschalter „Terminieren“ nicht gefunden — Bildschirmfoto in tiktok-logs");
  }

  // 5. Datum und Uhrzeit
  const { datum, uhrzeit } = berlin(auftrag.geplantAm);
  const zeitFeld = seite.locator('input[placeholder*=":"], input[value*=":"]').first();
  if (await zeitFeld.count()) {
    await zeitFeld.click();
    await seite.waitForTimeout(800);
    // Die Zeitauswahl ist eine Liste aus Stunden und Minuten, kein Textfeld.
    const [std, min] = uhrzeit.split(":");
    const stunde = seite.getByText(new RegExp(`^${std}$`)).last();
    if (await stunde.count()) { await stunde.click().catch(() => {}); await seite.waitForTimeout(400); }
    const minute = seite.getByText(new RegExp(`^${min}$`)).last();
    if (await minute.count()) { await minute.click().catch(() => {}); await seite.waitForTimeout(400); }
    await seite.keyboard.press("Escape");
  }
  const datumFeld = seite.locator(`input[value*="-"]`).first();
  if (await datumFeld.count()) {
    await datumFeld.click();
    await seite.waitForTimeout(800);
    const tag = String(Number(datum.slice(0, 2)));
    const tagFeld = seite.locator(`div[class*="calendar"] >> text=/^${tag}$/`).first();
    if (await tagFeld.count()) { await tagFeld.click().catch(() => {}); }
    await seite.keyboard.press("Escape");
    await seite.waitForTimeout(500);
  }
  await schuss(seite, env, `vor-absenden-${auftrag.pieceId}`);

  if (probe) return zeile("uebersprungen", "Probelauf — alles ausgefüllt, aber nicht abgeschickt");

  // 6. Absenden
  const knopf = seite.getByRole("button", { name: /^(Planen|Terminieren|Schedule|Post|Posten)$/i }).last();
  if (!(await knopf.count())) {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-knopf`);
    return zeile("fehler", "Absende-Knopf nicht gefunden — Bildschirmfoto in tiktok-logs");
  }
  await knopf.click({ timeout: 15_000 });
  await seite.waitForTimeout(6000);
  await schuss(seite, env, `nach-absenden-${auftrag.pieceId}`);
  return zeile("geplant", `im Studio terminiert auf ${datum} ${uhrzeit}`);
}

/**
 * Den ganzen Stapel durchgehen. Läuft im Hintergrund; der Fortschritt steht in
 * `sitzung.lauf` und wird von der Status-Abfrage mitgeliefert.
 */
export async function planenStarten(db: Db, env: Env, projectId: string, probe: boolean): Promise<Lauf> {
  if (!sitzung?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet(sitzung.ctx))) throw new Error("Im Browser ist niemand bei TikTok angemeldet.");
  if (sitzung.lauf?.laeuft) throw new Error("Es läuft schon ein Planungslauf.");

  const { auftraege, uebersprungen } = offeneAuftraege(db, env, projectId);
  const lauf: Lauf = {
    laeuft: true, probe, gestartetAm: new Date().toISOString(), fertigAm: null,
    gesamt: auftraege.length, erledigt: 0, aktuell: null, zeilen: [...uebersprungen],
  };
  sitzung.lauf = lauf;

  void (async () => {
    const ctx = sitzung?.ctx;
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
  const lauf = sitzung?.lauf;
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
