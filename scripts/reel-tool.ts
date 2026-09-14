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
  const z = document.createElement("div");
  z.id = "__zeiger";
  z.style.cssText = "position:fixed;z-index:2147483647;width:26px;height:26px;margin:-13px 0 0 -13px;" +
    "border-radius:50%;background:rgba(245,197,24,.92);box-shadow:0 0 0 3px rgba(20,22,28,.55),0 6px 18px rgba(0,0,0,.5);" +
    "pointer-events:none;transition:transform .09s ease-out;left:-100px;top:-100px";
  document.documentElement.appendChild(z);
  window.__zeigerAuf = (x, y) => { z.style.left = x + "px"; z.style.top = y + "px"; };
  window.__zeigerTipp = () => { z.style.transform = "scale(.62)"; setTimeout(() => (z.style.transform = "scale(1)"), 150); };
`;

const schlaf = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Buehne {
  constructor(readonly page: Page) {}

  /** Den Zeiger weich zum Ziel führen — ein Sprung liest sich wie ein Schnittfehler. */
  private async fahre(x: number, y: number) {
    const von = await this.page.evaluate<{ x: number; y: number }>(
      `(() => { const z = document.getElementById("__zeiger"); return { x: parseFloat(z.style.left) || 195, y: parseFloat(z.style.top) || 700 }; })()`);
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

export const TOOL_DREHBUECHER: Record<string, ToolDrehbuch> = {};
