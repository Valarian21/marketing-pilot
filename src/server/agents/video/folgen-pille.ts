/**
 * Der Folgen-Hinweis im Reel: Pille mit Handle und Knopf, dazu ein Pfeil auf den
 * echten Folgen-Knopf der jeweiligen App.
 *
 * Steht als eigenes Modul, weil zwei Wege ihn brauchen: `reel-binder.ts` baut
 * ihn beim Rendern ein, `reel-plattformen.ts` legt ihn nachträglich auf ein
 * fertiges Reel. Der zweite Weg spart pro Fassung rund vier Minuten — das Reel
 * selbst wird nur einmal gerechnet.
 */
import { fontHead } from "../studio/fonts.js";

const W = 1080, H = 1920;
/** Das Konto, auf allen Kanälen gleich geschrieben. */
export const HANDLE = "binderplan.app";
/** Wie lange der Hinweis steht — lang genug zum Lesen, kurz genug, um nicht zu stören. */
export const FOLGEN_MS = 2600;
/** Der Kanal, unter dem das Stück im Pilot liegt — Shorts laufen dort unter „youtube". */
export const KANAL: Record<Plattform, string> = { instagram: "instagram", tiktok: "tiktok", shorts: "youtube" };

/**
 * Wo die Plattform ihren eigenen Folgen-Knopf hat — darauf zeigt der Pfeil.
 *
 * **Die Werte sind am Bild geschätzt, nicht am Gerät gemessen.** Sie
 * verschieben sich mit App-Version, Geräteformat und Safe-Area; wer ein
 * Muster gegen einen echten Screenshot hält, korrigiert sie hier. Gemeint ist
 * jeweils, wo der Knopf im 1080 × 1920-Bild läge:
 *
 * - **Instagram** und **Shorts** setzen die Autorzeile samt „Folgen"/„Abonnieren"
 *   unten links über die Beschreibung — Ziel rund (400, 1600).
 * - **TikTok** hängt das Profilbild mit dem roten Plus in die Aktionsspalte
 *   rechts, etwa auf halber Höhe — Ziel rund (1010, 960).
 *
 * Daraus folgt die Anordnung: Bei Instagram und Shorts steht die Pille unten
 * links da, wo sonst der Satz steht (der Clip-Text weicht ihr, siehe Montage),
 * und der Pfeil geht nach unten. Bei TikTok steht sie rechts über der
 * Aktionsspalte, der Pfeil zeigt hinunter auf das Profilbild.
 */
export type Plattform = "instagram" | "tiktok" | "shorts";

export interface Sitz {
  /** Position der Pille im Bild. */
  pille: string;
  /** Rahmen des Pfeil-SVG und sein Pfad darin. */
  pfeil: { stil: string; b: number; h: number; d: string };
  /** Steht die Pille da, wo der Satz steht? Dann weicht der Satz. */
  untenLinks: boolean;
}

export const SITZE: Record<Plattform, Sitz> = {
  instagram: {
    pille: "left:88px;top:1318px",
    pfeil: { stil: "left:150px;top:1420px", b: 320, h: 210, d: "M56,8 Q34,120 196,168" },
    untenLinks: true,
  },
  shorts: {
    pille: "left:88px;top:1318px",
    pfeil: { stil: "left:150px;top:1420px", b: 380, h: 210, d: "M56,8 Q40,130 268,170" },
    untenLinks: true,
  },
  tiktok: {
    pille: "right:96px;top:742px",
    pfeil: { stil: "left:856px;top:846px", b: 210, h: 170, d: "M44,10 Q136,34 152,118" },
    untenLinks: false,
  },
};

/**
 * Der Folgen-Hinweis: Handle, Knopf und ein Pfeil auf den echten Knopf der App.
 *
 * Die Form ist der Plattform abgeschaut, weil sie dort gelernt ist: Wer einen
 * gelben „Folgen"-Knopf neben einem Handle sieht, weiß ohne Lesen, was gemeint
 * ist. Der Handle steht mit, damit das Reel auch dann zum Konto führt, wenn es
 * weitergeschickt oder abgefilmt wird.
 */
export function folgenHtml(akzent: string, plattform: Plattform): string {
  const sitz = SITZE[plattform];
  const { stil, b, h, d } = sitz.pfeil;
  return `<!doctype html><html><head><meta charset="utf-8">${fontHead()}<style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;background:transparent}
    .pille{position:absolute;${sitz.pille};display:flex;align-items:center;gap:20px;
           background:rgba(20,22,28,.92);border-radius:999px;padding:14px 14px 14px 34px;
           box-shadow:0 10px 34px rgba(0,0,0,.5)}
    .handle{font-family:'Archivo',system-ui,sans-serif;font-weight:700;font-size:38px;color:#fff;letter-spacing:-.01em}
    .knopf{font-family:'Archivo',system-ui,sans-serif;font-weight:800;font-size:34px;color:#14161C;
           background:${akzent};border-radius:999px;padding:14px 30px}
    .pfeil{position:absolute;${stil}}
  </style></head><body>
    <div class="pille"><span class="handle">@${HANDLE}</span><span class="knopf">Folgen</span></div>
    <svg class="pfeil" width="${b}" height="${h}" viewBox="0 0 ${b} ${h}" fill="none">
      <defs>
        <marker id="spitze" viewBox="0 0 12 12" refX="8" refY="6" markerWidth="5.4" markerHeight="5.4" orient="auto-start-reverse">
          <path d="M1,1 L11,6 L1,11 z" fill="${akzent}"/>
        </marker>
      </defs>
      <path d="${d}" stroke="${akzent}" stroke-width="13" stroke-linecap="round"
            marker-end="url(#spitze)" style="filter:drop-shadow(0 3px 10px rgba(0,0,0,.7))"/>
    </svg>
  </body></html>`;
}
