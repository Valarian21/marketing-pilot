/** Per-project channel profiles (Instagram page, LinkedIn page, Facebook groups, …), stored in mp_settings. */
import { eq } from "drizzle-orm";
import * as t from "./db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "./db/index.js";
import { defaultProfiles, type ChannelProfile } from "../shared/channels.js";
import { currentVersion } from "./agents/strategy/plan.js";

const key = (projectId: string) => `channels:${projectId}`;

export function planChannelNames(db: Db, projectId: string): string[] {
  return (currentVersion(db, projectId)?.plan.channels ?? []).map((c) => c.platform);
}

/** Stored profiles plus an empty row for every plan platform that has none yet - the UI shows what is still missing. */
export function loadProfiles(db: Db, projectId: string): ChannelProfile[] {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, key(projectId))).get();
  const stored = parseJson<ChannelProfile[]>(row?.value ?? "[]", []);
  const missing = defaultProfiles(planChannelNames(db, projectId)).filter((d) => !stored.some((s) => s.platform === d.platform));
  return [...stored, ...missing];
}

export function saveProfiles(db: Db, projectId: string, profiles: ChannelProfile[]): ChannelProfile[] {
  const clean = profiles.map((p) => ({ platform: p.platform.trim().toLowerCase(), label: p.label.trim(), url: p.url.trim() })).filter((p) => p.platform);
  db.insert(t.mpSettings).values({ key: key(projectId), value: toJson(clean), updatedAt: nowIso() }).onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(clean), updatedAt: nowIso() } }).run();
  return loadProfiles(db, projectId);
}
