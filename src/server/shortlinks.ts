/** Short links: one per piece, created when the publish package is built. A post carries `https://…/go/ab12cd`
 *  instead of a 150-character UTM URL; the redirect keeps the UTM parameters and counts the click. */
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as t from "./db/schema.js";
import { nowIso, type Db } from "./db/index.js";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";   // no 0/o/1/l/i - the code is read from a screen or typed from a video

function newCode(): string {
  const bytes = crypto.randomBytes(6);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function ensureShortlink(db: Db, projectId: string, pieceId: string, target: string): { code: string; clicks: number } {
  const existing = db.select().from(t.mpShortlinks).where(eq(t.mpShortlinks.pieceId, pieceId)).get();
  if (existing) {
    if (existing.target !== target) db.update(t.mpShortlinks).set({ target }).where(eq(t.mpShortlinks.code, existing.code)).run();
    return { code: existing.code, clicks: existing.clicks };
  }
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if (db.select({ code: t.mpShortlinks.code }).from(t.mpShortlinks).where(eq(t.mpShortlinks.code, code)).get()) continue;
    db.insert(t.mpShortlinks).values({ code, projectId, pieceId, target, clicks: 0, createdAt: nowIso(), lastClickAt: null }).run();
    return { code, clicks: 0 };
  }
  throw new Error("Kein freier Kurzlink-Code gefunden.");
}

/** Target for a code (or null) - counts the click. */
export function resolveShortlink(db: Db, code: string): string | null {
  const row = db.select().from(t.mpShortlinks).where(eq(t.mpShortlinks.code, code)).get();
  if (!row) return null;
  db.update(t.mpShortlinks).set({ clicks: sql`${t.mpShortlinks.clicks} + 1`, lastClickAt: nowIso() }).where(eq(t.mpShortlinks.code, code)).run();
  return row.target;
}

export function clicksByPiece(db: Db, projectId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of db.select({ pieceId: t.mpShortlinks.pieceId, clicks: t.mpShortlinks.clicks }).from(t.mpShortlinks).where(eq(t.mpShortlinks.projectId, projectId)).all()) if (r.pieceId) out.set(r.pieceId, r.clicks);
  return out;
}

export function shortUrl(publicBase: string, code: string): string {
  return `${publicBase.replace(/\/$/, "")}/go/${code}`;
}
