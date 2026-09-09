/**
 * Aufräumen, was niemand mehr braucht.
 *
 * Gemessen am 09.09.2026: von 553 Stücken waren 404 abgelehnt (73 %), und ihre
 * Videos und Bilder lagen weiter auf der Platte — 2,86 GB allein bei Binderplan.
 * Wegzubekommen waren sie nur über 202 Tabellenzeilen mit je einem roten Knopf.
 * Ein Vorratslager für Dinge, die niemand mehr will, ist kein Zustand, den ein
 * Mensch pflegen sollte.
 *
 * Zwei Regeln, beide bewusst konservativ:
 *
 * 1. **Abgelehnte Stücke verlieren nach sieben Tagen ihre Dateien** — der Text,
 *    der Ablehnungsgrund und die Kosten bleiben. Man muss nachvollziehen können,
 *    warum etwas abgelehnt wurde; man muss das 200-MB-Reel dazu nicht behalten.
 *    Sieben Tage, damit ein versehentliches „ablehnen" eine Woche lang
 *    reversibel bleibt.
 * 2. **Abgesagte Termine verschwinden nach 30 Tagen.** Ein `cancelled`-Eintrag
 *    ist die Spur einer Umplanung, keine Historie, die man ein Jahr braucht.
 *    Gescheiterte (`failed`) bleiben — die will man sehen.
 */
import { and, eq, lt } from "drizzle-orm";
import * as t from "./db/schema.js";
import { parseJson, toJson, type Db } from "./db/index.js";
import { deletePieceMedia } from "./routes/storage.js";
import type { JobHandler } from "./jobs.js";

const TAG_MS = 86_400_000;
/** Nach so vielen Tagen verliert ein abgelehntes Stück seine Dateien. */
export const ABGELEHNT_TAGE = 7;
/** Nach so vielen Tagen verschwindet ein abgesagter Termin. */
export const ABGESAGT_TAGE = 30;

export interface AufraeumErgebnis {
  /** Stücke, deren Dateien entfernt wurden. */
  stuecke: number;
  dateien: number;
  bytes: number;
  /** Gelöschte Zeilen abgesagter Termine. */
  termine: number;
}

/**
 * Ein Durchlauf über alle Projekte.
 *
 * `dateienGeloescht` im `meta` des Stücks verhindert, dass jeder Lauf dieselben
 * längst leeren Ordner durchsucht — bei 400 abgelehnten Stücken wäre das jeden
 * Tag ein sinnloser Gang über die Platte.
 */
export function raeumeAuf(db: Db, dataDir: string, opts: { now?: Date; tage?: number } = {}): AufraeumErgebnis {
  const now = opts.now ?? new Date();
  // `tage` weicht nur beim einmaligen Bestandslauf vom Standard ab.
  const grenze = new Date(now.getTime() - (opts.tage ?? ABGELEHNT_TAGE) * TAG_MS).toISOString();
  const out: AufraeumErgebnis = { stuecke: 0, dateien: 0, bytes: 0, termine: 0 };

  const abgelehnt = db.select().from(t.mpContentPieces)
    .where(and(eq(t.mpContentPieces.status, "rejected"), lt(t.mpContentPieces.updatedAt, grenze))).all();
  for (const p of abgelehnt) {
    const meta = parseJson<Record<string, unknown>>(p.meta, {});
    if (meta["dateienGeloescht"]) continue;
    const res = deletePieceMedia(db, dataDir, p.id, "all");
    // Auch wenn nichts zu löschen war (Text-Post ohne Datei): Merker setzen,
    // damit der nächste Lauf dieses Stück überspringt.
    const neu = parseJson<Record<string, unknown>>(db.select({ meta: t.mpContentPieces.meta }).from(t.mpContentPieces).where(eq(t.mpContentPieces.id, p.id)).get()?.meta ?? "{}", {});
    db.update(t.mpContentPieces).set({ meta: toJson({ ...neu, dateienGeloescht: now.toISOString() }) }).where(eq(t.mpContentPieces.id, p.id)).run();
    if (res.deletedFiles > 0) { out.stuecke++; out.dateien += res.deletedFiles; out.bytes += res.freedBytes; }
  }

  const terminGrenze = new Date(now.getTime() - ABGESAGT_TAGE * TAG_MS).toISOString();
  const alteAbsagen = db.select().from(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.status, "cancelled")).all()
    .filter((x) => x.createdAt < terminGrenze);
  for (const x of alteAbsagen) db.delete(t.mpScheduledPosts).where(eq(t.mpScheduledPosts.id, x.id)).run();
  out.termine = alteAbsagen.length;

  return out;
}

export const gib = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

export const CLEANUP_STEPS = ["aufräumen"];

/**
 * Der tägliche Lauf. Projektübergreifend — es gibt nichts zu entscheiden, was
 * je Projekt anders wäre, und ein Job je Projekt hätte nur das Protokoll gefüllt.
 */
export const cleanupJob: JobHandler<{ db: Db; dataDir: string; log: (m: string) => void }> = async (ctx, _job, progress) => {
  progress("aufräumen", { status: "running", startedAt: new Date().toISOString() });
  const res = raeumeAuf(ctx.db, ctx.dataDir);
  const detail = res.stuecke || res.termine
    ? `${res.stuecke} abgelehnte Stücke entrümpelt (${res.dateien} Dateien, ${gib(res.bytes)}), ${res.termine} alte Absagen entfernt`
    : "nichts zu tun";
  ctx.log(`cleanup: ${detail}`);
  progress("aufräumen", { status: "done", detail, finishedAt: new Date().toISOString() });
  return { ...res };
};
