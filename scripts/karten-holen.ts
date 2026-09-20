/**
 * Kartenscans für Drehbücher beschaffen — in beiden Größen, die die Reel-Skripte
 * erwarten: 340 px fürs Fach (`karten/`), 700 px für die Einzelkarte
 * (`karten-gross/`). Quelle ist der Produktkatalog (`cardImage`), wie in
 * `reel-preis.ts`; hier nur für eine Liste von Ids statt einer Rangliste.
 *
 *   pnpm exec tsx scripts/karten-holen.ts sv06-188 swsh7-215 …
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/server/env.js";
import { openDatabase } from "../src/server/db/index.js";
import { createProductDataProvider } from "../src/server/data-source.js";
import { runFfmpeg } from "../src/server/agents/video/assemble.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const daten = createProductDataProvider(db, env, PROJEKT, { log: () => {} });
const kartenDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten");
const grossDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten-gross");
fs.mkdirSync(kartenDir, { recursive: true }); fs.mkdirSync(grossDir, { recursive: true });
const dateiName = (id: string) => id.replace(/[^\w.-]/g, "_");

for (const id of process.argv.slice(2)) {
  const klein = path.join(kartenDir, `${dateiName(id)}.jpg`);
  const gross = path.join(grossDir, `${dateiName(id)}.jpg`);
  if (fs.existsSync(klein) && fs.existsSync(gross)) { console.log(`${id}: vorhanden`); continue; }
  const quelle = await daten.cardImage(id, "de");
  if (!quelle) { console.log(`${id}: KEIN SCAN`); continue; }
  if (!fs.existsSync(klein)) await runFfmpeg(["-i", quelle, "-vf", "scale=340:-1:flags=lanczos", "-q:v", "3", "-y", klein]);
  if (!fs.existsSync(gross)) await runFfmpeg(["-i", quelle, "-vf", "scale=700:-1:flags=lanczos", "-q:v", "2", "-y", gross]);
  console.log(`${id}: geholt`);
}
daten.close();
