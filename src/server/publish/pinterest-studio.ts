/**
 * Pinterest über den Anmelde-Browser bespielen — Profil füllen und Pins setzen,
 * ohne Entwickler-Token.
 *
 * Die v5-API (posters.ts, `pinterestPoster`) bräuchte eine registrierte App mit
 * Zugangsprüfung; das hat niemand beantragt. Stattdessen derselbe Weg wie bei
 * TikTok und YouTube: der Mensch meldet sich im Anmelde-Browser
 * (studio-browser.ts) bei Pinterest an, danach füllt dieser Lauf das Profil
 * (Name, Info, Website, Profilbild aus dem Social-Kit) und legt die
 * freigegebenen Pinterest-Stücke als Pins an — Bild, Titel, Beschreibung,
 * Link, Pinnwand.
 *
 * Was von Pinterest kommt und nicht von uns:
 * - Pins werden **sofort** veröffentlicht. Pinterest ist eine Suchmaschine,
 *   die Uhrzeit spielt kaum eine Rolle; ein Termin im Piloten bleibt trotzdem
 *   als Reihenfolge erhalten (früherer Termin zuerst).
 * - Keine Hashtags — Pinterest sucht über Titel und Beschreibung. Der Lauf
 *   streicht sie aus dem Text.
 * - Titel höchstens 100 Zeichen, Beschreibung höchstens 500.
 * - Die Oberfläche trägt `data-test-id`-Marken (pin-draft-title, …); wo eine
 *   fehlt, greift ein Text-Locator. Bei jedem Fehler liegt ein Bildschirmfoto
 *   in data/pinterest-logs — Selektoren werden am Foto nachgezogen, nicht
 *   geraten.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Page } from "playwright";
import * as t from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { Env } from "../env.js";
import { newId, nowIso, parseJson } from "../db/index.js";
import {
  aktuelleSitzung, logOrdner, schuss as schussAllgemein, sitzungOeffnen, sitzungSchliessen,
  type Lauf, type PlanStatus, type PlanZeile,
} from "./studio-browser.js";

const DIENST = "pinterest" as const;
const START_URL = "https://www.pinterest.com/";
const PIN_URL = "https://www.pinterest.com/pin-creation-tool/";
const PROFIL_URL = "https://www.pinterest.com/settings/";
/** Der Link unter jedem Pin — die Herkunft, die das Produkt zählt. */
const KURZLINK = "https://binderplan.app/pin";
/** Pinnwand, auf die der Lauf pinnt; gibt es sie nicht, legt er sie an. */
const PINNWAND = "Binderseiten";
const TITEL_MAX = 100;
const BESCHREIBUNG_MAX = 500;

// --- Sitzung ---------------------------------------------------------------

export async function sitzungStarten(env: Env): Promise<{ passwort: string }> {
  const s = await sitzungOeffnen(env, DIENST, START_URL);
  return { passwort: s.passwort };
}

/** Angemeldet, sobald Pinterest `_auth=1` setzt (die Sitzungskennung `_pinterest_sess` gibt es auch abgemeldet). */
async function angemeldet(): Promise<boolean> {
  const ctx = aktuelleSitzung(DIENST)?.ctx;
  if (!ctx) return false;
  try {
    const cookies = await ctx.cookies(["https://www.pinterest.com", "https://pinterest.com"]);
    return cookies.some((c) => c.name === "_auth" && c.value === "1");
  } catch { return false; }
}

export async function sitzungStatus(env: Env): Promise<{
  laeuft: boolean; angemeldet: boolean; passwort: string | null; gestartetAm: string | null; lauf: Lauf | null;
}> {
  void env;
  const s = aktuelleSitzung(DIENST);
  return { laeuft: !!s?.ctx, angemeldet: await angemeldet(), passwort: s?.passwort ?? null, gestartetAm: s?.gestartetAm ?? null, lauf: s?.lauf ?? null };
}

export async function sitzungBeenden(env: Env): Promise<void> {
  if (!aktuelleSitzung(DIENST)) return;
  await sitzungSchliessen(env);
}

// --- Was ist zu pinnen? ----------------------------------------------------

export type Auftrag = { pieceId: string; titel: string; beschreibung: string; bild: string; link: string; geplantAm: string };

function bildDatei(db: Db, env: Env, pieceId: string): string | null {
  const stueck = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  const ids = parseJson<string[]>(stueck?.assets ?? "[]", []);
  for (const assetId of ids) {
    const asset = db.select().from(t.mpAssets).where(eq(t.mpAssets.id, assetId)).get();
    if (!asset?.path || !/\.(png|jpe?g)$/i.test(asset.path)) continue;
    const voll = path.join(env.MP_DATA_DIR, asset.path);
    if (fs.existsSync(voll)) return voll;
  }
  return null;
}

const titelAus = (s: string) => {
  const t1 = s.replace(/\s*·\s*pinterest\s*$/i, "").trim();
  return t1.length > TITEL_MAX ? `${t1.slice(0, TITEL_MAX - 1).trimEnd()}…` : t1;
};
/** Text ohne Hashtags und ohne nackte Domain — der Link steht im Linkfeld. */
function beschreibungAus(text: string): string {
  const ohne = text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1").replace(/\s*(auf|:)?\s*binderplan\.(de|app)\.?/gi, ".")
    .replace(/\.\./g, ".").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return ohne.length > BESCHREIBUNG_MAX ? `${ohne.slice(0, BESCHREIBUNG_MAX - 1).trimEnd()}…` : ohne;
}

/**
 * Alles, was auf Pinterest wartet: freigegeben, ein Bild dabei, noch nicht
 * gepinnt. Ein Termin ist keine Bedingung — er ordnet nur die Reihenfolge.
 */
export function offeneAuftraege(db: Db, env: Env, projectId: string): { auftraege: Auftrag[]; uebersprungen: PlanZeile[] } {
  const stuecke = db.select().from(t.mpContentPieces)
    .where(and(eq(t.mpContentPieces.projectId, projectId), eq(t.mpContentPieces.channel, "pinterest"))).all()
    .filter((p) => p.status === "approved");
  const termine = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.platform, "pinterest"))).all();
  const auftraege: Auftrag[] = [];
  const uebersprungen: PlanZeile[] = [];
  for (const p of stuecke) {
    const meine = termine.filter((x) => x.pieceId === p.id && x.status !== "cancelled");
    const geplantAm = meine.find((x) => x.status === "queued")?.scheduledAt ?? p.createdAt;
    const titel = titelAus(p.title ?? "(ohne Titel)");
    if (meine.some((x) => x.status === "posted")) continue;
    const bild = bildDatei(db, env, p.id);
    if (!bild) { uebersprungen.push({ pieceId: p.id, titel, geplantAm, status: "uebersprungen", meldung: "kein Bild am Stück" }); continue; }
    auftraege.push({ pieceId: p.id, titel, beschreibung: beschreibungAus(p.body ?? ""), bild, link: KURZLINK, geplantAm });
  }
  auftraege.sort((a, b) => a.geplantAm.localeCompare(b.geplantAm));
  return { auftraege, uebersprungen };
}

// --- Der Lauf --------------------------------------------------------------

const schuss = (seite: Page, env: Env, name: string) => schussAllgemein(seite, env, DIENST, name);

/** In ein Textfeld tippen: markieren, löschen, Zeile für Zeile schreiben. */
async function tippen(seite: Page, feld: ReturnType<Page["locator"]>, text: string): Promise<void> {
  await feld.click();
  await seite.keyboard.press("Control+A");
  await seite.keyboard.press("Delete");
  const zeilen = text.split("\n");
  for (let i = 0; i < zeilen.length; i++) {
    if (zeilen[i]) await seite.keyboard.type(zeilen[i]!, { delay: 6 });
    if (i < zeilen.length - 1) await seite.keyboard.press("Shift+Enter");
  }
}

/** Das erste sichtbare Feld aus einer Liste von Kandidaten. */
async function feld(seite: Page, kandidaten: string[]) {
  for (const k of kandidaten) {
    const l = seite.locator(k).first();
    if (await l.count() && await l.isVisible().catch(() => false)) return l;
  }
  return null;
}

/** Pinnwand im Auswahlmenü wählen — oder anlegen, wenn es sie noch nicht gibt. */
async function pinnwandWaehlen(seite: Page, env: Env, name: string): Promise<boolean> {
  const knopf = await feld(seite, ['[data-test-id="board-dropdown-select-button"]', 'button[aria-label*="Pinnwand"]', 'button[aria-label*="board"]']);
  if (!knopf) return false;
  await knopf.click();
  await seite.waitForTimeout(1200);
  const suche = await feld(seite, ['[data-test-id="board-dropdown-search"] input', 'input[placeholder*="Suche"]', 'input[placeholder*="Search"]']);
  if (suche) { await suche.fill(name); await seite.waitForTimeout(1200); }
  const treffer = seite.locator('[data-test-id^="board-row-"], [role="option"], [role="listitem"]').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, "i") }).first();
  if (await treffer.count()) { await treffer.click(); await seite.waitForTimeout(800); return true; }
  // Nicht da: anlegen. Der Dialog übernimmt den Suchtext als Namen.
  const anlegen = seite.locator('[data-test-id="create-board"], button, [role="button"]').filter({ hasText: /Pinnwand erstellen|Create board/i }).first();
  if (!(await anlegen.count())) { await schuss(seite, env, "pinnwand-fehlt"); return false; }
  await anlegen.click();
  await seite.waitForTimeout(1200);
  const namensFeld = await feld(seite, ['[data-test-id="board-name"] input', 'input[id*="boardEditName"]', 'input[name="boardName"]']);
  if (namensFeld) await namensFeld.fill(name);
  const fertig = seite.locator("button").filter({ hasText: /^(Erstellen|Create)$/ }).first();
  if (await fertig.count()) await fertig.click();
  await seite.waitForTimeout(1500);
  return true;
}

async function einenPinnen(seite: Page, env: Env, auftrag: Auftrag, probe: boolean): Promise<PlanZeile> {
  const zeile = (status: PlanStatus, meldung: string): PlanZeile =>
    ({ pieceId: auftrag.pieceId, titel: auftrag.titel, geplantAm: auftrag.geplantAm, status, meldung });
  const fehlt = async (was: string, name: string) => {
    await schuss(seite, env, `fehler-${auftrag.pieceId}-${name}`);
    return zeile("fehler", `${was} — Bildschirmfoto in pinterest-logs`);
  };

  await seite.goto(PIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await seite.waitForTimeout(3500);
  const datei = seite.locator('input[type="file"]').first();
  if (!(await datei.count())) return fehlt("Bild-Upload nicht gefunden", "upload");
  await datei.setInputFiles(auftrag.bild);
  await seite.waitForTimeout(3500);

  const titel = await feld(seite, ['[data-test-id="pin-draft-title"] textarea', '[data-test-id="pin-draft-title"] input', '#storyboard-selector-title', 'textarea[placeholder*="Titel"]', 'input[placeholder*="Titel"]']);
  if (!titel) return fehlt("Titelfeld nicht gefunden", "titel");
  await tippen(seite, titel, auftrag.titel);

  const text = await feld(seite, ['[data-test-id="pin-draft-description"] [contenteditable="true"]', '[data-test-id="pin-draft-description"] textarea', '[contenteditable="true"][aria-label*="Beschreibung"]', '[contenteditable="true"][aria-label*="description"]']);
  if (text) await tippen(seite, text, auftrag.beschreibung);

  const link = await feld(seite, ['[data-test-id="pin-draft-link"] input', '#WebsiteField', 'input[placeholder*="Link"]', 'input[placeholder*="link"]']);
  if (link) { await link.click(); await seite.keyboard.press("Control+A"); await seite.keyboard.type(auftrag.link, { delay: 6 }); }

  const pinnwand = await pinnwandWaehlen(seite, env, PINNWAND);
  await schuss(seite, env, `entwurf-${auftrag.pieceId}`);
  if (!pinnwand) return zeile("fehler", "Pinnwand-Auswahl nicht gefunden — Bildschirmfoto in pinterest-logs");
  if (probe) return zeile("uebersprungen", "Probelauf: ausgefüllt, nicht veröffentlicht");

  const veroeffentlichen = seite.locator('[data-test-id="storyboard-creation-nav-done"], button').filter({ hasText: /Veröffentlichen|Publish/ }).first();
  if (!(await veroeffentlichen.count())) return fehlt("„Veröffentlichen“ nicht gefunden", "senden");
  await veroeffentlichen.click();
  await seite.waitForTimeout(5000);
  await schuss(seite, env, `nach-absenden-${auftrag.pieceId}`);
  // Nach dem Absenden bietet Pinterest „Pin ansehen" an — der Link ist die Adresse des Pins.
  const ansehen = seite.locator('a[href*="/pin/"]').first();
  const url = (await ansehen.getAttribute("href").catch(() => null)) ?? "";
  const voll = url.startsWith("http") ? url : url ? `https://www.pinterest.com${url}` : "";
  return zeile("geplant", voll ? `veröffentlicht: ${voll}` : "veröffentlicht");
}

export async function pinnenStarten(db: Db, env: Env, projectId: string, probe: boolean, hoechstens = 5): Promise<Lauf> {
  const s = aktuelleSitzung(DIENST);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet())) throw new Error("Im Browser ist niemand bei Pinterest angemeldet.");
  if (s.lauf?.laeuft) throw new Error("Es läuft schon ein Lauf.");

  const { auftraege, uebersprungen } = offeneAuftraege(db, env, projectId);
  const stapel = auftraege.slice(0, probe ? 1 : hoechstens);
  const lauf: Lauf = { laeuft: true, probe, gestartetAm: new Date().toISOString(), fertigAm: null, gesamt: stapel.length, erledigt: 0, aktuell: null, zeilen: [...uebersprungen] };
  s.lauf = lauf;

  void (async () => {
    const ctx = s.ctx;
    if (!ctx) return;
    const seite = ctx.pages()[0] ?? (await ctx.newPage());
    for (const auftrag of stapel) {
      lauf.aktuell = auftrag.titel;
      try { lauf.zeilen.push(await einenPinnen(seite, env, auftrag, probe)); }
      catch (e) {
        await schuss(seite, env, `fehler-${auftrag.pieceId}`);
        lauf.zeilen.push({ pieceId: auftrag.pieceId, titel: auftrag.titel, geplantAm: auftrag.geplantAm, status: "fehler", meldung: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      }
      lauf.erledigt += 1;
      // Zwischen zwei Pins Luft lassen — ein Stapel im Sekundentakt sieht nach Automat aus.
      await seite.waitForTimeout(probe ? 500 : 8000);
    }
    lauf.aktuell = null; lauf.laeuft = false; lauf.fertigAm = new Date().toISOString();
  })();
  return lauf;
}

/** Nach einem echten Lauf: gepinnte Stücke als gepostet eintragen. */
export function laufVermerken(db: Db, projectId: string): number {
  const lauf = aktuelleSitzung(DIENST)?.lauf;
  if (!lauf || lauf.laeuft || lauf.probe) return 0;
  let n = 0;
  const ts = nowIso();
  for (const z of lauf.zeilen.filter((x) => x.status === "geplant" && x.meldung.startsWith("veröffentlicht"))) {
    const link = /https?:\/\/\S+/.exec(z.meldung)?.[0] ?? null;
    const offen = db.select().from(t.mpScheduledPosts)
      .where(and(eq(t.mpScheduledPosts.pieceId, z.pieceId), eq(t.mpScheduledPosts.platform, "pinterest"))).all()
      .find((x) => x.status === "queued" && x.projectId === projectId);
    if (offen) db.update(t.mpScheduledPosts).set({ status: "posted", postedAt: ts, providerRef: "pinterest-studio", externalUrl: link }).where(eq(t.mpScheduledPosts.id, offen.id)).run();
    else db.insert(t.mpScheduledPosts).values({ id: newId(), projectId, pieceId: z.pieceId, platform: "pinterest", scheduledAt: ts, status: "posted", origin: "extern", providerRef: "pinterest-studio", externalUrl: link, error: null, attempts: 0, postedAt: ts, createdAt: ts }).run();
    db.update(t.mpContentPieces).set({ status: "published", publishedAt: ts, externalUrl: link, updatedAt: ts }).where(eq(t.mpContentPieces.id, z.pieceId)).run();
    // Nicht zweimal vermerken, falls die Ansicht noch einmal nachfragt.
    z.meldung = z.meldung.replace(/^veröffentlicht/, "vermerkt");
    n += 1;
  }
  return n;
}

// --- Profil ----------------------------------------------------------------

/** Name, Info, Website und Profilbild aus dem Social-Kit des Projekts. */
function profilDaten(db: Db, env: Env, projectId: string): { name: string; info: string; website: string; bild: string | null } {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, `socialkit-texts:${projectId}`)).get();
  const kit = parseJson<{ profiles?: { platform: string; displayName?: string; bio?: string }[]; link?: string }>(row?.value ?? "{}", {});
  const p = kit.profiles?.find((x) => x.platform === "pinterest");
  const ordner = path.join(env.MP_DATA_DIR, "assets", projectId, "socialkit");
  const bild = fs.existsSync(ordner) ? fs.readdirSync(ordner).filter((f) => /profilbild.*1080x1080\.png$/i.test(f)).map((f) => path.join(ordner, f))[0] ?? null : null;
  return { name: p?.displayName ?? "Binderplan", info: (p?.bio ?? "").slice(0, 160), website: "https://binderplan.app", bild };
}

async function profilFuellen(seite: Page, env: Env, daten: ReturnType<typeof profilDaten>, probe: boolean): Promise<PlanZeile> {
  const zeile = (status: PlanStatus, meldung: string): PlanZeile => ({ pieceId: "profil", titel: "Profil", geplantAm: null, status, meldung });
  await seite.goto(PROFIL_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await seite.waitForTimeout(3500);
  const gesetzt: string[] = [];
  const vorname = await feld(seite, ['input#first_name', 'input[name="first_name"]', 'input[id*="firstName"]', 'input[name="firstName"]']);
  if (vorname) { await vorname.fill(daten.name); gesetzt.push("Name"); }
  const info = await feld(seite, ['textarea#about', 'textarea[name="about"]', 'textarea[id*="about"]', 'textarea']);
  if (info) { await info.fill(daten.info); gesetzt.push("Info"); }
  const website = await feld(seite, ['input#website_url', 'input[name="website_url"]', 'input[id*="website"]', 'input[name="website"]']);
  if (website) { await website.fill(daten.website); gesetzt.push("Website"); }
  if (daten.bild) {
    const datei = seite.locator('input[type="file"]').first();
    if (await datei.count()) { await datei.setInputFiles(daten.bild); gesetzt.push("Profilbild"); await seite.waitForTimeout(2500); }
  }
  await schuss(seite, env, "profil-ausgefuellt");
  if (!gesetzt.length) return zeile("fehler", "Kein Profilfeld erkannt — Bildschirmfoto profil-ausgefuellt.png in pinterest-logs");
  if (probe) return zeile("uebersprungen", `Probelauf: ${gesetzt.join(", ")} ausgefüllt, nicht gespeichert`);
  const speichern = seite.locator("button").filter({ hasText: /^(Speichern|Save)$/ }).first();
  if (!(await speichern.count())) return zeile("fehler", `${gesetzt.join(", ")} ausgefüllt, aber „Speichern“ nicht gefunden`);
  await speichern.click();
  await seite.waitForTimeout(3000);
  await schuss(seite, env, "profil-gespeichert");
  return zeile("geplant", `gespeichert: ${gesetzt.join(", ")}`);
}

export async function profilStarten(db: Db, env: Env, projectId: string, probe: boolean): Promise<Lauf> {
  const s = aktuelleSitzung(DIENST);
  if (!s?.ctx) throw new Error("Keine Sitzung — bitte zuerst anmelden.");
  if (!(await angemeldet())) throw new Error("Im Browser ist niemand bei Pinterest angemeldet.");
  if (s.lauf?.laeuft) throw new Error("Es läuft schon ein Lauf.");
  const lauf: Lauf = { laeuft: true, probe, gestartetAm: new Date().toISOString(), fertigAm: null, gesamt: 1, erledigt: 0, aktuell: "Profil", zeilen: [] };
  s.lauf = lauf;
  void (async () => {
    const ctx = s.ctx;
    if (!ctx) return;
    const seite = ctx.pages()[0] ?? (await ctx.newPage());
    try { lauf.zeilen.push(await profilFuellen(seite, env, profilDaten(db, env, projectId), probe)); }
    catch (e) { await schuss(seite, env, "fehler-profil"); lauf.zeilen.push({ pieceId: "profil", titel: "Profil", geplantAm: null, status: "fehler", meldung: e instanceof Error ? e.message.slice(0, 300) : String(e) }); }
    lauf.erledigt = 1; lauf.aktuell = null; lauf.laeuft = false; lauf.fertigAm = new Date().toISOString();
  })();
  return lauf;
}
