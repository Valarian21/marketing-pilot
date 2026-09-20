/**
 * Werbe-Reels, die das Produkt zeigen: Bildschirmaufnahme der App in der
 * Handy-Ansicht, eingebettet in dieselbe Bildsprache wie die Kartenreels.
 *
 * Aufgenommen wird gegen die laufende Binderplan-Instanz (`BP_BASIS`, Vorgabe
 * `http://127.0.0.1:8103`) mit dem Probekonto. Das Ergebnis läuft durch
 * dieselbe Montage wie alles andere: Textzeilen unten links mit gelbem Strich,
 * Folgen-Pille im vorletzten Abschnitt, Abspann.
 *
 *   pnpm exec tsx scripts/reel-tool.ts --drehbuch seite --plattform instagram
 *   pnpm exec tsx scripts/reel-tool.ts --drehbuch seite --nur-aufnahme
 *
 * Bricht ein Klickpfad ab, landet ein Screenshot samt Zustandsbericht im
 * Arbeitsordner — ohne den ist ein danebenliegender Selektor nicht zu finden.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { loadEnv, ROOT } from "../src/server/env.js";
import { openDatabase, newId, nowIso, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { playwrightRenderer, type RenderJob } from "../src/server/agents/studio/render.js";
import { fontHead } from "../src/server/agents/studio/fonts.js";
import { runFfmpeg, OUTPUT_FPS } from "../src/server/agents/video/assemble.js";
import { abspannClip, ABSPANN_MS } from "../src/server/agents/video/abspann-binderplan.js";
import { folgenHtml, SITZE, FOLGEN_MS, KANAL, type Plattform } from "../src/server/agents/video/folgen-pille.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const BASIS = process.env.BP_BASIS || "http://127.0.0.1:8103";
const KONTO = { mail: "probe@binderplan.app", pw: "ProbeBinder2026" };
const W = 1080, H = 1920;
const s3 = (ms: number) => (ms / 1000).toFixed(3);
const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const flagge = (n: string) => process.argv.includes(n);

/**
 * Das Handybild im Reel.
 *
 * Aufgenommen wird 390 × 844 bei doppelter Pixeldichte, also 780 × 1688. Auf
 * 600 px Breite gebracht sind das 1299 px Höhe; darunter bleiben 560 px für
 * Text — genug für zwei Zeilen plus die Kennzeichnungszone, ohne dass die
 * Oberfläche beschnitten werden muss.
 */
const BILD = { breite: 600, hoehe: 1299, x: (W - 600) / 2, y: 60, radius: 42 };
const GRUND = "#12141A";

// --- Bühne -------------------------------------------------------------------

/** Ein sichtbarer Zeiger — headless hat keinen, und ohne ihn wirkt jeder Klick wie Zauberei. */
const ZEIGER = `
  (() => {
    let z = null;
    let letzte = { x: 195, y: 700 };
    /**
     * Der Zeiger wird beim ersten Gebrauch angelegt, nicht beim Laden: Das
     * Init-Skript läuft, bevor es ein <html> gibt, und ein appendChild darauf
     * scheitert. Nach jeder Navigation ist das Element weg — deshalb wird es
     * bei jedem Aufruf neu gesucht.
     */
    const hol = () => {
      if (z && z.isConnected) return z;
      if (!document.documentElement) return null;
      z = document.getElementById("__zeiger");
      if (!z) {
        z = document.createElement("div");
        z.id = "__zeiger";
        z.style.cssText = "position:fixed;z-index:2147483647;width:26px;height:26px;margin:-13px 0 0 -13px;" +
          "border-radius:50%;background:rgba(245,197,24,.92);box-shadow:0 0 0 3px rgba(20,22,28,.55),0 6px 18px rgba(0,0,0,.5);" +
          "pointer-events:none;transition:transform .09s ease-out;left:" + letzte.x + "px;top:" + letzte.y + "px";
        document.documentElement.appendChild(z);
      }
      return z;
    };
    window.__zeigerAuf = (x, y) => { letzte = { x, y }; const e = hol(); if (e) { e.style.left = x + "px"; e.style.top = y + "px"; } };
    window.__zeigerWo = () => letzte;
    window.__zeigerTipp = () => { const e = hol(); if (!e) return; e.style.transform = "scale(.62)"; setTimeout(() => (e.style.transform = "scale(1)"), 150); };
  })();
`;

const schlaf = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Buehne {
  constructor(readonly page: Page) {}

  /** Den Zeiger weich zum Ziel führen — ein Sprung liest sich wie ein Schnittfehler. */
  private async fahre(x: number, y: number) {
    const von = await this.page.evaluate<{ x: number; y: number }>(
      `(window.__zeigerWo ? window.__zeigerWo() : { x: 195, y: 700 })`);
    const schritte = 14;
    for (let i = 1; i <= schritte; i++) {
      const p = i / schritte, e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      await this.page.evaluate(([px, py]) => (window as unknown as { __zeigerAuf: (a: number, b: number) => void }).__zeigerAuf(px, py),
        [von.x + (x - von.x) * e, von.y + (y - von.y) * e]);
      await schlaf(16);
    }
  }

  async klick(sel: string, opt: { warte?: number } = {}) {
    const el = this.page.locator(sel).first();
    await el.waitFor({ state: "visible", timeout: 12000 });
    const box = await el.boundingBox();
    if (box) await this.fahre(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.evaluate(() => (window as unknown as { __zeigerTipp: () => void }).__zeigerTipp());
    await schlaf(120);
    await el.click({ timeout: 8000 });
    await schlaf(opt.warte ?? 700);
  }

  async tippe(sel: string, text: string) {
    const el = this.page.locator(sel).first();
    await el.waitFor({ state: "visible", timeout: 12000 });
    const box = await el.boundingBox();
    if (box) await this.fahre(box.x + box.width / 2, box.y + box.height / 2);
    await el.click();
    await el.fill("");
    for (const c of text) { await el.type(c, { delay: 0 }); await schlaf(45); }
    await schlaf(400);
  }

  async scrolle(px: number, ms = 900) {
    const schritte = Math.max(6, Math.round(ms / 60));
    for (let i = 0; i < schritte; i++) { await this.page.mouse.wheel(0, px / schritte); await schlaf(ms / schritte); }
    await schlaf(300);
  }

  async warte(ms: number) { await schlaf(ms); }
}

// --- Drehbücher --------------------------------------------------------------

interface Abschnitt {
  /** Was im Bild steht, während dieser Abschnitt läuft. Leer = kein Text. */
  zeig?: string;
  stil?: "hook" | "satz" | "schluss";
  tun: (b: Buehne) => Promise<void>;
}

interface ToolDrehbuch {
  titel: string;
  /** Wo die Aufnahme beginnt — angemeldet oder auf der Landingpage. */
  start: "app" | "landing";
  abschnitte: Abschnitt[];
  caption: string;
  captionKurz: string;
  hashtags: string[];
  musik: string;
}

const DREHBUECHER: Record<string, ToolDrehbuch> = {
  /**
   * „Wo andere ihre Seiten zeigen" — die Vitrine, von oben nach unten.
   *
   * Der einfachste Pfad der App und deshalb der erste: antippen, scrollen,
   * eine Seite öffnen. Kein Konto nötig, nichts kann schiefgehen.
   */
  vitrine: {
    titel: "Wo andere ihre Seiten zeigen",
    start: "app",
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    abschnitte: [
      { zeig: "Fremde Binderseiten,\nden ganzen Tag.", stil: "hook",
        tun: async (b) => { await b.klick("#mnav-vitrine", { warte: 1800 }); await b.warte(900); } },
      { zeig: "Das ist die Vitrine.",
        tun: async (b) => { await b.scrolle(700, 1400); await b.warte(600); } },
      { zeig: "Jede Seite von jemandem,\nder sie selbst gebaut hat.",
        tun: async (b) => { await b.scrolle(900, 1600); await b.warte(700); } },
      { zeig: "Ideen holen\nkostet nichts.",
        tun: async (b) => { await b.scrolle(800, 1400); await b.warte(900); } },
      { zeig: "binderplan.app", stil: "schluss",
        tun: async (b) => { await b.scrolle(600, 1200); await b.warte(1200); } },
    ],
    caption: `Fremde Binderseiten, den ganzen Tag.

Die Vitrine ist der Teil von Binderplan, den ich selbst am häufigsten offen habe — nicht zum Planen, sondern zum Ideenklauen. Jede Seite dort hat jemand von Hand gelegt, mit echten Karten und echten Preisen.

Kostenlos ansehen, ohne Konto.

Was würdest du auf deine erste Seite legen?`,
    captionKurz: `Die Vitrine: fremde Binderseiten, alle von Hand gelegt. Zum Ideenholen, ohne Konto.

Was käme auf deine erste Seite?`,
    hashtags: ["#pokemonbinder", "#binderart", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoncards"],
  },

  /**
   * „Tipp ein Pokémon ein" — der kürzeste Weg von nichts zu einem fertigen
   * Binder, und deshalb der beste Werbepfad: Eingabefeld, ein Name, ein Klick.
   *
   * Angelegt wird im Probekonto ein Evoli-Binder; die Vorlage holt alle Karten
   * des Pokémon aus dem Katalog und verteilt sie auf Seiten.
   */
  vorlage: {
    titel: "Tipp ein Pokémon ein",
    start: "app",
    musik: "alex-morgan-no-copyright-music-528321.mp3",
    abschnitte: [
      { zeig: "Binder planen\nin 20 Sekunden.", stil: "hook",
        tun: async (b) => { await b.klick("#mnav-binder", { warte: 1500 }); await b.warte(800); } },
      { zeig: "Eine Vorlage wählen.",
        tun: async (b) => {
          await b.page.evaluate(() => (window as unknown as { modalOeffnen: (i: string) => void }).modalOeffnen("modal-poke"));
          await b.warte(1600);
        } },
      { zeig: "Ein Pokémon eintippen.",
        tun: async (b) => { await b.tippe("#poke-name", "Evoli"); await b.warte(900); } },
      { zeig: "Alle Karten, alle Sets —\nauf Seiten verteilt.",
        // Innerhalb des Dialogs suchen: „Binder anlegen" heißt auch der Knopf in
        // den anderen Vorlagen-Dialogen, die im DOM liegen, aber verborgen sind.
        tun: async (b) => { await b.klick("#modal-poke button:has-text('Binder anlegen')", { warte: 4500 }); await b.warte(1800); } },
      { zeig: "Fach für Fach,\nmit echten Preisen.",
        tun: async (b) => { await b.scrolle(600, 1400); await b.warte(1000); } },
      { zeig: "Kostenlos,\nohne Anmeldung.", stil: "schluss",
        tun: async (b) => { await b.scrolle(500, 1200); await b.warte(1400); } },
    ],
    caption: `Binder planen in 20 Sekunden.

Ein Pokémon eintippen, Vorlage wählen, fertig: Binderplan holt alle Karten aus dem Katalog — alle Sets, alle Seltenheiten, deutsch und englisch — und verteilt sie auf Seiten. Mit Cardmarket-Preisen an jedem Fach.

Der Rest ist Umsortieren, und genau das ist der schöne Teil.

Kostenlos, ohne Anmeldung: binderplan.app

Welches Pokémon würdest du zuerst eintippen?`,
    captionKurz: `Ein Pokémon eintippen, Vorlage wählen, fertig — alle Karten aus allen Sets, auf Seiten verteilt, mit Preisen.

Welches würdest du zuerst nehmen?`,
    hashtags: ["#pokemonbinder", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#evoli", "#mastersets"],
  },

  /**
   * „Was deine Karten heute wert sind" — die Marktseite.
   *
   * Preise sind das Thema, das in dieser Nische immer zieht, und der Markt ist
   * der Teil des Produkts, den man ohne eigenes Konto sofort versteht.
   */
  markt: {
    titel: "Was deine Karten heute wert sind",
    start: "app",
    musik: "absolutesound-background-no-copyright-music-561870.mp3",
    abschnitte: [
      { zeig: "Preise für 33.000 Karten.\nJeden Tag neu.", stil: "hook",
        tun: async (b) => { await b.klick("#mnav-markt", { warte: 2600 }); await b.warte(900); } },
      { zeig: "Nach Set. Nach Ära.\nNach Pokémon.",
        tun: async (b) => { await b.scrolle(700, 1500); await b.warte(700); } },
      { zeig: "Wer steigt,\nwer fällt.",
        tun: async (b) => { await b.scrolle(800, 1500); await b.warte(800); } },
      { zeig: "Alles aus Cardmarket,\nin Euro.",
        tun: async (b) => { await b.scrolle(700, 1400); await b.warte(1000); } },
      { zeig: "Ohne Konto\nansehen.", stil: "schluss",
        tun: async (b) => { await b.scrolle(500, 1200); await b.warte(1300); } },
    ],
    caption: `Preise für 33.000 Karten, jeden Tag neu.

Der Markt in Binderplan zeigt, was eine Karte heute kostet — nach Set, nach Ära, nach Pokémon, nach Region. Alles aus Cardmarket, in Euro, mit dem 30-Tage-Schnitt statt dem Trendpreis: Der folgt einzelnen Verkäufen und hebt eine Karte schon mal um das Vierfache.

Ansehen kostet nichts und braucht kein Konto.

Welche Karte schaust du am häufigsten nach?`,
    captionKurz: `Preise für 33.000 Karten, täglich neu — nach Set, Ära, Pokémon. Aus Cardmarket, in Euro.

Welche schaust du am häufigsten nach?`,
    hashtags: ["#cardmarket", "#pokemonpreise", "#pokemonsammeln", "#binderplan", "#pokemontcg", "#pokemoninvesting"],
  },
};

// --- Aufnahme ----------------------------------------------------------------

interface Marke { startMs: number; endMs: number; zeig?: string | undefined; stil?: "hook" | "satz" | "schluss" | undefined }

/**
 * Das Drehbuch abfahren und dabei festhalten, wann welcher Abschnitt lief.
 *
 * Playwright schreibt das Video erst beim Schließen des Kontexts; die Marken
 * entstehen deshalb relativ zum Startzeitpunkt und werden hinterher auf die
 * fertige Datei angewandt.
 */
async function aufnehmen(buch: ToolDrehbuch, werk: string): Promise<{ datei: string; marken: Marke[]; vorlaufMs: number }> {
  fs.mkdirSync(werk, { recursive: true });
  const roh = path.join(werk, "roh");
  fs.rmSync(roh, { recursive: true, force: true });
  /**
   * `--force-device-scale-factor=2` ist der Unterschied zwischen einer scharfen
   * Aufnahme und einem 390-px-Bild in der Ecke eines 780-px-Videos: Playwright
   * filmt das Fenster in echten Gerätepixeln, und die entstehen nur, wenn
   * Chromium selbst in dieser Dichte läuft. Reine Kontext-Emulation
   * (`deviceScaleFactor`) reicht nicht.
   */
  const tKontext = Date.now();
  const browser = await chromium.launch({
    args: ["--hide-scrollbars", "--disable-blink-features=AutomationControlled", "--force-device-scale-factor=2"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    locale: "de-DE", reducedMotion: "no-preference",
    recordVideo: { dir: roh, size: { width: 780, height: 1688 } },
  });
  await ctx.addInitScript(ZEIGER);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  JS-Fehler:", String(e).slice(0, 140)));
  const b = new Buehne(page);

  await page.goto(`${BASIS}/app`, { waitUntil: "networkidle" });
  await schlaf(1500);
  // Anmelden, falls nötig. Das Feld ist bis zum Fokus schreibgeschützt (Schutz
  // gegen Passwortmanager) — `fill()` scheitert daran, Klick und Tippen nicht.
  // Der Knopf trägt im abgemeldeten Zustand „Anmelden", sonst den Rufnamen.
  const knopfText = (await page.textContent("#btn-konto").catch(() => "") ?? "").trim();
  if (/^anmelden$/i.test(knopfText) || !knopfText) {
    await b.klick("#btn-konto", { warte: 900 });
    await b.tippe("#auth-email", KONTO.mail);
    await b.tippe("#auth-pw", KONTO.pw);
    await b.klick("#auth-senden", { warte: 3200 });
    const jetzt = (await page.textContent("#btn-konto").catch(() => "") ?? "").trim();
    if (/^anmelden$/i.test(jetzt) || !jetzt) {
      const fehler = (await page.textContent("#auth-fehler").catch(() => "") ?? "").trim();
      throw new Error(`Anmeldung fehlgeschlagen${fehler ? `: ${fehler}` : ""}`);
    }
  }
  // Puffer im Verlauf: Dialoge schließen über history.back(); eines zu viel
  // verlässt sonst die Seite und die Aufnahme endet auf about:blank.
  await page.evaluate(() => { for (let i = 0; i < 8; i++) history.pushState({ p: i }, "", location.href); });
  await schlaf(800);

  const t0 = Date.now();
  const marken: Marke[] = [];
  for (const [i, a] of buch.abschnitte.entries()) {
    const start = Date.now() - t0;
    try {
      await a.tun(b);
    } catch (e) {
      const bild = path.join(werk, `abbruch-${i}.png`);
      await page.screenshot({ path: bild }).catch(() => undefined);
      console.log(`  Abbruch in Abschnitt ${i} („${a.zeig ?? ""}"): ${String(e).slice(0, 200)}`);
      console.log(`  Bild: ${bild}`);
      throw e;
    }
    marken.push({ startMs: start, endMs: Date.now() - t0, zeig: a.zeig, stil: a.stil });
    console.log(`  Abschnitt ${i + 1}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  await schlaf(400);
  await ctx.close();
  await browser.close();
  const datei = fs.readdirSync(roh).filter((f) => f.endsWith(".webm")).map((f) => path.join(roh, f))[0];
  if (!datei) throw new Error("Keine Aufnahme entstanden");
  /**
   * Playwright filmt ab dem Öffnen des Kontexts — Seitenaufbau und Anmeldung
   * sind also mit drin. Der Vorlauf wird beim Schneiden abgezogen, sonst läuft
   * die erste Textzeile über einem Anmeldedialog.
   */
  return { datei, marken, vorlaufMs: t0 - tKontext };
}

// --- Montage -----------------------------------------------------------------

/**
 * Der Rahmen um die Aufnahme: alles außerhalb des abgerundeten Fensters wird
 * zugedeckt.
 *
 * Der Trick ist ein `box-shadow` mit riesigem Spread auf einem transparenten
 * Kasten — er füllt die ganze Fläche in der Grundfarbe und lässt genau das
 * Fenster frei. So braucht es keine Maske und keinen zweiten ffmpeg-Durchlauf.
 */
function rahmenHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .fenster{position:absolute;left:${BILD.x}px;top:${BILD.y}px;width:${BILD.breite}px;height:${BILD.hoehe}px;
      border-radius:${BILD.radius}px;
      box-shadow:0 0 0 9999px ${GRUND}, 0 0 0 2px rgba(255,255,255,.14), 0 26px 60px rgba(0,0,0,.55)}
    /* Ein Schein oben, damit der Grund nicht wie eine leere Fläche wirkt. */
    .schein{position:absolute;left:0;right:0;top:0;height:520px;
      background:radial-gradient(ellipse 70% 100% at 50% 0%, rgba(42,75,155,.34), transparent 70%)}
  </style></head><body><div class="schein"></div><div class="fenster"></div></body></html>`;
}

/** Textzeile unten links — dieselbe Bauart wie in den Kartenreels. */
function textHtml(zeig: string, stil: "hook" | "satz" | "schluss", akzent: string): string {
  const gross = stil === "hook";
  const px = gross ? 78 : stil === "schluss" ? 68 : 58;
  const zeilen = zeig.split("\n").map((z) => `<span>${z}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .flaeche{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:0 96px 250px 88px}
    .schleier{position:absolute;left:0;right:0;bottom:0;height:640px;
      background:linear-gradient(to top,rgba(0,0,0,.92) 0%,rgba(0,0,0,.78) 34%,rgba(0,0,0,.4) 66%,rgba(0,0,0,0) 100%)}
    .text{position:relative;display:flex;flex-direction:column;gap:8px;
      font-family:${gross ? "'Bungee'" : "'Archivo'"},system-ui,sans-serif;font-weight:${gross ? 400 : 800};
      font-size:${px}px;line-height:${gross ? 1.06 : 1.18};color:#fff;
      text-shadow:0 4px 26px rgba(0,0,0,.92),0 2px 6px rgba(0,0,0,.8);
      text-transform:${gross ? "uppercase" : "none"}}
    .strich{position:relative;width:96px;height:9px;background:${akzent};margin-bottom:24px;
      box-shadow:0 2px 14px rgba(0,0,0,.6)}
  </style></head><body>
    <div class="schleier"></div><div class="flaeche"><div class="strich"></div><div class="text">${zeilen}</div></div>
  </body></html>`;
}

const name = arg("--drehbuch") ?? "vitrine";
const buch = DREHBUECHER[name];
if (!buch) throw new Error(`Kein Drehbuch „${name}". Bekannt: ${Object.keys(DREHBUECHER).join(", ")}`);
const plattform = (arg("--plattform") ?? "instagram") as Plattform;
if (!SITZE[plattform]) throw new Error(`Keine Plattform „${plattform}"`);

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const kit = loadBrandKit(db, PROJEKT);
const akzent = kit.accent2 ?? kit.colors?.[1] ?? "#F5C518";

const pieceId = newId();
const outDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId);
const arbeit = path.join(outDir, "arbeit");
fs.mkdirSync(arbeit, { recursive: true });

console.log(`${buch.titel}: ${buch.abschnitte.length} Abschnitte, Aufnahme gegen ${BASIS}`);
const { datei: rohVideo, marken, vorlaufMs } = await aufnehmen(buch, arbeit);
const laufMs = marken[marken.length - 1]!.endMs;
console.log(`Aufnahme: ${(laufMs / 1000).toFixed(1)} s (Vorlauf ${(vorlaufMs / 1000).toFixed(1)} s wird abgeschnitten)`);
if (flagge("--nur-aufnahme")) { console.log(rohVideo); process.exit(0); }

// 1. Ebenen rendern: Rahmen, Texte, Folgen-Pille.
const rahmen = path.join(arbeit, "rahmen.png");
const jobs: RenderJob[] = [{ html: rahmenHtml(), width: W, height: H, transparent: true, file: rahmen }];
const textDateien = marken.map((m, i) => {
  if (!m.zeig) return null;
  const f = path.join(arbeit, `text-${i}.png`);
  jobs.push({ html: textHtml(m.zeig, m.stil ?? "satz", akzent), width: W, height: H, transparent: true, file: f });
  return f;
});
/** Die Pille sitzt im vorletzten Abschnitt — dieselbe Regel wie bei den Kartenreels. */
const folgenIdx = Math.max(0, marken.length - 2);
const folgen = path.join(arbeit, "folgen.png");
/**
 * `--ohne-folgen` baut die Basis: alles fertig bis auf die Folgen-Pille. Aus ihr
 * legt `reel-plattformen.ts` die drei App-Fassungen an — die Aufnahme läuft
 * dann nur einmal statt dreimal durch die App.
 */
const ohneFolgen = flagge("--ohne-folgen");
if (!ohneFolgen) jobs.push({ html: folgenHtml(akzent, plattform), width: W, height: H, transparent: true, file: folgen });
await playwrightRenderer(jobs);

// 2. Bildspur: Aufnahme ins Format, Rahmen darüber, dann die Einblendungen.
const folgenStart = Math.min(marken[folgenIdx]!.startMs + 400, Math.max(0, laufMs - FOLGEN_MS - 400));
const folgenEnde = Math.min(folgenStart + FOLGEN_MS, laufMs - 200);
const einblendungen = marken.flatMap((m, i) => {
  const d = textDateien[i];
  if (!d) return [];
  // Bei Instagram und Shorts steht die Pille dort, wo der Satz steht: der Satz weicht.
  const weicht = SITZE[plattform].untenLinks && i === folgenIdx;
  return [{ datei: d, startMs: m.startMs + 150, endMs: weicht ? folgenStart - 150 : m.endMs }];
});
if (!ohneFolgen) einblendungen.push({ datei: folgen, startMs: folgenStart, endMs: folgenEnde });

const eingang: string[] = [];
let n = 0;
const add = (...a: string[]) => { eingang.push(...a); return n++; };
const vid = add("-ss", s3(vorlaufMs), "-i", rohVideo);
const rah = add("-loop", "1", "-framerate", String(OUTPUT_FPS), "-t", s3(laufMs), "-i", rahmen);
const ein = einblendungen.map((c) => ({ ...c, idx: add("-loop", "1", "-framerate", String(OUTPUT_FPS),
  "-t", s3(Math.max(200, c.endMs - c.startMs)), "-itsoffset", s3(c.startMs), "-i", c.datei) }));

const f: string[] = [
  `color=c=${GRUND}:s=${W}x${H}:d=${s3(laufMs)}:r=${OUTPUT_FPS}[grund]`,
  `[${vid}:v]scale=${BILD.breite}:${BILD.hoehe}:flags=lanczos,setsar=1[app]`,
  `[grund][app]overlay=${BILD.x}:${BILD.y}:shortest=1[mitApp]`,
  `[${rah}:v]format=rgba,setsar=1[r]`,
  `[mitApp][r]overlay=0:0[mitRahmen]`,
];
let letzte = "[mitRahmen]";
ein.forEach((c, k) => {
  f.push(`[${c.idx}:v]format=rgba,setsar=1[o${k}]`);
  f.push(`${letzte}[o${k}]overlay=0:0:eof_action=pass:enable='between(t,${s3(c.startMs)},${s3(c.endMs)})'[e${k}]`);
  letzte = `[e${k}]`;
});
f.push(`${letzte}fade=t=in:st=0:d=0.35,format=yuv420p[vout]`);

const koerper = path.join(arbeit, "koerper.mp4");
await runFfmpeg([...eingang, "-filter_complex", f.join(";"), "-map", "[vout]",
  "-r", String(OUTPUT_FPS), "-t", s3(laufMs),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-an", "-y", koerper]);

// 3. Abspann anhängen und Musik darunter.
const abspann = await abspannClip(env.MP_DATA_DIR);
const gesamtMs = laufMs + ABSPANN_MS;
const musik = flagge("--ohne-musik") ? null : path.join(ROOT, "assets", "music", arg("--musik") ?? buch.musik);
if (musik && !fs.existsSync(musik)) throw new Error(`Musik fehlt: ${musik}`);

const reel = path.join(outDir, "reel.mp4");
const mArgs = musik ? ["-i", musik] : [];
const tonFilter = musik
  ? `[2:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${s3(gesamtMs)},` +
    `afade=t=in:st=0:d=1.2,afade=t=out:st=${s3(Math.max(0, gesamtMs - 2200))}:d=2.2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
  : `anullsrc=r=44100:cl=stereo,atrim=duration=${s3(gesamtMs)}[aout]`;
await runFfmpeg(["-i", koerper, "-i", abspann, ...mArgs, "-filter_complex",
  `[0:v]setsar=1[a];[1:v]setsar=1[b];[a][b]concat=n=2:v=1:a=0,fade=t=out:st=${s3(gesamtMs - 500)}:d=0.5[v];${tonFilter}`,
  "-map", "[v]", "-map", "[aout]", "-r", String(OUTPUT_FPS), "-t", s3(gesamtMs),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
  "-metadata", "comment=AI-generated: false (Bildschirmaufnahme binderplan.app)",
  "-metadata", `title=${buch.titel}`, "-y", reel]);

// 4. Vorschaubild und Eintrag im Pilot.
const thumb = path.join(outDir, "reel-thumb.jpg");
await runFfmpeg(["-ss", "1.2", "-i", reel, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", "-y", thumb]);

const caption = plattform === "instagram" ? buch.caption : buch.captionKurz;
const hashtags = plattform === "instagram" ? buch.hashtags : buch.hashtags.slice(0, 3);
const ts = nowIso();
const assetId = newId(), thumbId = newId();
db.insert(t.mpContentPieces).values({
  id: pieceId, projectId: PROJEKT, taskId: null, channel: KANAL[plattform], format: "artwork_reel",
  title: `${buch.titel} · ${plattform}`,
  body: `${caption}\n\n${hashtags.join(" ")}`,
  assets: toJson([assetId, thumbId]), status: ohneFolgen ? "draft" : "review",
  humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}",
  meta: toJson({ platform: plattform, language: "de", size: `${W}x${H}`, linkRule: "bio",
    caption, captionLang: buch.caption, captionKurz: buch.captionKurz, hashtags, hashtagsAlle: buch.hashtags,
    drehbuch: `tool-${name}`, art: "werbung", ohneStimme: true, dauerMs: gesamtMs, abspannMs: ABSPANN_MS,
    folgenZeit: { startMs: folgenStart, endMs: folgenEnde }, basis: ohneFolgen, aufnahme: BASIS }),
  aiTellScore: null, aiTellNotes: "Bildschirmaufnahme der App, Texte von Hand.", rejectionReason: "",
  createdAt: ts, updatedAt: ts,
}).run();
db.insert(t.mpAssets).values({ id: assetId, projectId: PROJEKT, contentPieceId: pieceId, kind: "video",
  path: path.relative(env.MP_DATA_DIR, reel),
  meta: toJson({ aiGenerated: false, provenance: "reel-tool", drehbuch: name, plattform, size: `${W}x${H}` }), createdAt: ts }).run();
db.insert(t.mpAssets).values({ id: thumbId, projectId: PROJEKT, contentPieceId: pieceId, kind: "image",
  path: path.relative(env.MP_DATA_DIR, thumb),
  meta: toJson({ aiGenerated: false, provenance: "reel-tool", role: "thumbnail", size: "540x960" }), createdAt: ts }).run();

console.log(`\nFertig: ${reel}`);
console.log(`Stück ${pieceId} steht auf „review".`);
