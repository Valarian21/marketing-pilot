/**
 * Slide-Einstellungen je Projekt: Aufbau der Daten-Slides und Anzeige-Adresse.
 * Gespeichert wie die Datenquelle in `mp_settings` unter `slides:<projectId>`.
 */
import { eq } from "drizzle-orm";
import * as t from "./db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "./db/index.js";
import { SlideSettings } from "../shared/schemas.js";

const key = (projectId: string) => `slides:${projectId}`;

export function loadSlideSettings(db: Db, projectId: string): SlideSettings {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, key(projectId))).get();
  return SlideSettings.parse(parseJson<unknown>(row?.value ?? "{}", {}));
}

export function saveSlideSettings(db: Db, projectId: string, settings: SlideSettings): SlideSettings {
  const value = toJson(SlideSettings.parse(settings));
  db.insert(t.mpSettings).values({ key: key(projectId), value, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value, updatedAt: nowIso() } }).run();
  return loadSlideSettings(db, projectId);
}
