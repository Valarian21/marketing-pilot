/**
 * Der Folgen-Hinweis im Reel: eine Pille mit Zeichen, Handle und Aufforderung.
 *
 * Bis zum 15.09.2026 zeigte ein Pfeil auf den Folgen-Knopf der jeweiligen App.
 * Die Idee trug nicht: Wo dieser Knopf vertikal sitzt, ist bei TikTok und
 * YouTube nirgends dokumentiert und ändert sich mit jeder App-Version — der
 * Pfeil zeigte dort erkennbar daneben. Ein Hinweis, der auf nichts zeigt,
 * sondern für sich steht, funktioniert überall gleich und hat nebenbei einen
 * Vorteil: Das Video ist für alle Kanäle dasselbe.
 *
 * Benutzt von allen drei Bauwegen (`reel-binder.ts`, `reel-tool.ts`,
 * `reel-einschub.ts`) und von `reel-plattformen.ts`.
 */
import { fontHead } from "../studio/fonts.js";

const W = 1080, H = 1920;
/** Das Konto, auf allen Kanälen gleich geschrieben. */
export const HANDLE = "binderplan.app";
/** Wie lange der Hinweis steht — lang genug zum Lesen, kurz genug, um nicht zu stören. */
export const FOLGEN_MS = 2600;

export type Plattform = "instagram" | "tiktok" | "shorts";
/** Der Kanal, unter dem das Stück im Pilot liegt — Shorts laufen dort unter „youtube". */
export const KANAL: Record<Plattform, string> = { instagram: "instagram", tiktok: "tiktok", shorts: "youtube" };

/**
 * Wo die Pille sitzt.
 *
 * Seit sie auf nichts mehr zeigt, ist die Stelle für alle Kanäle dieselbe:
 * links unten, oberhalb der Zone, die TikTok und Instagram für ihre eigenen
 * Beschreibungen belegen (die unteren rund 400 px). `versatzY` schiebt sie
 * dorthin, wo ein Format seinen Text führt.
 */
export const PILLE_Y = 1318;
export const SITZE: Record<Plattform, { untenLinks: boolean }> = {
  instagram: { untenLinks: true },
  tiktok: { untenLinks: true },
  shorts: { untenLinks: true },
};

/**
 * Die Pille: Zeichen, Handle, Aufforderung.
 *
 * `versatzY` schiebt sie nach unten — Formate, deren Text unter dem Bild steht,
 * setzen sie an dieselbe Stelle.
 */
export function folgenHtml(akzent: string, _plattform: Plattform, versatzY = 0): string {
  const top = PILLE_Y + versatzY;
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .reihe{position:absolute;left:88px;top:${top}px;display:flex;align-items:center;gap:18px;
           background:rgba(20,22,28,.92);border-radius:999px;padding:14px 32px 14px 16px;
           box-shadow:0 12px 36px rgba(0,0,0,.55)}
    /* Das Binderplan-Zeichen: neun Felder, drei davon farbig — wie im Logo. */
    .zeichen{width:56px;height:56px;border-radius:13px;background:${akzent};border:3px solid #14161C;
             display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:2px;padding:5px;
             flex:0 0 auto}
    .zeichen i{background:${akzent};box-shadow:inset 0 0 0 1.4px #14161C}
    .zeichen i:nth-child(1),.zeichen i:nth-child(5){background:#2A4B9B}
    .zeichen i:nth-child(3){background:#D4342A}
    .texte{display:flex;flex-direction:column;gap:2px}
    .handle{font-family:'Archivo',system-ui,sans-serif;font-weight:800;font-size:37px;color:#fff;letter-spacing:-.01em}
    .dazu{font-family:'Archivo',system-ui,sans-serif;font-weight:600;font-size:25px;color:${akzent};letter-spacing:.01em}
  </style></head><body>
    <div class="reihe">
      <div class="zeichen"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="texte">
        <span class="handle">@${HANDLE}</span>
        <span class="dazu">folgen für mehr Seiten</span>
      </div>
    </div>
  </body></html>`;
}

/**
 * Wo im Stück die Pille läuft — und welche Zeile dafür weicht.
 *
 * Bis zum 15.09.2026 kam der Hinweis **nach** der letzten Textzeile und damit
 * direkt vor dem Abspann. Das las sich wie zweimal Werbung hintereinander:
 * erst „folge uns", dann die Adresse. Seither sitzt er mitten im Stück, und
 * nach ihm kommt noch Inhalt.
 *
 * Pille und Text stehen an derselben Stelle unter der Seite, dürfen sich also
 * nie überlagern. Zwei Fälle:
 *
 * - **Ohne `vorIndex`** läuft die Pille vor der Schlusszeile, und die Lücke
 *   wird aufgemacht: Die vorletzte Zeile endet früher, die Schlusszeile rückt
 *   nach hinten. Das verlängert das Stück um wenige Sekunden.
 * - **Mit `vorIndex`** sagt das Drehbuch, vor welcher Zeile die Pille gehört —
 *   dort, wo das Stück ohnehin Luft holt. Dann wird nichts verschoben: Die
 *   Lücke muss reichen, sonst stimmt die Dramaturgie nicht und der Bau bricht
 *   ab. Verschöbe man eine Zeile mitten im Stück, liefe sie aus ihrer Szene
 *   heraus.
 *
 * @param zeilen  Beginn jeder Textzeile in Millisekunden, aufsteigend.
 * @param vorIndex  Zeile, vor der die Pille laufen soll. Vorgabe: die letzte.
 */
export function folgenFenster(zeilen: number[], vorIndex?: number): {
  startMs: number; endMs: number;
  /** Diese Zeile endet früher — dort macht die Pille Platz. */
  kuerzeIndex: number;
  kuerzeEndeMs: number;
  /** Diese Zeile beginnt später (nur ohne `vorIndex`). */
  verschiebeIndex: number | null;
  verschiebeAufMs: number;
} {
  const LUFT = 150;
  /** So lange muss die Zeile davor mindestens stehen, sonst liest sie niemand. */
  const MINDESTZEILE = 2300;
  if (zeilen.length < 2) {
    const startMs = (zeilen[0] ?? 0) + MINDESTZEILE + LUFT;
    return { startMs, endMs: startMs + FOLGEN_MS, kuerzeIndex: 0, kuerzeEndeMs: startMs - LUFT,
      verschiebeIndex: null, verschiebeAufMs: 0 };
  }
  if (vorIndex === undefined) {
    const vorletzte = zeilen[zeilen.length - 2]!, letzte = zeilen[zeilen.length - 1]!;
    const startMs = vorletzte + MINDESTZEILE + LUFT;
    const endMs = startMs + FOLGEN_MS;
    return { startMs, endMs, kuerzeIndex: zeilen.length - 2, kuerzeEndeMs: startMs - LUFT,
      verschiebeIndex: zeilen.length - 1, verschiebeAufMs: Math.max(letzte, endMs + LUFT) };
  }
  const ziel = zeilen[vorIndex];
  const davor = zeilen[vorIndex - 1];
  if (ziel === undefined || davor === undefined) throw new Error(`Pillenplatz ${vorIndex} gibt es nicht.`);
  const endMs = ziel - LUFT;
  const startMs = endMs - FOLGEN_MS;
  const bleibt = startMs - LUFT - davor;
  if (bleibt < MINDESTZEILE) {
    throw new Error(
      `Vor Zeile ${vorIndex} ist zu wenig Platz für die Pille: ${Math.round(bleibt)} ms für die Zeile davor, ` +
      `nötig sind ${MINDESTZEILE}. Textzeile früher setzen oder einen anderen Platz wählen.`);
  }
  return { startMs, endMs, kuerzeIndex: vorIndex - 1, kuerzeEndeMs: startMs - LUFT,
    verschiebeIndex: null, verschiebeAufMs: 0 };
}
