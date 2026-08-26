/** Database bootstrap: opens mp.db, enables foreign keys/WAL, applies migrations. */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { ROOT } from "../env.js";

export type Db = ReturnType<typeof openDatabase>["db"];

export function openDatabase(dataDir: string, file = "mp.db") {
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(file === ":memory:" ? file : path.join(dataDir, file));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(ROOT, "src/server/db/migrations") });
  return { db, sqlite };
}

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();

export const parseJson = <T>(raw: string, fallback: T): T => {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};
export const toJson = (v: unknown): string => JSON.stringify(v ?? null);
