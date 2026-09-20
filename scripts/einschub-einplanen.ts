/**
 * Die Einschub-Reels freigeben und in den Instagram-Kalender setzen: eines je Tag.
 *
 * Für jeden Tag wird ein bereits geplanter Beitrag **ersetzt** — der alte wird
 * abgesagt, das Reel übernimmt seinen Platz. Unangetastet bleiben dabei die
 * Kunstseiten-Posts („Art Page"), Stories und andere Reels: Die Kunstseiten sind
 * das Format, das am zuverlässigsten läuft, und sollen nicht verdrängt werden.
 *
 *   pnpm exec tsx scripts/einschub-einplanen.ts            # Trockenlauf
 *   pnpm exec tsx scripts/einschub-einplanen.ts --echt     # schreibt
 */
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, newId, nowIso, parseJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const echt = process.argv.includes("--echt");
const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);

/** Reihenfolge der Serie — die stärkste Seite zuerst. */
const REIHE = ["einschub-coolshit", "einschub-harmonie2", "einschub-harmonie8", "einschub-harmonie4",
  "einschub-harmonie5", "einschub-harmonie1", "einschub-harmonie3", "einschub-harmonie6", "einschub-harmonie7"];

const stuecke = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, PROJEKT)).all();
const meta = (p: typeof stuecke[number]) => parseJson<Record<string, unknown>>(p.meta, {});

/** Je Drehbuch die jüngste Instagram-Fassung, die keine Basis ist. */
const reels = REIHE.map((d) => {
  const treffer = stuecke
    .filter((p) => meta(p)["drehbuch"] === d && meta(p)["platform"] === "instagram" && meta(p)["basis"] !== true && p.status !== "rejected")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { drehbuch: d, stueck: treffer[0] };
});
const fehlend = reels.filter((r) => !r.stueck);
if (fehlend.length) throw new Error(`Ohne Instagram-Fassung: ${fehlend.map((f) => f.drehbuch).join(", ")}`);

const geplant = db.select().from(t.mpScheduledPosts).all();
const stueckVon = new Map(stuecke.map((p) => [p.id, p]));

/** Ein Platz, der überschrieben werden darf. */
function freierPlatz(tag: string): typeof geplant[number] | undefined {
  const kandidaten = geplant
    .filter((s) => s.platform === "instagram" && s.status === "queued" && String(s.scheduledAt).startsWith(tag))
    .filter((s) => {
      const p = stueckVon.get(String(s.pieceId ?? ""));
      if (!p) return false;
      if (/Art Page|Artwork|Kunstseite|Story/i.test(p.title)) return false;
      return p.format !== "artwork_reel";
    })
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  // 13 Uhr bevorzugt: mittags läuft der Feed, und der Platz trägt sonst eine Rangliste.
  return kandidaten.find((s) => String(s.scheduledAt).slice(11, 13) === "13") ?? kandidaten[0];
}

const heute = new Date();
let tagNr = 0;
console.log(echt ? "ECHTER LAUF — es wird geschrieben\n" : "Trockenlauf — nichts wird geändert\n");
for (const { drehbuch, stueck } of reels) {
  let platz: ReturnType<typeof freierPlatz>;
  let tag = "";
  // Den nächsten Tag suchen, an dem ein ersetzbarer Platz frei ist.
  const d = new Date(heute.getTime() + tagNr * 86_400_000);
  tag = d.toISOString().slice(0, 10);
  platz = freierPlatz(tag);
  tagNr++;
  if (!stueck) continue;
  /**
   * Ist an einem Tag nichts zu ersetzen — der Kalender reicht nur bis zum
   * 20.09. —, entsteht ein neuer Termin um 13 Uhr. Verdrängt wird also nur
   * dort, wo der Platz schon vergeben war.
   */
  const zeit = platz ? String(platz.scheduledAt) : `${tag}T13:00:00.000Z`;
  const alt = platz ? stueckVon.get(String(platz.pieceId ?? "")) : undefined;
  console.log(`${zeit.slice(0, 16)}  ${stueck.title.slice(0, 38).padEnd(40)} ${alt ? `ersetzt: ${alt.title.slice(0, 40)}` : "(neuer Termin)"}`);
  if (!echt) continue;

  db.update(t.mpContentPieces).set({ status: "approved", updatedAt: nowIso() }).where(eq(t.mpContentPieces.id, stueck.id)).run();
  if (platz) db.update(t.mpScheduledPosts).set({ status: "cancelled", error: "ersetzt durch Einschub-Reel" }).where(eq(t.mpScheduledPosts.id, platz.id)).run();
  db.insert(t.mpScheduledPosts).values({
    id: newId(), projectId: PROJEKT, pieceId: stueck.id, platform: "instagram",
    scheduledAt: zeit, status: "queued", origin: "manuell",
    providerRef: null, externalUrl: null, error: null, attempts: 0, postedAt: null,
    // `metrics` ist in der Tabelle nicht optional — leeres Objekt statt null.
    metrics: "{}", metricsAt: null, createdAt: nowIso(),
  }).run();
}
console.log(echt ? "\nGeschrieben." : "\nMit --echt ausführen, um zu schreiben.");
