/**
 * Bildpost „Binderseite des Tages" als Datei — zum Ansehen, ohne Stück.
 *
 * Das Layout liegt in `src/server/agents/studio/bildpost.ts`; dieses Skript ist
 * nur die Kommandozeile davor. Wer den Bildpost als **Beitrag** braucht (mit
 * Text, Kanal und Termin), nimmt `scripts/stueck-anlegen.ts`.
 *
 *   pnpm exec tsx scripts/bildpost-seite.ts --seite _JoY2MluG11O \
 *     --titel "Drei Slabs.\nOder eine Seite." --layout b
 */
import { loadEnv } from "../src/server/env.js";
import { openDatabase } from "../src/server/db/index.js";
import { rendereBildpost } from "../src/server/agents/studio/bildpost.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const datei = await rendereBildpost({
  db, env, projektId: PROJEKT,
  seite: arg("--seite") ?? "_JoY2MluG11O",
  titel: (arg("--titel") ?? "Drei Slabs.\\nOder eine Seite.").replace(/\\n/g, "\n").split("\n"),
  kicker: arg("--kicker") ?? "Binderseite des Tages",
  layout: (arg("--layout") ?? "b") === "a" ? "a" : "b",
});
console.log(datei);
