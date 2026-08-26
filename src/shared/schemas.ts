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
  "text", "carousel", "image", "pin", "video", "article", "directory_entry", "community_reply", "ad_creative",
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

export const Evidence = z.object({ claim: z.string(), quote: z.string(), url: z.string() });
export const Persona = z.object({
  id: Id, projectId: Id,
  name: z.string(), description: z.string(),
  painPoints: z.array(z.string()), language: z.string(),
  /** Real phrasings taken from sources (how this persona talks about the problem). */
  phrases: z.array(z.string()),
  objections: z.array(z.string()),
  buyingTriggers: z.array(z.string()),
  whereTheyHangOut: z.array(z.string()),
  evidence: z.array(Evidence),
  createdAt: Iso,
});

export const ChannelMeta = z.object({
  format: z.string().default(""),
  reach: z.string().default(""),
  costEstimate: z.string().default(""),
  effort: z.string().default(""),
  evidenceRefs: z.array(z.string()).default([]),
});
export const Channel = z.object({
  id: Id, projectId: Id,
  platform: z.string(), rationale: z.string(), cadence: z.string(),
  priority: z.number().int(), status: z.string(),
  meta: ChannelMeta,
  createdAt: Iso,
});

export const Task = z.object({
  id: Id, projectId: Id,
  title: z.string(), description: z.string(),
  type: TaskType, status: TaskStatus,
  dueAt: Iso.nullable(), assignedTo: Assignee, approvalLevel: ApprovalLevel,
  outputRefs: z.array(z.string()), order: z.number().int(),
  channel: z.string(), week: z.number().int(), planVersion: z.number().int(),
  createdAt: Iso, updatedAt: Iso,
});
export const TaskCreate = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().default(""),
  type: TaskType,
  channel: z.string().default(""),
  dueAt: Iso.nullable().default(null),
  week: z.number().int().min(1).max(52).default(1),
  assignedTo: Assignee.default("human"),
  approvalLevel: ApprovalLevel.default("review"),
});
export const TaskPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().optional(),
  status: TaskStatus.optional(),
  dueAt: Iso.nullable().optional(),
  week: z.number().int().min(1).max(52).optional(),
  order: z.number().int().optional(),
  assignedTo: Assignee.optional(),
  approvalLevel: ApprovalLevel.optional(),
  channel: z.string().optional(),
});
export const TaskReorder = z.object({ ids: z.array(Id).min(1) });

export const ContentPiece = z.object({
  id: Id, projectId: Id, taskId: Id.nullable(),
  channel: z.string(), format: ContentFormat,
  title: z.string(), body: z.string(), assets: z.array(z.string()),
  status: ContentStatus, humanEdited: z.boolean(),
  publishedAt: Iso.nullable(), externalUrl: z.string().nullable(), utm: Json,
  meta: Json, aiTellScore: z.number().int().nullable(), aiTellNotes: z.string(), rejectionReason: z.string(),
  /** Sum of all agent runs booked on this piece (OpenRouter + ElevenLabs + …), USD. */
  costUsd: z.number().default(0),
  createdAt: Iso, updatedAt: Iso,
});

export const Asset = z.object({
  id: Id, contentPieceId: Id.nullable(), projectId: Id.nullable(),
  kind: AssetKind, path: z.string(), meta: Json, createdAt: Iso,
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
  draftReply: z.string(), status: LeadStatus, meta: Json, createdAt: Iso,
});

export const AgentRun = z.object({
  id: Id, projectId: Id.nullable(), pieceId: Id.nullable().default(null), provider: z.string().default("openrouter"),
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

// --- Analysis (Shot 1) -------------------------------------------------------

export const PricePlan = z.object({ plan: z.string(), price: z.string(), notes: z.string().default("") });
/** Product brief - structured output of the analysis, editable by the user. */
export const Brief = z.object({
  productName: z.string(),
  oneLiner: z.string(),
  category: z.string(),
  language: z.string(),
  features: z.array(z.string()),
  pricing: z.array(PricePlan),
  usp: z.array(z.string()),
  tone: z.string(),
  targetAudience: z.string(),
  keywords: z.array(z.string()),
  sources: z.array(z.string()),
});
export const BriefPatch = Brief.partial();
export const BriefMeta = z.object({
  generatedAt: Iso.nullable().default(null),
  model: z.string().nullable().default(null),
  userEdited: z.boolean().default(false),
  editedFields: z.array(z.string()).default([]),
  editedAt: Iso.nullable().default(null),
  confirmedAt: Iso.nullable().default(null),
});

export const Complaint = z.object({ text: z.string(), quote: z.string(), source: z.string(), url: z.string() });
export const Competitor = z.object({
  id: Id, projectId: Id,
  name: z.string(), url: z.string(), positioning: z.string(), pricing: z.string(),
  complaints: z.array(Complaint),
  createdAt: Iso,
});

export const PageKind = z.enum(["home", "pricing", "features", "docs", "changelog", "about", "blog", "appstore", "github", "other"]);
export const CrawlPage = z.object({
  id: Id, projectId: Id, url: z.string(), title: z.string(), kind: PageKind,
  status: z.number().int(), textLength: z.number().int(), fetchedAt: Iso,
});

export const AnalysisStepName = z.enum(["crawl", "brief", "competitors", "personas", "attention", "geo"]);
export const AnalysisStepStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export const AnalysisStep = z.object({
  name: AnalysisStepName,
  status: AnalysisStepStatus,
  startedAt: Iso.nullable(),
  finishedAt: Iso.nullable(),
  error: z.string().nullable(),
  summary: z.string(),
  runId: z.string().nullable(),
});
export const AnalysisRun = z.object({
  id: Id, projectId: Id,
  status: RunStatus,
  steps: z.array(AnalysisStep),
  startedAt: Iso, finishedAt: Iso.nullable(), error: z.string().nullable(),
});
export const AnalysisStart = z.object({ from: AnalysisStepName.optional() });

export const GeoModelStat = z.object({ model: z.string(), asked: z.number().int(), mentioned: z.number().int() });
export const AnalysisView = z.object({
  run: AnalysisRun.nullable(),
  brief: Brief.nullable(),
  briefMeta: BriefMeta,
  briefMarkdown: z.string(),
  personas: z.array(Persona),
  channels: z.array(Channel),
  competitors: z.array(Competitor),
  pages: z.array(CrawlPage),
  screenshots: z.array(Asset),
  geo: z.object({
    snapshots: z.array(GeoSnapshot),
    models: z.array(z.string()),
    visibility: z.number().nullable(),
    perModel: z.array(GeoModelStat),
    batch: z.string().nullable(),
  }),
});

// --- Strategy (Shot 2) -------------------------------------------------------

export const PlanChannel = z.object({
  platform: z.string(),
  role: z.enum(["start", "later"]).default("start"),
  format: z.string().default(""),
  cadence: z.string().default(""),
  rationale: z.string().default(""),
  evidenceRefs: z.array(z.string()).default([]),
});
export const PlanGoal = z.object({
  horizonDays: z.number().int(),
  metric: z.string().default("signups"),
  target: z.number(),
  rationale: z.string().default(""),
});
export const PlanBudgetItem = z.object({ item: z.string(), eur: z.number(), rationale: z.string().default("") });
export const StrategyPlan = z.object({
  summary: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coreMessage: z.object({ text: z.string(), rationale: z.string().default("") }),
  channels: z.array(PlanChannel).min(1),
  goals: z.array(PlanGoal).min(1),
  budget: z.object({ monthlyEur: z.number(), items: z.array(PlanBudgetItem).default([]), rationale: z.string().default("") }),
  risks: z.array(z.object({ text: z.string(), mitigation: z.string().default("") })).default([]),
});
export const PlanDiffEntry = z.object({ path: z.string(), before: z.unknown(), after: z.unknown() });
export const StrategyVersion = z.object({
  id: Id, projectId: Id, version: z.number().int(), plan: StrategyPlan, diff: z.array(PlanDiffEntry),
  createdBy: z.string(), note: z.string(), createdAt: Iso,
});
export const StrategyView = z.object({
  briefConfirmed: z.boolean(),
  running: z.boolean(),
  error: z.string().nullable(),
  current: StrategyVersion.nullable(),
  versions: z.array(z.object({ version: z.number().int(), createdBy: z.string(), note: z.string(), createdAt: Iso, changes: z.number().int() })),
  taskCount: z.number().int(),
});
export const StrategyStart = z.object({ note: z.string().default("") });

export const TimelineItem = z.object({
  kind: z.enum(["task", "piece"]),
  id: Id, title: z.string(), week: z.number().int(),
  status: z.string(), planned: z.boolean(), date: Iso.nullable(), assignedTo: z.string().nullable(), type: z.string(),
});
export const TimelineView = z.object({
  startDate: z.string(), weeks: z.number().int(), todayWeek: z.number().int().nullable(),
  rows: z.array(z.object({ channel: z.string(), items: z.array(TimelineItem) })),
});

export const ProjectOverview = Project.extend({
  openTasksThisWeek: z.number().int(),
  piecesInReview: z.number().int(),
  signups7d: z.number().int(),
  geoVisibility: z.number().nullable(),
  briefConfirmed: z.boolean(),
  planVersion: z.number().int().nullable(),
  latestReport: z.object({ id: Id, weekStart: z.string(), status: z.string(), excerpt: z.string() }).nullable().default(null),
});

export const ContentPatch = z.object({
  status: ContentStatus.optional(),
  body: z.string().optional(),
  title: z.string().optional(),
  reason: z.string().optional(),
  externalUrl: z.string().optional(),
});

// --- Content Studio (Shot 3) -------------------------------------------------

export const VoiceSample = z.object({ id: Id, text: z.string(), source: z.string().default(""), addedAt: Iso });
export const VoiceProfile = z.object({
  summary: z.string(),
  address: z.enum(["du", "Sie", "mixed", "n/a"]).default("n/a"),
  sentenceLength: z.string().default(""),
  favoriteWords: z.array(z.string()).default([]),
  humor: z.string().default(""),
  typicalOpeners: z.array(z.string()).default([]),
  noGos: z.array(z.string()).default([]),
  /** Ready-to-paste block for prompts. */
  promptBlock: z.string(),
  derivedAt: Iso,
  model: z.string().default(""),
  sampleCount: z.number().int().default(0),
});
export const BrandKit = z.object({
  colors: z.array(z.string()).default([]),
  primary: z.string().nullable().default(null),
  ink: z.string().nullable().default(null),
  background: z.string().nullable().default(null),
  logoAssetId: z.string().nullable().default(null),
  logoUrl: z.string().nullable().default(null),
  fonts: z.array(z.string()).default([]),
  extractedAt: Iso.nullable().default(null),
  voiceSamples: z.array(VoiceSample).default([]),
  voiceProfile: VoiceProfile.nullable().default(null),
});
export const BrandKitPatch = z.object({
  colors: z.array(z.string()).optional(), primary: z.string().nullable().optional(), ink: z.string().nullable().optional(),
  background: z.string().nullable().optional(),
});
export const VoiceSampleCreate = z.object({ text: z.string().trim().min(40, "Mindestens 40 Zeichen"), source: z.string().default("") });

export const Platform = z.enum(["x", "threads", "bluesky", "linkedin", "facebook", "instagram", "pinterest", "youtube", "tiktok", "website", "other"]);
export const ArticleKind = z.enum(["comparison", "best_tools", "faq"]);
export const CarouselTemplate = z.enum(["clean", "bold", "screenshot", "list", "story"]);
export const ContentRequest = z.object({
  format: ContentFormat,
  platform: Platform.optional(),
  topic: z.string().default(""),
  hint: z.string().default(""),
  taskId: Id.nullable().optional(),
  competitor: z.string().optional(),
  articleKind: ArticleKind.optional(),
  directory: z.string().optional(),
  template: CarouselTemplate.optional(),
  screenshotAssetIds: z.array(Id).optional(),
});
export const RegenerateRequest = z.object({ hint: z.string().default("") });

export const DirectoryDef = z.object({
  slug: z.string(), name: z.string(), submitUrl: z.string(), notes: z.string().default(""),
  taglineMax: z.number().int().default(60), screenshotSizes: z.array(z.object({ w: z.number().int(), h: z.number().int() })).default([]),
  fields: z.array(z.string()).default([]),
});
export const DirectoryStatus = DirectoryDef.extend({
  pieceId: Id.nullable(), pieceStatus: ContentStatus.nullable(), submittedUrl: z.string().nullable(), submittedAt: Iso.nullable(),
});

export const PublishPackage = z.object({
  piece: ContentPiece,
  platform: z.string(),
  text: z.string(),
  assets: z.array(z.object({ id: Id, kind: z.string(), url: z.string(), filename: z.string(), width: z.number().int().nullable(), height: z.number().int().nullable(), aiGenerated: z.boolean() })),
  utmLink: z.string().nullable(),
  deepLink: z.string().nullable(),
  deepLinkLabel: z.string().nullable(),
  postizAvailable: z.boolean(),
  notes: z.array(z.string()),
});
export const ScheduleRequest = z.object({ date: Iso });

export const StudioView = z.object({
  brandKit: BrandKit,
  hasBrief: z.boolean(),
  screenshots: z.array(Asset),
  recent: z.array(ContentPiece),
  directories: z.array(DirectoryStatus),
  competitors: z.array(z.string()),
});

// --- Video factory (Shot 4) --------------------------------------------------

export const VideoDevice = z.enum(["mobile", "desktop"]);
export const VideoAction = z.object({
  type: z.enum(["goto", "click", "type", "scroll", "wait", "hover", "press", "waitFor"]),
  url: z.string().optional(),
  /** Visible text, aria name, placeholder/label, or a CSS selector. */
  target: z.string().optional(),
  text: z.string().optional(),
  y: z.number().int().optional(),
  /** wait: pause; waitFor: maximum wait for the target to appear (idle time is cut out of the video) */
  ms: z.number().int().min(0).max(240000).optional(),
});
export const VideoScene = z.object({
  id: z.string(),
  voiceover: z.string(),
  caption: z.string().default(""),
  actions: z.array(VideoAction).default([]),
  /** Minimum dwell time for the scene (ms) - recording pads to voiceover length anyway. */
  durationMs: z.number().int().min(800).max(20000).default(3500),
});
export const VideoScript = z.object({
  title: z.string(),
  goal: z.string().default(""),
  persona: z.string().default(""),
  devices: z.array(VideoDevice).min(1).default(["mobile"]),
  hooks: z.array(z.string()).min(1).max(8),
  scenes: z.array(VideoScene).min(1).max(12),
  cta: z.object({ text: z.string(), url: z.string() }),
  language: z.string().default("de"),
});
export const VideoScriptRequest = z.object({ topic: z.string().default(""), hint: z.string().default(""), taskId: Id.nullable().optional(), devices: z.array(VideoDevice).optional() });
export const VideoRenderRequest = z.object({ variants: z.number().int().min(1).max(5).default(3), landscape: z.boolean().default(true), /** keep the existing recording, only voice/captions/cut are redone (no browser session, no demo credits) */ reuseRecording: z.boolean().default(false), /** music bed: none | only the landscape cut (Reels get their sound on the platform) | all */ music: z.enum(["none", "landscape", "all"]).default("landscape") });

export const JobStatus = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export const JobStep = z.object({ name: z.string(), status: z.enum(["pending", "running", "done", "failed", "skipped"]), detail: z.string().default(""), startedAt: Iso.nullable().default(null), finishedAt: Iso.nullable().default(null) });
export const Job = z.object({
  id: Id, projectId: Id.nullable(), kind: z.string(), status: JobStatus,
  payload: Json, steps: z.array(JobStep), result: Json, error: z.string().nullable(),
  createdAt: Iso, startedAt: Iso.nullable(), finishedAt: Iso.nullable(),
});
export const VideoView = z.object({
  pieces: z.array(ContentPiece),
  jobs: z.array(Job),
  demoConfigured: z.boolean(),
  voiceConfigured: z.boolean(),
  workerAlive: z.boolean(),
  musicTracks: z.number().int(),
});

// --- Community radar, insights, weekly loop (Shot 5) -------------------------

export const CommunitySourceType = z.enum(["reddit", "hn", "rss"]);
export const CommunitySource = z.object({ type: CommunitySourceType, value: z.string().default(""), label: z.string().default(""), enabled: z.boolean().default(true) });
export const CommunityLeadPatch = z.object({ draftReply: z.string().optional(), status: LeadStatus.optional(), externalUrl: z.string().optional() });
export const CommunityView = z.object({
  leads: z.array(CommunityLead),
  sources: z.array(CommunitySource),
  lastScanAt: Iso.nullable(),
  scanning: z.boolean(),
  redditAuth: z.boolean(),
});

export const EventName = z.enum(["signup", "activated", "paid"]);
export const InboundEvent = z.object({
  event: EventName,
  utm: z.object({ source: z.string().default(""), medium: z.string().default(""), campaign: z.string().default(""), content: z.string().default("") }).default({ source: "", medium: "", campaign: "", content: "" }),
  userRef: z.string().default(""),
  occurredAt: Iso.optional(),
  meta: Json.optional(),
});
export const InsightsView = z.object({
  weeks: z.array(z.object({ weekStart: z.string(), signups: z.number().int(), activated: z.number().int(), paid: z.number().int() })),
  byChannel: z.array(z.object({ source: z.string(), signups: z.number().int(), activated: z.number().int(), paid: z.number().int() })),
  pieces: z.array(z.object({ pieceId: z.string(), title: z.string(), channel: z.string(), format: z.string(), signups: z.number().int(), publishedAt: Iso.nullable() })),
  geoHistory: z.array(z.object({ batch: z.string(), takenAt: Iso, visibility: z.number(), asked: z.number().int() })),
  totalEvents: z.number().int(),
  webhookConfigured: z.boolean(),
});

export const WeeklyReport = z.object({
  id: Id, projectId: Id, weekStart: z.string(), report: z.string(),
  proposedPlan: StrategyPlan.nullable(), diff: z.array(PlanDiffEntry),
  status: z.enum(["proposed", "adopted", "dismissed"]), createdAt: Iso, decidedAt: Iso.nullable(),
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
export type Evidence = z.infer<typeof Evidence>;
export type ChannelMeta = z.infer<typeof ChannelMeta>;
export type Brief = z.infer<typeof Brief>;
export type BriefPatch = z.infer<typeof BriefPatch>;
export type BriefMeta = z.infer<typeof BriefMeta>;
export type Complaint = z.infer<typeof Complaint>;
export type Competitor = z.infer<typeof Competitor>;
export type CrawlPage = z.infer<typeof CrawlPage>;
export type PageKind = z.infer<typeof PageKind>;
export type AnalysisStepName = z.infer<typeof AnalysisStepName>;
export type AnalysisStep = z.infer<typeof AnalysisStep>;
export type AnalysisRun = z.infer<typeof AnalysisRun>;
export type AnalysisView = z.infer<typeof AnalysisView>;
export type TaskCreate = z.infer<typeof TaskCreate>;
export type TaskPatch = z.infer<typeof TaskPatch>;
export type PlanChannel = z.infer<typeof PlanChannel>;
export type StrategyPlan = z.infer<typeof StrategyPlan>;
export type PlanDiffEntry = z.infer<typeof PlanDiffEntry>;
export type StrategyVersion = z.infer<typeof StrategyVersion>;
export type StrategyView = z.infer<typeof StrategyView>;
export type TimelineItem = z.infer<typeof TimelineItem>;
export type TimelineView = z.infer<typeof TimelineView>;
export type ProjectOverview = z.infer<typeof ProjectOverview>;
export type ContentPatch = z.infer<typeof ContentPatch>;
export type VoiceSample = z.infer<typeof VoiceSample>;
export type VoiceProfile = z.infer<typeof VoiceProfile>;
export type BrandKit = z.infer<typeof BrandKit>;
export type Platform = z.infer<typeof Platform>;
export type ArticleKind = z.infer<typeof ArticleKind>;
export type CarouselTemplate = z.infer<typeof CarouselTemplate>;
export type ContentRequest = z.infer<typeof ContentRequest>;
export type DirectoryDef = z.infer<typeof DirectoryDef>;
export type DirectoryStatus = z.infer<typeof DirectoryStatus>;
export type PublishPackage = z.infer<typeof PublishPackage>;
export type StudioView = z.infer<typeof StudioView>;
export type VideoAction = z.infer<typeof VideoAction>;
export type VideoScene = z.infer<typeof VideoScene>;
export type VideoScript = z.infer<typeof VideoScript>;
export type VideoDevice = z.infer<typeof VideoDevice>;
export type VideoScriptRequest = z.infer<typeof VideoScriptRequest>;
export type Job = z.infer<typeof Job>;
export type JobStep = z.infer<typeof JobStep>;
export type VideoView = z.infer<typeof VideoView>;
export type CommunitySource = z.infer<typeof CommunitySource>;
export type CommunityLeadPatch = z.infer<typeof CommunityLeadPatch>;
export type CommunityView = z.infer<typeof CommunityView>;
export type InboundEvent = z.infer<typeof InboundEvent>;
export type InsightsView = z.infer<typeof InsightsView>;
export type WeeklyReport = z.infer<typeof WeeklyReport>;
