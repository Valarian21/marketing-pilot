/**
 * Die Pipeline: Slots sind Zielfenster, freigegebene Stücke rücken nach.
 *
 * Bis hierher musste jedes Stück einzeln „freigegeben & eingeplant" werden —
 * und „Alle freigeben" plante gar nicht ein, weshalb am ersten Morgen um neun
 * nichts passierte. Seit der Pipeline gilt: Auf einem Kanal ab Stufe
 * „Freigeben" ist die Freigabe selbst der Auslöser. Das Stück landet auf dem
 * nächsten freien Slot, das nächste freigegebene auf dem übernächsten.
 *
 * Die zweite Hälfte dieses Moduls ist die Vorschau darauf: je Kanal die Slots
 * der kommenden Tage und was sie füllt — veröffentlicht, wartend, oder nur
 * eine Projektion aus der Freigabe-Warteschlange. Die Ampel der Timeline.
 */
import { and, eq } from "drizzle-orm";
import * as t from "../db/schema.js";
import { parseJson, type Db } from "../db/index.js";
import type { HostUser } from "../../host-adapter.js";
import { berlinInstant, berlinParts } from "../agents/series/time.js";
import { loadProfiles, stageOf } from "../channels.js";
import { stageAtLeast, PLATFORMS } from "../../shared/channels.js";
import { drehbuchOf, kanalEmpfehlung, postArtOf, type PostArt } from "../../shared/postarten.js";
import { writeAudit } from "../audit.js";
import { credentialsFor, posterFor } from "./index.js";
import { schedulePiece } from "./schedule.js";

const DAY = 86_400_000;

// --- Freigabe = Einplanen ---------------------------------------------------

export interface AutoScheduled { pieceId: string; platform: string; at: string | null; note: string }

/**
 * Ein gerade freigegebenes Stück auf den nächsten Slot legen — wenn der Kanal
 * das hergibt. Gibt er es nicht her, kommt eine Begründung zurück, kein Fehler:
 * die Freigabe selbst ist dann trotzdem gültig, das Stück wartet auf Handarbeit.
 */
export function autoScheduleOnApprove(db: Db, pieceId: string, user: HostUser): AutoScheduled {
  const piece = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.id, pieceId)).get();
  if (!piece) return { pieceId, platform: "", at: null, note: "Stück nicht gefunden." };
  const meta = parseJson<Record<string, unknown>>(piece.meta, {});
  const platform = String(meta["platform"] ?? piece.channel).toLowerCase();
  const stage = stageOf(db, piece.projectId, platform);
  if (!stageAtLeast(stage, "approve")) return { pieceId, platform, at: null, note: `${platform} steht auf „Vorbereiten“ — du postest selbst.` };
  const poster = posterFor(platform);
  if (!poster) return { pieceId, platform, at: null, note: `Für ${platform} gibt es keinen automatischen Weg.` };
  const missing = poster.missing(credentialsFor(db, piece.projectId, platform));
  if (missing.length) return { pieceId, platform, at: null, note: `${platform}: Zugangsdaten fehlen (${missing.join(", ")}).` };
  // Schon eingeplant? Dann nicht noch einmal.
  const offen = db.select().from(t.mpScheduledPosts)
    .where(and(eq(t.mpScheduledPosts.pieceId, pieceId), eq(t.mpScheduledPosts.status, "queued"))).get();
  if (offen) return { pieceId, platform, at: offen.scheduledAt, note: "Schon eingeplant." };

  // Eine Story gehört zu ihrem Beitrag und geht zur selben Zeit raus — nicht
  // auf den nächsten freien Slot, der laege einen halben Tag daneben.
  let at: string | undefined;
  if (piece.format === "story" && typeof meta["bundleId"] === "string") {
    const leit = db.select().from(t.mpScheduledPosts)
      .where(and(eq(t.mpScheduledPosts.pieceId, String(meta["bundleId"])), eq(t.mpScheduledPosts.platform, platform))).all()
      .filter((x) => x.status === "queued" || x.status === "posted").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (leit) at = leit.scheduledAt;
    else return { pieceId, platform, at: null, note: "Story wartet, bis ihr Beitrag eingeplant ist." };
  }

  const planned = schedulePiece(db, piece.projectId, { pieceId, platforms: [platform], ...(at ? { at } : {}) });
  const eintrag = planned[0];
  writeAudit(db, { user, action: "publish.pipeline", entityType: "content_piece", entityId: pieceId, projectId: piece.projectId, content: { platform, at: eintrag?.scheduledAt ?? null } });
  return { pieceId, platform, at: eintrag?.scheduledAt ?? null, note: eintrag ? `Eingeplant für ${eintrag.scheduledAt.slice(0, 16).replace("T", " ")}.` : "Kein Slot gefunden." };
}

// --- Vorschau: die Ampel je Kanal ------------------------------------------

export type SlotState = "published" | "queued" | "failed" | "approved" | "review" | "empty";

export interface PipelineSlot {
  at: string;
  date: string;
  hour: number;
  state: SlotState;
  pieceId: string | null;
  title: string;
  format: string;
  /** Bei `failed`: warum. */
  error: string;
  /** Slot liegt in der Vergangenheit und wurde nicht bedient. */
  missed: boolean;
  /** Von Hand auf der Plattform eingeplant — der Pilot setzt ihn nicht ab. */
  extern: boolean;
  /** Post-Art aus dem Playbook (A–G, T, S, X); leer bei leerem Slot. */
  postArt: string;
  drehbuch: string;
  /** Die Sorte, die dieser Slot laut Kanalplan haben soll — leer, wenn beliebig. */
  slotArt: string;
  /** Termin-Eintrag hinter einem belegten Slot, zum Absagen oder Abhaken. */
  scheduledId: string | null;
  externalUrl: string | null;
}

export interface PipelineRow {
  platform: string;
  label: string;
  stage: string;
  /** Kanal kann automatisch posten (Stufe + Zugang + Poster). */
  automatic: boolean;
  slots: PipelineSlot[];
  /** Freigabe-Warteschlange, die über die sichtbaren Slots hinausgeht. */
  backlog: number;
  /** Kanal ohne Slots — Termine kommen aus der Handarbeit, Wartendes steht im `backlog`. */
  ohneSlots: boolean;
}

export interface PipelineView {
  from: string; days: number; today: string; rows: PipelineRow[];
  /** Eingeschaltete Kanäle ohne Slots — in einer Slot-Ansicht gibt es für sie nichts zu malen. */
  withoutSlots: string[];
}

/**
 * Was in den kommenden Tagen je Kanal ansteht.
 *
 * Reihenfolge der Füllung ist die Reihenfolge der Wahrheit: erst, was wirklich
 * eingeplant oder gepostet ist (steht in `mp_scheduled_posts`), dann als
 * Projektion die Freigabe-Warteschlange in Erstellreihenfolge. Die Projektion
 * ist eine Annahme — „wenn du in dieser Reihenfolge freigibst, landet es hier".
 */
export function pipelineView(db: Db, projectId: string, opts: { days?: number; now?: Date } = {}): PipelineView {
  const now = opts.now ?? new Date();
  const days = Math.max(1, Math.min(opts.days ?? 10, 31));
  const heute = berlinParts(now).date;
  const start = berlinInstant(heute, 0);
  const ende = new Date(start.getTime() + days * DAY);

  const alle = loadProfiles(db, projectId).filter((p) => p.stage !== "off");
  const alleTermine = db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.projectId, projectId)).all();
  const scheduled = alleTermine.filter((x) => x.scheduledAt >= start.toISOString() && x.scheduledAt < ende.toISOString());
  const pieces = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, projectId)).all();
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const metaOf = (p: { meta: string }) => parseJson<Record<string, unknown>>(p.meta, {});
  const artOf = (p: { format: string; meta: string } | undefined) => (p ? { postArt: postArtOf({ format: p.format, meta: metaOf(p) }), drehbuch: drehbuchOf({ format: p.format, meta: metaOf(p) }) } : { postArt: "", drehbuch: "" });
  /**
   * Eine Zeile bekommt jeder eingeschaltete Kanal, auf dem etwas ansteht —
   * Slots, Termine **oder wartende Stücke**. Bis zum 14.09.2026 galt nur die
   * erste Bedingung plus Termine; YouTube hatte weder Slots noch Termine und
   * war unsichtbar, obwohl 19 Shorts in der Freigabe lagen. Eine Pipeline,
   * die den Stau nicht zeigt, zeigt das Falsche.
   */
  const mitTerminen = new Set(scheduled.filter((x) => x.status !== "cancelled").map((x) => x.platform));
  const mitWartendem = new Set(pieces.filter((p) => p.status === "approved" || p.status === "review").map((p) => p.channel));
  const profiles = alle.filter((p) => p.slots.length > 0 || mitTerminen.has(p.platform) || mitWartendem.has(p.platform));
  const withoutSlots = alle.filter((p) => !profiles.includes(p)).map((p) => p.platform);

  const rows: PipelineRow[] = profiles.map((profile) => {
    const platform = profile.platform;
    const poster = posterFor(platform);
    const automatic = stageAtLeast(profile.stage, "approve") && Boolean(poster) && poster!.missing(credentialsFor(db, projectId, platform)).length === 0;

    // 1) Die Slots des Fensters, chronologisch.
    const slots: PipelineSlot[] = [];
    for (let i = 0; i < days; i++) {
      const tag = berlinParts(new Date(start.getTime() + i * DAY + 12 * 3_600_000));
      for (const sl of [...profile.slots].filter((x) => x.day === tag.day).sort((a, b) => a.hour - b.hour)) {
        const at = berlinInstant(tag.date, sl.hour);
        slots.push({ at: at.toISOString(), date: tag.date, hour: sl.hour, state: "empty", pieceId: null, title: "", format: "", error: "", missed: at.getTime() < now.getTime(), extern: false, postArt: "", drehbuch: "", slotArt: sl.art ?? "", scheduledId: null, externalUrl: null });
      }
    }

    // 2) Wirklich Eingeplantes und Gepostetes auf die Slots legen. Ein Post ohne
    //    passenden Slot bekommt einen eigenen Eintrag — außer er ist ein
    //    **verwaister** Pilot-Termin: vom Piloten auf einen Slot gelegt, den es
    //    nicht mehr gibt (Kanalplan geändert). Der zählt als „freigegeben ohne
    //    Termin", wird neu projiziert, und `nachplanen` schiebt den Eintrag auf
    //    den neuen Slot. Von Hand gesetzte Termine (`extern`) bleiben, wo sie sind.
    const mine = scheduled.filter((x) => x.platform === platform && x.status !== "cancelled")
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const verwaist = new Set<string>();
    for (const sp of mine) {
      const piece = byId.get(sp.pieceId);
      const state: SlotState = sp.status === "posted" ? "published" : sp.status === "failed" ? "failed" : "queued";
      const eintrag = { state, pieceId: sp.pieceId, title: piece?.title ?? "", format: piece?.format ?? "", error: sp.error ?? "", extern: sp.origin === "extern", ...artOf(piece), scheduledId: sp.id, externalUrl: sp.externalUrl ?? null };
      // Eine Story teilt sich den Slot mit ihrem Beitrag — sie ersetzt ihn nicht.
      if (piece?.format === "story") continue;
      const frei = slots.find((x) => x.state === "empty" && Math.abs(Date.parse(x.at) - Date.parse(sp.scheduledAt)) < 30 * 60_000);
      if (frei) Object.assign(frei, eintrag, { missed: false });
      else if (state === "queued" && sp.origin !== "extern" && profile.slots.length > 0 && Date.parse(sp.scheduledAt) > now.getTime()) verwaist.add(sp.pieceId);
      else {
        const p = berlinParts(new Date(sp.scheduledAt));
        slots.push({ at: sp.scheduledAt, date: p.date, hour: p.hour, ...eintrag, missed: false, slotArt: "" });
      }
    }
    slots.sort((a, b) => a.at.localeCompare(b.at));

    // 3) Projektion: was freigegeben, aber nicht eingeplant ist, und was noch
    //    in der Freigabe wartet — auf die freien, künftigen Slots. Ein Slot mit
    //    Sorte nimmt nur ein Stück dieser Sorte (sonst bleibt er offen und
    //    sagt, was fehlt); ein Slot ohne Sorte nimmt das älteste Stück einer
    //    Sorte, die an diesem Tag noch nicht dran war — so bleibt der Feed
    //    abwechslungsreich, statt viermal dieselbe Rangliste zu zeigen.
    const geplant = new Set(alleTermine.filter((x) => x.platform === platform && (x.status === "queued" || x.status === "posted")).map((x) => x.pieceId));
    for (const id of verwaist) geplant.delete(id);
    const kandidaten = pieces
      .filter((p) => p.channel === platform && p.format !== "story" && !geplant.has(p.id))
      .filter((p) => p.status === "approved" || p.status === "review")
      .sort((a, b) => (a.status === b.status ? a.createdAt.localeCompare(b.createdAt) : a.status === "approved" ? -1 : 1))
      .map((p) => ({ p, art: artOf(p).postArt as PostArt }));
    const vergeben = new Set<string>();
    const artenAmTag = new Map<string, Set<string>>();
    for (const s of slots) if (s.postArt) artenAmTag.set(s.date, new Set([...(artenAmTag.get(s.date) ?? []), s.postArt]));
    const lege = (slot: PipelineSlot, wahl: { p: (typeof pieces)[number]; art: PostArt }) => {
      vergeben.add(wahl.p.id);
      const heute = artenAmTag.get(slot.date) ?? new Set<string>();
      heute.add(wahl.art); artenAmTag.set(slot.date, heute);
      Object.assign(slot, { state: wahl.p.status === "approved" ? "approved" : "review", pieceId: wahl.p.id, title: wahl.p.title, format: wahl.p.format, extern: false, ...artOf(wahl.p) });
    };
    // Erster Durchgang: jeder Slot bekommt seine Sorte, Slots ohne Sorte Abwechslung.
    for (const slot of slots) {
      if (slot.state !== "empty" || slot.missed) continue;
      const frei = kandidaten.filter((k) => !vergeben.has(k.p.id));
      const heute = artenAmTag.get(slot.date) ?? new Set<string>();
      const wahl = slot.slotArt
        ? frei.find((k) => k.art === slot.slotArt)
        : frei.find((k) => !heute.has(k.art)) ?? frei[0];
      if (wahl) lege(slot, wahl);
    }
    // Zweiter Durchgang: ein leerer Slot ist schlechter als ein Beitrag der
    // falschen Sorte — außer beim Pflicht-Slot des Tages (die Binderseite zur
    // besten Stunde), der bleibt sichtbar offen und sagt, was fehlt. Am
    // 14.09.2026 standen auf Pinterest 17 von 21 Slots leer, weil dort nur
    // Ranglisten vorrätig waren und der Plan Kunstseiten wollte.
    const pflicht = kanalEmpfehlung(platform).pflicht;
    for (const slot of slots) {
      if (slot.state !== "empty" || slot.missed || slot.slotArt === pflicht) continue;
      const frei = kandidaten.filter((k) => !vergeben.has(k.p.id));
      const heute = artenAmTag.get(slot.date) ?? new Set<string>();
      const wahl = frei.find((k) => !heute.has(k.art)) ?? frei[0];
      if (wahl) lege(slot, wahl);
    }
    const k = vergeben.size;

    return { platform, label: PLATFORMS[platform]?.label ?? platform, stage: profile.stage, automatic, slots, backlog: Math.max(0, kandidaten.length - k), ohneSlots: profile.slots.length === 0 };
  });

  return { from: heute, days, today: heute, rows, withoutSlots };
}


// --- Nachplanen: Freigegebenes auf freie Slots legen ------------------------

/**
 * Freigegebene Stücke ohne Termin auf Kanälen, die der Pilot selbst bedient,
 * in die Slots legen, die die Projektion ihnen zuweist.
 *
 * `autoScheduleOnApprove` plant nur im Moment der Freigabe — und findet dann
 * keinen Slot, wenn die Woche voll ist. Kommen später Slots dazu (mehr je
 * Tag, ein neuer Kanalplan), blieben die Stücke orange stehen, bis jemand
 * jedes einzeln einplant. Am 14.09.2026 waren das 13 auf Instagram. Diese
 * Funktion läuft im Takt des Schedulers und nimmt genau die Slots, die die
 * Ampel zeigt — Sorte und Abwechslung inklusive.
 */
export function nachplanen(db: Db, projectId: string, opts: { days?: number; now?: Date } = {}): { pieceId: string; platform: string; at: string }[] {
  const view = pipelineView(db, projectId, { days: opts.days ?? 14, ...(opts.now ? { now: opts.now } : {}) });
  const out: { pieceId: string; platform: string; at: string }[] = [];
  for (const row of view.rows) {
    if (!row.automatic) continue;
    for (const slot of row.slots) {
      if (slot.state !== "approved" || !slot.pieceId) continue;
      const planned = schedulePiece(db, projectId, { pieceId: slot.pieceId, platforms: [row.platform], at: slot.at, ...(opts.now ? { now: opts.now } : {}) });
      const e = planned[0];
      if (e) out.push({ pieceId: slot.pieceId, platform: row.platform, at: e.scheduledAt });
    }
  }
  return out;
}
