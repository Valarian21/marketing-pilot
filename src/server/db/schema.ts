/**
 * Drizzle schema. Every table carries the `mp_` prefix so the package can share
 * a database with a host without collisions (it does not today: it owns mp.db).
 * JSON columns are stored as text and (de)serialised in the repository layer.
 */
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull();
const updatedAt = () => text("updated_at").notNull();
const projectRef = () => text("project_id").notNull().references(() => mpProjects.id, { onDelete: "cascade" });

export const mpProjects = sqliteTable("mp_projects", {
  id: id(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  status: text("status").notNull().default("draft"),
  brief: text("brief").notNull().default("{}"),
  briefMeta: text("brief_meta").notNull().default("{}"),
  briefMarkdown: text("brief_markdown").notNull().default(""),
  brandKit: text("brand_kit").notNull().default("{}"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mpPersonas = sqliteTable("mp_personas", {
  id: id(),
  projectId: projectRef(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  painPoints: text("pain_points").notNull().default("[]"),
  language: text("language").notNull().default("de"),
  phrases: text("phrases").notNull().default("[]"),
  objections: text("objections").notNull().default("[]"),
  buyingTriggers: text("buying_triggers").notNull().default("[]"),
  whereTheyHangOut: text("where_they_hang_out").notNull().default("[]"),
  evidence: text("evidence").notNull().default("[]"),
  createdAt: createdAt(),
}, (t) => [index("mp_personas_project").on(t.projectId)]);

export const mpChannels = sqliteTable("mp_channels", {
  id: id(),
  projectId: projectRef(),
  platform: text("platform").notNull(),
  rationale: text("rationale").notNull().default(""),
  cadence: text("cadence").notNull().default(""),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("planned"),
  meta: text("meta").notNull().default("{}"),
  createdAt: createdAt(),
}, (t) => [index("mp_channels_project").on(t.projectId)]);

export const mpTasks = sqliteTable("mp_tasks", {
  id: id(),
  projectId: projectRef(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull(),
  status: text("status").notNull().default("todo"),
  dueAt: text("due_at"),
  assignedTo: text("assigned_to").notNull().default("agent"),
  approvalLevel: text("approval_level").notNull().default("review"),
  outputRefs: text("output_refs").notNull().default("[]"),
  order: integer("order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("mp_tasks_project").on(t.projectId)]);

export const mpContentPieces = sqliteTable("mp_content_pieces", {
  id: id(),
  projectId: projectRef(),
  taskId: text("task_id").references(() => mpTasks.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  format: text("format").notNull(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  assets: text("assets").notNull().default("[]"),
  status: text("status").notNull().default("draft"),
  humanEdited: integer("human_edited", { mode: "boolean" }).notNull().default(false),
  publishedAt: text("published_at"),
  externalUrl: text("external_url"),
  utm: text("utm").notNull().default("{}"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("mp_content_project").on(t.projectId), index("mp_content_status").on(t.status)]);

export const mpAssets = sqliteTable("mp_assets", {
  id: id(),
  contentPieceId: text("content_piece_id").references(() => mpContentPieces.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => mpProjects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  path: text("path").notNull(),
  meta: text("meta").notNull().default("{}"),
  createdAt: createdAt(),
}, (t) => [index("mp_assets_piece").on(t.contentPieceId), index("mp_assets_project").on(t.projectId)]);

export const mpInsights = sqliteTable("mp_insights", {
  id: id(),
  projectId: projectRef(),
  source: text("source").notNull(),
  period: text("period").notNull(),
  metrics: text("metrics").notNull().default("{}"),
  signups: integer("signups").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("mp_insights_project").on(t.projectId)]);

export const mpGeoSnapshots = sqliteTable("mp_geo_snapshots", {
  id: id(),
  projectId: projectRef(),
  engine: text("engine").notNull(),
  query: text("query").notNull(),
  mentioned: integer("mentioned", { mode: "boolean" }).notNull().default(false),
  position: integer("position"),
  competitorsMentioned: text("competitors_mentioned").notNull().default("[]"),
  rawAnswer: text("raw_answer").notNull().default(""),
  batch: text("batch").notNull().default(""),
  takenAt: text("taken_at").notNull(),
}, (t) => [index("mp_geo_project").on(t.projectId), index("mp_geo_batch").on(t.batch)]);

export const mpCommunityLeads = sqliteTable("mp_community_leads", {
  id: id(),
  projectId: projectRef(),
  platform: text("platform").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull().default(""),
  excerpt: text("excerpt").notNull().default(""),
  score: integer("score").notNull().default(0),
  draftReply: text("draft_reply").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: createdAt(),
}, (t) => [index("mp_leads_project").on(t.projectId)]);

export const mpAgentRuns = sqliteTable("mp_agent_runs", {
  id: id(),
  projectId: text("project_id").references(() => mpProjects.id, { onDelete: "set null" }),
  task: text("task").notNull(),
  model: text("model"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  durationMs: integer("duration_ms"),
  resultRef: text("result_ref"),
  error: text("error"),
  status: text("status").notNull().default("running"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
}, (t) => [index("mp_runs_project").on(t.projectId), index("mp_runs_started").on(t.startedAt)]);

export const mpAuditLog = sqliteTable("mp_audit_log", {
  id: id(),
  projectId: text("project_id"),
  user: text("user").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  content: text("content").notNull().default("{}"),
  createdAt: createdAt(),
}, (t) => [index("mp_audit_project").on(t.projectId), index("mp_audit_created").on(t.createdAt)]);

export const mpSettings = sqliteTable("mp_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

// --- Analysis (Shot 1) -------------------------------------------------------

export const mpCompetitors = sqliteTable("mp_competitors", {
  id: id(),
  projectId: projectRef(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  positioning: text("positioning").notNull().default(""),
  pricing: text("pricing").notNull().default(""),
  complaints: text("complaints").notNull().default("[]"),
  createdAt: createdAt(),
}, (t) => [index("mp_competitors_project").on(t.projectId)]);

/** Crawled pages of the product site (text kept for later steps, e.g. brand kit). */
export const mpPages = sqliteTable("mp_pages", {
  id: id(),
  projectId: projectRef(),
  url: text("url").notNull(),
  title: text("title").notNull().default(""),
  kind: text("kind").notNull().default("other"),
  status: integer("status").notNull().default(0),
  text: text("text").notNull().default(""),
  fetchedAt: text("fetched_at").notNull(),
}, (t) => [index("mp_pages_project").on(t.projectId)]);

export const mpAnalysisRuns = sqliteTable("mp_analysis_runs", {
  id: id(),
  projectId: projectRef(),
  status: text("status").notNull().default("running"),
  steps: text("steps").notNull().default("[]"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  error: text("error"),
}, (t) => [index("mp_analysis_project").on(t.projectId)]);
