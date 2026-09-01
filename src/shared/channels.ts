/** Channels and platforms, shared by server and client.
 *
 *  Tasks name channels the way the strategy plan does ("Instagram", "Reddit r/lehrerzimmer", "Facebook-Gruppen"),
 *  content pieces carry the platform slug ("instagram", "linkedin"). Both are mapped to one canonical channel so the
 *  timeline, links and the cockpit line up. Profiles (per project) turn a channel name into the real page to open. */

export interface PlatformDef {
  label: string;
  /** public home of the platform - used when no profile URL is set */
  home: string;
  /** "create a post" page, opened next to the copied text */
  compose: string | null;
  composeLabel: string | null;
  /** upload only works in the mobile app (Instagram, TikTok) */
  appOnly?: boolean;
  /** regexes that identify the platform in free text (channel names, task titles) */
  match: RegExp;
}

export const PLATFORMS: Record<string, PlatformDef> = {
  instagram: { label: "Instagram", home: "https://www.instagram.com/", compose: "https://www.instagram.com/", composeLabel: "Instagram öffnen (Upload per App)", appOnly: true, match: /instagram|insta\b|reel/i },
  linkedin: { label: "LinkedIn", home: "https://www.linkedin.com/", compose: "https://www.linkedin.com/feed/?shareActive=true", composeLabel: "LinkedIn: Beitrag erstellen", match: /linkedin/i },
  facebook: { label: "Facebook", home: "https://www.facebook.com/", compose: "https://www.facebook.com/", composeLabel: "Facebook öffnen", match: /facebook|fb-gruppe/i },
  reddit: { label: "Reddit", home: "https://www.reddit.com/", compose: "https://www.reddit.com/submit", composeLabel: "Reddit: Beitrag erstellen", match: /reddit|\br\//i },
  pinterest: { label: "Pinterest", home: "https://www.pinterest.com/", compose: "https://www.pinterest.com/pin-creation-tool/", composeLabel: "Pinterest: Pin erstellen", match: /pinterest|\bpin\b/i },
  youtube: { label: "YouTube", home: "https://www.youtube.com/", compose: "https://studio.youtube.com/", composeLabel: "YouTube Studio: hochladen", match: /youtube|shorts/i },
  tiktok: { label: "TikTok", home: "https://www.tiktok.com/", compose: "https://www.tiktok.com/upload", composeLabel: "TikTok: hochladen", appOnly: true, match: /tiktok/i },
  x: { label: "X", home: "https://x.com/", compose: "https://x.com/compose/post", composeLabel: "X: neuen Post verfassen", match: /\bx\b|twitter|\bx\.com/i },
  threads: { label: "Threads", home: "https://www.threads.net/", compose: "https://www.threads.net/", composeLabel: "Threads öffnen", match: /threads/i },
  bluesky: { label: "Bluesky", home: "https://bsky.app/", compose: "https://bsky.app/", composeLabel: "Bluesky öffnen", match: /bluesky|bsky/i },
  website: { label: "Website", home: "", compose: null, composeLabel: null, match: /website|seo|blog|artikel|article|vergleich|landing/i },
  directory: { label: "Verzeichnisse", home: "", compose: null, composeLabel: null, match: /director(y|ies)|verzeichnis|alternativeto|product hunt|g2\b|saashub|there's an ai/i },
  newsletter: { label: "Newsletter", home: "", compose: null, composeLabel: null, match: /newsletter|e-?mail/i },
};

/** Platform key for a free-text channel name, or null if nothing matches. */
export function platformKey(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  const lower = n.toLowerCase();
  if (PLATFORMS[lower]) return lower;
  for (const [key, def] of Object.entries(PLATFORMS)) if (def.match.test(n)) return key;
  return null;
}

/** One canonical channel name: the plan's own spelling when the plan has that platform, else the platform label,
 *  else the name as it is (trimmed). "instagram", "Instagram Reels" and "Instagram" become one row. */
export function canonicalChannel(name: string, planChannels: readonly string[] = []): string {
  const key = platformKey(name);
  if (!key) return name.trim() || "Allgemein";
  // sub-communities stay distinct rows: "Reddit r/lehrerzimmer" and "Reddit r/referendariat"
  const sub = /\br\/([a-z0-9_]+)/i.exec(name);
  if (key === "reddit" && sub) return `Reddit r/${sub[1]}`;
  const fromPlan = planChannels.find((c) => platformKey(c) === key);
  return fromPlan?.trim() || PLATFORMS[key]!.label;
}

export type WeekdayId = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const WEEKDAY_IDS: readonly WeekdayId[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Ein Kanal-Profil des Projekts. `slots`/`publishMode` kamen mit Shot 10 dazu. */
export interface ChannelProfile {
  platform: string; label: string; url: string;
  /** Wochentag + Stunde (Europe/Berlin), zu denen auf diesem Kanal gepostet wird. */
  slots: { day: WeekdayId; hour: number }[];
  /** manual | scheduled | auto — Standard ist ueberall `manual`. */
  publishMode: "manual" | "scheduled" | "auto";
  autoWeeklyCap: number;
}

/** Ein Profil mit allen Feldern, egal wie alt der gespeicherte Eintrag ist. */
export function fullProfile(p: Partial<ChannelProfile> & { platform: string }): ChannelProfile {
  const slots = (Array.isArray(p.slots) ? p.slots : [])
    .filter((x): x is { day: WeekdayId; hour: number } => WEEKDAY_IDS.includes(x?.day as WeekdayId) && Number.isInteger(x?.hour) && x.hour >= 0 && x.hour <= 23);
  return {
    platform: p.platform, label: p.label ?? "", url: p.url ?? "",
    slots,
    publishMode: p.publishMode === "scheduled" || p.publishMode === "auto" ? p.publishMode : "manual",
    autoWeeklyCap: typeof p.autoWeeklyCap === "number" ? Math.max(0, Math.min(50, Math.round(p.autoWeeklyCap))) : 5,
  };
}

export interface ChannelLink { platform: string | null; label: string; url: string | null; appOnly: boolean }

/** Where a channel name points to: the project's profile URL for that platform, a subreddit derived from the name,
 *  or the platform's home page. `url` is null for channels that have no page (Website, Verzeichnisse). */
export function channelLink(name: string, profiles: readonly ChannelProfile[] = []): ChannelLink {
  const key = platformKey(name);
  const def = key ? PLATFORMS[key] : undefined;
  const label = def ? def.label : name.trim() || "Allgemein";
  if (!key || !def) return { platform: null, label, url: null, appOnly: false };
  const sub = /\br\/([a-z0-9_]+)/i.exec(name);
  const own = profiles.filter((p) => p.platform === key && p.url.trim());
  // several profiles of one platform (Facebook groups): the one whose label appears in the name wins, else the first
  const hit = own.find((p) => p.label && name.toLowerCase().includes(p.label.toLowerCase())) ?? own[0];
  const url = key === "reddit" && sub ? `https://www.reddit.com/r/${sub[1]}/` : hit?.url ?? (def.home || null);
  return { platform: key, label, url, appOnly: Boolean(def.appOnly) };
}

/** Default profile rows for a project: one per platform the plan uses (URLs empty until filled in). */
export function defaultProfiles(planChannels: readonly string[]): ChannelProfile[] {
  const seen = new Set<string>();
  const out: ChannelProfile[] = [];
  for (const c of planChannels) {
    const key = platformKey(c);
    if (!key || seen.has(key) || !PLATFORMS[key]?.home) continue;
    seen.add(key);
    out.push(fullProfile({ platform: key, label: PLATFORMS[key]!.label }));
  }
  return out;
}

export function deepLinkFor(platform: string): { url: string; label: string } | null {
  const def = PLATFORMS[platform];
  return def?.compose ? { url: def.compose, label: def.composeLabel ?? `${def.label} öffnen` } : null;
}

/** A usable title for a piece: the model's title unless it is empty or a placeholder, else the first line of the body. */
export function saneTitle(title: string, body: string, fallback = ""): string {
  const t = title.trim();
  if (t.length >= 4 && !/^\(?(internal|placeholder|platzhalter|untitled|ohne titel|title|titel|label)\b/i.test(t)) return t.slice(0, 120);
  const line = body.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find((l) => l.length >= 4) ?? "";
  return (line.slice(0, 80) || fallback || t || "(ohne Titel)").trim();
}

/**
 * Wie viele Hashtags auf welcher Plattform sinnvoll sind (Shot 7).
 *
 * Bis Shot 6 galt global „max 2“ — richtig für LinkedIn und X, falsch für
 * Instagram und TikTok, wo die Nischen-Discovery über genau diese Tags läuft.
 * Die Zahlen stehen zentral hier, damit Prompt, Renderer und Publish-Paket
 * dieselbe Politik lesen.
 */
export interface HashtagPolicy { min: number; max: number; note: string }

export const HASHTAG_POLICY: Record<string, HashtagPolicy> = {
  instagram: { min: 6, max: 10, note: "Discovery läuft über Hashtags — Mischung aus Marke, Thema und Sprache." },
  tiktok: { min: 3, max: 6, note: "Wenige, präzise Tags; der Text selbst ist das stärkere Signal." },
  youtube: { min: 3, max: 5, note: "Tags in die Beschreibung, nicht in den Titel." },
  pinterest: { min: 0, max: 0, note: "Keine Hashtags — Pinterest sucht über Titel und Beschreibung." },
  facebook: { min: 0, max: 2, note: "Höchstens zwei, sonst wirkt es wie Spam." },
  linkedin: { min: 0, max: 2, note: "Höchstens zwei, nur echte Community-Tags." },
  x: { min: 0, max: 2, note: "Höchstens zwei, nur echte Community-Tags." },
  threads: { min: 0, max: 2, note: "Höchstens zwei." },
  bluesky: { min: 0, max: 2, note: "Höchstens zwei." },
  reddit: { min: 0, max: 0, note: "Keine Hashtags — Reddit kennt sie nicht." },
  website: { min: 0, max: 0, note: "Keine Hashtags." },
  directory: { min: 0, max: 0, note: "Keine Hashtags." },
  newsletter: { min: 0, max: 0, note: "Keine Hashtags." },
};

export const DEFAULT_HASHTAG_POLICY: HashtagPolicy = { min: 0, max: 2, note: "Höchstens zwei." };

export function hashtagPolicy(platform: string): HashtagPolicy {
  return HASHTAG_POLICY[platform.trim().toLowerCase()] ?? DEFAULT_HASHTAG_POLICY;
}

/** Ein Tag normalisiert: genau ein führendes #, keine Leerzeichen. */
export function normalizeHashtag(raw: string): string {
  const body = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return body ? `#${body}` : "";
}

/** Wie der Link in den Beitrag kommt: bei App-Uploads gibt es keinen klickbaren Link. */
export function linkRuleFor(platform: string): "bio" | "link" {
  return PLATFORMS[platform.trim().toLowerCase()]?.appOnly ? "bio" : "link";
}
