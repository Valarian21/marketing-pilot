/**
 * Beiträge aus einem Redaktionsplan anlegen — Texte und Bildposts.
 *
 * Solange `MP_LLM_PAUSED` steht, schreibt kein Modell Captions: die Texte
 * kommen aus der Claude-Sitzung und müssen trotzdem als richtige Stücke in der
 * Datenbank landen, mit Kanal, Sorte, Schlagworten und (bei Bildposts) einer
 * Bilddatei. Genau das tut dieses Skript. Der Plan ist eine JSON-Datei, damit
 * die Redaktion einer Woche nachlesbar bleibt und ein zweiter Lauf nichts
 * doppelt anlegt (`schluessel` je Stück).
 *
 *   pnpm exec tsx scripts/stueck-anlegen.ts --plan plan.json [--trocken]
 *
 * Ein Eintrag:
 *   {
 *     "schluessel": "th-2026-09-15-cel30",   // eindeutig, verhindert Doppel
 *     "art": "text" | "bildpost",
 *     "kanal": "threads",
 *     "postArt": "T",                        // Sorte aus dem Playbook
 *     "titel": "…",                          // optional, sonst erste Textzeile
 *     "text": "…",                            // der Beitrag, ohne Schlagworte
 *     "hashtags": ["#binderplan"],
 *     "status": "approved",                  // Vorgabe: approved
 *     "seite": "fSq9nqKj0Q-5",               // nur Bildpost: Kunstseite
 *     "bildTitel": "Zeile eins\nZeile zwei", // nur Bildpost: Text im Bild
 *     "kicker": "Binderseite des Tages",     // nur Bildpost
 *     "layout": "a" | "b"                    // nur Bildpost
 *   }
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadEnv } from "../src/server/env.js";
import { eq } from "drizzle-orm";
import { openDatabase, parseJson, toJson } from "../src/server/db/index.js";
import * as t from "../src/server/db/schema.js";
import { rendereBildpost } from "../src/server/agents/studio/bildpost.js";
import { linkRuleFor } from "../src/shared/channels.js";
import { PLATFORM_LIMITS } from "../src/server/util/utm.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const trocken = process.argv.includes("--trocken");

interface Eintrag {
  schluessel: string;
  art: "text" | "bildpost";
  kanal: string;
  postArt: string;
  titel?: string;
  text: string;
  hashtags?: string[];
  status?: "draft" | "review" | "approved";
  seite?: string;
  bildTitel?: string;
  kicker?: string;
  layout?: "a" | "b";
}

const planDatei = arg("--plan");
if (!planDatei) throw new Error("--plan <datei.json> fehlt.");
const plan = JSON.parse(fs.readFileSync(planDatei, "utf8")) as { stuecke: Eintrag[] };

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const start = Date.now();
/**
 * Je Stück ein eigener Zeitstempel, eine Sekunde auseinander.
 *
 * Die Pipeline füllt Slots in Erstellreihenfolge: Wer den Plan in der
 * Reihenfolge der Tage schreibt, bekommt sie auch in dieser Reihenfolge auf
 * die Slots. Bei identischen Zeitstempeln entscheidet die Zeilenfolge der
 * Datenbank — das hält, ist aber nichts, worauf man sich verlassen sollte.
 */
const stempel = (i: number) => new Date(start + i * 1000).toISOString();

/** Schon angelegt? Der Schlüssel steht in `meta.schluessel` — ein zweiter Lauf ergänzt nur. */
const vorhanden = new Set(db.select().from(t.mpContentPieces).all()
  .map((p) => String(parseJson<Record<string, unknown>>(p.meta, {})["schluessel"] ?? ""))
  .filter(Boolean));

let neu = 0, uebersprungen = 0;
for (const [i, e] of plan.stuecke.entries()) {
  const jetzt = stempel(i);
  if (vorhanden.has(e.schluessel)) { uebersprungen++; console.log(`· ${e.schluessel}: steht schon`); continue; }
  if (e.art === "bildpost" && (!e.seite || !e.bildTitel)) throw new Error(`${e.schluessel}: Bildpost braucht seite und bildTitel.`);
  const tags = e.hashtags ?? [];
  // Die Schlagworte hängen am Textende, durch eine Leerzeile getrennt — so
  // liest der Feed sie als eigene Zeile, und die Themen-Ansicht trennt sie ab.
  const body = tags.length ? `${e.text.trimEnd()}\n\n${tags.join(" ")}` : e.text.trimEnd();
  const titel = e.titel ?? e.text.split("\n")[0]!.slice(0, 80);
  const pieceId = crypto.randomUUID();
  const assets: string[] = [];

  const meta = {
    platform: e.kanal, language: "de",
    caption: body, hashtags: tags,
    limit: PLATFORM_LIMITS[e.kanal] ?? 2000,
    linkRule: linkRuleFor(e.kanal),
    autor: "claude-sitzung",
    postArt: e.postArt,
    schluessel: e.schluessel,
    ...(e.art === "bildpost" ? { size: "1080x1350", kunstseite: e.seite, bildTitel: e.bildTitel } : {}),
  };
  if (!trocken) {
    // Erst das Stück, dann die Datei: die Asset-Zeile zeigt per Fremdschlüssel
    // auf das Stück, und SQLite lässt sie sonst nicht zu.
    db.insert(t.mpContentPieces).values({
      id: pieceId, projectId: PROJEKT, taskId: null, channel: e.kanal,
      format: e.art === "bildpost" ? "image" : "text",
      title: `${titel} · ${e.kanal}`, body, assets: toJson(assets),
      status: e.status ?? "approved",
      // Von Hand geschrieben ist von Hand geschrieben — der AI-Tell-Prüfer hat
      // hier nichts zu suchen, und die Mediathek soll es sehen.
      humanEdited: 1, publishedAt: null, externalUrl: null, utm: "{}",
      meta: toJson(meta), aiTellScore: null, aiTellNotes: "", rejectionReason: "",
      createdAt: jetzt, updatedAt: jetzt,
    }).run();
    if (e.art === "bildpost") {
      const datei = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "pieces", pieceId, "de-1080x1350.png");
      await rendereBildpost({
        db, env, projektId: PROJEKT, seite: e.seite!,
        titel: e.bildTitel!.split("\n"),
        ...(e.kicker ? { kicker: e.kicker } : {}),
        layout: e.layout ?? "b",
        datei,
      });
      const assetId = crypto.randomUUID();
      db.insert(t.mpAssets).values({
        id: assetId, contentPieceId: pieceId, projectId: PROJEKT, kind: "render",
        path: path.relative(env.MP_DATA_DIR, datei),
        meta: toJson({ aiGenerated: true, provenance: "bildpost-seite", size: "1080x1350", kunstseite: e.seite }),
        createdAt: jetzt,
      }).run();
      assets.push(assetId);
    }
    if (assets.length) db.update(t.mpContentPieces).set({ assets: toJson(assets) }).where(eq(t.mpContentPieces.id, pieceId)).run();
  }
  neu++;
  console.log(`+ ${e.schluessel.padEnd(28)} ${e.kanal.padEnd(10)} ${e.postArt}  ${titel.slice(0, 54)}`);
}

// Ein Lauf ohne Wirkung ist ein Fehler im Plan, kein Erfolg — deshalb laut.
console.log(`\n${neu} angelegt, ${uebersprungen} übersprungen${trocken ? " (Trockenlauf)" : ""}.`);
if (neu === 0 && uebersprungen === 0) process.exitCode = 1;
