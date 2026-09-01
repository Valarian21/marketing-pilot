/**
 * Zugangsdaten je Projekt und Kanal (`mp_settings` `publish:<projectId>`).
 *
 * Bewusst nicht in der `.env`: der Pilot bewirbt mehrere Produkte, und jedes
 * hat eigene Konten. Nach draußen gehen die Werte nur maskiert — gespeichert
 * wird, was hereinkommt, aber gelesen wird nie im Klartext.
 */
import { eq } from "drizzle-orm";
import * as t from "../db/schema.js";
import { nowIso, parseJson, toJson, type Db } from "../db/index.js";
import type { PlatformPosting } from "../../shared/schemas.js";
import { POSTERS } from "./posters.js";
import { PLATFORM_POSTING, postingDef, type PlatformPoster } from "./types.js";

const key = (projectId: string) => `publish:${projectId}`;
export type Credentials = Record<string, Record<string, string>>;

export function loadCredentials(db: Db, projectId: string): Credentials {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, key(projectId))).get();
  return parseJson<Credentials>(row?.value ?? "{}", {});
}

export function credentialsFor(db: Db, projectId: string, platform: string): Record<string, string> {
  return loadCredentials(db, projectId)[platform.trim().toLowerCase()] ?? {};
}

/**
 * Teil-Speichern: ein leerer Wert löscht das Feld, ein fehlendes Feld bleibt
 * unangetastet. Sonst könnte das UI, das Geheimnisse nur maskiert kennt, sie
 * beim Speichern überschreiben.
 */
export function saveCredentials(db: Db, projectId: string, patch: Credentials): Credentials {
  const cur = loadCredentials(db, projectId);
  for (const [platform, fields] of Object.entries(patch)) {
    const target = { ...(cur[platform] ?? {}) };
    for (const [k, v] of Object.entries(fields)) {
      if (v.trim()) target[k] = v.trim(); else delete target[k];
    }
    if (Object.keys(target).length) cur[platform] = target; else delete cur[platform];
  }
  db.insert(t.mpSettings).values({ key: key(projectId), value: toJson(cur), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: toJson(cur), updatedAt: nowIso() } }).run();
  return cur;
}

/** Der Poster einer Plattform — oder `null`, wenn dort bewusst nichts postet. */
export function posterFor(platform: string): PlatformPoster | null {
  const p = platform.trim().toLowerCase();
  const def = postingDef(p);
  // Gesperrte Plattformen haben keinen Poster, und zwar an genau dieser Stelle:
  // selbst wenn jemand einen einträgt, kommt er hier nicht heraus.
  if (!def || def.mode === "blocked" || def.mode === "manual" || def.mode === "needs_audit") return null;
  return POSTERS[p] ?? null;
}

/** Was das UI über jede Plattform anzeigt, inklusive „schon eingerichtet?". */
export function platformStatus(db: Db, projectId: string): PlatformPosting[] {
  const creds = loadCredentials(db, projectId);
  return Object.entries(PLATFORM_POSTING).map(([platform, def]) => {
    const poster = POSTERS[platform];
    const have = creds[platform] ?? {};
    const configured = Boolean(poster) && poster!.missing(have).length === 0;
    return {
      platform, label: def.label, reason: def.reason,
      // Eingerichtete Meta-/Pinterest-Konten sind ab dann normale API-Kanäle.
      mode: def.mode === "needs_setup" && configured ? "api" : def.mode,
      fields: def.fields, configured,
    };
  });
}

export { PLATFORM_POSTING, postingDef };
