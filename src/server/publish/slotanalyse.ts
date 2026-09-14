/**
 * Slot-Analyse je Kanal: was eingestellt ist, was empfohlen wird, was der
 * Vorrat hergibt und was die eigenen Zahlen sagen.
 *
 * Die Empfehlung (`KANAL_EMPFEHLUNG`) ist Branchenwissen plus Vorgabe des
 * Betreibers. Die eigenen Zahlen sind das Korrektiv: Aufrufe je Uhrzeit und je
 * Sorte aus den Beiträgen, die der Pilot gepostet und gemessen hat. Mit
 * wenigen Beiträgen je Stunde sagt der Schnitt noch nichts — deshalb steht
 * `n` überall dabei, und die Ansicht nennt es beim Namen.
 */
import { and, eq } from "drizzle-orm";
import * as t from "../db/schema.js";
import { parseJson, type Db } from "../db/index.js";
import { berlinParts } from "../agents/series/time.js";
import { loadProfiles } from "../channels.js";
import { PLATFORMS, stageAtLeast } from "../../shared/channels.js";
import { kanalEmpfehlung, postArtOf, slotVorschlag, type KanalEmpfehlung, type PostArt } from "../../shared/postarten.js";
import { leseMetriken } from "./metrics.js";
import { credentialsFor, posterFor } from "./index.js";

export interface SlotAnalyseKanal {
  platform: string;
  label: string;
  stage: string;
  automatic: boolean;
  /** Slots je Woche, wie sie eingestellt sind. */
  slotsJetzt: number;
  slotsMitArt: number;
  empfehlung: KanalEmpfehlung;
  /** Der komplette Wochenplan zum Übernehmen. */
  vorschlag: { day: string; hour: number; art: string }[];
  /** Freigegebene und wartende Stücke je Sorte — das ist der Vorrat. */
  vorrat: { art: string; n: number }[];
  vorratGesamt: number;
  /** Tage, die der Vorrat bei empfohlener Frequenz reicht. */
  reichtTage: number | null;
  gemessen: {
    stunden: { stunde: number; n: number; aufrufe: number }[];
    sorten: { art: string; n: number; aufrufe: number }[];
    beitraege: number;
  };
}

export interface SlotAnalyse { kanaele: SlotAnalyseKanal[] }

const mittel = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export function slotAnalyse(db: Db, projectId: string): SlotAnalyse {
  const profile = loadProfiles(db, projectId).filter((p) => p.stage !== "off");
  const pieces = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all();
  const posts = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.status, "posted"))).all();
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const artOf = (p: { format: string; meta: string }): PostArt => postArtOf({ format: p.format, meta: parseJson<Record<string, unknown>>(p.meta, {}) });

  const kanaele = profile.map((pr): SlotAnalyseKanal => {
    const platform = pr.platform;
    const poster = posterFor(platform);
    const automatic = stageAtLeast(pr.stage, "approve") && Boolean(poster) && poster!.missing(credentialsFor(db, projectId, platform)).length === 0;
    const empfehlung = kanalEmpfehlung(platform);

    // Vorrat: was für diesen Kanal freigegeben ist oder wartet, ohne Termin.
    const mitTermin = new Set(db.select({ pieceId: t.mpScheduledPosts.pieceId }).from(t.mpScheduledPosts)
      .where(and(eq(t.mpScheduledPosts.projectId, projectId), eq(t.mpScheduledPosts.platform, platform))).all()
      .map((x) => x.pieceId));
    const vorratStuecke = pieces.filter((p) => p.channel === platform && p.format !== "story" && (p.status === "approved" || p.status === "review") && !mitTermin.has(p.id));
    const jeArt = new Map<string, number>();
    for (const p of vorratStuecke) { const a = artOf(p); jeArt.set(a, (jeArt.get(a) ?? 0) + 1); }
    const vorrat = [...jeArt.entries()].map(([art, n]) => ({ art, n })).sort((a, b) => b.n - a.n);

    // Gemessen: die eigenen geposteten Beiträge dieses Kanals mit Zahlen.
    const meine = posts.filter((p) => p.platform === platform && p.postedAt);
    const jeStunde = new Map<number, number[]>();
    const jeSorte = new Map<string, number[]>();
    let beitraege = 0;
    for (const p of meine) {
      const m = leseMetriken(p);
      const wert = m?.aufrufe ?? m?.reichweite ?? null;
      if (wert === null) continue;
      beitraege++;
      const stunde = berlinParts(new Date(p.postedAt!)).hour;
      jeStunde.set(stunde, [...(jeStunde.get(stunde) ?? []), wert]);
      const piece = byId.get(p.pieceId);
      if (piece && piece.format !== "story") { const a = artOf(piece); jeSorte.set(a, [...(jeSorte.get(a) ?? []), wert]); }
    }
    const stunden = [...jeStunde.entries()].map(([stunde, xs]) => ({ stunde, n: xs.length, aufrufe: mittel(xs) })).sort((a, b) => b.aufrufe - a.aufrufe);
    const sorten = [...jeSorte.entries()].map(([art, xs]) => ({ art, n: xs.length, aufrufe: mittel(xs) })).sort((a, b) => b.aufrufe - a.aufrufe);

    return {
      platform, label: PLATFORMS[platform]?.label ?? platform, stage: pr.stage, automatic,
      slotsJetzt: pr.slots.length, slotsMitArt: pr.slots.filter((x) => x.art).length,
      empfehlung, vorschlag: slotVorschlag(platform),
      vorrat, vorratGesamt: vorratStuecke.length,
      reichtTage: empfehlung.proTag > 0 ? Math.floor(vorratStuecke.length / empfehlung.proTag) : null,
      gemessen: { stunden, sorten, beitraege },
    };
  });
  return { kanaele };
}
