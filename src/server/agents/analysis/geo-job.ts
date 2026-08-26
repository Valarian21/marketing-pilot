/** Weekly GEO re-measure: same questions/engines as the baseline, new batch. */
import * as s from "../../../shared/schemas.js";
import { nowIso } from "../../db/index.js";
import { modelFor } from "../../../../config/models.js";
import { withRun } from "../runner.js";
import type { JobHandler } from "../../jobs.js";
import { getProject } from "../../repo/projects.js";
import { listPersonas } from "./personas.js";
import { listCompetitors } from "./competitors.js";
import { runGeoStep } from "./geo.js";
import type { PipelineContext } from "./pipeline.js";

export const geoMeasureJob: JobHandler<PipelineContext> = async (ctx, job, progress) => {
  const projectId = String(job.payload["projectId"] ?? job.projectId ?? "");
  const project = getProject(ctx.db, projectId);
  const brief = s.Brief.safeParse(project?.brief);
  if (!project || !brief.success) throw new Error("GEO-Messung braucht einen Brief.");
  progress("geo", { status: "running", startedAt: nowIso() });
  const { result } = await withRun(ctx.db, { task: "analysis.geo", model: modelFor("critic"), projectId }, (usage) =>
    runGeoStep(ctx, project, brief.data, listPersonas(ctx, projectId), listCompetitors(ctx, projectId), usage, { batch: job.id, ...(ctx.geoCount ? { count: ctx.geoCount } : {}), ...(ctx.geoEngines ? { engines: ctx.geoEngines } : {}) }));
  progress("geo", { status: "done", finishedAt: nowIso(), detail: result });
  return { summary: result };
};
