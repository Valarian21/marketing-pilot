/**
 * Binder-Showcase (Shot 11): aus echten Seiten eines geteilten Binders wird ein
 * Plattform-Bündel — dieselbe Mechanik wie bei den Ranglisten, aber mit
 * Produkt-Screenshots statt gerechneter Slides.
 *
 * Der Unterschied zu Shot 7 ist genau einer: die Bilder kommen aus der App,
 * nicht aus den Daten. Alles danach — Größen je Plattform, Caption je Kanal,
 * Hashtag-Politik, Bündel-Zeilen — teilt sich den Weg mit `data-content.ts`.
 */
import path from "node:path";
import { z } from "zod";
import * as s from "../../../shared/schemas.js";
import { newId, type Db } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { chatJson, type UsageCollector } from "../runner.js";
import { showcasePrompt } from "../prompts/studio.js";
import { hashtagPolicy, linkRuleFor } from "../../../shared/channels.js";
import { PLATFORM_LIMITS } from "../../util/utm.js";
import { loadHashtags } from "../../hashtags.js";
import { dataFooterText, dataUrlFor, rankingCtaHtml, showcaseCoverHtml, showcaseSlideHtml, type RenderJob } from "./render.js";
import { reviseWithCritic } from "./critic.js";
import { sizeForPlatform, writeBundlePieces, type DataBase } from "./data-content.js";
import { playwrightBinderShooter, shareIdOf, type BinderShooter } from "../series/binder.js";
import type { StudioContext } from "./generate.js";

const err = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });

const Out = z.object({
  title: z.string().default(""),
  coverTitle: z.string().default(""),
  hook: z.string().default(""),
  ctaLine: z.string().default(""),
  captions: z.array(z.object({ platform: z.string(), caption: z.string().default(""), hashtags: z.array(z.string()).default([]) })).default([]),
});

const fmtDate = (d: Date, lang: "de" | "en") =>
  d.toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

export interface ShowcaseOpts {
  leadPieceId?: string;
  language: "de" | "en";
  addAsset: (pieceId: string, file: string, meta: Record<string, unknown>) => string;
  renderer: (jobs: RenderJob[]) => Promise<void>;
  screenshotPath: string | null;
  /** Einspeisbar, damit Tests ohne Browser laufen. */
  shooter?: BinderShooter;
}

export async function generateShowcaseBundle(
  ctx: StudioContext, base: DataBase, req: s.ContentRequest, usage: UsageCollector, opts: ShowcaseOpts,
): Promise<s.ContentPiece[]> {
  const cfg = s.ShowcaseOptions.parse(req.showcase ?? {});
  if (!cfg.url.trim()) throw err("Für einen Binder-Showcase fehlt der Share-Link der Binder-Ansicht.");
  if (!shareIdOf(cfg.url)) throw err(`„${cfg.url}" sieht nicht nach einer geteilten Binder-Ansicht aus (erwartet: …/app#ansicht/<id>).`);
  const lang = opts.language;
  const leadId = opts.leadPieceId ?? newId();

  const outDir = path.join(ctx.dataDir, "assets", base.project.id, "pieces", leadId);
  const shooter = opts.shooter ?? playwrightBinderShooter;
  const capture = await shooter(cfg.url, { outDir: path.join(outDir, "quelle"), maxPages: cfg.maxPages, withPrices: cfg.withPrices, log: ctx.log });

  const platforms = (req.bundlePlatforms.length ? req.bundlePlatforms : [req.platform ?? "instagram"])
    .map((p) => p.trim().toLowerCase()).filter((p, i, all) => p && all.indexOf(p) === i);
  const leadPlatform = platforms[0]!;
  const brand = base.brief.productName;
  const domain = base.project.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Die Fußzeile folgt dem, was auf den Bildern zu sehen ist: „Preise: Cardmarket-Trend"
  // über einer Seite ohne Preise wäre eine kleine Lüge.
  const footer = capture.pricesShown
    ? dataFooterText(fmtDate(new Date(), lang), domain)
    : `${lang === "de" ? "Binder-Ansicht" : "Binder view"}: ${domain} · ${fmtDate(new Date(), lang)}`;

  // --- der einzige Modellaufruf ---------------------------------------------
  const out = await chatJson(ctx.llm, modelFor("content"), Out, showcasePrompt({
    brief: base.brief, ...(base.personas[0] ? { persona: base.personas[0] } : {}), voiceProfile: base.voice, language: lang,
    binderName: capture.name, stats: capture.stats, pages: capture.pages.length,
    platforms: platforms.map((p) => ({ platform: p, limit: PLATFORM_LIMITS[p] ?? 2000, policy: hashtagPolicy(p), linkRule: linkRuleFor(p) })),
    pools: loadHashtags(ctx.db, base.project.id), topic: req.topic, hint: req.hint,
  }), usage, { maxTokens: 3000, temperature: 0.6 });

  const coverTitle = (out.coverTitle || capture.name).slice(0, 80);
  const ctaLine = (out.ctaLine || (lang === "de" ? `Plane deinen eigenen Binder mit ${brand}.` : `Plan your own binder with ${brand}.`)).slice(0, 120);

  // --- rendern ---------------------------------------------------------------
  const shotUrls = capture.pages.map((p) => ({ index: p.index, dataUrl: dataUrlFor(p.file) }));
  const usable = shotUrls.filter((x) => x.dataUrl);
  if (!usable.length) throw err("Keine der aufgenommenen Binderseiten ließ sich lesen.");
  const productShot = opts.screenshotPath ? dataUrlFor(opts.screenshotPath) : null;

  const sizes = [...new Map(platforms.map((p) => [sizeForPlatform(p).tag, sizeForPlatform(p)])).values()];
  const linkRules = [...new Set(platforms.map(linkRuleFor))];
  const jobs: RenderJob[] = [];
  const bySize = new Map<string, string[]>();
  const ctaFiles = new Map<string, string>();
  for (const size of sizes) {
    const files: string[] = [];
    const cover = path.join(outDir, `${lang}-${size.tag}-00-cover.png`);
    jobs.push({ html: showcaseCoverHtml(base.kit, { title: coverTitle, stats: capture.stats, imageDataUrl: usable[0]!.dataUrl }, size.w, size.h, brand, footer), width: size.w, height: size.h, file: cover });
    files.push(cover);
    usable.forEach((x, i) => {
      const file = path.join(outDir, `${lang}-${size.tag}-${String(i + 1).padStart(2, "0")}-seite${x.index}.png`);
      jobs.push({
        html: showcaseSlideHtml(base.kit, {
          headline: lang === "de" ? `Seite ${x.index} von ${capture.totalPages}` : `Page ${x.index} of ${capture.totalPages}`,
          sub: capture.name, imageDataUrl: x.dataUrl,
        }, size.w, size.h, brand, footer),
        width: size.w, height: size.h, file,
      });
      files.push(file);
    });
    for (const rule of linkRules) {
      const file = path.join(outDir, `${lang}-${size.tag}-99-cta-${rule}.png`);
      const linkLabel = rule === "bio" ? (lang === "de" ? "Link in Bio" : "Link in bio") : domain;
      jobs.push({ html: rankingCtaHtml(base.kit, { line: ctaLine, linkLabel, imageDataUrl: productShot }, size.w, size.h, brand, footer), width: size.w, height: size.h, file });
      ctaFiles.set(`${size.tag}:${rule}`, file);
    }
    bySize.set(size.tag, files);
  }
  await opts.renderer(jobs);

  const assetIds = new Map<string, string>();
  for (const [tag, files] of bySize) files.forEach((file, i) => assetIds.set(file, opts.addAsset(leadId, file, { size: tag, slide: i, language: lang, showcase: true })));
  for (const [k, file] of ctaFiles) assetIds.set(file, opts.addAsset(leadId, file, { size: k.split(":")[0]!, slide: "cta", linkRule: k.split(":")[1]!, language: lang, showcase: true }));

  // --- Captions --------------------------------------------------------------
  const captionOf = (platform: string) => out.captions.find((c) => c.platform.trim().toLowerCase() === platform)?.caption.trim() ?? "";
  const leadCaption = captionOf(leadPlatform) || out.captions[0]?.caption.trim() || coverTitle;
  const rev = await reviseWithCritic(ctx, usage, { body: leadCaption, language: lang, voiceProfile: base.voice, format: "showcase_carousel", platform: leadPlatform, limit: PLATFORM_LIMITS[leadPlatform] ?? 2000, maxRounds: 2 });

  const notes = [rev.notes];
  if (capture.pages.length < capture.totalPages) notes.push(`${capture.pages.length} von ${capture.totalPages} Binderseiten gezeigt.`);

  return writeBundlePieces({
    db: ctx.db as Db, projectId: base.project.id, leadId, format: "showcase_carousel", language: lang, platforms,
    taskId: req.taskId ?? null,
    title: out.title || coverTitle,
    score: rev.score, notes: notes.filter(Boolean).join("\n"),
    captionFor: (platform, isLead) => (isLead ? rev.body : captionOf(platform) || rev.body),
    hashtagsFor: (platform) => out.captions.find((c) => c.platform.trim().toLowerCase() === platform)?.hashtags ?? [],
    assetsFor: (platform) => {
      const size = sizeForPlatform(platform);
      return [...(bySize.get(size.tag) ?? []), ctaFiles.get(`${size.tag}:${linkRuleFor(platform)}`) ?? ""].filter(Boolean).map((f) => assetIds.get(f)!).filter(Boolean);
    },
    sizeFor: (platform) => sizeForPlatform(platform).tag,
    ruleFor: (platform) => linkRuleFor(platform),
    meta: {
      hook: out.hook, coverTitle, ctaLine, footer,
      showcase: { ...cfg, binderName: capture.name, stats: capture.stats, pages: capture.pages.length, totalPages: capture.totalPages, shareId: shareIdOf(cfg.url) },
      scopeLabel: capture.name, request: req,
    },
  });
}
