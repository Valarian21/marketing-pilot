/**
 * Die fertigen Kunstseiten-Reels als JSON — Grundlage für Übersichten.
 *
 * Gruppiert nach Drehbuch, je Drehbuch eine Zeile pro Plattform mit Text,
 * Schlagworten, Videopfad und Länge. Gelesen wird nur, was auch wirklich
 * gebaut wurde; abgelehnte Fassungen (ältere Läufe desselben Drehbuchs) fallen
 * weg.
 *
 * Aufruf: `pnpm exec tsx scripts/stuecke-export.ts [--datei ziel.json]`
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/server/env.js";
import { openDatabase, parseJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);

interface Fassung {
  plattform: string; kanal: string; pieceId: string;
  caption: string; hashtags: string[]; video: string | null; dauerMs: number;
}
interface Thema { drehbuch: string; titel: string; fassungen: Fassung[] }

const stuecke = db.select().from(t.mpContentPieces).where(eq(t.mpContentPieces.projectId, PROJEKT)).all()
  .filter((p) => p.format === "artwork_reel" && p.status !== "rejected");

/** Nur diese drei sind App-Fassungen; ältere `threads`-Stücke aus anderen Läufen bleiben außen vor. */
const reihe = ["instagram", "tiktok", "shorts"];
const themen = new Map<string, Thema>();
/**
 * Je Drehbuch und Plattform zählt nur der jüngste Lauf. Ältere Fassungen
 * bleiben in der Datenbank stehen (sie werden nicht gelöscht, nur überholt),
 * und Basis-Stücke — gebaut mit `--ohne-folgen` — sind Zwischenstände, keine
 * Veröffentlichungen.
 */
const jueng = new Map<string, string>();
for (const p of [...stuecke].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
  const m = parseJson<Record<string, unknown>>(p.meta, {});
  if (m["basis"] === true) continue;
  if (!reihe.includes(String(m["platform"] ?? p.channel))) continue;
  jueng.set(`${m["drehbuch"]}|${m["platform"] ?? p.channel}`, p.id);
}
for (const p of stuecke) {
  const m = parseJson<Record<string, unknown>>(p.meta, {});
  const drehbuch = String(m["drehbuch"] ?? "");
  if (!drehbuch) continue;
  if (jueng.get(`${drehbuch}|${m["platform"] ?? p.channel}`) !== p.id) continue;
  if (!reihe.includes(String(m["platform"] ?? p.channel))) continue;
  const asset = db.select().from(t.mpAssets).all().find((a) => a.contentPieceId === p.id && a.kind === "video");
  const datei = asset ? path.join(env.MP_DATA_DIR, asset.path) : null;
  const thema = themen.get(drehbuch) ?? { drehbuch, titel: p.title.replace(/ · \w+$/, ""), fassungen: [] };
  thema.fassungen.push({
    plattform: String(m["platform"] ?? p.channel),
    kanal: p.channel,
    pieceId: p.id,
    caption: String(m["caption"] ?? ""),
    hashtags: (m["hashtags"] as string[] | undefined) ?? [],
    video: datei && fs.existsSync(datei) ? datei : null,
    dauerMs: Number(m["dauerMs"] ?? 0),
  });
  themen.set(drehbuch, thema);
}

const raus = [...themen.values()].map((th) => ({
  ...th,
  fassungen: th.fassungen.sort((a, b) => reihe.indexOf(a.plattform) - reihe.indexOf(b.plattform)),
}));

const ziel = arg("--datei");
if (ziel) {
  fs.writeFileSync(ziel, JSON.stringify(raus, null, 2));
  console.log(`${raus.length} Themen, ${raus.reduce((n, t2) => n + t2.fassungen.length, 0)} Fassungen → ${ziel}`);
} else {
  for (const th of raus) {
    console.log(`\n${th.titel}  (${th.drehbuch})`);
    for (const f of th.fassungen) {
      console.log(`  ${f.plattform.padEnd(10)} ${(f.dauerMs / 1000).toFixed(1).padStart(5)} s  ` +
        `${f.video ? "Video" : "KEIN VIDEO"}  ${f.caption.length} Zeichen, ${f.hashtags.length} Tags`);
    }
  }
}
