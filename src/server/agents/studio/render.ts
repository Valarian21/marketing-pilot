/**
 * HTML templates for carousels, pins and directory screenshots, rendered to PNG
 * with Playwright. Every template is token-based (brand kit colours + theme fonts).
 */
import fs from "node:fs";
import path from "node:path";
import type { BrandKit, CarouselTemplate } from "../../../shared/schemas.js";
import { markPng } from "../../util/png.js";

export interface Slide { kind: "text" | "screenshot"; headline: string; body: string; imageDataUrl?: string; index: number; total: number }
export interface RenderJob { html: string; width: number; height: number; file: string; transparent?: boolean }
export type Renderer = (jobs: RenderJob[]) => Promise<void>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@600;700&family=Nunito+Sans:wght@400;600&family=DM+Mono:wght@500&family=Bungee&family=Archivo:wght@500;600;800&display=swap">`;

/** Im Stil `kontur` traegt eine andere Schrift und eine zweite Signalfarbe. */
export const istKontur = (kit: BrandKit): boolean => kit.style === "kontur";

export function themeVars(kit: BrandKit): string {
  const primary = kit.primary ?? "#3D7A4E";
  const ink = kit.ink ?? "#1E2A20";
  const bg = kit.background ?? "#FFFFFF";
  const soft = kit.colors.find((c) => c !== primary && c !== ink && c !== bg) ?? "#EEF2EA";
  const kontur = istKontur(kit);
  const linie = kit.contour ?? "#14161C";
  const zweite = kit.accent2 ?? primary;
  const schriften = kontur
    ? `--f-display:"Bungee",system-ui,sans-serif;--f-body:"Archivo",system-ui,sans-serif;--f-mono:"Archivo",system-ui,sans-serif;`
    : `--f-display:"Gabarito",system-ui,sans-serif;--f-body:"Nunito Sans",system-ui,sans-serif;--f-mono:"DM Mono",monospace;`;
  // Der Grund einer Rangkarte: weich ein Verlauf, im Konturstil schlicht hell —
  // dort tragen Rahmen und Rang-Kasten die Marke, und die Karte bleibt das Bunteste.
  const grund = kontur ? bg : `linear-gradient(170deg,${soft},${bg})`;
  return `--b-primary:${primary};--b-ink:${ink};--b-bg:${bg};--b-soft:${soft};--b-on-primary:#FFFFFF;`
    + `--b-accent2:${zweite};--b-contour:${linie};--b-ground:${grund};${schriften}`;
}

/**
 * Aufkleber-Sprache: harte Konturen statt weicher Schatten, Rang und Preis in
 * Kaesten. Bewusst nur ueber Klassen, damit dieselben Vorlagen beide Welten
 * bedienen und Lehreule unveraendert bleibt.
 */
const KONTUR_CSS = `
.stil-kontur .slide{border:14px solid var(--b-contour)}
.stil-kontur .drank{background:var(--b-accent2);color:var(--b-contour);border:5px solid var(--b-contour);border-radius:10px;font-family:var(--f-body);font-weight:800}
.stil-kontur .dprice{color:var(--b-contour);display:inline-block;font-family:var(--f-body);font-weight:800;padding:0 .12em;
  background-image:linear-gradient(transparent 54%, var(--b-accent2) 54%, var(--b-accent2) 88%, transparent 88%)}
.stil-kontur .dname{letter-spacing:-.01em}
.stil-kontur .dcard::after{display:none}
.stil-kontur .dcard img{filter:drop-shadow(0 0 0 transparent)}
.stil-kontur .dchange{color:var(--b-contour);background:var(--b-accent2);display:inline-block;padding:.12em .4em;border:3px solid var(--b-contour);border-radius:6px}
.stil-kontur .dshot{border:5px solid var(--b-contour);box-shadow:none}
.stil-kontur .dfoot{opacity:.85}
.stil-kontur .dtotal{color:var(--b-accent2);font-weight:800}
`;

const base = (kit: BrandKit, w: number, h: number, body: string, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>
:root{${themeVars(kit)}} *{box-sizing:border-box;margin:0} html,body{width:${w}px;height:${h}px;overflow:hidden}
body{font-family:var(--f-body);color:var(--b-ink);background:var(--b-bg);-webkit-font-smoothing:antialiased}
.slide{width:${w}px;height:${h}px;padding:${Math.round(w * 0.08)}px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
h1{font-family:var(--f-display);font-weight:700;font-size:${Math.round(w * 0.075)}px;line-height:1.08;letter-spacing:-.01em;text-wrap:balance}
p{font-size:${Math.round(w * 0.036)}px;line-height:1.4;margin-top:${Math.round(w * 0.03)}px;max-width:90%}
.meta{font-family:var(--f-mono);font-size:${Math.round(w * 0.022)}px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;display:flex;justify-content:space-between}
.img{width:100%;flex:1;margin:${Math.round(w * 0.03)}px 0;border-radius:${Math.round(w * 0.02)}px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18);background:var(--b-soft)}
.img img{width:100%;height:100%;object-fit:contain;object-position:top}
.pill{display:inline-block;padding:.35em .9em;border-radius:999px;background:var(--b-primary);color:var(--b-on-primary);font-family:var(--f-mono);font-size:${Math.round(w * 0.024)}px;letter-spacing:.06em;text-transform:uppercase}
${extraCss}${istKontur(kit) ? KONTUR_CSS : ""}</style></head><body class="${istKontur(kit) ? "stil-kontur" : "stil-weich"}">${body}</body></html>`;

export function carouselSlideHtml(kit: BrandKit, template: CarouselTemplate, slide: Slide, w: number, h: number, brand: string): string {
  const counter = `<div class="meta"><span>${esc(brand)}</span><span>${slide.index + 1} / ${slide.total}</span></div>`;
  const isCover = slide.index === 0, isLast = slide.index === slide.total - 1;
  if (slide.kind === "screenshot" && slide.imageDataUrl) {
    return base(kit, w, h, `<div class="slide">${counter}<h1 style="font-size:${Math.round(w * 0.055)}px">${esc(slide.headline)}</h1><div class="img"><img src="${slide.imageDataUrl}"></div><p>${esc(slide.body)}</p></div>`);
  }
  switch (template) {
    case "bold":
      return base(kit, w, h, `<div class="slide" style="background:${isCover || isLast ? "var(--b-primary)" : "var(--b-bg)"};color:${isCover || isLast ? "var(--b-on-primary)" : "var(--b-ink)"}">${counter}<div><h1 style="font-size:${Math.round(w * 0.1)}px">${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div><div class="meta"><span>${isLast ? esc(brand) : "→"}</span></div></div>`);
    case "list":
      return base(kit, w, h, `<div class="slide">${counter}<div><span class="pill">${slide.index + 1}</span><h1 style="margin-top:.4em">${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div><div style="height:${Math.round(w * 0.012)}px;background:var(--b-soft);border-radius:99px"><div style="width:${Math.round(((slide.index + 1) / slide.total) * 100)}%;height:100%;background:var(--b-primary);border-radius:99px"></div></div></div>`);
    case "story":
      return base(kit, w, h, `<div class="slide" style="background:linear-gradient(160deg,var(--b-soft),var(--b-bg))">${counter}<div><h1>${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div><div class="meta"><span>${esc(brand)}</span><span>${isLast ? "" : "weiter →"}</span></div></div>`);
    case "screenshot":
    case "clean":
    default:
      return base(kit, w, h, `<div class="slide">${counter}<div><div style="width:${Math.round(w * 0.08)}px;height:${Math.round(w * 0.012)}px;background:var(--b-primary);border-radius:99px;margin-bottom:${Math.round(w * 0.04)}px"></div><h1>${esc(slide.headline)}</h1><p>${esc(slide.body)}</p></div>${isLast ? `<span class="pill">${esc(brand)}</span>` : `<div class="meta"><span>→</span></div>`}</div>`);
  }
}

/** Eine Zeile der Rangliste, so wie sie auf die Slide kommt. Zahlen kommen fertig aus dem Provider. */
export interface RankingSlide {
  rank: number;
  name: string;
  setLine: string;
  /** Fertig formatiert („626,08 €“) — der Renderer rechnet nichts. */
  price: string;
  /** Nur bei Preis-Bewegungen: „▲ +38 % in 7 Tagen“. */
  change?: string;
  imageDataUrl: string | null;
  index: number;
  total: number;
  /** Ratemodus: der Preis steht erst auf der Folgeslide. */
  hidePrice?: boolean;
}

/** Fußzeile, die laut Plan auf JEDER Daten-Slide steht — Quelle, Stand, Herkunft. */
/**
 * Die Fußzeile jeder Slide — sie muss sagen, **welcher** Preis dort steht.
 *
 * Trend und 30-Tage-Schnitt unterscheiden sich bei einzelnen Karten um das
 * Vierfache. Wer nur „Cardmarket" liest, hält beides für dasselbe.
 */
export const dataFooterText = (priceStand: string, source: string, basis: string = "max"): string =>
  `Preise: Cardmarket${basis === "avg30" ? " 30-Tage-Schnitt" : "-Trend"} · Stand ${priceStand} · ${source}`;

const dataFoot = (w: number, footer: string) =>
  `<div class="dfoot" style="font-family:var(--f-mono);font-size:${Math.round(w * 0.019)}px;letter-spacing:.02em;opacity:.6;text-align:center">${esc(footer)}</div>`;

const dataCss = (w: number) => `
.dwrap{width:100%;height:100%;display:flex;flex-direction:column;gap:${Math.round(w * 0.025)}px}
.dhead{display:flex;align-items:center;justify-content:space-between;gap:${Math.round(w * 0.02)}px}
.drank{font-family:var(--f-mono);font-weight:500;font-size:${Math.round(w * 0.075)}px;line-height:1;padding:.12em .38em;border-radius:${Math.round(w * 0.02)}px;background:var(--b-primary);color:var(--b-on-primary);font-variant-numeric:tabular-nums}
.dbrand{font-family:var(--f-mono);font-size:${Math.round(w * 0.022)}px;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.dcard{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.dcard::after{content:"";position:absolute;width:62%;height:52%;border-radius:50%;background:var(--b-primary);opacity:.16;filter:blur(${Math.round(w * 0.06)}px);z-index:0}
.dcard img{position:relative;z-index:1;max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 ${Math.round(w * 0.02)}px ${Math.round(w * 0.045)}px rgba(0,0,0,.35))}
.dname{font-family:var(--f-display);font-weight:700;font-size:${Math.round(w * 0.062)}px;line-height:1.1;text-wrap:balance}
.dset{font-family:var(--f-mono);font-size:${Math.round(w * 0.026)}px;opacity:.7;margin-top:.35em}
.dprice{font-family:var(--f-display);font-weight:700;font-size:${Math.round(w * 0.115)}px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-top:${Math.round(w * 0.02)}px}
.dchange{font-family:var(--f-mono);font-size:${Math.round(w * 0.03)}px;margin-top:.4em;color:var(--b-primary)}
.dfan{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.dfan img{position:absolute;max-height:74%;max-width:40%;object-fit:contain;border-radius:${Math.round(w * 0.012)}px;box-shadow:0 ${Math.round(w * 0.02)}px ${Math.round(w * 0.05)}px rgba(0,0,0,.35)}
.stil-kontur .dfan img{border:${Math.round(w * 0.006)}px solid var(--b-contour);box-shadow:${Math.round(w * 0.012)}px ${Math.round(w * 0.012)}px 0 var(--b-contour)}
.stil-kontur .dcard img{border-radius:${Math.round(w * 0.012)}px}
.dtotal{font-family:var(--f-mono);font-size:${Math.round(w * 0.03)}px;opacity:.75;font-variant-numeric:tabular-nums}
.dshot{flex:1;min-height:0;border-radius:${Math.round(w * 0.02)}px;overflow:hidden;background:var(--b-soft);box-shadow:0 ${Math.round(w * 0.02)}px ${Math.round(w * 0.05)}px rgba(0,0,0,.2)}
.dshot img{width:100%;height:100%;object-fit:cover;object-position:top}
/* Produktkachel des Abschluss-Slides: drei aufgefaecherte Seiten, gezeichnet
   statt fotografiert. Ein Website-Screenshot altert mit jeder Aenderung an der
   Seite und zeigt auf 1080 px ohnehin nur Kleingedrucktes. */
.dtile{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.dtile span{width:${Math.round(w * 0.23)}px;aspect-ratio:63/88;border:${Math.round(w * 0.009)}px solid var(--b-contour);border-radius:${Math.round(w * 0.014)}px;margin:0 ${Math.round(w * -0.024)}px;display:block}
.dtile .l{background:var(--b-accent2);transform:rotate(-9deg)}
.dtile .m{background:var(--b-primary);width:${Math.round(w * 0.25)}px;position:relative;z-index:2}
.dtile .r{background:var(--b-bg);transform:rotate(9deg)}
/* Die drei Produktansichten: aufgefaechert wie auf der Startseite, jede
   beschriftet — ohne Beschriftung sieht man drei Blaetter und weiss nicht,
   dass es drei verschiedene Dinge sind, die das Werkzeug kann. */
.dprod{flex:1;min-height:0;display:flex;align-items:flex-end;justify-content:center;gap:0}
.dprod figure{width:40%;margin:0 ${Math.round(w * -0.045)}px;display:flex;flex-direction:column;align-items:center;gap:${Math.round(w * 0.016)}px}
.dprod img{width:100%;border:${Math.round(w * 0.007)}px solid var(--b-contour);border-radius:${Math.round(w * 0.016)}px;background:#fff;display:block}
.dprod figcaption{font-family:var(--f-mono);font-size:${Math.round(w * 0.023)}px;letter-spacing:.03em;opacity:.75;white-space:nowrap}
.dprod .p0{transform:rotate(-7deg)}
.dprod .p1{width:45%;z-index:2}
.dprod .p2{transform:rotate(7deg)}`;

/** Rangkarte: Bild groß, Preis groß, alles andere leise. */
export function rankingSlideHtml(kit: BrandKit, slide: RankingSlide, w: number, h: number, brand: string, footer: string): string {
  const body = `<div class="slide" style="background:var(--b-ground)"><div class="dwrap">
<div class="dhead"><span class="drank">${slide.rank}</span><span class="dbrand">${esc(brand)}</span></div>
<div class="dcard">${slide.imageDataUrl ? `<img src="${slide.imageDataUrl}">` : ""}</div>
<div><div class="dname">${esc(slide.name)}</div><div class="dset">${esc(slide.setLine)}</div>
<div class="dprice"${slide.hidePrice ? ' style="opacity:.35"' : ""}>${slide.hidePrice ? "? ? ?" : esc(slide.price)}</div>${slide.change && !slide.hidePrice ? `<div class="dchange">${esc(slide.change)}</div>` : ""}</div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/** Cover: worum es geht, was die Liste zusammen wert ist, drei Karten angedeutet. */
export function rankingCoverHtml(kit: BrandKit, a: { title: string; totalLabel: string; images: (string | null)[]; hook?: string }, w: number, h: number, brand: string, footer: string): string {
  const imgs = a.images.filter((x): x is string => Boolean(x)).slice(0, 3);
  // Der Versatz bleibt bewusst klein: bei 0,26·w ragten die aeusseren Karten
  // ueber den Slide-Rand hinaus und wurden abgeschnitten.
  const fan = imgs.map((src, i) => {
    const off = (i - (imgs.length - 1) / 2) * 0.17;
    const mid = i === Math.floor(imgs.length / 2);
    return `<img src="${src}" style="transform:translateX(${Math.round(off * w)}px) rotate(${(off * 30).toFixed(1)}deg) scale(${mid ? 1 : 0.9});z-index:${mid ? 2 : 1}">`;
  }).join("");
  const body = `<div class="slide" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div class="dfan">${fan}</div>
<div><h1 style="font-size:${Math.round(w * (a.title.length > 22 ? 0.072 : 0.085))}px">${esc(a.title)}</h1>
${a.hook ? `<div class="dcoverhook" style="font-size:${Math.round(w * 0.042)}px;margin-top:.5em;line-height:1.25">${esc(a.hook)}</div>` : ""}
<div class="dtotal" style="margin-top:.55em">${esc(a.totalLabel)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/** Abschluss: Produkt-Screenshot, ein Satz, der Link bzw. der Bio-Hinweis. */
export function rankingCtaHtml(
  kit: BrandKit,
  a: { line: string; linkLabel: string; imageDataUrl: string | null; trustLine?: string; productImages?: { url: string; label: string }[] },
  w: number, h: number, brand: string, footer: string,
): string {
  // Die drei Ansichten der Startseite — geplante Binderseite, Artwork-Seite,
  // Druckblatt. Sie zeigen das Produkt, statt es zu behaupten. Liegen sie nicht
  // vor, bleibt die gezeichnete Kachel als Rueckfall.
  const bilder = (a.productImages ?? []).slice(0, 3);
  const kachel = bilder.length
    ? `<div class="dprod">${bilder.map((b, i) => `<figure class="p${i}"><img src="${b.url}"><figcaption>${esc(b.label)}</figcaption></figure>`).join("")}</div>`
    : `<div class="dtile"><span class="l"></span><span class="m"></span><span class="r"></span></div>`;
  const body = `<div class="slide"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
${kachel}
<div><h1 style="font-size:${Math.round(w * (a.line.length > 70 ? 0.056 : a.line.length > 45 ? 0.064 : 0.072))}px">${esc(a.line)}</h1>
${a.trustLine ? `<div class="dset" style="opacity:.7;margin-top:.35em">${esc(a.trustLine)}</div>` : ""}
<div class="dset" style="opacity:.85">${esc(a.linkLabel)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/**
 * Übersichtskachel: die ganze Rangliste auf einem Bild.
 *
 * Sie ist der Grund, aus dem jemand den Beitrag **speichert** — und Speichern
 * ist neben Teilen das stärkste Signal, das der Feed kennt. Wer nur zwei Slides
 * wischt, hat trotzdem alles gesehen; wer weiterwischt, bekommt die Einzelkarten.
 * Deshalb steht sie als Slide 2, direkt nach der Deckseite.
 */
export function rankingOverviewHtml(
  kit: BrandKit,
  a: { title: string; sub: string; cards: { rank: number; price: string; imageDataUrl: string | null }[] },
  w: number, h: number, brand: string, footer: string,
): string {
  // Spalten nach Kartenzahl: 8 Karten sind 4×2, 15 sind 5×3. Mehr als fünf
  // Spalten machen die Karten kleiner als einen Daumennagel.
  const spalten = a.cards.length <= 4 ? a.cards.length : a.cards.length <= 8 ? 4 : 5;
  // Geht die letzte Reihe nicht auf (7 Karten auf 4 Spalten), steht sie sonst
  // linksbuendig neben einer Luecke und liest sich wie ein Fehler. Das Raster
  // laeuft deshalb in halben Spalten, damit die Restreihe um eine halbe Spalte
  // versetzt — also mittig — beginnen kann.
  const rest = a.cards.length % spalten;
  const ersteDerRestreihe = rest ? a.cards.length - rest : -1;
  const zellen = a.cards.map((c, i) => `<figure class="ozelle"${i === ersteDerRestreihe ? ` style="grid-column:${spalten - rest + 1} / span 2"` : ""}>
<span class="okarte">${c.imageDataUrl ? `<img src="${c.imageDataUrl}">` : ""}<b>${c.rank}</b></span>
<figcaption>${esc(c.price)}</figcaption></figure>`).join("");
  const body = `<div class="slide" style="background:var(--b-ground)"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div><h1 style="font-size:${Math.round(w * 0.062)}px">${esc(a.title)}</h1>${a.sub ? `<div class="dtotal" style="margin-top:.4em">${esc(a.sub)}</div>` : ""}</div>
<div class="oraster" style="grid-template-columns:repeat(${spalten * 2},1fr)">${zellen}</div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, `${dataCss(w)}
.oraster{flex:1;min-height:0;display:grid;gap:${Math.round(w * 0.028)}px ${Math.round(w * 0.022)}px;align-content:center}
.ozelle{margin:0;grid-column:span 2;display:flex;flex-direction:column;align-items:center;gap:${Math.round(w * 0.012)}px;min-height:0}
.okarte{position:relative;display:block;flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.okarte img{max-width:100%;max-height:100%;object-fit:contain;border-radius:${Math.round(w * 0.008)}px}
.stil-kontur .okarte img{border:${Math.round(w * 0.005)}px solid var(--b-contour)}
.okarte b{position:absolute;top:${Math.round(w * -0.012)}px;left:${Math.round(w * -0.012)}px;width:${Math.round(w * 0.055)}px;height:${Math.round(w * 0.055)}px;border-radius:50%;
  background:var(--b-contour);color:var(--b-accent2);font-family:var(--f-body);font-weight:800;font-size:${Math.round(w * 0.028)}px;display:flex;align-items:center;justify-content:center}
.ozelle figcaption{font-family:var(--f-body);font-weight:800;font-size:${Math.round(w * (spalten >= 5 ? 0.023 : 0.03))}px;font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 0 auto}`);
}

/**
 * Story (1080 × 1920): der Hinweis auf den Beitrag, der heute im Feed steht.
 *
 * Zwei Dinge unterscheiden sie von einer Slide. Erstens ist unten und oben je
 * ein Sechstel der Fläche von der Oberfläche der App verdeckt — Profilzeile,
 * Antwortfeld —, deshalb liegt alles Wichtige in der Mitte. Zweitens kann eine
 * Story über die API **keinen antippbaren Link** tragen: der Hinweis, wo es
 * weitergeht, muss im Bild stehen, sonst steht er nirgends.
 */
export function storyHtml(
  kit: BrandKit,
  a: { eyebrow: string; line: string; sub: string; images: string[]; hint: string },
  w: number, h: number, brand: string, footer: string,
): string {
  const fan = a.images.slice(0, 3).map((src, i) =>
    `<img src="${src}" style="transform:rotate(${(i - 1) * 8}deg) translateY(${Math.abs(i - 1) * Math.round(w * 0.025)}px);left:${18 + i * 22}%">`).join("");
  const body = `<div class="slide" style="background:var(--b-ground);padding:${Math.round(h * 0.09)}px ${Math.round(w * 0.09)}px"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div class="sblock">
  <span class="pill">${esc(a.eyebrow)}</span>
  <h1 style="font-size:${Math.round(w * (a.line.length > 46 ? 0.085 : 0.105))}px;margin-top:${Math.round(w * 0.045)}px">${esc(a.line)}</h1>
  ${a.sub ? `<div class="dtotal" style="margin-top:${Math.round(w * 0.03)}px">${esc(a.sub)}</div>` : ""}
</div>
<div class="dfan" style="flex:1.4">${fan}</div>
<div class="sblock"><div class="dname" style="font-size:${Math.round(w * 0.05)}px">${esc(a.hint)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, `${dataCss(w)}
/* Story: alles Wichtige in der Mitte — oben und unten legt Instagram seine
   eigene Oberfläche darüber. */
.sblock{flex:0 0 auto}
.dfan img{max-height:100%;max-width:46%}`);
}

/**
 * Binder-Showcase (Shot 11): eine echte Seite aus der geteilten Ansicht.
 *
 * Das Bild wird nie beschnitten — es ist ein Produkt-Screenshot, und ein halb
 * abgeschnittenes Fach wäre eine Falschaussage über die App.
 */
export function showcaseSlideHtml(kit: BrandKit, a: { headline: string; sub: string; imageDataUrl: string | null }, w: number, h: number, brand: string, footer: string): string {
  const body = `<div class="slide" style="background:var(--b-ground)"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div class="dshot" style="background:transparent;box-shadow:none">${a.imageDataUrl ? `<img src="${a.imageDataUrl}" style="object-fit:contain;object-position:center">` : ""}</div>
<div><div class="dname" style="font-size:${Math.round(w * 0.055)}px">${esc(a.headline)}</div><div class="dset">${esc(a.sub)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

/** Cover des Showcase: Name des Binders, eine Seite angedeutet, die Eckdaten. */
export function showcaseCoverHtml(kit: BrandKit, a: { title: string; stats: string; imageDataUrl: string | null }, w: number, h: number, brand: string, footer: string): string {
  const body = `<div class="slide" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="dwrap">
<div class="dhead"><span class="dbrand">${esc(brand)}</span></div>
<div class="dshot" style="background:rgba(255,255,255,.1)">${a.imageDataUrl ? `<img src="${a.imageDataUrl}" style="object-fit:contain">` : ""}</div>
<div><h1 style="font-size:${Math.round(w * 0.08)}px">${esc(a.title)}</h1><div class="dtotal" style="margin-top:.5em">${esc(a.stats)}</div></div>
${dataFoot(w, footer)}</div></div>`;
  return base(kit, w, h, body, dataCss(w));
}

export function pinHtml(kit: BrandKit, overlay: string, brand: string, url: string, imageDataUrl: string | null): string {
  const w = 1000, h = 1500;
  return base(kit, w, h, `<div class="slide" style="background:var(--b-primary);color:var(--b-on-primary)"><div class="meta"><span>${esc(brand)}</span></div>${imageDataUrl ? `<div class="img"><img src="${imageDataUrl}"></div>` : `<div style="flex:1"></div>`}<div><h1 style="font-size:${Math.round(w * 0.085)}px">${esc(overlay)}</h1><p style="opacity:.85">${esc(url.replace(/^https?:\/\//, ""))}</p></div></div>`);
}

export function framedScreenshotHtml(kit: BrandKit, imageDataUrl: string, w: number, h: number): string {
  return base(kit, w, h, `<div style="width:${w}px;height:${h}px;background:linear-gradient(160deg,var(--b-soft),var(--b-bg));display:flex;align-items:center;justify-content:center;padding:${Math.round(w * 0.04)}px"><div style="width:100%;height:100%;border-radius:${Math.round(w * 0.012)}px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2);background:#fff"><img src="${imageDataUrl}" style="width:100%;height:100%;object-fit:cover;object-position:top"></div></div>`);
}

export const playwrightRenderer: Renderer = async (jobs) => {
  if (!jobs.length) return;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const job of jobs) {
      const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
      await page.setContent(job.html, { waitUntil: "load" });
      await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready).catch(() => undefined);
      await page.waitForTimeout(250);
      fs.mkdirSync(path.dirname(job.file), { recursive: true });
      await page.screenshot({ path: job.file, type: "png", clip: { x: 0, y: 0, width: job.width, height: job.height }, omitBackground: Boolean(job.transparent) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  for (const job of jobs) markPng(job.file, { aiGenerated: true, generator: "Marketing Pilot (template render)" });
};


// --- Binderseite -------------------------------------------------------------
//
// Der Aufbau, mit dem Binderplan seit September 2026 postet: jede Karte liegt
// in einem Fach einer 9er-Binderseite. Die Seite ist das Produkt, das Fach ist
// die Funktion — deshalb erklärt jede Slide das Werkzeug, ohne es zu nennen.
// Farben und Schriften kommen aus dem Brand-Kit (Kontur: Bungee + Archivo,
// Schwarz, Gelb), die Vorlagen selbst sind stilunabhängig.

export interface BinderChrome {
  brand: string;
  footer: string;
  /** Icon oben links; ohne Logo steht nur die Wortmarke. */
  logoDataUrl: string | null;
  /** Oben rechts: „3 / 9" — oder ein Wort wie „Set-Check" auf der Deckseite. */
  corner: string;
}
export interface BinderPocket { rank: number; price: string; imageDataUrl: string | null }
export interface BinderRankSlide {
  rank: number; name: string;
  /** „Nr. 161 / 131" — fertig formatiert. */
  numLine: string;
  illustrator: string;
  price: string;
  imageDataUrl: string | null;
  hidePrice?: boolean;
}

/** Der Pfeil: ein gezeichneter Strich im Kreis, immer mittig, immer gleich dick. */
export const binderArrow = (size: number, rotate = 0): string =>
  `<svg class="arr" width="${size}" height="${size}" viewBox="0 0 100 100" style="flex:0 0 auto;transform:rotate(${rotate}deg)"><circle cx="50" cy="50" r="50" fill="var(--b-contour)"/><path d="M27 50h46M52 29l21 21-21 21" fill="none" stroke="var(--b-accent2)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const binderCss = (w: number, h: number): string => {
  const u = (x: number) => Math.round(w * x);
  const hoch = h / w > 1.5;  // Reel- und Story-Format: mehr Rand oben und unten, größere Schrift
  return `
.slide{width:${w}px;height:${h}px;position:relative;padding:${hoch ? Math.round(h * 0.078) : u(0.072)}px ${u(0.072)}px ${hoch ? Math.round(h * 0.073) : u(0.072)}px;display:flex;flex-direction:column;gap:${u(0.028)}px;background:var(--b-bg)}
.top{display:flex;justify-content:space-between;align-items:center;flex:0 0 auto}
.logo{display:flex;align-items:center;gap:${u(0.015)}px;font-family:var(--f-body);font-weight:800;font-size:${u(0.025)}px;letter-spacing:.05em;text-transform:uppercase}
.logo img{width:${u(0.054)}px;height:${u(0.054)}px;border-radius:${u(0.012)}px;display:block}
.corner{font-family:var(--f-body);font-size:${u(0.023)}px;font-weight:700;opacity:.55;letter-spacing:.06em;text-transform:uppercase;font-variant-numeric:tabular-nums}
.bfoot{font-family:var(--f-body);font-size:${u(0.0185)}px;opacity:.5;text-align:center;flex:0 0 auto}
.mid{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.disp{font-family:var(--f-display);font-weight:700;line-height:1.04;text-wrap:balance}
.sub{font-family:var(--f-body);font-size:${u(0.028)}px;opacity:.7}
.hint{display:inline-flex;align-items:center;gap:${u(0.024)}px;font-family:var(--f-display);font-weight:700;font-size:${u(hoch ? 0.052 : 0.048)}px;line-height:1}
.page{background:var(--b-contour);border-radius:${u(0.028)}px;padding:${u(0.02)}px;display:grid;gap:${u(0.015)}px;position:relative}
.pk{background:#fff;border-radius:${u(0.011)}px;overflow:hidden;position:relative;aspect-ratio:63/88}
.pk img{width:100%;height:100%;object-fit:cover;display:block}
.pk::after{content:"";position:absolute;inset:0;background:linear-gradient(155deg,rgba(255,255,255,.26),rgba(255,255,255,0) 40%);pointer-events:none}
.pk .rk{position:absolute;top:${u(0.007)}px;left:${u(0.007)}px;background:rgba(20,22,28,.82);color:var(--b-accent2);font-family:var(--f-body);font-weight:800;font-size:${u(0.0185)}px;line-height:1;padding:${u(0.004)}px ${u(0.0075)}px;border-radius:${u(0.0065)}px;z-index:2;font-variant-numeric:tabular-nums}
.pk .pr{position:absolute;left:0;right:0;bottom:0;background:rgba(20,22,28,.88);color:#fff;font-family:var(--f-body);font-weight:800;font-size:${u(0.022)}px;text-align:center;padding:${u(0.0085)}px ${u(0.004)}px;z-index:2;font-variant-numeric:tabular-nums}
.pk.leer{background:#22242B;aspect-ratio:auto;display:grid;place-items:center}.pk.leer::after{display:none}
.pk.leer .hint{color:#fff;font-size:${u(0.04)}px;gap:${u(0.018)}px}
.pk.leer .hint svg circle{fill:var(--b-accent2)}.pk.leer .hint svg path{stroke:var(--b-contour)}
.tab{display:inline-block;background:var(--b-accent2);color:var(--b-contour);font-family:var(--f-display);font-weight:700;font-size:${u(0.028)}px;line-height:1;padding:${u(0.011)}px ${u(0.02)}px ${u(0.0075)}px;border-radius:${u(0.011)}px ${u(0.011)}px 0 0}
.name{font-family:var(--f-display);font-weight:700;font-size:${u(hoch ? 0.07 : 0.057)}px;line-height:1.05;text-wrap:balance}
.daten{display:flex;gap:${u(0.031)}px;margin-top:${u(0.013)}px;font-family:var(--f-body);font-size:${u(hoch ? 0.028 : 0.023)}px}
.daten span{opacity:.6}.daten b{font-weight:700;opacity:1}
.price{font-family:var(--f-display);font-weight:700;font-size:${u(hoch ? 0.139 : 0.085)}px;line-height:1;margin-top:${u(0.018)}px;font-variant-numeric:tabular-nums;white-space:nowrap;display:inline-block;color:var(--b-contour);background-image:linear-gradient(transparent 58%,var(--b-accent2) 58%,var(--b-accent2) 90%,transparent 90%);padding:0 .1em}
.price.frage{background-image:none;opacity:.3}
.prod{color:#fff;font-family:var(--f-body);font-weight:700;font-size:${u(0.021)}px;margin-top:${u(0.011)}px;text-align:center}`;
};

const binderTop = (c: BinderChrome) =>
  `<div class="top"><div class="logo">${c.logoDataUrl ? `<img src="${c.logoDataUrl}">` : ""}${esc(c.brand)}</div><div class="corner">${esc(c.corner)}</div></div>`;
const binderFoot = (c: BinderChrome) => `<div class="bfoot">${esc(c.footer)}</div>`;

/** Deckseite: eine 9er-Seite mit Karten ohne Rang, Bereich, Fakten, der Pfeil. */
export function binderCoverHtml(kit: BrandKit, a: { title: string; sub: string; images: string[]; hint: string }, w: number, h: number, c: BinderChrome): string {
  const u = (x: number) => Math.round(w * x);
  const pk = a.images.slice(0, 9).map((src) => `<div class="pk"><img src="${src}"></div>`).join("");
  const body = `<div class="slide">${binderTop(c)}
<div class="mid" style="gap:${u(0.037)}px"><div class="page" style="grid-template-columns:repeat(3,1fr);transform:rotate(-3deg);width:52%;margin:${u(0.013)}px auto 0">${pk}</div>
<div><div class="disp" style="font-size:${u(a.title.length > 22 ? 0.066 : 0.074)}px">${esc(a.title)}</div>${a.sub ? `<div class="sub" style="margin-top:${u(0.013)}px">${esc(a.sub)}</div>` : ""}</div>
<div class="hint">${esc(a.hint)}${binderArrow(u(0.1))}</div></div>
${binderFoot(c)}</div>`;
  return base(kit, w, h, body, binderCss(w, h));
}

/**
 * Eine 9er-Seite als Übersicht. Bleiben Fächer leer, tragen sie den Hinweis auf
 * das, was als Nächstes kommt — ein leeres Fach ohne Grund sähe nach Fehler aus.
 */
export function binderPageHtml(
  kit: BrandKit,
  a: { tab: string; pockets: BinderPocket[]; leerText: string; hint: string; hintRotate?: number; width?: string },
  w: number, h: number, c: BinderChrome,
): string {
  const u = (x: number) => Math.round(w * x);
  const pockets = a.pockets.slice(0, 9);
  const rest = 9 - pockets.length;
  const cells = pockets.map((p) => `<div class="pk">${p.imageDataUrl ? `<img src="${p.imageDataUrl}">` : ""}<span class="rk">${p.rank}</span><span class="pr">${esc(p.price)}</span></div>`);
  // Mehr als drei freie Fächer: die überzähligen bleiben schlicht dunkel, der
  // Hinweis füllt die letzte Reihe.
  for (let i = 3; i < rest; i++) cells.push(`<div class="pk leer"></div>`);
  if (rest > 0) cells.push(`<div class="pk leer" style="grid-column:span ${Math.min(rest, 3)}"><div class="hint">${esc(a.leerText)}${binderArrow(u(0.085))}</div></div>`);
  const body = `<div class="slide">${binderTop(c)}
<div><span class="tab">${esc(a.tab)}</span><div class="page" style="grid-template-columns:repeat(3,1fr);border-top-left-radius:0;width:${a.width ?? "72%"}">${cells.join("")}</div></div>
<div class="mid"><div class="hint">${esc(a.hint)}${binderArrow(u(0.1), a.hintRotate ?? 0)}</div></div>
${binderFoot(c)}</div>`;
  return base(kit, w, h, body, binderCss(w, h));
}

/** Rang-Kachel: ein Fach mit Etikett „Platz 5", darunter Name, Nummer, Illustrator, Preis. */
export function binderRankHtml(kit: BrandKit, s: BinderRankSlide, w: number, h: number, c: BinderChrome, labels: { platz: string; nr: string; illu: string }): string {
  const u = (x: number) => Math.round(w * x);
  const hoch = h / w > 1.5;
  const body = `<div class="slide">${binderTop(c)}
<div class="mid" style="align-items:center"><div style="width:${hoch ? 62 : 50}%"><span class="tab">${esc(labels.platz)} ${s.rank}</span><div class="page" style="grid-template-columns:1fr;border-top-left-radius:0"><div class="pk">${s.imageDataUrl ? `<img src="${s.imageDataUrl}">` : ""}</div></div></div></div>
<div><div class="name">${esc(s.name)}</div>
<div class="daten"><span>${esc(labels.nr)} <b>${esc(s.numLine)}</b></span>${s.illustrator ? `<span>${esc(labels.illu)} <b>${esc(s.illustrator)}</b></span>` : ""}</div>
<div class="price${s.hidePrice ? " frage" : ""}">${s.hidePrice ? "? ? ?" : esc(s.price)}</div></div>
${binderFoot(c)}</div>`;
  return base(kit, w, h, body, binderCss(w, h) + `\n.pk .rk,.pk .pr{display:none}`);
}

/** Abschluss: die drei Produktseiten in Fächern, ein Satz, die Adresse. */
export function binderCtaHtml(
  kit: BrandKit,
  a: { line: string; trustLine: string; linkLabel: string; productImages: { url: string; label: string }[] },
  w: number, h: number, c: BinderChrome,
): string {
  const u = (x: number) => Math.round(w * x);
  const hoch = h / w > 1.5;
  const bilder = a.productImages.slice(0, 3);
  const kachel = bilder.length
    ? `<div class="page" style="grid-template-columns:repeat(${bilder.length},1fr);gap:${u(0.017)}px;padding:${u(0.024)}px ${u(0.02)}px ${u(0.02)}px">${bilder.map((b) => `<div><div class="pk" style="aspect-ratio:860/1160"><img src="${b.url}"></div><div class="prod">${esc(b.label)}</div></div>`).join("")}</div>`
    : "";
  const body = `<div class="slide">${binderTop(c)}
${kachel}
<div class="mid" style="gap:${u(0.02)}px"><div class="disp" style="font-size:${u(hoch ? 0.07 : a.line.length > 60 ? 0.054 : 0.06)}px;line-height:1.08">${esc(a.line)}</div>
${a.trustLine ? `<div class="sub">${esc(a.trustLine)}</div>` : ""}
<div class="hint" style="font-size:${u(0.036)}px">${esc(a.linkLabel)}${binderArrow(u(0.075), -45)}</div></div>
${binderFoot(c)}</div>`;
  return base(kit, w, h, body, binderCss(w, h) + `\n.pk::after{display:none}`);
}

/** Story und Reel-Hook: eine Zeile groß, eine Reihe Karten, ein Pfeil (Story: nach unten). */
export function binderTeaserHtml(kit: BrandKit, a: { line: string; images: string[]; hint: string; down: boolean }, w: number, h: number, c: BinderChrome): string {
  const u = (x: number) => Math.round(w * x);
  const pk = a.images.slice(0, 3).map((src) => `<div class="pk"><img src="${src}"></div>`).join("");
  const body = `<div class="slide" style="justify-content:space-between">${binderTop(c)}
<div class="disp" style="font-size:${u(a.line.length > 40 ? 0.078 : 0.09)}px">${esc(a.line)}</div>
<div class="page" style="grid-template-columns:repeat(3,1fr);transform:rotate(-3deg)">${pk}</div>
<div class="hint">${esc(a.hint)}${binderArrow(u(0.1), a.down ? 90 : 0)}</div>
${binderFoot(c)}</div>`;
  return base(kit, w, h, body, binderCss(w, h));
}

export function dataUrlFor(file: string): string | null {
  try {
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "svg" ? "image/svg+xml" : "application/octet-stream";
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch { return null; }
}
