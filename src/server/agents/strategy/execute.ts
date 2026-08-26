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

const Out = z.object({ title: z.string().default(""), body: z.string().min(1), notes: z.string().default("") });

export function formatForTask(task: { type: string; title: string; channel: string }): s.ContentPiece["format"] {
  const txt = `${task.title} ${task.channel}`;
  if (task.type === "community") return "community_reply";
  if (task.type === "ads") return "ad_creative";
  if (/directory|verzeichnis|alternativeto|product hunt|g2|saashub/i.test(txt)) return "directory_entry";
  if (/reel|video|short|demo/i.test(txt)) return "video";
  if (/carousel|karussell/i.test(txt)) return "carousel";
  if (/artikel|article|blog|vergleich|vs\.?|faq|landing/i.test(txt) || task.type !== "content") return "article";
  return "text";
}

export function rowToTask(r: typeof t.mpTasks.$inferSelect): s.Task {
  return { ...r, type: r.type as s.Task["type"], status: r.status as s.Task["status"], assignedTo: r.assignedTo as s.Task["assignedTo"], approvalLevel: r.approvalLevel as s.Task["approvalLevel"], outputRefs: parseJson<string[]>(r.outputRefs, []) };
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
  const format = formatForTask(task);
  ctx.db.update(t.mpTasks).set({ status: "in_progress", updatedAt: nowIso() }).where(eq(t.mpTasks.id, taskId)).run();
  try {
    const { result } = await withRun(ctx.db, { task: `task.execute:${task.type}`, model: modelFor(task.type === "community" ? "community" : "content"), projectId: task.projectId }, (usage) =>
      chatJson(ctx.llm, modelFor(task.type === "community" ? "community" : "content"), Out,
        executeTaskPrompt({ brief: brief.data, task, personas: listPersonas(ctx, task.projectId), plan: currentVersion(ctx.db, task.projectId)?.plan ?? null, format }), usage, { maxTokens: 4000, temperature: 0.5 }));
    const ts = nowIso();
    const piece = {
      id: newId(), projectId: task.projectId, taskId: task.id, channel: task.channel, format, title: result.title || task.title,
      body: result.body + (result.notes ? `\n\n---\nHinweise für die Prüfung:\n${result.notes}` : ""), assets: "[]", status: "review",
      humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}", createdAt: ts, updatedAt: ts,
    };
    ctx.db.insert(t.mpContentPieces).values(piece).run();
    ctx.db.update(t.mpTasks).set({ status: "review", outputRefs: toJson([...task.outputRefs, piece.id]), updatedAt: ts }).where(eq(t.mpTasks.id, taskId)).run();
    writeAudit(ctx.db, { user, action: "task.execute", entityType: "task", entityId: task.id, projectId: task.projectId, content: { piece: piece.id, format } });
    return { ...piece, format, status: "review", assets: [], utm: {} };
  } catch (e) {
    ctx.db.update(t.mpTasks).set({ status: task.status === "review" ? "review" : "todo", updatedAt: nowIso() }).where(eq(t.mpTasks.id, taskId)).run();
    throw e;
  }
}
