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

/** Aus der Graph-Meldung den Satz, der weiterhilft — die Rohmeldung steht in der Pipeline. */
export function kurzerGrund(fehler: string): string {
  if (!fehler) return "";
  if (/Best\\u00e4tige deine Identit|Bestätige deine Identität/i.test(fehler)) return "Facebook verlangt eine Identitätsprüfung — in der Facebook-App auf dem Handy erledigen.";
  if (/API access blocked/i.test(fehler)) return "Instagram hat den Zugang gesperrt — Token und App-Status prüfen.";
  if (/Media ID is not available/i.test(fehler)) return "Das Medium war beim Veröffentlichen noch nicht fertig.";
  if (/timeout|aborted/i.test(fehler)) return "Zeitüberschreitung beim Hochladen.";
  if (/pages_read_engage|permission/i.test(fehler)) return "Dem Zugang fehlt ein Recht.";
  const m = /"message":"([^"]{0,120})/.exec(fehler);
  return m?.[1] ?? fehler.slice(0, 120);
}

export function todayView(db: Db, projectId: string, opts?: { now?: Date }): s.TodayView {
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
  /**
   * Terminiertes ist keine Arbeit.
   *
   * Ein freigegebenes Stück mit wartendem Eintrag im Zeitplan wird vom Piloten
   * selbst gepostet. Es hier trotzdem zum Kopieren anzubieten, hieß: derselbe
   * Beitrag geht zweimal raus. Übrig bleibt, was keinen Termin hat oder haben
   * kann — die Kanäle ohne Schnittstelle.
   */
  const termine = db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.projectId, projectId)).all();
  const verplant = new Set(termine.filter((x) => x.status === "queued" || x.status === "posted").map((x) => x.pieceId));
  const wartend = termine.filter((x) => x.status === "queued").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const jeKanal = new Map<string, number>();
  for (const x of wartend) jeKanal.set(x.platform, (jeKanal.get(x.platform) ?? 0) + 1);
  const eingeplant = {
    anzahl: wartend.length,
    naechsterAt: wartend[0]?.scheduledAt ?? null,
    naechsterPlatform: wartend[0]?.platform ?? "",
    plattformen: [...jeKanal.entries()].map(([platform, anzahl]) => ({ platform, anzahl })).sort((a, b) => b.anzahl - a.anzahl),
  };
  // Gescheiterte Versuche der letzten zwei Wochen — älteres ist Geschichte.
  const seit = new Date((opts?.now ?? new Date()).getTime() - 14 * 86_400_000).toISOString();
  const fehlversuche = termine.filter((x) => x.status === "failed" && x.scheduledAt >= seit);
  // Der **häufigste** Grund, nicht der letzte: neun gescheiterte
  // Facebook-Beiträge wegen der Identitätsprüfung sagen mehr als der eine
  // Threads-Fehler, der zufällig zuletzt eintrat.
  const gruende = new Map<string, number>();
  for (const x of fehlversuche) {
    const g = kurzerGrund(x.error ?? "");
    if (g) gruende.set(g, (gruende.get(g) ?? 0) + 1);
  }
  const haeufigster = [...gruende.entries()].sort((a, b) => b[1] - a[1])[0];
  const gescheitert = {
    anzahl: fehlversuche.length,
    grund: haeufigster ? (gruende.size > 1 ? `häufigster Grund: ${haeufigster[0]}` : haeufigster[0]) : "",
  };
  const toPost = pieces.filter((p) => p.status === "approved" && !verplant.has(p.id)).map((p) => {
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
    toPost, eingeplant, gescheitert,
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
