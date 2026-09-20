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

export type PostArt = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "P" | "T" | "S" | "X";

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
  G: { name: "Binder Art", kurz: "Seiten, die als Bild funktionieren — Matching Cards und Artwork Pages", takt: "1–2 × pro Woche", farbe: "g" },
  P: { name: "Preis-Rangliste", kurz: "Top 10 / Top 20 auf der Binderseite, Spitze zuletzt einzeln", takt: "1–2 × pro Woche", farbe: "p" },
  T: { name: "Threads-Text", kurz: "Kurzer Meinungs- oder Fragebeitrag ohne Bild", takt: "nach Bedarf", farbe: "t" },
  S: { name: "Story", kurz: "Begleitet ihren Beitrag, 24 h sichtbar", takt: "zu B/C", farbe: "s" },
  X: { name: "Versuch", kurz: "Einzelbeitrag außerhalb des Katalogs", takt: "—", farbe: "x" },
};

export const POST_ART_REIHE: readonly PostArt[] = ["A", "B", "C", "D", "E", "F", "G", "P", "T", "S", "X"];

/**
 * Drehbuch → Post-Art, aus der Tabelle in Abschnitt 3a des Playbooks. Die dort
 * mit „—" geführten Drehbücher (Duell, Seitenwert, Illustrator …) sind die
 * Vorschläge aus „was dazukommen sollte" und laufen als Versuch.
 */
export const DREHBUCH_ART: Record<string, PostArt> = {
  slab: "A", starter: "A", dreissig: "A", feelinara: "G",
  bisaflor: "A", mauzigasse: "A", turtok: "A",
  neunfaecher: "F",
  pikachu: "B", preise: "B", futuristic: "B",
  aera: "C", exaera: "C",
  vintagemodern: "D", glurakduell: "D",
  farbblau: "G", farbgruen: "G",
  illustrator: "X", sugimori: "X", duell: "X", seitenwert: "X", raketen: "X", billigseite: "X",
  // Die beiden fertigen Bühnen-Formate (Playbook H und I) und die Preis-Ranglisten (J).
  "einschub-coolshit": "G",
  "einschub-harmonie1": "G", "einschub-harmonie2": "G", "einschub-harmonie3": "G", "einschub-harmonie4": "G",
  "einschub-harmonie5": "G", "einschub-harmonie6": "G", "einschub-harmonie7": "G", "einschub-harmonie8": "G",
  "einschub-kunstseite151": "G",
  "preis-set151": "P", "preis-aeraklassik": "P", "preis-illuarita": "P",
  "preis-raritysir": "P", "preis-pokeglurak": "P",
  // Content-Plan 21.09.–04.10.2026
  "preis-pokenachtara": "P", "preis-pokepikachu": "P",
  "einschub-evoli": "G", "einschub-harmonie-rot": "G", "einschub-harmonie-gold": "G", "einschub-harmonie-lila": "G",
  "duell-lugia": "D", "duell-nachtara": "D", "duell-mew": "D",
  "seitenwert-schimmernd": "X", "lugia-nachdruck-hook": "X", "karpador-hook": "X",
  "kunst-mew30": "A", "kunst-nutzer": "A", "kunst-reshizek": "A", "kunst-kirsch": "A",
};

/**
 * Die **Kategorie** eines Drehbuchs — der Name, unter dem wir das Format
 * besprechen. Die Post-Art (`DREHBUCH_ART`) sagt, in welchen Slot der Woche ein
 * Stück gehört; die Kategorie sagt, welches Layout dahintersteckt.
 *
 * Seit dem 15.09.2026 sind die drei fertigen Layouts benannt und liegen alle
 * auf derselben Bühne (`agents/video/binderbuehne.ts`):
 *
 * - **Matching Cards** — neun Karten, die farblich zusammenpassen, gleiten
 *   nacheinander in die Fächer (Playbook H).
 * - **Artwork Pages** — echte Karten zuerst, danach die gemalten Teile der
 *   Kunstseite (Playbook I).
 * - **Preis-Rangliste** — Top 10 oder Top 20, die Spitze zuletzt einzeln
 *   (Playbook J), in fünf Bereichen: Set, Ära, Illustrator, Seltenheit, Pokémon.
 */
export const DREHBUCH_KATEGORIE: Record<string, string> = {
  "einschub-coolshit": "Matching Cards",
  "einschub-harmonie1": "Matching Cards", "einschub-harmonie2": "Matching Cards",
  "einschub-harmonie3": "Matching Cards", "einschub-harmonie4": "Matching Cards",
  "einschub-harmonie5": "Matching Cards", "einschub-harmonie6": "Matching Cards",
  "einschub-harmonie7": "Matching Cards", "einschub-harmonie8": "Matching Cards",
  farbblau: "Matching Cards", farbgruen: "Matching Cards", feelinara: "Matching Cards",
  "einschub-kunstseite151": "Artwork Pages",
  turtok: "Artwork Pages", bisaflor: "Artwork Pages", mauzigasse: "Artwork Pages",
  "preis-set151": "Preis-Rangliste · Set",
  "preis-aeraklassik": "Preis-Rangliste · Ära",
  "preis-illuarita": "Preis-Rangliste · Illustrator",
  "preis-raritysir": "Preis-Rangliste · Seltenheit",
  "preis-pokeglurak": "Preis-Rangliste · Pokémon",
  "preis-pokenachtara": "Preis-Rangliste · Pokémon", "preis-pokepikachu": "Preis-Rangliste · Pokémon",
  "einschub-evoli": "Matching Cards", "einschub-harmonie-rot": "Matching Cards",
  "einschub-harmonie-gold": "Matching Cards", "einschub-harmonie-lila": "Matching Cards",
  "kunst-mew30": "Artwork Pages", "kunst-nutzer": "Artwork Pages", "kunst-reshizek": "Artwork Pages", "kunst-kirsch": "Artwork Pages",
};

/** Die Kategorie eines Stücks, falls sein Drehbuch eine hat. */
export const kategorieOf = (st: StueckFuerArt): string =>
  DREHBUCH_KATEGORIE[drehbuchOf(st)] ?? "";

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
  // Ein Stück darf seine Sorte selbst nennen. Das brauchen Beiträge ohne
  // Drehbuch und ohne Datenabfrage — ein Bildpost einer Kunstseite ist eine
  // Binderseite (A), auch wenn sein Format „image" heißt.
  if (isPostArt(st.meta["postArt"])) return st.meta["postArt"];
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

/**
 * Empfehlung je Kanal: wie oft, wann, und welche Sorte in welchen Slot.
 *
 * Die Zahlen sind eine Mischung aus Branchendaten (Stand 09/2026: Buffer,
 * Sprout Social, Hootsuite — Tue–Do, 9–12 und 18–21 Uhr Ortszeit) und der
 * Vorgabe des Betreibers, so viel zu posten, wie der Vorrat hergibt. Die
 * Branchendaten sagen für den Instagram-Feed 1–2 Beiträge am Tag; mehr senkt
 * die Reichweite **je Beitrag**, nicht zwingend die Gesamtreichweite — genau
 * das misst die Übersicht („Nach Uhrzeit"), und die Empfehlung ist danach zu
 * korrigieren. Uhrzeiten sind Europe/Berlin.
 *
 * `pflicht` ist die Sorte, die jeden Tag zur besten Stunde steht — die
 * Binderseite (A), weil sie der Grund ist, warum Leute das Werkzeug benutzen.
 * `mix` rotiert über die übrigen Slots, damit der Feed nicht viermal
 * dieselbe Sorte hintereinander zeigt.
 */
export interface KanalEmpfehlung {
  /** Beiträge je Tag, die der Kanal verträgt. */
  proTag: number;
  /** Stunden je Tag, beste zuerst — die erste bekommt die Pflicht-Sorte. */
  stunden: number[];
  pflicht: PostArt;
  /** Rotation für die übrigen Slots; `null` heißt „was da ist". */
  mix: PostArt[];
  /** Ein Satz, woher die Zahl kommt und was sie bedeutet. */
  hinweis: string;
  /** Womit die Reichweite auf diesem Kanal steigt — konkret, nicht allgemein. */
  hebel: string[];
}

export const KANAL_EMPFEHLUNG: Record<string, KanalEmpfehlung> = {
  instagram: {
    proTag: 5, stunden: [18, 9, 12, 15, 20], pflicht: "A", mix: ["B", "G", "C", "D", "B", "F", "E"],
    hinweis: "Branchendaten (Buffer 9,6 Mio. Beiträge, 09/2026): 18–21 Uhr schlägt den Morgen, Mi 12 und Do 9 sind Spitzen; 1–2 Feed-Beiträge am Tag sind das Maß, ab 3 sinkt die Reichweite je Beitrag. 5 am Tag ist die Vorgabe des Betreibers — die Gesamtreichweite je Tag entscheidet, nicht die je Beitrag.",
    hebel: ["Sends je Reichweite ist 2026 das stärkste Signal — jedes Reel endet mit einer Aufforderung zum Weiterschicken (Playbook A).", "Story zu jedem Beitrag (läuft automatisch mit).", "Erste Zeile der Caption = Hook des Videos, Keywords im Text statt in Hashtags.", "Kommentare in der ersten Stunde beantworten — Community-Radar."],
  },
  tiktok: {
    proTag: 3, stunden: [19, 12, 21], pflicht: "A", mix: ["B", "D", "G", "C", "B", "F"],
    hinweis: "TikTok verträgt 1–4 Beiträge am Tag ohne Abzug; Di–Do nachmittags/abends und Samstag sind die stärksten Fenster (Sprout Social, 2 Mrd. Interaktionen).",
    hebel: ["Kein API-Weg — Titel, Beschreibung, Hashtags und Datei liegen im Slot bereit, Status „geplant“ per Klick.", "Erste 2 Sekunden entscheiden: Hook ab 200 ms (Playbook).", "3–5 Nischen-Tags, kein #fyp.", "Samstag doppelt belegen, wenn der Vorrat reicht."],
  },
  youtube: {
    proTag: 2, stunden: [16, 12], pflicht: "A", mix: ["B", "C", "D", "G"],
    hinweis: "Shorts: 1–2 am Tag sind nachhaltig; Di–Do 14–18 Uhr sind die Spitzen (Buffer, Sprout Social, 24k Shorts).",
    hebel: ["Titel ≤ 100 Zeichen mit dem Haken, nicht dem Drehbuchnamen — liegt im Slot bereit.", "Beschreibung mit 3–5 Tags, #Shorts hilft nicht mehr.", "Endscreen/Abspann mit Adresse (steht in jedem Reel).", "Kanalzahlen laufen über den offenen Feed mit."],
  },
  threads: {
    proTag: 3, stunden: [9, 12, 18], pflicht: "T", mix: ["B", "X", "A", "T"],
    hinweis: "Threads: 1–3 am Tag, Mi/Do 9 Uhr sind die Spitzen; Antworten zählen mehr als Likes, ein Link kostet Reichweite.",
    hebel: ["Frage-Beiträge ohne Bild und ohne Link — Antworten sind das Signal.", "Community-Radar antwortet auf fremde Threads (läuft).", "Ein Topic-Tag statt Hashtags."],
  },
  facebook: {
    proTag: 2, stunden: [9, 13], pflicht: "A", mix: ["B", "C", "D", "B"],
    hinweis: "Seiten: 1–2 am Tag, 9–11 und 13–15 Uhr; mehr bringt auf Facebook nichts, die Seite lebt von Gruppen und Teilen.",
    hebel: ["Beiträge in Sammler-Gruppen teilen (von Hand — die API darf das nicht).", "Mehrbild-Beiträge statt Einzelbild.", "Höchstens zwei Hashtags."],
  },
  pinterest: {
    proTag: 3, stunden: [20, 14, 21], pflicht: "A", mix: ["B", "G", "C"],
    hinweis: "Pinterest empfiehlt 15–25 Pins am Tag — das gibt der Vorrat nicht her. 3 am Tag zu den Abend- und Wochenendspitzen sind realistisch; jede Rangliste wird ein Pin.",
    hebel: ["Beschreibung mit Suchbegriffen (Pinterest ist eine Suchmaschine).", "Hochformat 2:3, Titel im Bild.", "Kein API-Weg — Pins aus dem Slot heraus von Hand setzen."],
  },
};

/** Empfehlung für einen Kanal ohne Eintrag: zwei am Tag, Standardzeiten. */
export const STANDARD_EMPFEHLUNG: KanalEmpfehlung = { proTag: 2, stunden: [12, 18], pflicht: "A", mix: ["B", "C", "D", "G"], hinweis: "Keine kanalspezifischen Daten — zwei Beiträge am Tag zu den üblichen Spitzen.", hebel: [] };
export const kanalEmpfehlung = (platform: string): KanalEmpfehlung => KANAL_EMPFEHLUNG[platform] ?? STANDARD_EMPFEHLUNG;

export const WOCHENTAGE_MO: readonly Wochentag[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Der Slot-Vorschlag für eine Woche: je Tag `proTag` Slots, die beste Stunde
 * trägt die Pflicht-Sorte, die übrigen rotieren durch `mix` — über die ganze
 * Woche hinweg, damit nicht jeder Tag mit derselben zweiten Sorte beginnt.
 */
export function slotVorschlag(platform: string, proTag?: number): { day: Wochentag; hour: number; art: PostArt }[] {
  const e = kanalEmpfehlung(platform);
  const n = Math.max(1, Math.min(proTag ?? e.proTag, e.stunden.length));
  const out: { day: Wochentag; hour: number; art: PostArt }[] = [];
  let k = 0;
  for (const day of WOCHENTAGE_MO) {
    const stunden = e.stunden.slice(0, n);
    for (let i = 0; i < stunden.length; i++) {
      const art = i === 0 ? e.pflicht : e.mix[k++ % e.mix.length]!;
      out.push({ day, hour: stunden[i]!, art });
    }
  }
  return out.sort((a, b) => WOCHENTAGE_MO.indexOf(a.day) - WOCHENTAGE_MO.indexOf(b.day) || a.hour - b.hour);
}

export const isPostArt = (x: unknown): x is PostArt => typeof x === "string" && x in POST_ARTEN;
