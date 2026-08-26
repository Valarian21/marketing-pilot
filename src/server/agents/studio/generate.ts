/** Content generators (Shot 3): one entry point per format, all through the critic loop, results as ContentPieces in review. */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import * as t from "../../db/schema.js";
import { newId, nowIso, parseJson, toJson, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { DEFAULT_DIRECTORIES } from "../../../../config/directories.js";
import { chatJson, withRun, type AgentContext, type UsageCollector } from "../runner.js";
import type { ImageProvider, PublishProvider } from "../../providers/index.js";
import { articleMetaPrompt, articlePrompt, carouselPrompt, directoryPrompt, imagePrompt, pinPrompt, textPostPrompt } from "../prompts/studio.js";
import { getProject } from "../../repo/projects.js";
import { listPersonas } from "../analysis/personas.js";
import { listCompetitors } from "../analysis/competitors.js";
import { currentVersion } from "../strategy/plan.js";
import { loadBrandKit, type BrandExtractor } from "./brandkit.js";
import { voiceBlock } from "./voice.js";
import { reviseWithCritic } from "./critic.js";
import { carouselSlideHtml, dataUrlFor, framedScreenshotHtml, pinHtml, playwrightRenderer, type RenderJob, type Renderer } from "./render.js";
import { buildUtmUrl, deepLinkFor, PLATFORM_LIMITS, platformFromChannel, slugify } from "../../util/utm.js";
import { markdownToHtml } from "../../util/markdown.js";
import { pngSize } from "../../util/png.js";
import { pieceCosts, writeAudit } from "../../audit.js";
import { enqueueJob, hasActiveJob, workerAlive } from "../../jobs.js";
import { renderOptionsFromMeta, VIDEO_STEPS } from "../video/pipeline.js";
import type { HostUser } from "../../../host-adapter.js";

export interface StudioContext extends AgentContext {
  image: ImageProvider | null;
  publish: PublishProvider;
  renderer?: Renderer;
  brandExtractor?: BrandExtractor;
}

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });

export const pieceOf = (r: typeof t.mpContentPieces.$inferSelect): s.ContentPiece => ({
  ...r, format: r.format as s.ContentPiece["format"], status: r.status as s.ContentPiece["status"],
  assets: parseJson<string[]>(r.assets, []), utm: parseJson<Record<string, unknown>>(r.utm, {}), meta: parseJson<Record<string, unknown>>(r.meta, {}), costUsd: 0,
});
/** Attach the booked agent-run costs (all providers) to pieces. */
export function withCosts<T extends { id: string; costUsd: number }>(db: Db, pieces: T[]): T[] {
  const costs = pieceCosts(db, pieces.map((p) => p.id));
  return pieces.map((p) => ({ ...p, costUsd: Math.round((costs.get(p.id) ?? 0) * 10000) / 10000 }));
}
export function getPiece(db: Db, id: string): s.ContentPiece | null {
  const r = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, id)).get();
  return r ? withCosts(db, [pieceOf(r)])[0]! : null;
}

export function projectScreenshots(db: Db, projectId: string): (typeof t.mpAssets.$inferSelect & { label: string })[] {
  return db.select().from(t.mpAssets).where(and(eq(t.mpAssets.projectId, projectId), eq(t.mpAssets.kind, "screenshot"))).all()
    .map((a) => ({ ...a, label: String(parseJson<Record<string, unknown>>(a.meta, {})["kind"] ?? "screenshot") }));
}

export function directoriesFor(db: Db, projectId: string): s.DirectoryDef[] {
  const row = db.select().from(t.mpSettings).where(eq(t.mpSettings.key, `directories:${projectId}`)).get();
  const parsed = z.array(s.DirectoryDef).safeParse(parseJson(row?.value ?? "[]", []));
  return parsed.success && parsed.data.length ? parsed.data : DEFAULT_DIRECTORIES;
}

interface Base { db: Db; project: s.Project; brief: s.Brief; personas: s.Persona[]; kit: s.BrandKit; voice: string | null; coreMessage: string | null; language: string }
function loadBase(ctx: StudioContext, projectId: string): Base {
  const project = getProject(ctx.db, projectId);
  if (!project) throw err("Projekt nicht gefunden.", 404);
  const brief = s.Brief.safeParse(project.brief);
  if (!brief.success) throw err("Kein Brief - erst die Analyse ausführen und bestätigen.");
  const kit = loadBrandKit(ctx.db, projectId);
  return { db: ctx.db, project, brief: brief.data, personas: listPersonas(ctx, projectId), kit, voice: voiceBlock(kit), coreMessage: currentVersion(ctx.db, projectId)?.plan.coreMessage.text ?? null, language: brief.data.language };
}

function addAsset(db: Db, dataDir: string, projectId: string, pieceId: string, kind: s.Asset["kind"], file: string, meta: Record<string, unknown>): string {
  const id = newId();
  db.insert(t.mpAssets).values({ id, projectId, contentPieceId: pieceId, kind, path: path.relative(dataDir, file), meta: toJson({ aiGenerated: true, provenance: "png-text-chunk", ...meta }), createdAt: nowIso() }).run();
  return id;
}

interface Draft { title: string; body: string; format: s.ContentPiece["format"]; channel: string; meta: Record<string, unknown>; assets: string[]; score: number | null; notes: string }

const SIZES = [{ w: 1080, h: 1080, tag: "1080x1080" }, { w: 1080, h: 1350, tag: "1080x1350" }];

async function draftFor(ctx: StudioContext, base: Base, req: s.ContentRequest, pieceId: string, usage: UsageCollector): Promise<Draft> {
  const persona = base.personas[0];
  const shots = projectScreenshots(ctx.db, base.project.id);
  const outDir = path.join(ctx.dataDir, "assets", base.project.id, "pieces", pieceId);
  const renderer = ctx.renderer ?? playwrightRenderer;
  const brand = base.brief.productName;
  const common = { brief: base.brief, ...(persona ? { persona } : {}), topic: req.topic, hint: req.hint, voiceProfile: base.voice };

  switch (req.format) {
    case "text": {
      const platform = req.platform ?? "linkedin";
      const limit = PLATFORM_LIMITS[platform] ?? 2000;
      const out = await chatJson(ctx.llm, modelFor("content"), z.object({ title: z.string().default(""), body: z.string().min(1), altText: z.string().default("") }),
        textPostPrompt({ ...common, platform, limit, coreMessage: base.coreMessage, screenshotsAvailable: shots.length }), usage, { maxTokens: 2000, temperature: 0.6 });
      const rev = await reviseWithCritic(ctx, usage, { body: out.body, language: base.language, voiceProfile: base.voice, format: "text", platform, limit });
      const over = rev.body.length > limit;
      return { title: out.title || `${platform}: ${req.topic || base.brief.oneLiner}`.slice(0, 120), body: rev.body, format: "text", channel: platform,
        meta: { platform, limit, length: rev.body.length, altText: out.altText, overLimit: over, request: req }, assets: [], score: rev.score, notes: rev.notes + (over ? `\nACHTUNG: ${rev.body.length} Zeichen > Limit ${limit}.` : "") };
    }
    case "carousel": {
      const template = req.template ?? "clean";
      const chosen = (req.screenshotAssetIds?.length ? shots.filter((x) => req.screenshotAssetIds!.includes(x.id)) : shots).slice(0, 3);
      const out = await chatJson(ctx.llm, modelFor("content"), z.object({ title: z.string().default(""), caption: z.string().default(""), slides: z.array(z.object({ kind: z.enum(["text", "screenshot"]).default("text"), headline: z.string(), body: z.string().default(""), screenshotId: z.string().default("") })).min(3).max(10) }),
        carouselPrompt({ ...common, screenshots: chosen.map((x) => ({ id: x.id, label: x.label })), slides: 7 }), usage, { maxTokens: 3000, temperature: 0.6 });
      const slidesText = out.slides.map((sl, i) => `${i + 1}. ${sl.headline}${sl.body ? ` - ${sl.body}` : ""}`).join("\n");
      // Critic on the caption only: slides are structured (headline/body) and would break when rewritten as prose.
      const rev = await reviseWithCritic(ctx, usage, { body: out.caption || slidesText, language: base.language, voiceProfile: base.voice, format: "carousel", platform: req.platform ?? "instagram", maxRounds: 2 });
      const caption = out.caption ? rev.body : out.caption;
      const jobs: RenderJob[] = []; const files: { file: string; size: string; index: number }[] = [];
      for (const size of SIZES) {
        out.slides.forEach((sl, i) => {
          const shot = sl.kind === "screenshot" ? chosen.find((x) => x.id === sl.screenshotId) ?? chosen[0] : undefined;
          const img = shot ? dataUrlFor(path.join(ctx.dataDir, shot.path)) : null;
          const file = path.join(outDir, `carousel-${size.tag}-${String(i + 1).padStart(2, "0")}.png`);
          jobs.push({ html: carouselSlideHtml(base.kit, template, { kind: img ? "screenshot" : "text", headline: sl.headline, body: sl.body, ...(img ? { imageDataUrl: img } : {}), index: i, total: out.slides.length }, size.w, size.h, brand), width: size.w, height: size.h, file });
          files.push({ file, size: size.tag, index: i });
        });
      }
      await renderer(jobs);
      const assets = files.map((f) => addAsset(ctx.db, ctx.dataDir, base.project.id, pieceId, "render", f.file, { size: f.size, slide: f.index + 1, template }));
      return { title: out.title || `Carousel: ${req.topic || out.slides[0]?.headline}`.slice(0, 120), body: `${caption}\n\n${slidesText}`, format: "carousel", channel: req.platform ?? "instagram",
        meta: { template, slides: out.slides, caption, sizes: SIZES.map((x) => x.tag), request: req }, assets, score: rev.score, notes: rev.notes };
    }
    case "pin": {
      const out = await chatJson(ctx.llm, modelFor("content"), z.object({ title: z.string().max(140), description: z.string(), overlay: z.string(), altText: z.string().default("") }), pinPrompt(common), usage, { maxTokens: 1200, temperature: 0.6 });
      const rev = await reviseWithCritic(ctx, usage, { body: `${out.title}\n\n${out.description}`, language: base.language, voiceProfile: base.voice, format: "pin", maxRounds: 1 });
      const utm = buildUtmUrl(base.project.url, { source: "pinterest", medium: "social", campaign: slugify(req.topic || "pins"), content: pieceId });
      const shot = shots[0]; const img = shot ? dataUrlFor(path.join(ctx.dataDir, shot.path)) : null;
      const file = path.join(outDir, "pin-1000x1500.png");
      await renderer([{ html: pinHtml(base.kit, out.overlay, brand, base.project.url, img), width: 1000, height: 1500, file }]);
      const assetId = addAsset(ctx.db, ctx.dataDir, base.project.id, pieceId, "render", file, { size: "1000x1500", overlay: out.overlay });
      return { title: out.title, body: rev.body, format: "pin", channel: "pinterest", meta: { platform: "pinterest", overlay: out.overlay, altText: out.altText, targetUrl: utm, request: req }, assets: [assetId], score: rev.score, notes: rev.notes };
    }
    case "image":
    case "ad_creative": {
      if (!ctx.image) throw err("Kein Bildmodell konfiguriert (MP_MODEL_IMAGE / OPENROUTER_API_KEY).", 503);
      const purpose = req.format === "ad_creative" ? "ad background" : "thumbnail / social background";
      const prompt = imagePrompt({ brief: base.brief, purpose, topic: req.topic, hint: req.hint, primaryColor: base.kit.primary });
      const res = await ctx.image.generate({ prompt, width: 1200, height: 628 }, outDir);
      usage.add(res.usage);
      const assetId = addAsset(ctx.db, ctx.dataDir, base.project.id, pieceId, "image", res.path, { model: res.model, prompt });
      return { title: `${req.format === "ad_creative" ? "Ad-Hintergrund" : "Bild"}: ${req.topic || base.brief.productName}`.slice(0, 120), body: `Prompt: ${prompt}\n\nHinweis: KI-generiertes Bild, nur als Hintergrund/Thumbnail - nie als Ersatz für Produkt-Screenshots.`, format: req.format, channel: req.platform ?? "other", meta: { prompt, model: res.model, request: req }, assets: [assetId], score: null, notes: "" };
    }
    case "directory_entry": {
      const dir = directoriesFor(ctx.db, base.project.id).find((d) => d.slug === req.directory);
      if (!dir) throw err("Unbekanntes Verzeichnis: " + (req.directory ?? "(leer)"));
      const out = await chatJson(ctx.llm, modelFor("content"), z.object({ tagline: z.string(), descriptionShort: z.string(), descriptionMedium: z.string(), descriptionLong: z.string(), categories: z.array(z.string()).default([]), tags: z.array(z.string()).default([]), alternatives: z.array(z.string()).default([]), firstComment: z.string().default("") }),
        directoryPrompt({ brief: base.brief, directory: dir, competitors: listCompetitors(ctx, base.project.id).map((c) => c.name), voiceProfile: base.voice }), usage, { maxTokens: 3000, temperature: 0.4 });
      const tagline = out.tagline.length > dir.taglineMax ? out.tagline.slice(0, dir.taglineMax).replace(/\s+\S*$/, "") : out.tagline;
      const rev = await reviseWithCritic(ctx, usage, { body: out.descriptionLong, language: base.language, voiceProfile: base.voice, format: "directory_entry", maxRounds: 1 });
      const fields = { ...out, tagline, descriptionLong: rev.body };
      const jobs: RenderJob[] = []; const rendered: { file: string; size: string }[] = [];
      for (const size of dir.screenshotSizes) shots.slice(0, 3).forEach((shot, i) => {
        const img = dataUrlFor(path.join(ctx.dataDir, shot.path)); if (!img) return;
        const file = path.join(outDir, `${dir.slug}-${size.w}x${size.h}-${i + 1}.png`);
        jobs.push({ html: framedScreenshotHtml(base.kit, img, size.w, size.h), width: size.w, height: size.h, file }); rendered.push({ file, size: `${size.w}x${size.h}` });
      });
      await renderer(jobs);
      const assets = rendered.map((r) => addAsset(ctx.db, ctx.dataDir, base.project.id, pieceId, "render", r.file, { size: r.size, directory: dir.slug, containsProductScreenshot: true }));
      const body = [`Tagline (${tagline.length}/${dir.taglineMax}): ${tagline}`, "", `Kurz (${fields.descriptionShort.length}): ${fields.descriptionShort}`, "", `Mittel (${fields.descriptionMedium.length}):\n${fields.descriptionMedium}`, "", `Lang (${fields.descriptionLong.length}):\n${fields.descriptionLong}`, "", `Kategorien: ${fields.categories.join(", ")}`, `Tags: ${fields.tags.join(", ")}`, `Alternativen zu: ${fields.alternatives.join(", ")}`, "", `Erster Kommentar:\n${fields.firstComment}`].join("\n");
      return { title: `${dir.name}: Eintrag ${base.brief.productName}`, body, format: "directory_entry", channel: dir.name, meta: { directory: dir.slug, fields, deepLink: dir.submitUrl, notes: dir.notes, request: req }, assets, score: rev.score, notes: rev.notes };
    }
    case "article": {
      const kind = req.articleKind ?? "comparison";
      const comps = listCompetitors(ctx, base.project.id);
      const competitor = req.competitor ?? comps[0]?.name;
      // Long Markdown as plain text (JSON escaping breaks on 10k+ chars), metadata in a second small JSON call.
      const draft = await ctx.llm.chat(modelFor("analysis"), articlePrompt({ ...common, kind, ...(competitor ? { competitor } : {}), competitors: comps.map((c) => ({ name: c.name, positioning: c.positioning, pricing: c.pricing, complaints: c.complaints.map((x) => x.text) })), productUrl: base.project.url }), { temperature: 0.4, maxTokens: 9000 });
      usage.add(draft.usage);
      const markdown = draft.text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
      if (markdown.length < 400) throw new Error("Artikel zu kurz - Modell hat keinen vollständigen Text geliefert.");
      const rev = await reviseWithCritic(ctx, usage, { body: markdown, language: base.language, voiceProfile: base.voice, format: "article", maxRounds: 1 });
      const meta = await chatJson(ctx.llm, modelFor("critic"), z.object({ title: z.string(), slug: z.string().default(""), metaDescription: z.string().default(""), faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]), jsonLd: z.array(z.record(z.string(), z.unknown())).default([]) }),
        articleMetaPrompt({ brief: base.brief, markdown: rev.body, productUrl: base.project.url }), usage, { maxTokens: 4000 });
      const slug = slugify(meta.slug || meta.title);
      const jsonLd = meta.jsonLd.length ? meta.jsonLd : [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: meta.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }];
      const html = renderArticleHtml({ title: meta.title, metaDescription: meta.metaDescription, markdown: rev.body, jsonLd, language: base.language });
      const file = path.join(outDir, `${slug}.html`); fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(file, html);
      return { title: meta.title, body: rev.body, format: "article", channel: "website", meta: { kind, competitor: competitor ?? null, slug, metaDescription: meta.metaDescription, faq: meta.faq, jsonLd, htmlPath: path.relative(ctx.dataDir, file), request: req }, assets: [], score: rev.score, notes: rev.notes };
    }
    default:
      throw err(`Format "${req.format}" kommt in einem späteren Shot (Video: Shot 4, Community-Antworten: Shot 5).`);
  }
}

export function renderArticleHtml(a: { title: string; metaDescription: string; markdown: string; jsonLd: unknown[]; language: string }): string {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<!doctype html>\n<html lang="${esc(a.language)}">\n<head>\n<meta charset="utf-8">\n<title>${esc(a.title)}</title>\n<meta name="description" content="${esc(a.metaDescription)}">\n<script type="application/ld+json">${JSON.stringify(a.jsonLd.length === 1 ? a.jsonLd[0] : a.jsonLd)}</script>\n</head>\n<body>\n<article>\n${markdownToHtml(a.markdown)}\n</article>\n</body>\n</html>\n`;
}

/** Insert the piece row first (assets reference it), then fill it once the draft exists. */
function insertPlaceholder(db: Db, projectId: string, pieceId: string, req: s.ContentRequest, taskId: string | null): void {
  const ts = nowIso();
  db.insert(t.mpContentPieces).values({ id: pieceId, projectId, taskId, channel: req.platform ?? "", format: req.format, title: "(wird erzeugt)", body: "", assets: "[]", status: "draft", humanEdited: false, publishedAt: null, externalUrl: null, utm: "{}", meta: toJson({ request: req }), aiTellScore: null, aiTellNotes: "", rejectionReason: "", createdAt: ts, updatedAt: ts }).run();
}

function fillPiece(db: Db, pieceId: string, d: Draft, existingMeta: Record<string, unknown>): s.ContentPiece {
  const ts = nowIso();
  db.update(t.mpContentPieces).set({ title: d.title, body: d.body, assets: toJson(d.assets), meta: toJson({ ...existingMeta, ...d.meta }), status: "review", humanEdited: false, aiTellScore: d.score, aiTellNotes: d.notes, channel: d.channel, format: d.format, updatedAt: ts }).where(eq(t.mpContentPieces.id, pieceId)).run();
  return getPiece(db, pieceId)!;
}

function linkTask(db: Db, taskId: string, pieceId: string): void {
  const task = db.select().from(t.mpTasks).where(eq(t.mpTasks.id, taskId)).get();
  if (task) db.update(t.mpTasks).set({ status: "review", outputRefs: toJson([...parseJson<string[]>(task.outputRefs, []), pieceId]), updatedAt: nowIso() }).where(eq(t.mpTasks.id, taskId)).run();
}

export async function generateContent(ctx: StudioContext, projectId: string, req: s.ContentRequest, user: HostUser): Promise<s.ContentPiece> {
  const base = loadBase(ctx, projectId);
  const pieceId = newId();
  insertPlaceholder(ctx.db, projectId, pieceId, req, req.taskId ?? null);
  const model = req.format === "article" ? modelFor("analysis") : modelFor("content");
  let result: Draft;
  try {
    result = (await withRun(ctx.db, { task: `studio.${req.format}`, model, projectId, pieceId }, (usage) => draftFor(ctx, base, req, pieceId, usage))).result;
  } catch (e) {
    ctx.db.delete(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).run();
    throw e;
  }
  const piece = fillPiece(ctx.db, pieceId, result, { request: req });
  if (req.taskId) linkTask(ctx.db, req.taskId, pieceId);
  writeAudit(ctx.db, { user, action: "content.generate", entityType: "content_piece", entityId: pieceId, projectId, content: { format: req.format, platform: req.platform ?? null, score: result.score } });
  return piece;
}

export async function regenerateContent(ctx: StudioContext, pieceId: string, hint: string, user: HostUser): Promise<s.ContentPiece> {
  const existing = getPiece(ctx.db, pieceId);
  if (!existing) throw err("Stück nicht gefunden.", 404);
  if (existing.status === "published") throw err("Veröffentlichte Stücke werden nicht neu generiert.");
  if (existing.format === "video") {
    // videos are re-rendered by the worker (new recording + voice) - the studio path would only delete the files
    if (!workerAlive(ctx.db)) throw err("Render-Worker läuft nicht - Video kann gerade nicht neu erzeugt werden.", 503);
    if (hasActiveJob(ctx.db, existing.projectId, "video.render")) throw err("Für dieses Projekt läuft bereits ein Render.", 409);
    const job = enqueueJob(ctx.db, { projectId: existing.projectId, kind: "video.render", payload: { pieceId, ...renderOptionsFromMeta(existing.meta), reuseRecording: false }, steps: VIDEO_STEPS });
    writeAudit(ctx.db, { user, action: "content.regenerate", entityType: "content_piece", entityId: pieceId, projectId: existing.projectId, content: { hint, job: job.id, video: true } });
    return existing;
  }
  const reqParsed = s.ContentRequest.safeParse(existing.meta["request"]);
  const req: s.ContentRequest = reqParsed.success ? reqParsed.data : { format: existing.format, topic: existing.title, hint: "" };
  const merged = { ...req, hint: [req.hint, hint].filter(Boolean).join(" | ") };
  const base = loadBase(ctx, existing.projectId);
  const old = ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.contentPieceId, pieceId)).all();
  for (const a of old) { try { fs.unlinkSync(path.join(ctx.dataDir, a.path)); } catch { /* gone */ } }
  ctx.db.delete(t.mpAssets).where(eq(t.mpAssets.contentPieceId, pieceId)).run();
  const { result } = await withRun(ctx.db, { task: `studio.regenerate:${existing.format}`, model: modelFor("content"), projectId: existing.projectId, pieceId }, (usage) => draftFor(ctx, base, merged, pieceId, usage));
  const piece = fillPiece(ctx.db, pieceId, result, existing.meta);
  writeAudit(ctx.db, { user, action: "content.regenerate", entityType: "content_piece", entityId: pieceId, projectId: existing.projectId, content: { hint, score: result.score } });
  return piece;
}

export function buildPackage(ctx: StudioContext, piece: s.ContentPiece): s.PublishPackage {
  const project = getProject(ctx.db, piece.projectId);
  const platform = String(piece.meta["platform"] ?? platformFromChannel(piece.channel, piece.format === "article" ? "website" : "other"));
  const medium = piece.format === "directory_entry" ? "directory" : piece.format === "article" ? "content" : "social";
  const campaign = slugify(String(piece.meta["campaign"] ?? currentVersion(ctx.db, piece.projectId)?.plan.channels[0]?.platform ?? piece.channel ?? "marketing"));
  const utmLink = project && piece.format !== "article" ? buildUtmUrl(project.url, { source: platform, medium, campaign, content: piece.id }) : null;
  const dl = piece.format === "directory_entry" ? { url: String(piece.meta["deepLink"] ?? ""), label: `Formular bei ${piece.channel} öffnen` } : deepLinkFor(platform);
  const assets = ctx.db.select().from(t.mpAssets).where(eq(t.mpAssets.contentPieceId, piece.id)).all().map((a) => {
    const meta = parseJson<Record<string, unknown>>(a.meta, {});
    const size = a.path.endsWith(".png") ? pngSize(path.join(ctx.dataDir, a.path)) : null;
    return { id: a.id, kind: a.kind, url: `/api/mp/assets/${a.id}/file`, filename: path.basename(a.path), width: size?.width ?? null, height: size?.height ?? null, aiGenerated: Boolean(meta["aiGenerated"]) };
  });
  const notes: string[] = [];
  if (assets.some((a) => a.aiGenerated)) notes.push("Bilder tragen die Kennzeichnung 'AI-generated: true' als PNG-Textchunk + XMP (kein C2PA-Zertifikat, siehe DECISIONS.md). Beim Upload ggf. als KI-generiert markieren.");
  if (piece.meta["overLimit"]) notes.push(`Text überschreitet das Plattform-Limit (${String(piece.meta["length"])} Zeichen).`);
  if (piece.format === "directory_entry" && piece.meta["notes"]) notes.push(String(piece.meta["notes"]));
  if (!piece.humanEdited && piece.aiTellScore !== null && piece.aiTellScore < 7) notes.push(`AI-Tell-Score ${piece.aiTellScore}/10 - vor dem Posten noch einmal in eigene Worte bringen.`);
  const text = utmLink && piece.format === "text" && !piece.body.includes(project?.url ?? " ") ? `${piece.body}\n\n${utmLink}` : piece.body;
  return { piece, platform, text, assets, utmLink, deepLink: dl?.url || null, deepLinkLabel: dl?.label ?? null, postizAvailable: ctx.publish.name === "postiz", notes };
}

export function studioView(ctx: StudioContext, projectId: string): s.StudioView | null {
  const project = getProject(ctx.db, projectId);
  if (!project) return null;
  const pieces = withCosts(ctx.db, ctx.db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all().map(pieceOf)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dirs = directoriesFor(ctx.db, projectId).map((d) => {
    const piece = pieces.find((p) => p.format === "directory_entry" && p.meta["directory"] === d.slug);
    return { ...d, pieceId: piece?.id ?? null, pieceStatus: piece?.status ?? null, submittedUrl: piece?.externalUrl ?? null, submittedAt: piece?.publishedAt ?? null };
  });
  return {
    brandKit: loadBrandKit(ctx.db, projectId), hasBrief: s.Brief.safeParse(project.brief).success,
    screenshots: projectScreenshots(ctx.db, projectId).map((a) => ({ id: a.id, contentPieceId: a.contentPieceId, projectId: a.projectId, kind: a.kind as s.Asset["kind"], path: a.path, meta: parseJson<Record<string, unknown>>(a.meta, {}), createdAt: a.createdAt })),
    recent: pieces.slice(0, 30), directories: dirs, competitors: listCompetitors(ctx, projectId).map((c) => c.name),
  };
}
