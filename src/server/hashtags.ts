/**
 * Hashtag-Vorräte je Projekt (`mp_settings` `hashtags:<projectId>`).
 *
 * Der Vorrat ist Marcels Material, nicht das des Modells: einmal per LLM aus
 * Analyse und Personas vorgeschlagen, danach von Hand editierbar. Wie viele
 * Tags ein Stück tatsächlich trägt, entscheidet allein die Plattform-Politik
 * in `shared/channels.ts`.
 */
import { eq } from "drizzle-orm";
import * as t from "./db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "./db/index.js";
import { HashtagPools } from "../shared/schemas.js";
import { hashtagPolicy, normalizeHashtag } from "../shared/channels.js";

const key = (projectId: string) => `hashtags:${projectId}`;
const EMPTY: HashtagPools = { brand: [], topics: {}, byLanguage: { de: [], en: [] }, suggestedAt: null };

export function loadHashtags(db: Db, projectId: string): HashtagPools {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, key(projectId))).get();
  const parsed = HashtagPools.safeParse(parseJson(row?.value ?? "{}", {}));
  return parsed.success ? parsed.data : EMPTY;
}

export function saveHashtags(db: Db, projectId: string, pools: HashtagPools): HashtagPools {
  const clean = (list: string[]) => [...new Set(list.map((x) => normalizeHashtag(x).slice(1).toLowerCase()).filter(Boolean))];
  const value: HashtagPools = {
    brand: clean(pools.brand),
    topics: Object.fromEntries(Object.entries(pools.topics).map(([k, v]) => [k, clean(v ?? [])] as const).filter(([, v]) => v.length > 0)),
    byLanguage: { de: clean(pools.byLanguage.de), en: clean(pools.byLanguage.en) },
    suggestedAt: pools.suggestedAt,
  };
  db.insert(t.mpSettings).values({ key: key(projectId), value: toJson(value), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(value), updatedAt: nowIso() } }).run();
  return value;
}

/**
 * Die Tags eines Stücks: was das Modell vorgeschlagen hat, auf die Politik der
 * Plattform gestutzt und aus dem Vorrat aufgefüllt, falls es zu wenige waren.
 * Reihenfolge: Vorschläge zuerst (die passen zum Text), dann Marke, dann Sprache.
 */
export function applyHashtagPolicy(suggested: string[], pools: HashtagPools, platform: string, language: "de" | "en"): string[] {
  const policy = hashtagPolicy(platform);
  if (policy.max === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string, limit: number) => {
    const tag = normalizeHashtag(raw).toLowerCase();
    if (!tag || tag === "#" || seen.has(tag) || out.length >= limit) return;
    seen.add(tag); out.push(tag);
  };
  suggested.forEach((x) => push(x, policy.max));
  // Nur auffüllen, bis das Minimum steht — nicht bis zum Maximum: aus dem Vorrat
  // kommen allgemeine Tags, die Vorschläge des Modells passen zum konkreten Text.
  for (const x of [...pools.brand, ...pools.byLanguage[language], ...Object.values(pools.topics).flat()]) push(x, policy.min);
  return out;
}
