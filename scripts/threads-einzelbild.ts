/**
 * Einzelbild für Threads-Preisbeiträge: die Rang-1-Karte einer Rangliste als
 * eigenständige Slide — ohne den Zähler „8 / 9", den die Carousel-Slide oben
 * rechts trägt. In der Ecke steht stattdessen der Bereich der Rangliste
 * (Set, Illustrator, Ära). Aufruf: `pnpm exec tsx scripts/threads-einzelbild.ts`
 * — bearbeitet alle Threads-Stücke mit `meta.threadsArt = "preis+bild"`.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, parseJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { loadBrandKit } from "../src/server/agents/studio/brandkit.js";
import { binderRankHtml, dataUrlFor, playwrightRenderer } from "../src/server/agents/studio/render.js";
import { createProductDataProvider } from "../src/server/data-source.js";

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const PID = process.argv[2] ?? "47a70767-fbe6-4657-b406-2de088282896";
const kit = loadBrandKit(db, PID);
const logo = kit.logoAssetId ? db.select().from(t.mpAssets).all().find((a) => a.id === kit.logoAssetId) : undefined;
const logoDataUrl = logo ? dataUrlFor(path.join(env.MP_DATA_DIR, logo.path)) : null;
const daten = createProductDataProvider(db, env, PID, { log: () => {} });
const L = { platz: "Platz", nr: "Nr.", illu: "Illustration" };
const fmtEur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

type Karte = { id: string; name: string; localId: string; priceEur: number; setName: string };
const alle = db.select().from(t.mpContentPieces).all();
const posts = alle.filter((p) => p.channel === "threads" && parseJson<Record<string, unknown>>(p.meta, {})["threadsArt"] === "preis+bild");
for (const p of posts) {
  const m = parseJson<Record<string, unknown>>(p.meta, {});
  const lead = alle.find((x) => x.id === m["quelleBundle"]);
  if (!lead) { console.log(`- ${p.title}: Quell-Rangliste fehlt`); continue; }
  const lm = parseJson<Record<string, unknown>>(lead.meta, {});
  // Standard ist Platz 1; `meta.karteRang` wählt eine andere Karte der Rangliste (z. B. das Karpador auf Platz 2).
  const rang = Number(m["karteRang"] ?? 1);
  const card = (lm["cards"] as (Karte & { rank: number })[]).find((c) => c.rank === rang) ?? (lm["cards"] as Karte[])[0]!;
  const fakten = daten.cardFacts(card.id, "de");
  const img = await daten.cardImage(card.id, "de");
  const outDir = path.join(env.MP_DATA_DIR, "assets", PID, "pieces", p.id);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "de-1080x1350-karte.png");
  const ecke = String(lm["scopeLabel"] ?? card.setName);
  const html = binderRankHtml(kit, {
    rank: rang, name: card.name, numLine: `${card.localId}${fakten?.setOfficial ? ` / ${fakten.setOfficial}` : ""}`,
    illustrator: fakten?.illustrator ?? null, price: fmtEur(card.priceEur), imageDataUrl: img ? dataUrlFor(img) : null,
  }, 1080, 1350, { brand: "Binderplan", footer: String(lm["footer"] ?? ""), logoDataUrl, corner: ecke }, L);
  await playwrightRenderer([{ html, width: 1080, height: 1350, file }]);
  // Frühere Einzelbilder dieses Stücks ersetzen, statt Leichen zu hinterlassen.
  for (const alt of db.select().from(t.mpAssets).all().filter((a) => a.contentPieceId === p.id && parseJson<Record<string, unknown>>(a.meta, {})["einzelbild"] === true)) {
    db.delete(t.mpAssets).where(eq(t.mpAssets.id, alt.id)).run();
  }
  const id = crypto.randomUUID();
  db.insert(t.mpAssets).values({
    id, contentPieceId: p.id, projectId: PID, kind: "render", path: path.relative(env.MP_DATA_DIR, file),
    meta: JSON.stringify({ aiGenerated: true, provenance: "png-text-chunk", size: "1080x1350", dataSlide: true, einzelbild: true, card: card.id }),
    createdAt: new Date().toISOString(),
  }).run();
  db.update(t.mpContentPieces).set({ assets: JSON.stringify([id]), updatedAt: new Date().toISOString() }).where(eq(t.mpContentPieces.id, p.id)).run();
  console.log(`- ${p.title}: Ecke „${ecke}", ${card.name} ${card.localId}${fakten?.setOfficial ? `/${fakten.setOfficial}` : ""}, Kartenbild ${img ? "ok" : "FEHLT"}`);
}
daten.close();
