/** Worker process: claims jobs from mp_jobs and runs them (renders, recordings). Started by app-marketing-pilot-worker.service. */
import { loadEnv } from "./env.js";
import { openDatabase } from "./db/index.js";
import { buildContext } from "./services.js";
import { markStaleJobs, runWorkerLoop } from "./jobs.js";
import { renderVideoJob } from "./agents/video/pipeline.js";
import { renderSlideshowJob } from "./agents/video/slideshow.js";
import { communityScanJob } from "./agents/community/radar.js";
import { weeklyReportJob } from "./agents/loop/weekly.js";
import { geoMeasureJob } from "./agents/analysis/geo-job.js";
import { enqueueDue } from "./scheduler.js";

const env = loadEnv();
const { db, sqlite } = openDatabase(env.MP_DATA_DIR);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const ctx = buildContext(env, db, log);
if (!ctx) { console.error("OPENROUTER_API_KEY fehlt - Worker beendet sich."); process.exit(1); }
const stale = markStaleJobs(db);
if (stale) log(`${stale} Job(s) nach Neustart als abgebrochen markiert`);
const ac = new AbortController();
const stop = () => { log("stopping"); ac.abort(); setTimeout(() => { sqlite.close(); process.exit(0); }, 500); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
log("worker ready");
if (env.MP_SCHEDULER) {
  const tick = () => { try { const d = enqueueDue(db); if (d.length) log(`scheduler: ${d.map((x) => `${x.kind}@${x.projectId.slice(0, 8)}`).join(", ")}`); } catch (e) { log(`scheduler error: ${e instanceof Error ? e.message : String(e)}`); } };
  tick(); setInterval(tick, 10 * 60_000).unref();
}
await runWorkerLoop(ctx, { "video.render": renderVideoJob, "video.slideshow": renderSlideshowJob, "community.scan": communityScanJob, "weekly.report": weeklyReportJob, "geo.measure": geoMeasureJob }, { signal: ac.signal });
