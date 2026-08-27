/** Channel names as links: "Instagram" opens the project's Instagram page (from the channel profiles) in a new tab,
 *  "Reddit r/lehrerzimmer" opens the subreddit, "Website" stays plain text. Profiles are fetched once per project. */
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { channelLink, type ChannelProfile } from "../../shared/channels.js";

const cache = new Map<string, ChannelProfile[]>();
const listeners = new Set<() => void>();

export async function loadProfiles(projectId: string, force = false): Promise<ChannelProfile[]> {
  if (!force && cache.has(projectId)) return cache.get(projectId)!;
  const p = await api<ChannelProfile[]>(`/projects/${projectId}/profiles`).catch(() => [] as ChannelProfile[]);
  cache.set(projectId, p);
  listeners.forEach((l) => l());
  return p;
}

export function useProfiles(projectId: string): ChannelProfile[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (projectId) void loadProfiles(projectId);
    return () => { listeners.delete(l); };
  }, [projectId]);
  return cache.get(projectId) ?? [];
}

export function ChannelTag({ name, projectId, className = "mp-label" }: { name: string; projectId: string; className?: string }) {
  const profiles = useProfiles(projectId);
  if (!name.trim()) return null;
  const link = channelLink(name, profiles);
  if (!link.url) return <span className={className}>{name}</span>;
  return <a className={`${className} mp-channel-link`} href={link.url} target="_blank" rel="noreferrer" title={`${link.label} öffnen (neuer Tab)`}>{name}<span className="mp-ext" aria-hidden="true">↗</span></a>;
}
