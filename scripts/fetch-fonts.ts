/**
 * Die Slide-Schriften einmal holen und als eine CSS-Datei mit eingebetteten
 * Woff2-Dateien ablegen (`assets/fonts/inline.css`).
 *
 * Aufruf: `pnpm fonts:fetch`. Danach rendert der Pilot ohne Netzzugriff und
 * sieht auch dann richtig aus, wenn Google nicht erreichbar ist.
 *
 * Behalten wird nur `latin` und `latin-ext` — Kyrillisch, Griechisch und
 * Vietnamesisch würden die Datei verdreifachen und kommen in keiner Slide vor.
 */
import fs from "node:fs";
import path from "node:path";
import { FONT_CSS_FILE, FONT_FAMILIES } from "../src/server/agents/studio/fonts.js";

/** Ohne Browser-Kennung liefert Google TTF statt Woff2 — dreimal so groß. */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BEHALTEN = /\/\*\s*(latin|latin-ext)\s*\*\//;

const hol = async (url: string, alsText: boolean): Promise<string | Buffer> => {
  for (let versuch = 1; versuch <= 4; versuch++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return alsText ? await res.text() : Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (versuch === 4) throw e;
      process.stderr.write(`  Versuch ${versuch} fehlgeschlagen (${e instanceof Error ? e.message : e}), neuer Anlauf …\n`);
      await new Promise((r) => setTimeout(r, versuch * 3000));
    }
  }
  throw new Error("unerreichbar");
};

const css = (await hol(`https://fonts.googleapis.com/css2?family=${FONT_FAMILIES}&display=swap`, true)) as string;

// Die Antwort ist eine Folge aus Kommentar (`/* latin */`) und @font-face-Block.
const bloecke = css.split(/(?=\/\*\s*[a-z-]+\s*\*\/)/).filter((b) => b.includes("@font-face"));
const gewollt = bloecke.filter((b) => BEHALTEN.test(b));
process.stderr.write(`${bloecke.length} Schnitte, davon ${gewollt.length} in latin/latin-ext\n`);

const teile: string[] = [];
let bytes = 0;
for (const block of gewollt) {
  const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(block)?.[1];
  if (!url) continue;
  const daten = (await hol(url, false)) as Buffer;
  bytes += daten.length;
  const familie = /font-family:\s*'([^']+)'/.exec(block)?.[1] ?? "?";
  const gewicht = /font-weight:\s*([\d ]+)/.exec(block)?.[1]?.trim() ?? "400";
  process.stderr.write(`  ${familie} ${gewicht}: ${Math.round(daten.length / 1024)} kB\n`);
  teile.push(block.replace(/url\(https:\/\/fonts\.gstatic\.com\/[^)]+\)/, `url(data:font/woff2;base64,${daten.toString("base64")})`));
}
if (!teile.length) throw new Error("Keine Schrift geladen — Datei nicht angefasst.");

fs.mkdirSync(path.dirname(FONT_CSS_FILE), { recursive: true });
fs.writeFileSync(FONT_CSS_FILE, `/* Erzeugt von scripts/fetch-fonts.ts am ${new Date().toISOString().slice(0, 10)}. Nicht von Hand ändern. */\n${teile.join("")}`);
process.stderr.write(`${FONT_CSS_FILE}: ${teile.length} Schnitte, ${Math.round(bytes / 1024)} kB Schriftdaten, ${Math.round(fs.statSync(FONT_CSS_FILE).size / 1024)} kB Datei\n`);
