/**
 * Die Kanäle-Seite des Content-Piloten: eine Karte je Plattform.
 *
 * Jede Karte beantwortet drei Fragen — auf welcher Stufe steht der Kanal, läuft
 * die Stufe wirklich, und was fehlt noch bis dahin (oder bis zur nächsten).
 * Die Antworten werden hier **berechnet**, nicht gespeichert: sie ergeben sich
 * aus Profil, Zugangsdaten, Serien, Worker und Marken-Kit, und jede dieser
 * Quellen kann sich ändern, ohne dass jemand die Karte anfasst.
 */
import { and, eq, gte } from "drizzle-orm";
import * as s from "../../shared/schemas.js";
import * as t from "../db/schema.js";
import { parseJson, type Db } from "../db/index.js";
import { PLATFORMS, STAGE_ORDER, stageAtLeast, stageRank, type ChannelStage } from "../../shared/channels.js";
import { loadProfiles } from "../channels.js";
import { getProject } from "../repo/projects.js";
import { loadBrandKit } from "../agents/studio/brandkit.js";
import { loadDataSource } from "../data-source.js";
import { workerAlive } from "../jobs.js";
import { credentialsFor, platformStatus, posterFor } from "./index.js";
import { PLATFORM_POSTING } from "./types.js";

export interface ProjectSetup { briefConfirmed: boolean; brandKit: boolean; voiceProfile: boolean; hasData: boolean }

export function projectSetup(db: Db, projectId: string): ProjectSetup {
  const project = getProject(db, projectId);
  const kit = loadBrandKit(db, projectId);
  return {
    briefConfirmed: Boolean(project && s.Brief.safeParse(project.brief).success),
    brandKit: Boolean(kit.extractedAt || kit.primary),
    voiceProfile: Boolean(kit.voiceProfile),
    hasData: loadDataSource(db, projectId).provider !== "none",
  };
}

/** Höchste Stufe, die eine Plattform erreichen kann — ohne API-Weg bleibt es beim Vorbereiten. */
export function maxStageFor(posting: s.PlatformPosting): { maxStage: ChannelStage; maxReason: string } {
  if (posting.mode === "api" || posting.mode === "needs_setup") return { maxStage: "auto", maxReason: "" };
  return { maxStage: "prepare", maxReason: posting.reason };
}

type Req = s.ChannelRequirement;
const req = (id: string, label: string, ok: boolean, blocking: boolean, hint = "", action: string | null = null): Req => ({ id, label, ok, blocking, hint: ok ? "" : hint, action: ok ? null : action });

/**
 * Die Voraussetzungen einer Stufe für einen Kanal. Aufsteigend: was `approve`
 * braucht, braucht `auto` auch. `prepare` braucht nur, dass der Pilot überhaupt
 * Content erzeugen kann.
 */
export function requirementsFor(stage: ChannelStage, input: {
  setup: ProjectSetup; posting: s.PlatformPosting; profile: { url: string; slots: unknown[]; autoWeeklyCap: number };
  seriesCount: number; workerAlive: boolean; appOnly: boolean;
  /** Schluessel der Zugangsfelder, die noch fehlen (nur die Pflichtfelder des Posters). */
  missingCreds: string[];
}): Req[] {
  const { setup, posting, profile } = input;
  const out: Req[] = [];
  if (stage === "off") return out;
  out.push(req("brief", "Produkt-Brief bestätigt", setup.briefConfirmed, true, "Ohne Brief weiß der Pilot nicht, worüber er schreibt — Analyse ausführen und Brief bestätigen.", "analysis"));
  out.push(req("brand", "Marken-Kit extrahiert", setup.brandKit, false, "Sonst tragen alle Slides das Standard-Grün des Piloten statt deiner Farben.", "studio?tab=brand"));
  out.push(req("url", "Eigene Seite auf der Plattform hinterlegt", Boolean(profile.url.trim()), false, "Dann führen Kanal-Links direkt auf dein Profil statt auf die Startseite der Plattform.", "url"));
  if (!stageAtLeast(stage, "approve")) return out;

  const apiPossible = posting.mode === "api" || posting.mode === "needs_setup";
  out.push(req("api", "Plattform lässt automatisches Posten zu", apiPossible, true, posting.reason, null));
  if (apiPossible) {
    const missing = posting.fields.filter((f) => input.missingCreds.includes(f.key)).map((f) => f.label);
    out.push(req("creds", "Zugangsdaten vollständig", posting.configured, true, missing.length ? `Fehlt: ${missing.join(", ")}.` : "Zugangsdaten unten auf der Karte eintragen.", "credentials"));
    if (posting.warning) out.push(req("token", "Zugang gültig", false, false, posting.warning, "credentials"));
  }
  out.push(req("slots", "Mindestens ein Slot gesetzt", profile.slots.length > 0, false, "Ohne Slot postet der Pilot eine Stunde nach der Freigabe — Slots machen den Kanal planbar.", "slots"));
  out.push(req("worker", "Worker läuft", input.workerAlive, true, "Der Dienst app-marketing-pilot-worker steht — geplante Beiträge bleiben liegen.", null));
  if (!stageAtLeast(stage, "auto")) return out;

  out.push(req("series", "Eine aktive Serie bespielt diesen Kanal", input.seriesCount > 0, true, "Vollautomatisch heißt: Serien liefern den Content. Ohne Serie entsteht hier nie etwas von selbst.", "series"));
  out.push(req("cap", "Wochendeckel gesetzt", profile.autoWeeklyCap > 0, true, "Ein Deckel von 0 postet nichts — mindestens 1 je Woche.", "cap"));
  return out;
}

const DAY = 86_400_000;

/** Aktive Serien je Plattform — was `auto` wirklich mit Content versorgt. */
function seriesPerPlatform(db: Db, projectId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of db.select().from(t.mpContentSeries).where(and(eq(t.mpContentSeries.projectId, projectId), eq(t.mpContentSeries.status, "active"))).all()) {
    const platforms = parseJson<{ platforms?: string[] }>(row.params, {}).platforms ?? [];
    for (const p of platforms) out.set(p, (out.get(p) ?? 0) + 1);
  }
  return out;
}

export function channelBoard(db: Db, projectId: string, now = new Date()): s.ChannelCard[] {
  const setup = projectSetup(db, projectId);
  const profiles = loadProfiles(db, projectId);
  const posting = new Map(platformStatus(db, projectId, now).map((p) => [p.platform, p]));
  const series = seriesPerPlatform(db, projectId);
  const alive = workerAlive(db);

  const pieces = db.select({ channel: t.mpContentPieces.channel, status: t.mpContentPieces.status, meta: t.mpContentPieces.meta })
    .from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all()
    .map((r) => ({ platform: String(parseJson<Record<string, unknown>>(r.meta, {})["platform"] ?? r.channel).toLowerCase(), status: r.status }));
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const scheduled = db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.projectId, projectId)).all();
  const posted7d = db.select({ platform: t.mpScheduledPosts.platform, postedAt: t.mpScheduledPosts.postedAt }).from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.status, "posted"), gte(t.mpScheduledPosts.postedAt, since))).all();

  // Alle Plattformen mit Posting-Definition, dazu gespeicherte Profile, die keine haben (z. B. Website).
  const keys = [...Object.keys(PLATFORM_POSTING), ...profiles.map((p) => p.platform).filter((k) => !PLATFORM_POSTING[k])];
  const cards = keys.map((platform): s.ChannelCard => {
    const profile = profiles.find((p) => p.platform === platform);
    const post = posting.get(platform) ?? { platform, label: PLATFORMS[platform]?.label ?? platform, mode: "manual" as const, reason: "Für diese Plattform gibt es keinen automatischen Weg.", fields: [], configured: false, tokenAgeDays: null, warning: "" };
    const { maxStage, maxReason } = maxStageFor(post);
    const stage = profile?.stage ?? "off";
    const prof = { url: profile?.url ?? "", slots: profile?.slots ?? [], autoWeeklyCap: profile?.autoWeeklyCap ?? 5 };
    const common = {
      setup, posting: post, profile: prof, seriesCount: series.get(platform) ?? 0, workerAlive: alive, appOnly: Boolean(PLATFORMS[platform]?.appOnly),
      missingCreds: posterFor(platform)?.missing(credentialsFor(db, projectId, platform)) ?? [],
    };
    const requirements = requirementsFor(stage, common);
    const next = STAGE_ORDER[stageRank(stage) + 1];
    const nextMissing = next && stageAtLeast(maxStage, next) ? requirementsFor(next, common).filter((r) => !r.ok && r.blocking).map((r) => r.label) : [];
    const mine = pieces.filter((p) => p.platform === platform);
    const lastPosted = posted7d.filter((p) => p.platform === platform).map((p) => p.postedAt ?? "").sort().at(-1) || null;
    return {
      platform, label: post.label, stage, maxStage, maxReason, ...prof,
      appOnly: Boolean(PLATFORMS[platform]?.appOnly), posting: post, requirements,
      ready: requirements.every((r) => r.ok || !r.blocking),
      nextMissing,
      stats: {
        waitingReview: mine.filter((p) => p.status === "review").length,
        approvedUnposted: mine.filter((p) => p.status === "approved").length,
        queued: scheduled.filter((x) => x.platform === platform && x.status === "queued").length,
        posted7d: posted7d.filter((p) => p.platform === platform).length,
        lastPostedAt: lastPosted,
        series: series.get(platform) ?? 0,
      },
    };
  });
  // Eingeschaltete Kanäle zuerst, dann die höchste erreichbare Stufe, dann alphabetisch.
  return cards.sort((a, b) => (stageRank(b.stage) - stageRank(a.stage)) || (stageRank(b.maxStage) - stageRank(a.maxStage)) || a.label.localeCompare(b.label, "de"));
}
