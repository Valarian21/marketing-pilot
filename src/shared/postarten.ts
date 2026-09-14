/**
 * Die Post-Arten aus dem Content-Playbook (Abschnitt 4), einmal für Server und
 * Client.
 *
 * Bis zum 14.09.2026 wusste der Pilot nur das **Format** eines Stücks (Reel,
 * Carousel, Story). Welche *Sorte* Beitrag es ist — Binderseite des Tages,
 * Top-Karten eines Sets, Vintage gegen Modern — stand nur im Playbook und in
 * den Köpfen. Die Pipeline konnte deshalb nicht zeigen, ob die Woche nach dem
 * Rhythmus gefüllt ist oder ob viermal dieselbe Sorte hintereinander kommt.
 *
 * Die Zuordnung hier ist bewusst redundant zum Playbook: dort steht sie für
 * Menschen, hier für die Ansicht. Ändert sich der Katalog, ändern sich beide.
 */

export type PostArt = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "T" | "S" | "X";

export interface PostArtDef {
  /** Kurzname, wie er im Playbook steht. */
  name: string;
  /** Ein Satz, was die Sorte ist. */
  kurz: string;
  /** Wie oft laut Playbook — für die Legende. */
  takt: string;
  /** Farb-Kennung für CSS (`mp-art--a` …). */
  farbe: string;
}

export const POST_ARTEN: Record<PostArt, PostArtDef> = {
  A: { name: "Binderseite", kurz: "Binderseite des Tages — eine Kunstseite, Fahrt über die Fächer", takt: "täglich", farbe: "a" },
  B: { name: "Top-Karten Set", kurz: "Rangliste eines Sets, Preise aus Cardmarket", takt: "1–2 × pro Woche", farbe: "b" },
  C: { name: "Top-Karten Ära", kurz: "Rangliste einer ganzen Ära (WotC, EX, HGSS …)", takt: "1 × pro Woche", farbe: "c" },
  D: { name: "Vintage vs. Modern", kurz: "Zwei Karten desselben Pokémon, Preis gegen Preis", takt: "1 × pro Woche", farbe: "d" },
  E: { name: "Sets der Woche", kurz: "Stärkstes und schwächstes Set der letzten sieben Tage", takt: "1 × pro Woche, fester Tag", farbe: "e" },
  F: { name: "Werkzeug", kurz: "Eigenwerbung: wie eine Seite entsteht", takt: "höchstens 1 von 7", farbe: "f" },
  G: { name: "Farbseite", kurz: "Neun Karten, die farblich zusammenpassen", takt: "1–2 × pro Woche", farbe: "g" },
  T: { name: "Threads-Text", kurz: "Kurzer Meinungs- oder Fragebeitrag ohne Bild", takt: "nach Bedarf", farbe: "t" },
  S: { name: "Story", kurz: "Begleitet ihren Beitrag, 24 h sichtbar", takt: "zu B/C", farbe: "s" },
  X: { name: "Versuch", kurz: "Einzelbeitrag außerhalb des Katalogs", takt: "—", farbe: "x" },
};

export const POST_ART_REIHE: readonly PostArt[] = ["A", "B", "C", "D", "E", "F", "G", "T", "S", "X"];

/**
 * Drehbuch → Post-Art, aus der Tabelle in Abschnitt 3a des Playbooks. Die dort
 * mit „—" geführten Drehbücher (Duell, Seitenwert, Illustrator …) sind die
 * Vorschläge aus „was dazukommen sollte" und laufen als Versuch.
 */
export const DREHBUCH_ART: Record<string, PostArt> = {
  slab: "A", starter: "A", dreissig: "A", feelinara: "G",
  neunfaecher: "F",
  pikachu: "B", preise: "B", futuristic: "B",
  aera: "C", exaera: "C",
  vintagemodern: "D", glurakduell: "D",
  farbblau: "G", farbgruen: "G",
  illustrator: "X", sugimori: "X", duell: "X", seitenwert: "X", raketen: "X", billigseite: "X",
};

/** Was ein Stück über sich weiß — mehr braucht die Zuordnung nicht. */
export interface StueckFuerArt {
  format: string;
  meta: Record<string, unknown>;
}

/**
 * Die Post-Art eines Stücks. Drehbuch schlägt alles; sonst entscheiden Format
 * und Datenabfrage. `X` heißt: nicht zuzuordnen — sichtbar als Versuch, damit
 * die Lücke auffällt und nicht als „A" durchgeht.
 */
export function postArtOf(st: StueckFuerArt): PostArt {
  const drehbuch = typeof st.meta["drehbuch"] === "string" ? st.meta["drehbuch"] : "";
  if (drehbuch && DREHBUCH_ART[drehbuch]) return DREHBUCH_ART[drehbuch]!;
  if (st.format === "story") return "S";
  if (st.format === "artwork_reel" || st.format === "artwork_carousel") return "A";
  if (st.format === "data_reel" || st.format === "data_carousel") {
    const q = (st.meta["dataQuery"] ?? {}) as { kind?: string; era?: string; set?: string; illustrator?: string };
    if (q.kind === "movers") return "E";
    if (q.era) return "C";
    if (q.set) return "B";
    return "X";
  }
  if (st.format === "text") return "T";
  if (st.format === "showcase_carousel") return "F";
  return "X";
}

/** Das Drehbuch eines Stücks, falls es eines hat. */
export const drehbuchOf = (st: StueckFuerArt): string => (typeof st.meta["drehbuch"] === "string" ? st.meta["drehbuch"] : "");

export type Wochentag = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * Der Wochenrhythmus aus dem Playbook: je Tag die Pflicht und das, was dazu
 * kommt. „Duell oder Sammler-Fehler" am Mittwoch hat keine eigene Sorte im
 * Katalog und läuft als Versuch (`X`).
 */
export const WOCHENRHYTHMUS: Record<Wochentag, { pflicht: PostArt[]; dazu: PostArt[] }> = {
  mon: { pflicht: ["A"], dazu: ["E"] },
  tue: { pflicht: ["A"], dazu: ["B"] },
  wed: { pflicht: ["A"], dazu: ["X"] },
  thu: { pflicht: ["A"], dazu: ["C"] },
  fri: { pflicht: ["A"], dazu: ["D"] },
  sat: { pflicht: ["A"], dazu: ["B", "X"] },
  sun: { pflicht: ["A"], dazu: ["F"] },
};

const WOCHENTAGE: readonly Wochentag[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** Wochentag eines ISO-Datums (`2026-09-14`), ohne Zeitzonen-Sprünge: Mittag UTC. */
export const wochentagOf = (date: string): Wochentag => WOCHENTAGE[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
