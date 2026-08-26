/** UI map: visible button/link/field labels seen during recordings, so script authors use real texts instead of guessing. */
import { eq } from "drizzle-orm";
import * as t from "../../db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "../../db/index.js";

const KEY = (projectId: string) => `ui-map:${projectId}`;
const MAX = 160;

export function loadUiMap(db: Db, projectId: string): string[] {
  const row = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, KEY(projectId))).get();
  return row ? parseJson<{ labels: string[] }>(row.value, { labels: [] }).labels : [];
}

/** Merge newly seen labels in front of the known ones (newest UI wins), capped. */
export function saveUiMap(db: Db, projectId: string, labels: string[]): string[] {
  const merged = Array.from(new Set([...labels, ...loadUiMap(db, projectId)])).slice(0, MAX);
  const value = toJson({ labels: merged, at: nowIso() });
  db.insert(t.mpSettings).values({ key: KEY(projectId), value, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value, updatedAt: nowIso() } }).run();
  return merged;
}
