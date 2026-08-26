/** Project repository - maps between DB rows (JSON as text) and domain objects. */
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { newId, nowIso, parseJson, toJson } from "../db/index.js";
import { mpProjects } from "../db/schema.js";
import type { Project, ProjectCreate, ProjectUpdate } from "../../shared/schemas.js";

type Row = typeof mpProjects.$inferSelect;
type JsonObject = Record<string, unknown>;

const toDomain = (r: Row): Project => ({
  ...r,
  status: r.status as Project["status"],
  brief: parseJson<JsonObject>(r.brief, {}),
  brandKit: parseJson<JsonObject>(r.brandKit, {}),
});

export function listProjects(db: Db): Project[] {
  return db.select().from(mpProjects).orderBy(desc(mpProjects.createdAt)).all().map(toDomain);
}

export function getProject(db: Db, id: string): Project | null {
  const row = db.select().from(mpProjects).where(eq(mpProjects.id, id)).get();
  return row ? toDomain(row) : null;
}

export function createProject(db: Db, input: ProjectCreate): Project {
  const ts = nowIso();
  const row: Row = {
    id: newId(), name: input.name, url: input.url, status: "draft",
    brief: "{}", briefMeta: "{}", briefMarkdown: "", brandKit: "{}", createdAt: ts, updatedAt: ts,
  };
  db.insert(mpProjects).values(row).run();
  return toDomain(row);
}

export function updateProject(db: Db, id: string, patch: ProjectUpdate): Project | null {
  const set: Partial<Row> = { updatedAt: nowIso() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.url !== undefined) set.url = patch.url;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.brief !== undefined) set.brief = toJson(patch.brief);
  if (patch.brandKit !== undefined) set.brandKit = toJson(patch.brandKit);
  const res = db.update(mpProjects).set(set).where(eq(mpProjects.id, id)).run();
  return res.changes ? getProject(db, id) : null;
}

export function deleteProject(db: Db, id: string): boolean {
  return db.delete(mpProjects).where(eq(mpProjects.id, id)).run().changes > 0;
}
