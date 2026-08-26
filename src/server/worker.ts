/** Worker process: claims jobs from mp_jobs and runs them (renders, recordings). Started by app-marketing-pilot-worker.service. */
import { loadEnv } from "./env.js";
import { openDatabase } from "./db/index.js";
import { buildContext } from "./services.js";
import { markStaleJobs, runWorkerLoop } from "./jobs.js";
import { renderVideoJob } from "./agents/video/pipeline.js";

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
await runWorkerLoop(ctx, { "video.render": renderVideoJob }, { signal: ac.signal });
