/** Per-project channel profiles (Instagram page, LinkedIn page, Facebook groups, …), stored in mp_settings. */
import { eq } from "drizzle-orm";
import * as t from "./db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "./db/index.js";
import { defaultProfiles, fullProfile, PLATFORMS, type ChannelProfile, type ChannelStage } from "../shared/channels.js";
import { currentVersion } from "./agents/strategy/plan.js";

const key = (projectId: string) => `channels:${projectId}`;

export function planChannelNames(db: Db, projectId: string): string[] {
  return (currentVersion(db, projectId)?.plan.channels ?? []).map((c) => c.platform);
}

/** Stored profiles plus an empty row for every plan platform that has none yet - the UI shows what is still missing. */
export function loadProfiles(db: Db, projectId: string): ChannelProfile[] {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, key(projectId))).get();
  // Alte Eintraege kennen `slots`/`publishMode` noch nicht - `fullProfile` ergaenzt sie.
  const stored = parseJson<Partial<ChannelProfile>[]>(row?.value ?? "[]", []).filter((x): x is Partial<ChannelProfile> & { platform: string } => Boolean(x?.platform)).map(fullProfile);
  const missing = defaultProfiles(planChannelNames(db, projectId)).filter((d) => !stored.some((s) => s.platform === d.platform));
  return [...stored, ...missing];
}

type ProfileInput = { [K in keyof ChannelProfile]?: ChannelProfile[K] | undefined } & { platform: string };

export function saveProfiles(db: Db, projectId: string, profiles: ProfileInput[]): ChannelProfile[] {
  const clean = profiles.map((raw) => Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Partial<ChannelProfile> & { platform: string }).map((p) => fullProfile({ ...p, platform: p.platform.trim().toLowerCase(), label: (p.label ?? "").trim(), url: (p.url ?? "").trim() })).filter((p) => p.platform);
  db.insert(t.mpSettings).values({ key: key(projectId), value: toJson(clean), updatedAt: nowIso() }).onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(clean), updatedAt: nowIso() } }).run();
  return loadProfiles(db, projectId);
}

/** Die Stufe eines Kanals — `off`, wenn es kein Profil gibt. Das ist die eine Frage, die Serien und Zeitplan stellen. */
export function stageOf(db: Db, projectId: string, platform: string): ChannelStage {
  return loadProfiles(db, projectId).find((p) => p.platform === platform.trim().toLowerCase())?.stage ?? "off";
}

/**
 * Ein Kanal von der Kanaele-Seite: legt das Profil an, wenn es fehlt, und aendert
 * nur die mitgeschickten Felder. So kann eine Plattform eingeschaltet werden,
 * ohne dass das UI die ganze Liste kennen muss.
 */
export function patchChannel(db: Db, projectId: string, platform: string, patch: { [K in "stage" | "url" | "label" | "slots" | "autoWeeklyCap"]?: ChannelProfile[K] | undefined }): ChannelProfile {
  const slug = platform.trim().toLowerCase();
  const all = loadProfiles(db, projectId);
  const cur = all.find((p) => p.platform === slug) ?? fullProfile({ platform: slug, label: PLATFORMS[slug]?.label ?? slug, stage: "off" });
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<ChannelProfile>;
  const next = fullProfile({ ...cur, ...defined });
  const rest = all.filter((p) => p.platform !== slug);
  saveProfiles(db, projectId, [...rest, next]);
  return next;
}
