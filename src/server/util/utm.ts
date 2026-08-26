/** UTM links + platform deep links for the publish package. */
export interface UtmParams { source: string; medium: string; campaign: string; content?: string }

export function buildUtmUrl(base: string, utm: UtmParams): string {
  const u = new URL(base);
  u.searchParams.set("utm_source", utm.source);
  u.searchParams.set("utm_medium", utm.medium);
  u.searchParams.set("utm_campaign", utm.campaign);
  if (utm.content) u.searchParams.set("utm_content", utm.content);
  return u.toString();
}

export const slugify = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";

const DEEP_LINKS: Record<string, { url: string; label: string }> = {
  x: { url: "https://x.com/compose/post", label: "X: neuen Post verfassen" },
  threads: { url: "https://www.threads.net/", label: "Threads öffnen" },
  bluesky: { url: "https://bsky.app/", label: "Bluesky öffnen" },
  linkedin: { url: "https://www.linkedin.com/feed/?shareActive=true", label: "LinkedIn: Beitrag erstellen" },
  facebook: { url: "https://www.facebook.com/", label: "Facebook öffnen" },
  instagram: { url: "https://www.instagram.com/", label: "Instagram öffnen (Upload per App)" },
  pinterest: { url: "https://www.pinterest.com/pin-creation-tool/", label: "Pinterest: Pin erstellen" },
  youtube: { url: "https://studio.youtube.com/", label: "YouTube Studio: hochladen" },
  tiktok: { url: "https://www.tiktok.com/upload", label: "TikTok: hochladen" },
  reddit: { url: "https://www.reddit.com/submit", label: "Reddit: Beitrag erstellen" },
};

export function platformFromChannel(channel: string, fallback = "other"): string {
  const c = channel.toLowerCase();
  for (const key of Object.keys(DEEP_LINKS)) if (c.includes(key)) return key;
  if (/twitter/.test(c)) return "x";
  if (/shorts/.test(c)) return "youtube";
  if (/reel/.test(c)) return "instagram";
  return fallback;
}

export function deepLinkFor(platform: string): { url: string; label: string } | null {
  return DEEP_LINKS[platform] ?? null;
}

export const PLATFORM_LIMITS: Record<string, number> = { x: 280, threads: 500, bluesky: 300, linkedin: 3000, facebook: 2000, instagram: 2200, pinterest: 500, other: 2000 };
