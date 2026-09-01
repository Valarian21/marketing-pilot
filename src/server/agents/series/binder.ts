/**
 * Binder-Showcase (Shot 11): echte Seiten aus einem geteilten Binder.
 *
 * Anders als bei den Ranglisten wird hier **nichts nachgebaut** — der Pilot
 * öffnet Marcels eigenen Binder in der öffentlichen Ansicht und fotografiert
 * die Seiten ab. Das ist der Punkt des Formats: man sieht das Produkt, nicht
 * eine Nachbildung davon.
 *
 * Die Ansicht ist stabil aufgebaut (`.slots` = eine Binderseite, `.seiten-nav`
 * blättert, ein Schalter zeigt Preise). Ändert Binderplan sie, schlägt der Lauf
 * mit einer klaren Meldung fehl, statt leere Bilder zu liefern.
 */
import fs from "node:fs";
import path from "node:path";

export interface BinderPage { file: string; index: number }
export interface BinderCapture {
  name: string;
  /** „64 Fächer · 8 Binderseiten · 8 A4-Blätter im Druck" — direkt aus der Ansicht. */
  stats: string;
  pages: BinderPage[];
  totalPages: number;
  /** Ob die Preise wirklich eingeblendet wurden — die Fußzeile richtet sich danach. */
  pricesShown: boolean;
}

export interface BinderShotOptions {
  outDir: string;
  /** So viele Seiten höchstens abfotografieren. */
  maxPages?: number;
  /** Preise in der Ansicht einblenden — sie sind der eigentliche Haken. */
  withPrices?: boolean;
  log?: (m: string) => void;
}

export type BinderShooter = (url: string, opts: BinderShotOptions) => Promise<BinderCapture>;

/** Aus `https://binderplan.app/app#ansicht/<id>` die Share-ID lesen. */
export function shareIdOf(url: string): string | null {
  const m = /#ansicht\/([A-Za-z0-9_-]{6,})/.exec(url.trim());
  return m?.[1] ?? null;
}

export const playwrightBinderShooter: BinderShooter = async (url, opts) => {
  const { chromium } = await import("playwright");
  const max = Math.max(1, Math.min(opts.maxPages ?? 5, 12));
  fs.mkdirSync(opts.outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1250 }, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // Die Ansicht laedt ihre Kartenbilder nach - ohne Wartezeit gaebe es leere Faecher.
    await page.waitForSelector(".slots .slot", { timeout: 30_000 });
    await page.waitForTimeout(2500);

    // Der Schalter heißt in Binderplan `#preis-toggle` und ruft `preiseUmschalten()`.
    // Ein Klick auf das Label würde ins Leere gehen — deshalb die ID, und danach
    // wird nachgesehen, ob er wirklich an ist.
    let pricesShown = false;
    if (opts.withPrices) {
      const box = page.locator("#preis-toggle");
      if (await box.count()) { await box.check().catch(() => undefined); await page.waitForTimeout(2500); }
      // Entscheidend ist nicht der Schalter, sondern was im Bild landet: nur wenn
      // im aufgenommenen Bereich wirklich Preise stehen, darf die Fußzeile welche
      // behaupten.
      pricesShown = await page.evaluate(() => /\d[\d.,]*\s*€/.test(document.querySelector(".slots")?.textContent ?? "")).catch(() => false);
      if (!pricesShown) opts.log?.("Keine Preise in der Binderansicht sichtbar — Fußzeile bleibt ohne Preisangabe");
    }

    const head = (await page.locator(".ansicht-banner").first().innerText().catch(() => "")).trim();
    const name = head.split("–").pop()?.trim() || "Binder";
    const stats = (await page.locator("text=/Fächer/").first().innerText().catch(() => "")).trim();
    const navText = (await page.locator(".seiten-nav").first().innerText().catch(() => "")).trim();
    const totalPages = Number(/\/\s*(\d+)/.exec(navText)?.[1] ?? "1");

    const pages: BinderPage[] = [];
    for (let n = 0; n < Math.min(max, Math.max(1, totalPages)); n++) {
      const slots = page.locator(".slots").first();
      if (!(await slots.count())) break;
      const file = path.join(opts.outDir, `binder-seite-${String(n + 1).padStart(2, "0")}.png`);
      await slots.screenshot({ path: file });
      pages.push({ file, index: n + 1 });
      opts.log?.(`Binderseite ${n + 1}/${totalPages} aufgenommen`);
      if (n + 1 >= totalPages) break;
      const next = page.locator(".seiten-nav button, .seiten-nav a").last();
      if (!(await next.count())) break;
      await next.click().catch(() => undefined);
      await page.waitForTimeout(1400);
    }
    if (!pages.length) throw new Error("Keine Binderseite gefunden — sieht die geteilte Ansicht noch aus wie erwartet?");
    return { name, stats, pages, totalPages: Math.max(totalPages, pages.length), pricesShown };
  } finally {
    await browser.close();
  }
};
