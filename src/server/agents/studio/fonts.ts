/**
 * Die Schriften der Slides — lokal, nicht von Google.
 *
 * Bis zum 08.09.2026 zog jede gerenderte Slide ihre Schriften live von
 * `fonts.googleapis.com` und `fonts.gstatic.com`. Das ging gut, bis es nicht
 * mehr ging: an diesem Tag waren beide Hosts vom Server aus minutenlang
 * unerreichbar (der Rest des Netzes lief), und jede Slide hing erst in der
 * Zeitschranke und wurde dann still mit Systemschrift gerendert. Ein Bündel
 * sah anders aus als das vom Vortag, ohne dass irgendwo etwas davon stand.
 *
 * Deshalb liegen die Schriften jetzt als eine CSS-Datei mit eingebetteten
 * Woff2-Dateien im Repo (`assets/fonts/inline.css`, erzeugt von
 * `pnpm fonts:fetch`). Sie wird einmal beim ersten Render gelesen und in jede
 * Slide eingebettet. Fehlt die Datei, fällt der Renderer auf den alten
 * Google-Link zurück — dann ist das Ergebnis wieder vom Netz abhängig, aber
 * nichts ist kaputt.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const FONT_CSS_FILE = path.join(ROOT, "assets", "fonts", "inline.css");

/** Der Rückfall: derselbe Link, den es vorher gab. */
export const FONT_LINK_REMOTE = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@600;700&family=Nunito+Sans:wght@400;600&family=DM+Mono:wght@500&family=Bungee&family=Archivo:wght@500;600;800&display=swap">`;

/** Die Familien und Schnitte, die `themeVars` benutzt. */
export const FONT_FAMILIES = "Gabarito:wght@600;700&family=Nunito+Sans:wght@400;600&family=DM+Mono:wght@500&family=Bungee&family=Archivo:wght@500;600;800";

let zwischenspeicher: string | null = null;

/**
 * Der `<style>`- oder `<link>`-Block für den Kopf einer Slide.
 *
 * Einmal gelesen, dann im Speicher: bei 24 Slides je Bündel wäre das sonst
 * 24-mal dieselbe halbe Megabyte von der Platte.
 */
export function fontHead(): string {
  if (zwischenspeicher !== null) return zwischenspeicher;
  try {
    const css = fs.readFileSync(FONT_CSS_FILE, "utf8");
    zwischenspeicher = css.trim() ? `<style>${css}</style>` : FONT_LINK_REMOTE;
  } catch { zwischenspeicher = FONT_LINK_REMOTE; }
  return zwischenspeicher;
}

/** Nur für Tests: den Zwischenspeicher verwerfen. */
export const fontHeadVergessen = (): void => { zwischenspeicher = null; };

/** Ob die Schriften lokal liegen — für die Statusanzeige. */
export const fontsLokal = (): boolean => fs.existsSync(FONT_CSS_FILE) && fs.statSync(FONT_CSS_FILE).size > 1000;
