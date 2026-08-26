/** "Change this": one instruction from the founder applied to a finished piece - text edit or script revision + re-render. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { nowIso, parseJson, toJson } from "../db/index.js";
import { modelFor } from "../../../config/models.js";
import { chatJson, withRun } from "./runner.js";
import { reviseScriptPrompt, reviseTextPrompt } from "./prompts/revise.js";
import { getProject } from "../repo/projects.js";
import { loadBrandKit } from "./studio/brandkit.js";
import { voiceBlock } from "./studio/voice.js";
import { getPiece, type StudioContext } from "./studio/generate.js";
import { enqueueJob, hasActiveJob, workerAlive } from "../jobs.js";
import { HOOK_MS, VIDEO_STEPS, type SceneNote } from "./video/pipeline.js";
import { PLATFORM_LIMITS } from "../util/utm.js";
import { writeAudit } from "../audit.js";
import type { HostUser } from "../../host-adapter.js";

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });

export interface ReviseResult { piece: s.ContentPiece; changed: string; job: s.Job | null; needsRecording: boolean }

export async function revisePiece(ctx: StudioContext, pieceId: string, instruction: string, user: HostUser): Promise<ReviseResult> {
  const piece = getPiece(ctx.db, pieceId);
  if (!piece) throw err("Stück nicht gefunden.", 404);
  if (piece.status === "published") throw err("Veröffentlichte Stücke werden nicht mehr geändert - neues Stück erzeugen.");
  const project = getProject(ctx.db, piece.projectId);
  const brief = s.Brief.safeParse(project?.brief);
  if (!brief.success) throw err("Kein Brief am Projekt.");
  const voice = voiceBlock(loadBrandKit(ctx.db, piece.projectId));
  const revisions = Array.isArray(piece.meta["revisions"]) ? (piece.meta["revisions"] as unknown[]) : [];

  if (piece.format === "video") {
    const script = s.VideoScript.safeParse(piece.meta["script"]);
    if (!script.success) throw err("Kein Skript am Video-Stück.");
    const timeline = z.array(z.object({ id: z.string(), startMs: z.number(), endMs: z.number() })).safeParse(piece.meta["timeline"]);
    const notes = z.array(z.object({ id: z.string(), seen: z.string().optional(), issue: z.string().optional() })).safeParse(piece.meta["sceneNotes"]);
    const Out = z.object({ script: s.VideoScript, needsRecording: z.boolean().default(true), changed: z.string().default("") });
    const { result } = await withRun(ctx.db, { task: "revise.script", model: modelFor("script"), projectId: piece.projectId, pieceId }, (usage) =>
      chatJson(ctx.llm, modelFor("script"), Out, reviseScriptPrompt({ brief: brief.data, script: script.data, timeline: timeline.success ? timeline.data : [], hookMs: Number(piece.meta["hookMs"] ?? HOOK_MS), instruction, sceneNotes: notes.success ? (notes.data as SceneNote[]) : [] }), usage, { maxTokens: 6000, temperature: 0.3 }));
    const actionsChanged = JSON.stringify(script.data.scenes.map((x) => [x.id, x.actions, x.durationMs])) !== JSON.stringify(result.script.scenes.map((x) => [x.id, x.actions, x.durationMs])) || JSON.stringify(script.data.devices) !== JSON.stringify(result.script.devices);
    const needsRecording = result.needsRecording || actionsChanged;
    ctx.db.update(t.mpContentPieces).set({ meta: toJson({ ...piece.meta, script: result.script, revisions: [...revisions, { at: nowIso(), instruction, changed: result.changed, needsRecording }] }), title: result.script.title, updatedAt: nowIso() }).where(eq(t.mpContentPieces.id, pieceId)).run();
    writeAudit(ctx.db, { user, action: "content.revise", entityType: "content_piece", entityId: pieceId, projectId: piece.projectId, content: { instruction, changed: result.changed, needsRecording } });
    let job: s.Job | null = null;
    if (workerAlive(ctx.db) && !hasActiveJob(ctx.db, piece.projectId, "video.render")) {
      const variants = Array.isArray(piece.meta["variants"]) ? Math.max(1, (piece.meta["variants"] as unknown[]).filter((v) => String((v as { variant: string }).variant).startsWith("reel")).length) : 1;
      const landscape = Array.isArray(piece.meta["variants"]) && (piece.meta["variants"] as { variant: string }[]).some((v) => v.variant === "landscape");
      job = enqueueJob(ctx.db, { projectId: piece.projectId, kind: "video.render", payload: { pieceId, variants, landscape, reuseRecording: !needsRecording }, steps: VIDEO_STEPS });
    }
    return { piece: getPiece(ctx.db, pieceId)!, changed: result.changed, job, needsRecording };
  }

  const platform = typeof piece.meta["platform"] === "string" ? piece.meta["platform"] : undefined;
  const limit = piece.format === "text" && platform ? PLATFORM_LIMITS[platform] : undefined;
  const Out = z.object({ body: z.string().min(1), changed: z.string().default("") });
  const { result } = await withRun(ctx.db, { task: `revise.${piece.format}`, model: modelFor("content"), projectId: piece.projectId, pieceId }, (usage) =>
    chatJson(ctx.llm, modelFor("content"), Out, reviseTextPrompt({ brief: brief.data, format: piece.format, body: piece.body, instruction, voiceProfile: voice, ...(limit ? { limit } : {}) }), usage, { maxTokens: 8000, temperature: 0.4 }));
  const meta = { ...piece.meta, revisions: [...revisions, { at: nowIso(), instruction, changed: result.changed }], ...(limit ? { length: result.body.length, overLimit: result.body.length > limit } : {}) };
  ctx.db.update(t.mpContentPieces).set({ body: result.body, meta: toJson(meta), status: piece.status === "approved" ? "review" : piece.status, updatedAt: nowIso() }).where(eq(t.mpContentPieces.id, pieceId)).run();
  writeAudit(ctx.db, { user, action: "content.revise", entityType: "content_piece", entityId: pieceId, projectId: piece.projectId, content: { instruction, changed: result.changed } });
  return { piece: getPiece(ctx.db, pieceId)!, changed: result.changed, job: null, needsRecording: false };
}

export { parseJson };
