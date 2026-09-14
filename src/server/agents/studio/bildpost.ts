/**
 * Bildpost „Binderseite des Tages" — eine Kunstseite als Einzelbild, 1080 × 1350.
 *
 * Das Gegenstück zum Reel für Post-Art A (`docs/CONTENT_PLAYBOOK.md`, Abschnitt 5):
 * Ein Einzelbild kostet Sekunden statt einer Stunde, und auf Threads und
 * Pinterest trägt es weiter als Video. Gezeigt wird dieselbe Seite in denselben
 * Hüllen wie im Reel — die Geometrie kommt aus `blatt.ts`, damit beide dasselbe
 * Blatt zeigen.
 *
 * Lag bis zum 14.09.2026 vollständig in `scripts/bildpost-seite.ts`. Seit die
 * Wochenplanung Bildposts als eigene Stücke anlegt, brauchen zwei Aufrufer
 * dasselbe Layout — und zwei Kopien eines Layouts sind in vier Wochen zwei
 * verschiedene Layouts.
 */
import fs from "node:fs";
import path from "node:path";
import type { Env } from "../../env.js";
import type { Db } from "../../db/index.js";
import { loadBrandKit } from "./brandkit.js";
import { playwrightRenderer, dataUrlFor } from "./render.js";
import { fontHead } from "./fonts.js";
import { runFfmpeg } from "../video/assemble.js";
import { blattMasse } from "./blatt.js";

export const BILDPOST_B = 1080, BILDPOST_H = 1350;

/** Farben wie im Reel und in `tokens.css` des Produkts. */
const MARKE = { blau: "#2A4B9B", kontur: "#14161C", seiteDunkel: "#14161a", grund: "#12141A" };
const DOMAIN = "binderplan.app";

/**
 * Das Blatt in Hüllen: neun Ausschnitte derselben Seite, zwischen ihnen die
 * Naht. Der Ausschnitt entsteht über `background-position` auf einer einzigen
 * Bildquelle — neun eigene `data:`-URLs wären neun Kopien eines mehrere
 * Megabyte großen Bildes, und daran ist der Renderer schon einmal gestorben.
 */
function blattHtml(breite: number, x: number, y: number, kippen: number): string {
  const m = blattMasse(breite);
  const px = (n: number) => `${n.toFixed(2)}px`;
  const felder = Array.from({ length: 9 }, (_, i) => {
    const spalte = i % 3, zeile = Math.floor(i / 3);
    const versatz = `background-image:var(--seite);`
      + `background-position:-${px(spalte * (m.fachB + m.fuge))} -${px(zeile * (m.fachH + m.fuge))};`
      + `background-size:${px(breite)} ${px(m.hoehe)}`;
    return `<div class="fach" style="${versatz}"></div>`;
  }).join("");
  const dreh = kippen ? `transform:rotate(${kippen}deg)` : "";
  return `<div class="blatt" style="left:${px(x)};top:${px(y)};width:${px(breite)};height:${px(m.hoehe)};`
    + `grid-template-columns:repeat(3,${px(m.fachB)});grid-template-rows:repeat(3,${px(m.fachH)});`
    + `gap:${px(m.fuge)};${dreh}">${felder}</div>`;
}

const KOPF_CSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${BILDPOST_B}px;height:${BILDPOST_H}px;background:${MARKE.grund};overflow:hidden;
            font-family:'Archivo',system-ui,sans-serif}
  .grund{position:absolute;inset:-60px;background-image:var(--seite);background-size:cover;
         background-position:center;filter:blur(46px) brightness(.4) saturate(.7)}
  .blatt{position:absolute;display:grid}
  .fach{position:relative;border-radius:6px;background-repeat:no-repeat;background-size:100% 100%;
        box-shadow:0 6px 22px rgba(0,0,0,.55), inset 0 0 0 1.5px rgba(255,255,255,.16)}
  /* Der Glanz der Hülle — ohne ihn wirkt das Fach wie aufgeklebtes Papier. */
  .fach::after{content:"";position:absolute;inset:0;border-radius:6px;
               background:linear-gradient(118deg,rgba(255,255,255,.17) 0%,rgba(255,255,255,.03) 26%,
                          rgba(255,255,255,0) 46%,rgba(255,255,255,.07) 84%,rgba(255,255,255,0) 100%)}
  .strich{position:absolute;height:9px;box-shadow:0 2px 14px rgba(0,0,0,.6)}
  .kicker{position:absolute;font-weight:600;font-size:29px;letter-spacing:.11em;text-transform:uppercase;
          color:rgba(255,255,255,.86);text-shadow:0 2px 12px rgba(0,0,0,.8)}
  .titel{position:absolute;font-weight:800;line-height:1.16;color:#fff;
         text-shadow:0 4px 26px rgba(0,0,0,.9), 0 2px 6px rgba(0,0,0,.75)}
  .hinweis{position:absolute;font-weight:600;font-size:25px;letter-spacing:.09em;text-transform:uppercase;
           color:rgba(255,255,255,.72);text-shadow:0 2px 12px rgba(0,0,0,.9)}
  .pille{position:absolute;display:inline-block;font-weight:700;font-size:32px;color:#fff;
         background:${MARKE.kontur};border-radius:999px;padding:15px 32px;
         box-shadow:0 8px 26px rgba(0,0,0,.5), inset 0 0 0 1.5px rgba(255,255,255,.14)}
`;

/** „Galerie": Kopfzeile oben, Blatt frei in der Mitte, Titel darunter. */
function layoutA(titel: string[], kicker: string, akzent: string): string {
  const breite = 606;                              // → 837 px hoch, lässt oben und unten Luft
  const blatt = blattHtml(breite, (BILDPOST_B - breite) / 2, 178, -1.4);
  return `<div class="grund"></div>${blatt}
    <div class="strich" style="left:88px;top:92px;width:84px;background:${akzent}"></div>
    <div class="kicker" style="left:88px;top:118px">${kicker}</div>
    <div class="titel" style="left:88px;right:88px;top:1076px;font-size:60px">
      ${titel.map((z) => `<div>${z}</div>`).join("")}</div>
    <div class="pille" style="right:76px;bottom:48px">${DOMAIN}</div>`;
}

/**
 * „Ausschnitt": vier Fächer formatfüllend, an drei Seiten angeschnitten — der
 * Blick aus dem Reel, wenn die Kamera auf einem Fach steht. Text unten links
 * über dem Schleier, genau wie dort.
 *
 * Der Anschnitt ist der Punkt: Er zeigt, dass das Motiv über die Fächer
 * hinausläuft, und macht die Malerei so groß, dass man sie wirklich sieht. Ein
 * ganzes Blatt in 1080 px zeigt neun Briefmarken — Layout `a` tut das bewusst,
 * dieses hier soll das Gegenteil sein.
 *
 * Die 1560 px Blattbreite sind gerechnet, nicht geraten: ein Fach ist dann
 * 499 px breit, zwei Fächer plus Naht sind 1030 px. Bei `x = -46` steht links
 * ein schmaler Rest der vorigen Spalte, rechts beginnt die nächste — das Auge
 * liest „geht weiter", nicht „hört auf".
 */
function layoutB(titel: string[], kicker: string, akzent: string): string {
  const blatt = blattHtml(1560, -46, -96, 0);
  return `<div class="grund"></div>${blatt}
    <div style="position:absolute;left:0;right:0;bottom:0;height:660px;
         background:linear-gradient(to top,rgba(0,0,0,.94) 0%,rgba(0,0,0,.82) 28%,
                    rgba(0,0,0,.46) 60%,rgba(0,0,0,0) 100%)"></div>
    <div class="kicker" style="left:88px;bottom:342px">${kicker}</div>
    <div class="strich" style="left:88px;bottom:296px;width:96px;background:${akzent}"></div>
    <div class="titel" style="left:88px;right:96px;bottom:150px;font-size:66px">
      ${titel.map((z) => `<div>${z}</div>`).join("")}</div>
    <div class="pille" style="right:76px;bottom:48px">${DOMAIN}</div>`;
}

export interface BildpostAuftrag {
  db: Db;
  env: Env;
  projektId: string;
  /** Kunstseiten-Id in Binderplan; die Datei liegt als `kunstseite-<id>.png` im Projektordner. */
  seite: string;
  /** Titelzeilen, wie sie im Bild stehen — die Hook des Beitrags, höchstens zwei Zeilen. */
  titel: string[];
  kicker?: string;
  layout?: "a" | "b";
  /** Zieldatei; fehlt sie, landet das Bild unter `assets/<projekt>/bildposts/`. */
  datei?: string;
}

/** Ein Bildpost als PNG. Gibt den Pfad der geschriebenen Datei zurück. */
export async function rendereBildpost(a: BildpostAuftrag): Promise<string> {
  const layout = a.layout ?? "b";
  const kit = loadBrandKit(a.db, a.projektId);
  // Das Binderplan-Gelb, nicht das Blau: über dunklen Bildern ist Blau unsichtbar.
  const akzent = kit.accent2 ?? kit.colors?.[1] ?? "#F5C518";

  const quelle = path.join(a.env.MP_DATA_DIR, "assets", a.projektId, `kunstseite-${a.seite}.png`);
  if (!fs.existsSync(quelle)) throw new Error(`Kunstseite fehlt: ${quelle}`);
  const ordner = path.join(a.env.MP_DATA_DIR, "assets", a.projektId, "bildposts");
  fs.mkdirSync(ordner, { recursive: true });

  // Verkleinerte Arbeitskopie: das Blatt ist höchstens 700 px breit, das Original
  // hat 1472 — ungefiltert wandern mehrere Megabyte als data:-URL ins Dokument.
  const klein = path.join(ordner, `quelle-${a.seite}.jpg`);
  if (!fs.existsSync(klein)) {
    await runFfmpeg(["-i", quelle, "-vf", "scale=1000:-1:flags=lanczos", "-q:v", "3", klein]);
  }
  const url = dataUrlFor(klein);
  if (!url) throw new Error(`Arbeitskopie unlesbar: ${klein}`);

  const kicker = a.kicker ?? "Binderseite des Tages";
  const inhalt = layout === "a" ? layoutA(a.titel, kicker, akzent) : layoutB(a.titel, kicker, akzent);
  const html = `<!doctype html><html><head><meta charset="utf-8">${fontHead()}
    <style>:root{--seite:url('${url}')}${KOPF_CSS}</style></head><body>${inhalt}</body></html>`;

  const datei = a.datei ?? path.join(ordner, `seite-${a.seite}-${layout}.png`);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  await playwrightRenderer([{ html, width: BILDPOST_B, height: BILDPOST_H, file: datei }]);
  return datei;
}
