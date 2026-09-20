/**
 * Die Binderseite als Bühne — das gemeinsame Grundlayout aller Seiten-Reels.
 *
 * Seit dem 15.09.2026 ist das der feste Aufbau: dunkles Kunstleder, eine
 * durchsichtige Hülle mit Lochleiste, neun Taschen, ein Glanz über der ganzen
 * Folie, und der Text **unter** der Seite. Zwei Formate bauen darauf auf
 * (`docs/CONTENT_PLAYBOOK.md`, Abschnitte H und I), die Preis-Ranglisten
 * kommen als drittes dazu. Damit alle drei dieselbe Seite zeigen, steht die
 * Geometrie hier und nicht dreimal in den Skripten.
 *
 * Nicht verhandelbar, weil jeder Punkt einmal falsch gebaut wurde:
 *
 * - **Die Taschen sind seitlich offen, nicht oben.** Aus oben offenen Hüllen
 *   fallen die Karten, sobald der Binder senkrecht steht. Linke und mittlere
 *   Spalte nehmen die Karte **von rechts**, die rechte **von links**
 *   (`OEFFNUNG`) — die Öffnungen zeigen zur Seitenmitte.
 * - **Kein Streifen an der Öffnungskante.** Er lag nach dem Einschieben über
 *   dem Kartenrand; das Beschneiden während der Fahrt leistet das Fach durch
 *   `overflow: hidden` allein.
 * - **Keine Ringe.** Die Lochreihe sitzt in der linken Randleiste der Hülle.
 * - **Ein Fach ist 63 von 67 mm breit**, nicht ein Drittel der Seite — wer
 *   stumpf drittelt, staucht die Karte um 1,2 % (`blattMasse`).
 */
import { blattMasse } from "../studio/blatt.js";
import { fontHead } from "../studio/fonts.js";

export const W = 1080, H = 1920;

/**
 * Blattbreite und oberer Rand.
 *
 * Die Hülle ist mit Rand und Lochleiste 936 px breit und sitzt damit mittig:
 * links wie rechts bleiben 72 px zum Bildrand. Bei 860 px Blattbreite ist die
 * Seite 1.187 px hoch und endet bei 1.409 — die Textzeile beginnt bei 1.450,
 * also ohne Überschneidung.
 */
export const SEITE_B = 860, SEITE_Y = 200;
export const MASSE = blattMasse(SEITE_B);

/** Aus welcher Richtung die Karte in ihr Fach fährt, je Spalte. */
export const OEFFNUNG: ("links" | "rechts")[] = ["rechts", "rechts", "links"];

/** Oberkante der Textzeile — dort sitzt auch die Folgen-Pille. */
export const TEXT_OBEN = SEITE_Y + MASSE.hoehe + 22 + 54;

export const px = (n: number) => `${n.toFixed(2)}px`;

export interface Fach {
  /** Bildquelle als CSS (`url(...)` samt eventuellem Zuschnitt) oder leer für eine leere Tasche. */
  bild: string;
  /** Wann die Karte in dieses Fach fährt. `null` heißt: liegt von Anfang an drin. */
  abMs: number | null;
  /** Preisschild unten rechts im Fach. */
  preis?: string;
  /** Platzziffer oben links — für die Ranglisten. */
  rang?: number;
  /** Teil einer Kunstseite: flacherer Schatten, damit die Teile als ein Bild lesen. */
  kunst?: boolean;
}

export interface BuehnenWahl {
  /** Wie lange eine Karte zum Einfahren braucht. */
  einschubMs?: number;
  /** Farbe der Platzziffer. */
  akzent?: string;
}

/**
 * Das Bild einer Kunstseite für Fach `i` — Blattgröße hinter das Fach gelegt
 * und um die Fachposition verschoben.
 *
 * Die gespeicherte Kunstseite zeigt genau die Blattfläche, und `artwork.py`
 * rechnet dort mit denselben 63 × 88 mm und 4 mm Naht wie `blattMasse`.
 * Deshalb passt der Ausschnitt auf den Pixel, ohne ein Bildwerkzeug.
 */
export function kunstAusschnitt(url: string, fach: number): string {
  const spalte = fach % 3, zeile = Math.floor(fach / 3);
  return `background-image:url('${url}');background-size:${px(SEITE_B)} ${px(MASSE.hoehe)};`
    + `background-position:-${px(spalte * (MASSE.fachB + MASSE.fuge))} -${px(zeile * (MASSE.fachH + MASSE.fuge))}`;
}

/**
 * Eine Binderseite als vollständige HTML-Datei.
 *
 * Die Karten stehen als pausierte CSS-Animation drin: Wer ein Einzelbild zu
 * einem bestimmten Zeitpunkt braucht, setzt `animation-delay` auf den
 * negativen Zeitwert. So entsteht jeder Frame pixelgenau, statt eine laufende
 * Animation abzufilmen (die Bildschirmaufnahme lieferte 1,6 Mbit/s, und das
 * sah man an den Kartentexten).
 */
export function seiteHtml(faecher: Fach[], wahl: BuehnenWahl = {}): string {
  const einschubMs = wahl.einschubMs ?? 620;
  const akzent = wahl.akzent ?? "#F5C518";
  const inhalt = faecher.map((f, i) => {
    const von = OEFFNUNG[i % 3]!;
    if (!f.bild) return `<div class="fach"></div>`;
    // `abMs === null` heißt: die Karte liegt schon drin — keine Animation.
    const lauf = f.abMs === null ? "animation:none;transform:none" : `animation-delay:${f.abMs}ms`;
    return `<div class="fach">
      <div class="karte ${von}${f.kunst ? " kunst" : ""}" style="${f.bild};${lauf}">
        ${f.rang ? `<span class="rang">${f.rang}</span>` : ""}
        ${f.preis ? `<span class="preis">${f.preis}</span>` : ""}
      </div>
    </div>`;
  }).join("");

  /** Die Hülle steht ringsum etwas über die Fächer hinaus — wie das Schweißband einer echten Seite. */
  const rand = 22;
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:#0E1013;overflow:hidden}

    /* --- Der Binder: dunkles Kunstleder mit Naht und Vignette ------------- */
    .leder{position:absolute;inset:0;background:
      radial-gradient(ellipse 72% 46% at 50% 32%, #33405E 0%, #1E2536 52%, #0E1116 100%)}
    /* Feine Körnung, damit die Fläche nicht wie eine Farbfüllung wirkt. */
    .korn{position:absolute;inset:0;opacity:.5;background-image:
      repeating-linear-gradient(48deg, rgba(255,255,255,.028) 0 2px, transparent 2px 5px),
      repeating-linear-gradient(-42deg, rgba(0,0,0,.05) 0 3px, transparent 3px 7px)}

    /* --- Die Hülle ------------------------------------------------------- */
    /* Links eine breitere Leiste für die Lochreihe — wie bei einer echten Hülle
       liegen die Löcher außerhalb der Taschen. */
    .huelle{z-index:2;position:absolute;left:${px((W - (SEITE_B + rand * 2 + 32)) / 2)};top:${px(SEITE_Y - rand)};
      width:${px(SEITE_B + rand * 2 + 32)};height:${px(MASSE.hoehe + rand * 2)};
      border-radius:14px;padding:${rand}px ${rand}px ${rand}px ${rand + 32}px;
      background:linear-gradient(160deg, rgba(232,238,248,.26), rgba(170,185,205,.12) 40%, rgba(232,238,248,.22));
      box-shadow:0 30px 70px rgba(0,0,0,.65), inset 0 0 0 1.5px rgba(255,255,255,.34)}
    /* Die Lochreihe der Seite — sitzt im Rand, nicht in den Fächern. */
    .loecher{position:absolute;left:14px;top:0;bottom:0;width:30px;display:flex;flex-direction:column;
      justify-content:space-around;align-items:center;padding:${px(MASSE.hoehe * 0.08)} 0;z-index:2}
    .loch{width:22px;height:46px;border-radius:11px;background:#0D1016;
      box-shadow:inset 0 3px 6px rgba(0,0,0,.85), 0 1px 0 rgba(255,255,255,.18)}

    .blatt{position:relative;width:${px(SEITE_B)};height:${px(MASSE.hoehe)};display:grid;
      grid-template-columns:repeat(3,${px(MASSE.fachB)});grid-template-rows:repeat(3,${px(MASSE.fachH)});gap:${px(MASSE.fuge)}}

    /* Ein Fach ist die Tasche: schneidet die Karte ab, solange sie draußen ist. */
    /* Eine leere Tasche zeigt die Innenseite des Binders durch den Kunststoff —
       dunkel, aber nicht schwarz, mit einem Schimmer auf der Folie. */
    .fach{position:relative;overflow:hidden;border-radius:6px;
      background:linear-gradient(152deg,#2B3345 0%,#1C2231 58%,#151A26 100%);
      box-shadow:inset 0 0 0 1.4px rgba(255,255,255,.22), inset 0 12px 30px rgba(0,0,0,.5)}
    /* Pausierte Animation mit negativer Verzögerung zeigt exakt den Zustand zum
       gewünschten Zeitpunkt — so entsteht jedes Einzelbild pixelgenau, statt
       eine laufende Animation abzufilmen. */
    .karte{position:absolute;inset:0;background-size:100% 100%;background-position:center;
      border-radius:4px;box-shadow:0 8px 20px rgba(0,0,0,.6);
      animation:var(--rein) ${einschubMs}ms cubic-bezier(.22,.9,.24,1.06) forwards;
      animation-play-state:paused}
    /* Ein Papierteil ist dünner als eine Karte — flacherer Schatten, damit die
       Teile am Ende wie ein durchgehendes Bild wirken. */
    .karte.kunst{box-shadow:0 3px 9px rgba(0,0,0,.42);border-radius:3px}
    .karte.links{--rein:reinLinks;transform:translateX(-116%)}
    .karte.rechts{--rein:reinRechts;transform:translateX(116%)}
    @keyframes reinLinks{from{transform:translateX(-116%)}to{transform:translateX(0)}}
    @keyframes reinRechts{from{transform:translateX(116%)}to{transform:translateX(0)}}

    .preis{position:absolute;right:4%;bottom:4%;z-index:2;
      font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:26px;color:#fff;
      background:#14161C;border-radius:3px;padding:.16em .42em;
      box-shadow:0 3px 12px rgba(0,0,0,.55), inset 0 0 0 1.5px #2A4B9B}
    /* Die Platzziffer sitzt **unten links**, gegenüber dem Preis — oben links
       stünde sie auf dem Kartennamen, und den will man lesen können. Unten
       verdeckt sie nur die Zeile mit Zeichner und Copyright. */
    .rang{position:absolute;left:4%;bottom:4%;z-index:2;min-width:1.55em;text-align:center;
      font-family:Bungee,Archivo,system-ui,sans-serif;font-size:26px;line-height:1.34;
      color:#14161C;background:${akzent};border-radius:3px;padding:0 .16em;
      box-shadow:0 3px 12px rgba(0,0,0,.5), inset 0 0 0 1.5px rgba(20,22,28,.55)}

    /* Der Glanz läuft über die ganze Hülle, nicht je Fach — genau daran erkennt
       man eine durchgehende Folie statt neun einzelner Rahmen. */
    .glanz{position:absolute;inset:0;z-index:5;pointer-events:none;border-radius:14px;
      background:linear-gradient(112deg,
        rgba(255,255,255,0) 0%, rgba(255,255,255,.10) 17%, rgba(255,255,255,.02) 26%,
        rgba(255,255,255,0) 46%, rgba(255,255,255,.07) 72%, rgba(255,255,255,.015) 80%,
        rgba(255,255,255,0) 100%)}
  </style></head><body>
    <div class="leder"></div><div class="korn"></div>
    <div class="huelle">
      <div class="loecher">${Array.from({ length: 6 }, () => '<div class="loch"></div>').join("")}</div>
      <div class="blatt">${inhalt}</div>
      <div class="glanz"></div>
    </div>
  </body></html>`;
}

/**
 * Textzeile **unter** der Binderseite, in einer Größe für alle Zeilen.
 *
 * Die Seite endet bei rund 1.409 px; der Text setzt darunter an, statt über das
 * Blatt zu laufen. Und er ist überall gleich groß — ein größerer Einstieg sieht
 * neben den folgenden Zeilen aus wie ein Fehler, sobald beide unter demselben
 * Bild stehen.
 *
 * Die Schrift schrumpft, wenn eine Zeile sonst umbrechen würde: Zwischen den
 * Rändern liegen 896 px, Archivo 800 braucht rund 0,55 der Schriftgröße je
 * Zeichen. Ohne das muss jeder Text von Hand abgezählt werden.
 */
export function textHtml(zeigRoh: string, akzent: string, obenPx = TEXT_OBEN): string {
  // Ein wörtliches „\\n" im Drehbuch (doppelt escapt) stand am 19.09.2026 in acht
  // Harmonie-Reels sichtbar im Bild: „Farben, die harmonieren.\\nAus 8 Sets."
  // Hier wird es zum Umbruch — und gemeldet, damit das Drehbuch berichtigt wird.
  const zeig = zeigRoh.includes("\\n") ? zeigRoh.replace(/\\n/g, "\n") : zeigRoh;
  if (zeig !== zeigRoh) console.warn(`textHtml: wörtliches \\n im Drehbuchtext ersetzt: ${JSON.stringify(zeigRoh)}`);
  const breit = W - 88 - 96;
  const laengste = Math.max(...zeig.split("\n").map((z) => z.length), 1);
  const groesse = Math.min(64, Math.floor(breit / (laengste * 0.55)));
  const zeilen = zeig.split("\n").map((z) => `<span>${z}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .flaeche{position:absolute;left:88px;right:96px;top:${obenPx}px;display:flex;flex-direction:column}
    .text{display:flex;flex-direction:column;gap:8px;
      font-family:'Archivo',system-ui,sans-serif;font-weight:800;
      font-size:${groesse}px;line-height:1.18;color:#fff;
      text-shadow:0 3px 18px rgba(0,0,0,.75)}
    .strich{width:96px;height:9px;background:${akzent};margin-bottom:22px}
  </style></head><body>
    <div class="flaeche"><div class="strich"></div><div class="text">${zeilen}</div></div>
  </body></html>`;
}

/**
 * Eine einzelne Karte, groß und mittig — der Schluss jeder Preis-Rangliste.
 *
 * Die Seite zeigt neun Karten gleich groß; Platz 1 bekommt deshalb ein eigenes
 * Bild, sonst ist die Spitze nur das zehnte Fach. Der Hintergrund bleibt
 * derselbe Binder, damit der Schnitt nicht wie ein anderes Video aussieht.
 *
 * Die Karte liegt mit 640 px Breite bei 393 px und endet bei 1.287 — also über
 * der Textzeile (1.463) und damit ohne Überschneidung.
 */
export function einzelHtml(
  bild: string,
  wahl: { preis?: string; rang?: number; name?: string; akzent?: string; einschubMs?: number } = {},
): string {
  const akzent = wahl.akzent ?? "#F5C518";
  const breite = 640, hoehe = breite * 88 / 63;
  const oben = 393;
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:#0E1013;overflow:hidden}
    .leder{position:absolute;inset:0;background:
      radial-gradient(ellipse 72% 46% at 50% 32%, #33405E 0%, #1E2536 52%, #0E1116 100%)}
    .korn{position:absolute;inset:0;opacity:.5;background-image:
      repeating-linear-gradient(48deg, rgba(255,255,255,.028) 0 2px, transparent 2px 5px),
      repeating-linear-gradient(-42deg, rgba(0,0,0,.05) 0 3px, transparent 3px 7px)}
    /* Ein Schein hinter der Karte hebt sie aus der Fläche, ohne einen Rahmen zu
       brauchen — ein Rahmen sähe nach Fach aus, und das ist hier gerade nicht. */
    .schein{position:absolute;left:50%;top:${px(oben + hoehe * 0.42)};width:1100px;height:1100px;
      transform:translate(-50%,-50%);border-radius:50%;
      background:radial-gradient(circle, ${akzent}22 0%, transparent 62%)}
    .karte{position:absolute;left:${px((W - breite) / 2)};top:${px(oben)};
      width:${px(breite)};height:${px(hoehe)};border-radius:12px;
      background-size:100% 100%;box-shadow:0 26px 70px rgba(0,0,0,.72);
      animation:auflegen ${wahl.einschubMs ?? 640}ms cubic-bezier(.2,.86,.26,1.04) forwards;
      animation-play-state:paused;opacity:0;transform:translateY(64px) scale(.93)}
    @keyframes auflegen{from{opacity:0;transform:translateY(64px) scale(.93)}
      to{opacity:1;transform:translateY(0) scale(1)}}
    .rang{position:absolute;left:4%;bottom:3.4%;z-index:2;min-width:1.55em;text-align:center;
      font-family:Bungee,Archivo,system-ui,sans-serif;font-size:52px;line-height:1.34;
      color:#14161C;background:${akzent};border-radius:7px;padding:0 .18em;
      box-shadow:0 5px 20px rgba(0,0,0,.55), inset 0 0 0 2px rgba(20,22,28,.55)}
    .preis{position:absolute;right:4%;bottom:3.4%;z-index:2;
      font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:52px;color:#fff;
      background:#14161C;border-radius:6px;padding:.14em .4em;
      box-shadow:0 5px 22px rgba(0,0,0,.6), inset 0 0 0 2px #2A4B9B}
  </style></head><body>
    <div class="leder"></div><div class="korn"></div><div class="schein"></div>
    <div class="karte" style="background-image:url('${bild}')">
      ${wahl.rang ? `<span class="rang">${wahl.rang}</span>` : ""}
      ${wahl.preis ? `<span class="preis">${wahl.preis}</span>` : ""}
    </div>
  </body></html>`;
}
