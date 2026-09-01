/**
 * Serien-Lauf als Job. Er läuft im Worker, weil dahinter ein Modellaufruf und
 * — bei Reels — ein kompletter Videorender steckt.
 *
 * Ein Lauf, der bewusst ausfällt (kein frisches Set, zu dünner Preisverlauf),
 * ist **kein Fehler**: der Job endet erfolgreich mit einer Begründung. Sonst
 * stünde in der Oberfläche jede Woche ein rotes „fehlgeschlagen", wo in
 * Wahrheit alles richtig lief.
 */
import type { Env } from "../../env.js";
import type { JobHandler } from "../../jobs.js";
import { nowIso } from "../../db/index.js";
import type { StudioContext } from "../studio/generate.js";
import { getSeries, runSeries } from "./series.js";

export const SERIES_STEPS = ["auswaehlen", "erzeugen"];
export const SERIES_USER = { id: "scheduler", name: "Serien-Plan" };

export const seriesRunJob: JobHandler<StudioContext & { env: Env }> = async (ctx, job, progress) => {
  const seriesId = String(job.payload["seriesId"] ?? "");
  const preview = job.payload["preview"] === true;
  const series = getSeries(ctx.db, seriesId);
  if (!series) throw new Error("Serie nicht gefunden.");

  progress("auswaehlen", { status: "running", startedAt: nowIso(), detail: series.name });
  try {
    const res = await runSeries(ctx, seriesId, SERIES_USER, { preview });
    progress("auswaehlen", { status: "done", detail: res.scope, finishedAt: nowIso() });
    progress("erzeugen", { status: "done", detail: `${res.pieces.length} Bündel (${res.formats.join(", ")})`, finishedAt: nowIso() });
    return { pieces: res.pieces, scope: res.scope, preview };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    const msg = e instanceof Error ? e.message : String(e);
    if (status === 409) {
      // Bewusster Aussetzer - der Slot war fällig, es gab nur nichts zu zeigen.
      progress("auswaehlen", { status: "done", detail: msg, finishedAt: nowIso() });
      progress("erzeugen", { status: "skipped", detail: "ausgefallen", finishedAt: nowIso() });
      return { skipped: true, reason: msg };
    }
    progress("auswaehlen", { status: "failed", detail: msg, finishedAt: nowIso() });
    throw e;
  }
};
