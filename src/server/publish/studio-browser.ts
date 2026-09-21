/**
 * Der Anmelde-Browser für Kanäle ohne Veröffentlichungs-API — TikTok, YouTube
 * und (seit 21.09.2026) Pinterest teilen sich ihn.
 *
 * Auf dem VPS läuft ein echter Chrome auf einem virtuellen Bildschirm (:99).
 * Der Mensch sieht ihn über noVNC im Piloten und meldet sich **selbst** an;
 * Passwort und 2FA tippt er, wir sehen beides nie. Das Chrome-Profil bleibt
 * je Dienst unter data/<dienst>-profil liegen, damit die Anmeldung Neustarts
 * überlebt und der Planungslauf mit derselben IP und demselben Fingerabdruck
 * arbeitet wie die Anmeldung — exportierte Cookies scheitern genau daran.
 *
 * Es gibt nur einen Bildschirm und eine VNC-Sicht, also auch nur **eine**
 * Sitzung zur Zeit: wer YouTube öffnet, schließt TikTok, und umgekehrt. Die
 * Profile bleiben davon unberührt; das nächste Öffnen ist wieder angemeldet.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import patchright from "patchright";
import type { BrowserContext, Page } from "playwright";
import type { Env } from "../env.js";

const { chromium } = patchright as unknown as typeof import("playwright");

export const DISPLAY = ":99";
const VNC_PORT = 5901;
export const WEB_PORT = 6080;

export type Dienst = "tiktok" | "youtube" | "pinterest";

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

export type Sitzung = {
  dienst: Dienst;
  passwort: string;
  gestartetAm: string;
  ctx: BrowserContext | null;
  lauf: Lauf | null;
};

let sitzung: Sitzung | null = null;

/** Die laufende Sitzung — auf Wunsch nur, wenn sie zum Dienst gehört. */
export function aktuelleSitzung(dienst?: Dienst): Sitzung | null {
  if (!sitzung) return null;
  if (dienst && sitzung.dienst !== dienst) return null;
  return sitzung;
}

// --- Ordner -----------------------------------------------------------------

export function logOrdner(env: Env, dienst: Dienst): string {
  const d = path.join(env.MP_DATA_DIR, `${dienst}-logs`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function profilOrdner(env: Env, dienst: Dienst): string {
  const d = path.join(env.MP_DATA_DIR, `${dienst}-profil`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// --- Bildschirm, VNC, Web-Brücke -------------------------------------------

function laeuftProzess(muster: string): boolean {
  return spawnSync("pgrep", ["-f", muster], { encoding: "utf8" }).stdout.trim().length > 0;
}

function starteHintergrund(befehl: string, args: string[], logDatei: string): void {
  const log = fs.openSync(logDatei, "a");
  const p = spawn(befehl, args, { detached: true, stdio: ["ignore", log, log] });
  p.unref();
}

/** Prozesse beenden, ohne den eigenen Dienst zu treffen. */
export function toeten(muster: string): void {
  const pids = spawnSync("pgrep", ["-f", muster], { encoding: "utf8" }).stdout.trim().split(/\s+/).filter(Boolean);
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try { process.kill(Number(pid), "SIGTERM"); } catch { /* schon weg */ }
  }
}

/** Virtuellen Bildschirm, VNC-Server und die noVNC-Brücke hochziehen. */
function bildschirmStarten(env: Env, dienst: Dienst): string {
  const logs = logOrdner(env, dienst);
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

// --- Sitzung ---------------------------------------------------------------

/**
 * Sitzung öffnen: Bildschirm hoch, Chrome mit dem dauerhaften Profil des
 * Dienstes starten, Startseite laden. Eine laufende Sitzung — egal welchen
 * Dienstes — wird vorher geschlossen.
 */
export async function sitzungOeffnen(env: Env, dienst: Dienst, startUrl: string): Promise<Sitzung> {
  await sitzungSchliessen(env);
  const passwort = bildschirmStarten(env, dienst);
  const profil = profilOrdner(env, dienst);
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
    // Feste Fensterbreite statt --start-maximized: im TikTok-Cover-Dialog liegt
    // „Speichern" rechts oben, und bei einem schmalen Fenster steht der Knopf
    // ausserhalb des Sichtfelds — am 15.09. sind daran 24 Beitraege gescheitert.
    args: ["--window-size=1400,1000", "--window-position=0,0", "--disable-gpu", "--hide-crash-restore-bubble"],
  });
  const seite = ctx.pages()[0] ?? (await ctx.newPage());
  await seite.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

  sitzung = { dienst, passwort, gestartetAm: new Date().toISOString(), ctx, lauf: null };
  return sitzung;
}

export async function sitzungSchliessen(env: Env): Promise<void> {
  if (sitzung?.lauf?.laeuft) throw new Error("Es läuft gerade ein Planungslauf.");
  const alt = sitzung;
  try { await alt?.ctx?.close(); } catch { /* egal */ }
  sitzung = null;
  if (alt) toeten(`user-data-dir=${profilOrdner(env, alt.dienst)}`);
  toeten("x11vnc -display");
  toeten(`websockify --web /usr/share/novnc ${WEB_PORT}`);
}

// --- Kleine Helfer für die Läufe -------------------------------------------

export async function schuss(seite: Page, env: Env, dienst: Dienst, name: string): Promise<void> {
  try { await seite.screenshot({ path: path.join(logOrdner(env, dienst), `${name}.png`) }); } catch { /* egal */ }
}

/**
 * Berliner Datum und Uhrzeit aus einem ISO-Zeitpunkt (UTC+2 im Sommer).
 * Das Datum in der Schreibweise, die die Studios im Feld zeigen (2026-09-15),
 * damit die Gegenprobe direkt vergleichen kann.
 */
export function berlin(iso: string): { datum: string; stunde: string; minute: string } {
  const s = new Date(new Date(iso).getTime() + 2 * 3600_000).toISOString();
  return { datum: s.slice(0, 10), stunde: s.slice(11, 13), minute: s.slice(14, 16) };
}

// --- Fernsteuerung ------------------------------------------------------------
//
// Pinterest zeigt seine Feldnamen erst in der echten Sitzung. Statt bei jedem
// Selektor neu zu bauen und den Dienst durchzustarten, nimmt dieser Schritt
// einen kleinen Auftrag entgegen (Seite laden, tippen, klicken, Datei setzen)
// und liefert Bildschirmfoto plus Seitentext zurück. Nur mit angemeldeter
// Sitzung, nur über die geschützte API — ein Werkzeug für die Einrichtung,
// kein Weg für Beiträge.

export type Schritt = {
  goto?: string | undefined;
  klick?: string | undefined;
  /** Text-Locator: ein Element, dessen Text passt (Knopf, Menüpunkt). */
  klickText?: string | undefined;
  tippen?: { selektor: string; text: string; loeschen?: boolean | undefined } | undefined;
  datei?: { selektor: string; pfad: string } | undefined;
  /** Native Auswahlliste: Option nach sichtbarem Text. */
  waehlen?: { selektor: string; text: string } | undefined;
  taste?: string | undefined;
  warteMs?: number | undefined;
  /** Selektoren, deren Vorhandensein und Sichtbarkeit gemeldet werden. */
  pruefen?: string[] | undefined;
  name?: string | undefined;
};

export async function schritt(env: Env, dienst: Dienst, auftrag: Schritt): Promise<{ url: string; text: string; foto: string; gefunden: Record<string, { anzahl: number; sichtbar: boolean }> }> {
  const s = aktuelleSitzung(dienst);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (s.lauf?.laeuft) throw new Error("Es läuft gerade ein Lauf.");
  const seite = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  if (auftrag.goto) { await seite.goto(auftrag.goto, { waitUntil: "domcontentloaded" }).catch(() => {}); await seite.waitForTimeout(3500); }
  // Pinterest zeichnet Listen und Knöpfe so, dass Playwrights Trefferprüfung
  // hängen bleibt („scrolling into view" in Schleife, 21.09.2026). Deshalb erst
  // der ordentliche Klick, danach der erzwungene, zuletzt ein Klick per Skript.
  const klicken = async (l: ReturnType<Page["locator"]>) => {
    try { await l.click({ timeout: 4000 }); return; } catch { /* weiter */ }
    try { await l.click({ timeout: 4000, force: true }); return; } catch { /* weiter */ }
    await l.evaluate((el) => (el as HTMLElement).click());
  };
  if (auftrag.klick) { await klicken(seite.locator(auftrag.klick).first()); await seite.waitForTimeout(1200); }
  if (auftrag.klickText) { await klicken(seite.getByText(auftrag.klickText, { exact: false }).first()); await seite.waitForTimeout(1200); }
  if (auftrag.tippen) {
    const f = seite.locator(auftrag.tippen.selektor).first();
    await klicken(f);
    if (auftrag.tippen.loeschen !== false) { await seite.keyboard.press("Control+A"); await seite.keyboard.press("Delete"); }
    await seite.keyboard.type(auftrag.tippen.text, { delay: 6 });
    await seite.waitForTimeout(600);
  }
  if (auftrag.datei) { await seite.locator(auftrag.datei.selektor).first().setInputFiles(auftrag.datei.pfad); await seite.waitForTimeout(2500); }
  if (auftrag.waehlen) { await seite.locator(auftrag.waehlen.selektor).first().selectOption({ label: auftrag.waehlen.text }, { timeout: 8000 }); await seite.waitForTimeout(800); }
  if (auftrag.taste) { await seite.keyboard.press(auftrag.taste); await seite.waitForTimeout(800); }
  if (auftrag.warteMs) await seite.waitForTimeout(Math.min(auftrag.warteMs, 20_000));
  const name = (auftrag.name ?? "schritt").replace(/[^\w-]/g, "_");
  await schuss(seite, env, dienst, name);
  const gefunden: Record<string, { anzahl: number; sichtbar: boolean }> = {};
  for (const sel of auftrag.pruefen ?? []) {
    const l = seite.locator(sel);
    const anzahl = await l.count().catch(() => 0);
    gefunden[sel] = { anzahl, sichtbar: anzahl ? await l.first().isVisible().catch(() => false) : false };
  }
  const text = (await seite.locator("body").innerText().catch(() => "")).slice(0, 6000);
  return { url: seite.url(), text, foto: path.join(logOrdner(env, dienst), `${name}.png`), gefunden };
}
