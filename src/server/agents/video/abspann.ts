/**
 * Die Abschluss-Slide der Reels — als Bildfolge, nicht als Standbild.
 *
 * Seit dem 11.09.2026 fahren die Reels ohne Vorspann-Karte; der Abspann traegt
 * die ganze Werbung und darf sich deshalb bewegen. Nach einem Reel voller
 * Bewegung wirkt ein hartes Standbild wie ein Abbruch: die Figur fliegt ein,
 * atmet, blinzelt, der Text baut sich gestaffelt auf.
 *
 * Jedes Einzelbild ist ein eigener HTML-Render. Angesprungen wird ueber
 * `animation-delay: -t` bei `animation-play-state: paused` — damit ist jedes
 * Bild fuer sich reproduzierbar, ohne dass der Renderer eine Zeitachse kennen
 * muss.
 *
 * Die Figur ist Projektsache: `assets/abspann/<ordner>/figur.svg` (Klassen
 * `.koerper`, `.kopf`, `.auge`, `.blatt`, `.haken`) plus optional
 * `schrift.css`. Fehlt der Ordner, bleibt die Slide reine Typografie in den
 * Farben des Brand-Kits.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../env.js";
import type { BrandKit } from "../../../shared/schemas.js";
import type { RenderJob } from "../studio/render.js";
import { fontHead } from "../studio/fonts.js";
import { themeVars } from "../studio/render.js";

export const ABSPANN_DIR = path.join(ROOT, "assets", "abspann");

export interface AbspannInhalt {
  /** Die Adresse, gross gesetzt — das Einzige, was haengen bleiben muss. */
  domain: string;
  /** Ein Satz darunter; `|` trennt die Zeilen. */
  claim: string;
  /** Kleingedrucktes, etwa „15 Credits gratis · keine Kreditkarte". */
  fuss: string;
  /** Ordner unter assets/abspann mit figur.svg und schrift.css. */
  ordner: string | null;
}

export interface AbspannPlan { jobs: RenderJob[]; muster: string; anzahl: number; letzte: string; fps: number }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Schriftgroesse der Adresse — sie muss in eine Zeile passen.
 *
 * Die feste Groesse von 13,9 % der Breite lief aus dem Bild: „binderplan.app"
 * stand am 11.09. als „INDERPLAN.AP" im Reel, und auch „lehreule.de" reichte
 * bis an beide Bildkanten. Im Renderer nachgemessen (Bungee, 1080 px breit):
 * 0,663 em je Zeichen, also 9,28 em fuer vierzehn Zeichen — bei 150 px waeren
 * das 1392 px auf 1080 px Bild.
 *
 * Die Zeile darf deshalb hoechstens 88 % der Bildbreite belegen; nur wenn sie
 * darunter bleibt, gilt weiter die alte Groesse.
 */
const EM_JE_ZEICHEN = 0.663;
function domainGroesse(w: number, domain: string): number {
  const hoechstens = w * 0.88 / (EM_JE_ZEICHEN * Math.max(1, domain.length));
  return Math.round(Math.min(w * 0.139, hoechstens));
}

/** Figur und Hausschrift eines Projekts, falls hinterlegt. */
export function abspannMaterial(ordner: string | null): { figur: string; schrift: string } {
  if (!ordner || !/^[a-z0-9_-]+$/i.test(ordner)) return { figur: "", schrift: "" };
  const dir = path.join(ABSPANN_DIR, ordner);
  const lies = (name: string) => { try { return fs.readFileSync(path.join(dir, name), "utf8"); } catch { return ""; } };
  const schrift = lies("schrift.css");
  return { figur: lies("figur.svg"), schrift: schrift ? `<style>${schrift}</style>` : "" };
}

/**
 * Das HTML eines einzelnen Bildes.
 *
 * `tMs` ist der Zeitpunkt auf der Zeitachse der Slide. Alle Animationen laufen
 * mit demselben negativen Verzoegerungswert und stehen — der Browser rechnet
 * den Zustand aus, der zu diesem Zeitpunkt gehoert.
 */
export function abspannHtml(kit: BrandKit, inhalt: AbspannInhalt, w: number, h: number, tMs: number): string {
  const { figur, schrift } = abspannMaterial(inhalt.ordner);
  const t = Math.max(0, Math.round(tMs));
  const primary = kit.primary ?? "#e8912d";
  const ink = kit.ink ?? "#2e2536";
  const soft = kit.background ?? "#fdf1e3";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">${fontHead()}${schrift}<style>
:root{${themeVars(kit)}}
*{box-sizing:border-box;margin:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;font-family:var(--ab-body,var(--f-body))}
.buehne{width:${w}px;height:${h}px;background:${primary};
  background-image:radial-gradient(ellipse 60% 30% at 50% 8%,rgba(255,255,255,.18),transparent 70%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(w * 0.052)}px;
  color:${ink};padding:${Math.round(w * 0.089)}px;text-align:center}
.figur{width:${Math.round(w * 0.315)}px;transform-box:view-box}
.figur g{transform-box:view-box}
.domain{font-family:var(--ab-display,var(--f-display));font-weight:900;letter-spacing:-.02em;
  font-size:${domainGroesse(w, inhalt.domain)}px;color:${ink};line-height:1;white-space:nowrap}
.claim{font-family:var(--ab-display,var(--f-display));font-weight:800;font-size:${Math.round(w * 0.052)}px;
  line-height:1.25;max-width:15em}
.fuss{font-size:${Math.round(w * 0.037)}px;color:${ink};opacity:.72;background:${soft}8c;
  border-radius:999px;padding:${Math.round(w * 0.018)}px ${Math.round(w * 0.041)}px}
/* Alles steht still — der Zeitpunkt kommt aus der negativen Verzoegerung. */
.buehne *{animation-play-state:paused!important;animation-delay:-${t}ms!important;animation-fill-mode:both!important}
.figur{animation:einflug .55s cubic-bezier(.22,1.4,.36,1)}
.koerper{transform-origin:120px 240px;animation:atmen 2.8s ease-in-out infinite}
.kopf{transform-origin:120px 200px;animation:wiegen 3.2s ease-in-out}
.auge{animation:blinzeln 3.2s linear}
.auge-l{transform-origin:86px 104px}.auge-r{transform-origin:154px 104px}
.fuesse{transform-origin:120px 232px;animation:wippen 1.1s ease-in-out 2}
.blatt{transform-origin:120px 240px;animation:blattflug .75s cubic-bezier(.2,.9,.3,1)}
.haken{transform-origin:160px 205px;animation:hakenpop .45s cubic-bezier(.22,1.5,.36,1)}
.domain{animation:auf .5s cubic-bezier(.2,.9,.3,1)}
.claim{animation:auf .5s cubic-bezier(.2,.9,.3,1)}
.fuss{animation:auf .5s cubic-bezier(.2,.9,.3,1)}
/* Die Staffelung steckt in eigenen Verzoegerungen, die der Zeitpunkt mitnimmt. */
.domain{animation-delay:-${t - 300}ms!important}
.claim{animation-delay:-${t - 480}ms!important}
.fuss{animation-delay:-${t - 660}ms!important}
.blatt{animation-delay:-${t - 850}ms!important}
.fuesse{animation-delay:-${t - 950}ms!important}
.haken{animation-delay:-${t - 1750}ms!important}
@keyframes einflug{from{transform:translateY(-70px) scale(.9);opacity:0}to{transform:none;opacity:1}}
@keyframes atmen{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}
@keyframes wiegen{0%{transform:rotate(-2.2deg)}55%{transform:rotate(2.2deg)}100%{transform:rotate(-1deg)}}
@keyframes blinzeln{0%,27%{transform:scaleY(1)}29.5%{transform:scaleY(.06)}32%{transform:scaleY(1)}
  68%{transform:scaleY(1)}70.5%{transform:scaleY(.06)}73%{transform:scaleY(1)}100%{transform:scaleY(1)}}
@keyframes wippen{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
@keyframes blattflug{from{opacity:0;transform:translate(-120px,150px) rotate(-28deg) scale(.7)}to{opacity:1;transform:none}}
@keyframes hakenpop{from{opacity:0;transform:scale(.2)}to{opacity:1;transform:scale(1)}}
@keyframes auf{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
</style></head><body><div class="buehne">
${figur}
<div class="domain">${esc(inhalt.domain)}</div>
<p class="claim">${inhalt.claim.split("|").map((z) => esc(z.trim())).join("<br>")}</p>
${inhalt.fuss ? `<p class="fuss">${esc(inhalt.fuss)}</p>` : ""}
</div></body></html>`;
}

/** Alle Bilder der Slide als Render-Auftraege plus das ffmpeg-Muster dazu. */
export function abspannJobs(kit: BrandKit, inhalt: AbspannInhalt, w: number, h: number, dauerMs: number, fps: number, outDir: string, praefix: string): AbspannPlan {
  const anzahl = Math.max(1, Math.round((dauerMs / 1000) * fps));
  const datei = (i: number) => path.join(outDir, `${praefix}-${String(i).padStart(3, "0")}.png`);
  const jobs: RenderJob[] = [];
  for (let i = 0; i < anzahl; i++) jobs.push({ html: abspannHtml(kit, inhalt, w, h, (i / fps) * 1000), width: w, height: h, file: datei(i) });
  return { jobs, muster: path.join(outDir, `${praefix}-%03d.png`), anzahl, letzte: datei(anzahl - 1), fps };
}
