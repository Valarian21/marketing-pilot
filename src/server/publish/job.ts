/**
 * Der Job, der fällige Beiträge tatsächlich absetzt. Er läuft im Worker und
 * arbeitet die Warteschlange der Reihe nach ab — ein Fehlschlag hält die
 * anderen nicht auf, er erzeugt nur seine Aufgabe und geht weiter.
 */
import type { JobHandler } from "../jobs.js";
import { nowIso } from "../db/index.js";
import { duePosts, runScheduledPost, type PostContext } from "./schedule.js";
import { holeMetriken } from "./metrics.js";
import { holeKanalStats } from "./kanal-metriken.js";
import { credentialsFor } from "./index.js";

export const PUBLISH_STEPS = ["posten"];

export const publishDueJob: JobHandler<PostContext> = async (ctx, job, progress) => {
  const projectId = String(job.payload["projectId"] ?? "");
  progress("posten", { status: "running", startedAt: nowIso() });
  const due = duePosts(ctx.db, ctx.now?.() ?? new Date()).filter((d) => !projectId || d.projectId === projectId);
  const done: string[] = [], failed: string[] = [];
  for (const entry of due) {
    const res = await runScheduledPost(ctx, entry);
    (res.ok ? done : failed).push(`${entry.platform}: ${res.detail}`);
  }
  progress("posten", { status: "done", detail: `${done.length} gepostet, ${failed.length} gescheitert`, finishedAt: nowIso() });
  return { posted: done, failed };
};

export const METRICS_STEPS = ["zahlen holen"];

/**
 * Die Zahlen der Plattformen einsammeln.
 *
 * Laeuft einmal taeglich je Projekt. Ein Beitrag, dessen Abruf scheitert,
 * bekommt den Grund an seine Zeile geschrieben und haelt die anderen nicht auf.
 */
export const metricsFetchJob: JobHandler<PostContext> = async (ctx, job, progress) => {
  const projectId = String(job.payload["projectId"] ?? "");
  progress("zahlen holen", { status: "running", startedAt: nowIso() });
  const res = await holeMetriken({
    db: ctx.db,
    creds: (platform) => credentialsFor(ctx.db, projectId, platform),
    ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    log: ctx.log,
    ...(ctx.now ? { now: ctx.now } : {}),
  }, projectId);
  progress("zahlen holen", { status: "done", detail: `${res.geholt} abgerufen, ${res.gescheitert} gescheitert`, finishedAt: nowIso() });
  return res;
};

export const KANAL_STEPS = ["kanalzahlen"];

/**
 * Die Zahlen der **Kanäle** einsammeln — Follower, Aufrufe, Reichweite je Tag.
 *
 * Getrennt vom Beitrags-Abruf, weil beides verschieden schnell altert: ein
 * Beitrag ist nach vier Wochen fertig, ein Kanal nie. Der Lauf holt außerdem
 * die letzten Tage nach, für die noch nichts gespeichert ist — nach ein paar
 * Läufen steht die Historie, danach ist es ein Aufruf am Tag.
 */
export const kanalStatsJob: JobHandler<PostContext> = async (ctx, job, progress) => {
  const projectId = String(job.payload["projectId"] ?? "");
  progress("kanalzahlen", { status: "running", startedAt: nowIso() });
  const res = await holeKanalStats({
    db: ctx.db,
    creds: (platform) => credentialsFor(ctx.db, projectId, platform),
    ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    log: ctx.log,
    ...(ctx.now ? { now: ctx.now } : {}),
  }, projectId);
  const ok = res.filter((r) => !r.fehler);
  const detail = res.length
    ? `${ok.length} Kanäle, ${ok.reduce((n, r) => n + r.tage, 0)} Tage${res.length > ok.length ? `, ${res.length - ok.length} mit Fehler` : ""}`
    : "kein Kanal mit hinterlegtem Zugang";
  progress("kanalzahlen", { status: "done", detail, finishedAt: nowIso() });
  return { kanaele: res };
};
