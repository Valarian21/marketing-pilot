/** "Jetzt ausführen": run one agent task and park the result as a ContentPiece in review. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, withRun, type AgentContext } from "../runner.js";
import { executeTaskPrompt } from "../prompts/strategy.js";
import { getProject } from "../../repo/projects.js";
import { listPersonas } from "../analysis/personas.js";
import { currentVersion } from "./plan.js";
import { writeAudit } from "../../audit.js";
import type { HostUser } from "../../../host-adapter.js";
import { generateContent, type StudioContext } from "../studio/generate.js";
import { generateVideoScript } from "../video/script.js";
import { platformKey, saneTitle } from "../../../shared/channels.js";
import { createProductDataProvider, loadDataSource } from "../../data-source.js";

const Out = z.object({ title: z.string().default(""), body: z.string().min(1), notes: z.string().default("") });

/** Aufgaben, die nach einer Rangliste aus Produktdaten klingen (Shot 8). */
const RANKING = /teuerste|teuersten|wertvollste|wertvollsten|rangliste|preis-?raketen|top ?\d+|die ?\d+ (teuersten|wertvollsten|besten)/i;

export function formatForTask(task: { type: string; title: string; channel: string }, opts: { hasData?: boolean } = {}): s.ContentPiece["format"] {
  const txt = `${task.title} ${task.channel}`;
  if (task.type === "community") return "community_reply";
  if (task.type === "ads") return "ad_creative";
  // Nur Projekte mit Datenquelle: „Die 15 teuersten Karten …“ ist dort ein Daten-Format,
  // sonst bliebe es ein Text, den ein Modell sich ausdenken müsste.
  if (opts.hasData && task.type === "content" && RANKING.test(txt)) return /reel|video|short/i.test(txt) ? "data_reel" : "data_carousel";
  if (/directory|verzeichnis|alternativeto|product hunt|g2|saashub/i.test(txt)) return "directory_entry";
  if (/reel|video|short|demo/i.test(txt)) return "video";
  if (/carousel|karussell/i.test(txt)) return "carousel";
  if (/artikel|article|blog|vergleich|vs\.?|faq|landing/i.test(txt) || task.type !== "content") return "article";
  return "text";
}

export function rowToTask(r: typeof t.mpTasks.$inferSelect): s.Task {
  return { ...r, link: null, type: r.type as s.Task["type"], status: r.status as s.Task["status"], assignedTo: r.assignedTo as s.Task["assignedTo"], approvalLevel: r.approvalLevel as s.Task["approvalLevel"], outputRefs: parseJson<string[]>(r.outputRefs, []) };
}

/**
 * Welchen Ausschnitt der Produktdaten eine Aufgabe meint: nennt ihr Titel eine
 * Ära, dann die; sonst das neueste internationale Set. Mehr zu raten wäre
 * gefährlich — die Zahlen landen ungefiltert auf einer Slide.
 */
function dataQueryForTask(ctx: AgentContext, projectId: string, title: string): s.DataQuery {
  const provider = createProductDataProvider(ctx.db, ctx.env, projectId, { log: ctx.log });
  if (!provider) throw Object.assign(new Error("Dieses Projekt hat keine Produktdatenquelle."), { statusCode: 400 });
  try {
    const era = provider.listEras().find((e) => e.setCount > 0 && (title.toLowerCase().includes(e.name.toLowerCase()) || title.toLowerCase().includes(e.nameEn.toLowerCase())));
    if (era) return s.DataQuery.parse({ kind: "top", era: era.id, n: numberInTitle(title) });
    const set = provider.newestSets(1, "intl")[0];
    if (!set) throw Object.assign(new Error("Kein Set in den Produktdaten gefunden."), { statusCode: 400 });
    return s.DataQuery.parse({ kind: "top", set: set.id, n: numberInTitle(title) });
  } finally { provider.close(); }
}

/** „Die 15 teuersten …“ → 15. Ohne Zahl im Titel bleibt es beim Standard. */
function numberInTitle(title: string): number {
  const m = /\b(\d{1,2})\b/.exec(title);
  const n = m ? Number(m[1]) : 15;
  return n >= 3 && n <= 20 ? n : 15;
}

export async function executeTask(ctx: AgentContext, taskId: string, user: HostUser): Promise<s.ContentPiece> {
  const row = ctx.db.select().from(t.mpTasks).where(eq(t.mpTasks.id, taskId)).get();
  if (!row) throw Object.assign(new Error("Aufgabe nicht gefunden."), { statusCode: 404 });
  const task = rowToTask(row);
  if (task.assignedTo !== "agent") throw Object.assign(new Error("Diese Aufgabe ist dir zugewiesen - der Agent führt nur Agent-Aufgaben aus."), { statusCode: 400 });
  if (task.type === "publish" || task.type === "ads") throw Object.assign(new Error("Veröffentlichen und Werbebudget bleiben beim Menschen."), { statusCode: 400 });
  const project = getProject(ctx.db, task.projectId);
  const brief = s.Brief.safeParse(project?.brief);
  if (!brief.success) throw Object.assign(new Error("Kein bestätigter Brief - erst die Analyse abschließen."), { statusCode: 400 });
  const hasData = loadDataSource(ctx.db, task.projectId).provider !== "none";
  const format = formatForTask(task, { hasData });
  // Real formats go through the studio (proper prompts, renders, AI-tell check) or the video factory;
  // only research/strategy/measure notes use the generic task prompt below.
  const platform = platformKey(task.channel) ?? undefined;
  if (task.type === "content" && format === "video") {
    return generateVideoScript(ctx, task.projectId, { topic: task.title, hint: task.description, taskId: task.id }, user);
  }
  if (task.type === "content" && (format === "data_carousel" || format === "data_reel")) {
    const req = s.ContentRequest.parse({
      format, topic: task.title, hint: task.description, taskId: task.id,
      bundlePlatforms: platform && platform !== "website" ? [platform] : ["instagram", "tiktok"],
      dataQuery: dataQueryForTask(ctx, task.projectId, task.title),
    });
    return generateContent(ctx as unknown as StudioContext, task.projectId, req, user);
  }
  // directory entries need a directory slug - they are prepared from the studio's "Verzeichnisse" tab
  if (task.type === "content" && (format === "text" || format === "carousel" || format === "pin")) {
    const req = s.ContentRequest.parse({ format, topic: task.title, hint: task.description, taskId: task.id, ...(platform && s.Platform.safeParse(platform).success ? { platform } : {}) });
    return generateContent(ctx as unknown as StudioContext, task.projectId, req, user);
  }
  ctx.db.update(t.mpTasks).set({ status: "in_progress", updatedAt: nowIso() }).where(eq(t.mpTasks.id, taskId)).run();
  const pendingPieceId = newId();
  try {
    const { result } = await withRun(ctx.db, { task: `task.execute:${task.type}`, model: modelFor(task.type === "community" ? "community" : "content"), projectId: task.projectId, pieceId: pendingPieceId }, (usage) =>
      chatJson(ctx.llm, modelFor(task.type === "community" ? "community" : "content"), Out,
        executeTaskPrompt({ brief: brief.data, task, personas: listPersonas(ctx, task.projectId), plan: currentVersion(ctx.db, task.projectId)?.plan ?? null, format }), usage, { maxTokens: 4000, temperature: 0.5 }));
    const ts = nowIso();
    const piece = {
      id: pendingPieceId, projectId: task.projectId, taskId: task.id, channel: task.channel, format, title: saneTitle(result.title, result.body, task.title),
      body: result.body + (result.notes ? `\n\n---\nHinweise für die Prüfung:\n${result.notes}` : ""), assets: "[]", status: "review",
      humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}", meta: "{}", aiTellScore: null, aiTellNotes: "", rejectionReason: "", createdAt: ts, updatedAt: ts,
    };
    ctx.db.insert(t.mpContentPieces).values(piece).run();
    ctx.db.update(t.mpTasks).set({ status: "review", outputRefs: toJson([...task.outputRefs, piece.id]), updatedAt: ts }).where(eq(t.mpTasks.id, taskId)).run();
    writeAudit(ctx.db, { user, action: "task.execute", entityType: "task", entityId: task.id, projectId: task.projectId, content: { piece: piece.id, format } });
    return { ...piece, format, status: "review", assets: [], utm: {}, meta: {}, costUsd: 0 };
  } catch (e) {
    ctx.db.update(t.mpTasks).set({ status: task.status === "review" ? "review" : "todo", updatedAt: nowIso() }).where(eq(t.mpTasks.id, taskId)).run();
    throw e;
  }
}
