/** "Heute" cockpit: what needs a human now (review, post, answer, this week's tasks) and what the agent can do.
 *  Also links tasks to the piece they are about, so a publish task leads straight to its package. */
import { and, eq } from "drizzle-orm";
import type * as s from "../shared/schemas.js";
import * as t from "./db/schema.js";
import { nowIso, type Db } from "./db/index.js";
import { canonicalChannel, channelLink, deepLinkFor, platformKey } from "../shared/channels.js";
import { pieceOf, withCosts } from "./agents/studio/generate.js";
import { formatForTask, rowToTask } from "./agents/strategy/execute.js";
import { currentVersion } from "./agents/strategy/plan.js";
import { listLeads } from "./agents/community/radar.js";
import { loadProfiles, planChannelNames } from "./channels.js";
import { loadBrandKit } from "./agents/studio/brandkit.js";
import { briefConfirmed } from "./routes/strategy.js";
import { weekOf } from "./routes/tasks.js";
import { jammedSeries } from "./agents/series/series.js";

const OPEN: s.Task["status"][] = ["todo", "in_progress", "review"];

/** Which piece a task is about: its own output, else the newest unpublished piece with the expected format on the same channel. */
export function attachLinks(db: Db, projectId: string, tasks: s.Task[]): s.Task[] {
  const plan = planChannelNames(db, projectId);
  const pieces = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all().map(pieceOf)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const mk = (p: s.ContentPiece): s.TaskLink => ({ pieceId: p.id, title: p.title, status: p.status, format: p.format });
  const taken = new Set<string>();   // each draft is suggested to one publish task only ("erstes Reel", "zweites Reel")
  return tasks.map((task) => {
    const own = [...task.outputRefs].reverse().map((id) => byId.get(id)).find(Boolean);
    if (own) { taken.add(own.id); return { ...task, link: mk(own) }; }
    if (task.type !== "publish") return { ...task, link: null };
    const format = formatForTask({ ...task, type: "content" });
    const ch = canonicalChannel(task.channel, plan);
    const title = task.title.toLowerCase();
    const open = pieces.filter((p) => p.status !== "rejected" && p.status !== "published" && !taken.has(p.id) && p.format === format);
    // same channel first; a directory task ("AlternativeTo-Eintrag … einreichen") names the directory in its title
    const hit = open.find((p) => canonicalChannel(p.channel, plan) === ch) ?? open.find((p) => p.channel && title.includes(p.channel.toLowerCase()));
    if (hit) taken.add(hit.id);
    return { ...task, link: hit ? mk(hit) : null };
  });
}

export function listTasks(db: Db, projectId: string): s.Task[] {
  return attachLinks(db, projectId, db.select().from(t.mpTasks).where(eq(t.mpTasks.projectId, projectId)).orderBy(t.mpTasks.week, t.mpTasks.order).all().map(rowToTask));
}

export function todayView(db: Db, projectId: string): s.TodayView {
  const plan = currentVersion(db, projectId);
  const project = db.select({ createdAt: t.mpProjects.createdAt }).from(t.mpProjects).where(eq(t.mpProjects.id, projectId)).get();
  const startDate = plan?.plan.startDate ?? project?.createdAt.slice(0, 10) ?? nowIso().slice(0, 10);
  const week = weekOf(startDate, nowIso());
  const thisWeek = week !== null && week >= 1 ? week : 1;
  const tasks = listTasks(db, projectId);
  const weekOfTask = (x: s.Task) => weekOf(startDate, x.dueAt) ?? x.week;
  const due = (x: s.Task) => OPEN.includes(x.status) && weekOfTask(x) <= thisWeek;
  const profiles = loadProfiles(db, projectId);
  const pieces = withCosts(db, db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all().map(pieceOf)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const toPost = pieces.filter((p) => p.status === "approved").map((p) => {
    const platform = String(p.meta["platform"] ?? platformKey(p.channel) ?? "other");
    const link = channelLink(p.channel || platform, profiles);
    const compose = deepLinkFor(platform);
    return { piece: p, platform, composeLink: compose?.url ?? null, composeLabel: compose?.label ?? null, profileLink: link.url, appOnly: link.appOnly };
  });
  const leads = listLeads(db, projectId).filter((l) => l.status === "new" || l.status === "drafted");
  const weekTasks = tasks.filter((x) => weekOfTask(x) === thisWeek);
  const kit = loadBrandKit(db, projectId);
  return {
    startDate, week: thisWeek, weekPlanned: week !== null && week >= 1,
    review: pieces.filter((p) => p.status === "review"),
    toPost,
    leads: { count: leads.length, top: leads.slice(0, 5) },
    myTasks: tasks.filter((x) => x.assignedTo === "human" && due(x) && x.status !== "review"),
    agentTasks: tasks.filter((x) => x.assignedTo === "agent" && due(x) && x.status === "todo" && x.type !== "publish" && x.type !== "ads"),
    progress: { done: weekTasks.filter((x) => x.status === "done" || x.status === "skipped").length, total: weekTasks.length },
    // Stau: eine Serie hat zweimal geliefert, ohne dass jemand freigegeben hat -
    // dann ist nicht der Agent zu langsam, sondern die Kadenz zu hoch.
    seriesStuck: jammedSeries(db, projectId),
    setup: {
      briefConfirmed: briefConfirmed(db, projectId), planVersion: plan?.version ?? null,
      profilesMissing: profiles.filter((p) => !p.url).length, voiceProfile: Boolean(kit.voiceProfile),
      eventsSeen: db.select({ id: t.mpEvents.id }).from(t.mpEvents).where(and(eq(t.mpEvents.projectId, projectId), eq(t.mpEvents.event, "signup"))).limit(1).all().length > 0,
    },
  };
}
