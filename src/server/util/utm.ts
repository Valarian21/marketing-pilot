/** UTM links for the publish package. Platform detection and deep links live in shared/channels.ts. */
import { platformKey } from "../../shared/channels.js";
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

export { deepLinkFor } from "../../shared/channels.js";

export function platformFromChannel(channel: string, fallback = "other"): string {
  return platformKey(channel) ?? fallback;
}

export const PLATFORM_LIMITS: Record<string, number> = { x: 280, threads: 500, bluesky: 300, linkedin: 3000, facebook: 2000, instagram: 2200, pinterest: 500, other: 2000 };
