/**
 * Domain model as Zod schemas. Shared between server (validation at every API
 * boundary) and client (typed API responses). Keep this file free of Node or
 * DOM imports.
 */
import { z } from "zod";

export const ProjectStatus = z.enum(["draft", "active", "paused", "archived"]);
export const TaskType = z.enum(["research", "strategy", "content", "publish", "community", "ads", "measure"]);
export const TaskStatus = z.enum(["todo", "in_progress", "review", "done", "skipped"]);
export const Assignee = z.enum(["agent", "human"]);
/** Approval level for anything with outside effect. Default is `review`. */
export const ApprovalLevel = z.enum(["auto", "review", "human_only"]);
export const ContentFormat = z.enum([
  "text", "carousel", "image", "video", "article", "directory_entry", "community_reply", "ad_creative",
]);
export const ContentStatus = z.enum(["draft", "review", "approved", "published", "rejected"]);
export const AssetKind = z.enum(["screenshot", "recording", "voiceover", "render", "image"]);
export const LeadStatus = z.enum(["new", "drafted", "answered", "dismissed"]);
export const RunStatus = z.enum(["running", "done", "failed"]);

const Id = z.string().min(1);
const Iso = z.string().datetime({ offset: true });
const Json = z.record(z.string(), z.unknown());

export const Project = z.object({
  id: Id,
  name: z.string().min(1).max(120),
  url: z.string().url(),
  status: ProjectStatus,
  brief: Json,
  brandKit: Json,
  createdAt: Iso,
  updatedAt: Iso,
});
export const ProjectCreate = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  url: z.string().trim().url("Keine gültige URL"),
});
export const ProjectUpdate = ProjectCreate.partial().extend({
  status: ProjectStatus.optional(),
  brief: Json.optional(),
  brandKit: Json.optional(),
});

export const Persona = z.object({
  id: Id, projectId: Id,
  name: z.string(), description: z.string(),
  painPoints: z.array(z.string()), language: z.string(),
  whereTheyHangOut: z.array(z.string()),
  createdAt: Iso,
});

export const Channel = z.object({
  id: Id, projectId: Id,
  platform: z.string(), rationale: z.string(), cadence: z.string(),
  priority: z.number().int(), status: z.string(),
  createdAt: Iso,
});

export const Task = z.object({
  id: Id, projectId: Id,
  title: z.string(), description: z.string(),
  type: TaskType, status: TaskStatus,
  dueAt: Iso.nullable(), assignedTo: Assignee, approvalLevel: ApprovalLevel,
  outputRefs: z.array(z.string()), order: z.number().int(),
  createdAt: Iso, updatedAt: Iso,
});

export const ContentPiece = z.object({
  id: Id, projectId: Id, taskId: Id.nullable(),
  channel: z.string(), format: ContentFormat,
  title: z.string(), body: z.string(), assets: z.array(z.string()),
  status: ContentStatus, humanEdited: z.boolean(),
  publishedAt: Iso.nullable(), externalUrl: z.string().nullable(), utm: Json,
  createdAt: Iso, updatedAt: Iso,
});

export const Asset = z.object({
  id: Id, contentPieceId: Id, kind: AssetKind, path: z.string(), meta: Json, createdAt: Iso,
});

export const Insight = z.object({
  id: Id, projectId: Id, source: z.string(), period: z.string(),
  metrics: Json, signups: z.number().int(), notes: z.string(), createdAt: Iso,
});

export const GeoSnapshot = z.object({
  id: Id, projectId: Id, engine: z.string(), query: z.string(),
  mentioned: z.boolean(), position: z.number().int().nullable(),
  competitorsMentioned: z.array(z.string()), rawAnswer: z.string(), takenAt: Iso,
});

export const CommunityLead = z.object({
  id: Id, projectId: Id, platform: z.string(), url: z.string(), title: z.string(),
  excerpt: z.string(), score: z.number().int().min(0).max(100),
  draftReply: z.string(), status: LeadStatus, createdAt: Iso,
});

export const AgentRun = z.object({
  id: Id, projectId: Id.nullable(),
  task: z.string(), model: z.string().nullable(),
  tokensIn: z.number().int(), tokensOut: z.number().int(), costUsd: z.number(),
  durationMs: z.number().int().nullable(), resultRef: z.string().nullable(),
  error: z.string().nullable(), status: RunStatus,
  startedAt: Iso, finishedAt: Iso.nullable(),
});

export const AuditEntry = z.object({
  id: Id, projectId: Id.nullable(), user: z.string(), action: z.string(),
  entityType: z.string(), entityId: z.string().nullable(), content: Json, createdAt: Iso,
});

/** Shape of GET /api/mp/host - what the client needs to render the shell. */
export const HostInfo = z.object({
  mode: z.enum(["dashboard", "standalone"]),
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
  backLink: z.string().nullable(),
  backLabel: z.string().nullable(),
  version: z.string(),
});

export const IdParams = z.object({ id: Id });
export const ProjectIdParams = z.object({ projectId: Id });
export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const NotImplemented = z.object({ detail: z.string(), shot: z.number().int() });
export const ErrorBody = z.object({ detail: z.string() });

export type Project = z.infer<typeof Project>;
export type ProjectCreate = z.infer<typeof ProjectCreate>;
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;
export type Persona = z.infer<typeof Persona>;
export type Channel = z.infer<typeof Channel>;
export type Task = z.infer<typeof Task>;
export type ContentPiece = z.infer<typeof ContentPiece>;
export type Asset = z.infer<typeof Asset>;
export type Insight = z.infer<typeof Insight>;
export type GeoSnapshot = z.infer<typeof GeoSnapshot>;
export type CommunityLead = z.infer<typeof CommunityLead>;
export type AgentRun = z.infer<typeof AgentRun>;
export type AuditEntry = z.infer<typeof AuditEntry>;
export type HostInfo = z.infer<typeof HostInfo>;
