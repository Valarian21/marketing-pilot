/** `pnpm db:migrate` - apply pending migrations without starting the server. */
import { loadEnv } from "../env.js";
import { openDatabase } from "./index.js";

const env = loadEnv();
const { sqlite } = openDatabase(env.MP_DATA_DIR);
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mp_%' ORDER BY name").all() as { name: string }[];
console.log(`mp.db in ${env.MP_DATA_DIR}: ${tables.length} tables -> ${tables.map((t) => t.name).join(", ")}`);
sqlite.close();
