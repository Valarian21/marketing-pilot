/** Demo script agent: brief + persona + task -> scenes, hooks, CTA; stored on a ContentPiece (format video, status draft). */
import { eq } from "drizzle-orm";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, withRun, type AgentContext } from "../runner.js";
import { videoScriptPrompt } from "../prompts/video.js";
import { getProject } from "../../repo/projects.js";
import { listPersonas } from "../analysis/personas.js";
import { loadBrandKit } from "../studio/brandkit.js";
import { voiceBlock } from "../studio/voice.js";
import { writeAudit } from "../../audit.js";
import type { HostUser } from "../../../host-adapter.js";
import { pieceOf } from "../studio/generate.js";

export function scriptToBody(script: s.VideoScript): string {
  return [
    `Ziel: ${script.goal}`, `Geräte: ${script.devices.join(", ")}`, "",
    "Hooks:", ...script.hooks.map((h, i) => `${i + 1}. ${h}`), "",
    ...script.scenes.flatMap((sc, i) => [`Szene ${i + 1} (${sc.id}, ${Math.round(sc.durationMs / 1000)} s)`, `  Voiceover: ${sc.voiceover}`, sc.caption ? `  Caption: ${sc.caption}` : "", `  Aktionen: ${sc.actions.map((a) => `${a.type}${a.url ? " " + a.url : ""}${a.target ? " „" + a.target + "“" : ""}${a.text ? " '" + a.text + "'" : ""}${a.y ? " " + a.y + "px" : ""}${a.ms ? " " + a.ms + "ms" : ""}`).join(" → ") || "-"}`, ""].filter((x) => x !== "")),
    `CTA: ${script.cta.text} — ${script.cta.url}`,
  ].join("\n");
}

export async function generateVideoScript(ctx: AgentContext, projectId: string, req: s.VideoScriptRequest, user: HostUser): Promise<s.ContentPiece> {
  const project = getProject(ctx.db, projectId);
  if (!project) throw Object.assign(new Error("Projekt nicht gefunden."), { statusCode: 404 });
  const brief = s.Brief.safeParse(project.brief);
  if (!brief.success) throw Object.assign(new Error("Kein Brief - erst die Analyse ausführen."), { statusCode: 400 });
  const personas = listPersonas(ctx, projectId);
  const pages = ctx.db.select({ url: t.mpPages.url, title: t.mpPages.title, kind: t.mpPages.kind }).from(t.mpPages).where(eq(t.mpPages.projectId, projectId)).all().slice(0, 15);
  const demoBaseUrl = ctx.env.MP_DEMO_BASE_URL ?? null;
  const hasLogin = Boolean(demoBaseUrl && ctx.env.MP_DEMO_USER && ctx.env.MP_DEMO_PASSWORD);
  const model = modelFor("script");
  const { result: script } = await withRun(ctx.db, { task: "video.script", model, projectId }, (usage) =>
    chatJson(ctx.llm, model, s.VideoScript, videoScriptPrompt({
      brief: brief.data, ...(personas[0] ? { persona: personas[0] } : {}), topic: req.topic, hint: req.hint, voiceProfile: voiceBlock(loadBrandKit(ctx.db, projectId)),
      demoBaseUrl, pages, hasLogin, targetSeconds: 30,
    }), usage, { maxTokens: 5000, temperature: 0.5 }));
  if (req.devices?.length) script.devices = req.devices;
  const ts = nowIso();
  const id = newId();
  ctx.db.insert(t.mpContentPieces).values({
    id, projectId, taskId: req.taskId ?? null, channel: "instagram", format: "video", title: script.title, body: scriptToBody(script), assets: "[]", status: "draft",
    humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}", meta: toJson({ script, request: req, platform: "instagram" }), aiTellScore: null, aiTellNotes: "", rejectionReason: "", createdAt: ts, updatedAt: ts,
  }).run();
  if (req.taskId) {
    const task = ctx.db.select().from(t.mpTasks).where(eq(t.mpTasks.id, req.taskId)).get();
    if (task) ctx.db.update(t.mpTasks).set({ status: "in_progress", outputRefs: toJson([...parseJson<string[]>(task.outputRefs, []), id]), updatedAt: ts }).where(eq(t.mpTasks.id, task.id)).run();
  }
  writeAudit(ctx.db, { user, action: "video.script", entityType: "content_piece", entityId: id, projectId, content: { title: script.title, scenes: script.scenes.length } });
  return pieceOf(ctx.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, id)).get()!);
}

export function updateVideoScript(db: Db, pieceId: string, script: s.VideoScript, user: HostUser): s.ContentPiece | null {
  const row = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  if (!row || row.format !== "video") return null;
  const meta = parseJson<Record<string, unknown>>(row.meta, {});
  db.update(t.mpContentPieces).set({ meta: toJson({ ...meta, script }), title: script.title, body: scriptToBody(script), humanEdited: true, updatedAt: nowIso() }).where(eq(t.mpContentPieces.id, pieceId)).run();
  writeAudit(db, { user, action: "video.script.edit", entityType: "content_piece", entityId: pieceId, projectId: row.projectId, content: { scenes: script.scenes.length } });
  return pieceOf(db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get()!);
}
