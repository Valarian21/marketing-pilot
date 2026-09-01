/**
 * Direktes Veröffentlichen (Shot 10).
 *
 * Ein `PlatformPoster` postet **einen** freigegebenen Beitrag auf **einer**
 * Plattform. Was er dafür braucht, steht im Kanal-Profil des Projekts, nicht in
 * der `.env` — der Pilot bedient mehrere Produkte, und jedes hat eigene Konten.
 *
 * Die Hausregel aus V1 bleibt unangetastet: Reddit, Foren und Discord haben
 * keinen Code-Pfad, der postet. Das ist in `PLATFORM_POSTING` als `blocked`
 * hinterlegt und wird von `posterFor` erzwungen.
 */
export interface PostAsset {
  /** Absoluter Pfad auf der Platte. */
  path: string;
  /** Öffentlich erreichbare, ablaufende URL — nur Meta braucht die. */
  url: string;
  mime: string;
  alt: string;
  kind: "image" | "video";
}

export interface PostInput {
  platform: string;
  text: string;
  assets: PostAsset[];
  /** Kurzlink des Stücks, falls die Plattform Links im Text erlaubt. */
  link: string | null;
  /** Reine Bildbeiträge brauchen auf manchen Plattformen einen Titel. */
  title: string;
  creds: Record<string, string>;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
}

export interface PostOutput {
  /** Referenz der Plattform (Post-ID, AT-URI, Message-ID) — daran hängt das Löschen. */
  ref: string;
  externalUrl: string | null;
}

export interface PlatformPoster {
  readonly platform: string;
  /** Fehlende Zugangsdaten nennen, statt beim Posten zu scheitern. */
  missing(creds: Record<string, string>): string[];
  post(input: PostInput): Promise<PostOutput>;
}

export interface CredField { key: string; label: string; secret: boolean }

/**
 * Was auf welcher Plattform überhaupt geht — Recherchestand 31.08.2026, beim
 * Bau je Provider gegen die aktuelle Doku geprüft. Der `reason` steht wörtlich
 * im UI: wer „manuell" liest, soll auch lesen, warum.
 */
export interface PlatformPostingDef { label: string; mode: "api" | "manual" | "needs_setup" | "needs_audit" | "blocked"; reason: string; fields: CredField[] }

const F = (key: string, label: string, secret = true): CredField => ({ key, label, secret });

export const PLATFORM_POSTING: Record<string, PlatformPostingDef> = {
  bluesky: {
    label: "Bluesky", mode: "api",
    reason: "Offen und kostenlos: App-Passwort im Konto erzeugen, mehr braucht es nicht.",
    fields: [F("handle", "Handle (z. B. binderplan.bsky.social)", false), F("appPassword", "App-Passwort"), F("service", "Server (leer = bsky.social)", false)],
  },
  telegram: {
    label: "Telegram", mode: "api",
    reason: "Bot-API, offen und kostenlos. Der Bot muss Administrator des Kanals sein.",
    fields: [F("botToken", "Bot-Token"), F("chatId", "Kanal (@name oder numerische ID)", false)],
  },
  mastodon: {
    label: "Mastodon", mode: "api",
    reason: "Offen und kostenlos: Zugriffstoken in den Kontoeinstellungen erzeugen.",
    fields: [F("instance", "Instanz (z. B. https://mastodon.social)", false), F("accessToken", "Zugriffstoken")],
  },
  instagram: {
    label: "Instagram", mode: "needs_setup",
    reason: "Kostenlos und ohne App Review, solange nur dein eigenes Konto postet: Professional-Konto (Business/Creator), verknüpfte Facebook-Seite, eine Meta-App im Entwicklermodus, dein Konto darin als Instagram-Tester. Geprüft am 01.09.2026.",
    fields: [F("igUserId", "Instagram-Business-ID", false), F("accessToken", "Langlebiges Zugriffstoken")],
  },
  facebook: {
    label: "Facebook-Seite", mode: "needs_setup",
    reason: "Über dieselbe Meta-App wie Instagram; es postet die Seite, nicht das Profil.",
    fields: [F("pageId", "Seiten-ID", false), F("accessToken", "Seiten-Zugriffstoken")],
  },
  pinterest: {
    label: "Pinterest", mode: "needs_setup",
    reason: "Kostenlos, aber zweistufig: den Trial-Zugang gibt es in ein bis zwei Tagen — damit erzeugte Pins sieht jedoch nur du selbst. Für echte Pins braucht es Standard-Zugang, ein bis vier Wochen Prüfung mit Video-Nachweis. Geprüft am 01.09.2026.",
    fields: [F("boardId", "Board-ID", false), F("accessToken", "Zugriffstoken")],
  },
  youtube: {
    label: "YouTube", mode: "needs_audit",
    reason: "Der Upload wäre kostenlos, aber Videos aus nicht auditierten API-Projekten sperrt YouTube auf privat — bis zum Audit bleibt es beim Hochladen von Hand.",
    fields: [],
  },
  tiktok: {
    label: "TikTok", mode: "needs_audit",
    reason: "Ohne bestandenen Content-Posting-Audit erzwingt TikTok bei jedem API-Beitrag SELF_ONLY — nur du selbst siehst ihn. Deshalb bewusst von Hand, mit Fotomodus und Bio-Link. Geprüft am 01.09.2026.",
    fields: [],
  },
  x: {
    label: "X", mode: "manual",
    reason: "Bewusst von Hand: ein Post mit Link kostet über die API rund 0,20 $, und der Kanal trägt das nicht.",
    fields: [],
  },
  linkedin: {
    label: "LinkedIn", mode: "manual",
    reason: "Die API gibt es nur über das Partnerprogramm — für ein Ein-Personen-Produkt kein Weg.",
    fields: [],
  },
  threads: {
    label: "Threads", mode: "needs_setup",
    reason: "Kostenlos und ohne App Review, solange nur dein eigenes Konto postet: Meta-App anlegen, dein Threads-Konto als Tester eintragen, Token holen.",
    fields: [F("userId", "Threads-Nutzer-ID", false), F("accessToken", "Zugriffstoken")],
  },
  reddit: {
    label: "Reddit", mode: "blocked",
    reason: "Hausregel seit V1: Reddit wird gelesen, nie beschrieben. Es gibt keinen Code-Pfad, der dort postet.",
    fields: [],
  },
};

export const postingDef = (platform: string): PlatformPostingDef | undefined => PLATFORM_POSTING[platform.trim().toLowerCase()];
