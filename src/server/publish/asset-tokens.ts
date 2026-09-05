/**
 * Signierte, ablaufende Asset-Adressen (`/go/a/<token>`).
 *
 * Instagram und Pinterest laden Medien nicht hoch, sie **holen** sie von einer
 * öffentlichen URL. Der Pilot liefert deshalb genau die Datei aus, die er selbst
 * signiert hat — kein Verzeichnis, kein rateabler Pfad, und nach kurzer Zeit
 * ist der Link tot.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { eq } from "drizzle-orm";
import * as t from "../db/schema.js";
import { nowIso, type Db } from "../db/index.js";

const SECRET_KEY = "publish:assetSecret";
export const ASSET_TTL_MS = 6 * 3600_000;

/** Ein Geheimnis je Installation, beim ersten Gebrauch erzeugt. */
export function assetSecret(db: Db): string {
  const row = db.select({ value: t.mpSettings.value }).from(t.mpSettings).where(eq(t.mpSettings.key, SECRET_KEY)).get();
  if (row?.value) return row.value;
  const secret = crypto.randomBytes(32).toString("base64url");
  db.insert(t.mpSettings).values({ key: SECRET_KEY, value: secret, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: t.mpSettings.key, set: { value: secret, updatedAt: nowIso() } }).run();
  return secret;
}

const sign = (secret: string, payload: string) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

export function assetToken(db: Db, assetId: string, now = Date.now()): string {
  const payload = `${assetId}.${now + ASSET_TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(assetSecret(db), payload)}`;
}

/** Asset-ID aus einem Token — oder `null`, wenn abgelaufen oder gefälscht. */
export function readAssetToken(db: Db, token: string, now = Date.now()): string | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  let payload: string;
  try { payload = Buffer.from(body, "base64url").toString("utf8"); } catch { return null; }
  const expected = sign(assetSecret(db), payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const [assetId, expiry] = payload.split(".");
  if (!assetId || !expiry || Number(expiry) < now) return null;
  return assetId;
}

export const assetUrl = (publicBase: string, token: string): string => `${publicBase.replace(/\/$/, "")}/go/a/${token}`;

/**
 * PNG in JPEG umwandeln — für Meta, das nichts anderes annimmt.
 *
 * Instagram akzeptiert als Bildformat **ausschließlich JPEG**; ein PNG quittiert
 * die API mit „Only photo or video can be accepted as media type", was den
 * eigentlichen Grund nicht nennt. Unsere Slides sind PNG, weil sie aus dem
 * Renderer kommen — also wird beim Ausliefern umgewandelt und das Ergebnis
 * neben der Datei behalten. Diese Adresse ruft ohnehin nur Meta ab.
 */
export function jpegFuerMeta(pngFile: string): string {
  const ziel = pngFile.replace(/\.png$/i, ".meta.jpg");
  if (fs.existsSync(ziel) && fs.statSync(ziel).mtimeMs >= fs.statSync(pngFile).mtimeMs) return ziel;
  // -q:v 2 ist die beste Stufe unterhalb von verlustfrei; die Slides sind Flächen
  // und Text, da fällt jede stärkere Kompression sofort als Kantenflimmern auf.
  const res = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", pngFile, "-q:v", "2", ziel]);
  if (res.status !== 0 || !fs.existsSync(ziel)) {
    throw new Error(`Konnte ${path.basename(pngFile)} nicht in JPEG wandeln: ${res.stderr?.toString().slice(0, 200) ?? "ffmpeg fehlt"}`);
  }
  return ziel;
}
