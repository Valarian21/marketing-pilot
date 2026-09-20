/**
 * Kartendaten und -bilder für neue Reel-Drehbücher holen.
 *
 * `reel-binder.ts` erwartet Scans unter `assets/<projekt>/karten/<id>.jpg` und
 * im Drehbuch Preise und Namen als fertige Zeichenketten. Beides beschafft
 * dieses Werkzeug aus den Produktdaten (Binderplan-Katalog, Cardmarket-Preise)
 * und gibt es so aus, dass es sich direkt ins Drehbuch übernehmen lässt.
 *
 * Drei Betriebsarten:
 *
 *   --bereich set:cel30        Top-Karten eines Sets
 *   --bereich era:klassik      Top-Karten einer Ära
 *   --bereich illu:"Mitsuhiro Arita"
 *   --bereich rar:"Special Illustration Rare"
 *   --bereich poke:Glurak     Top-Karten eines Pokemon
 *   --pokemon Rayquaza         alle Karten eines Pokémon mit Preis, nach Ära
 *
 * `--n 9` setzt die Anzahl, `--basis avg30` die Preisgrundlage (Vorgabe: der
 * 30-Tage-Schnitt — der Trendpreis folgt einzelnen Verkäufen und hebt eine
 * Karte schon mal um das Vierfache).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadEnv } from "../src/server/env.js";
import { openDatabase } from "../src/server/db/index.js";
import { createProductDataProvider } from "../src/server/data-source.js";
import { runFfmpeg } from "../src/server/agents/video/assemble.js";

const PROJEKT = "47a70767-fbe6-4657-b406-2de088282896";
const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const eur = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;

/** Kartennummern enthalten „!“ und „/“ — als Dateiname taugt nur das Gesäuberte. */
const dateiName = (id: string) => id.replace(/[^\w.-]/g, "_");

const env = loadEnv();
const { db } = openDatabase(env.MP_DATA_DIR);
const daten = createProductDataProvider(db, env, PROJEKT, { log: () => {} });
const kartenDir = path.join(env.MP_DATA_DIR, "assets", PROJEKT, "karten");
fs.mkdirSync(kartenDir, { recursive: true });

/**
 * Das Bild einer Karte im Reel-Ordner ablegen — auf 340 px verkleinert, weil
 * ein Fach im Reel höchstens 288 px breit ist. Liefert den Dateinamen ohne
 * Endung, also genau das, was im Drehbuch steht.
 */
async function bildHolen(cardId: string): Promise<string | null> {
  const name = dateiName(cardId);
  const ziel = path.join(kartenDir, `${name}.jpg`);
  if (fs.existsSync(ziel)) return name;
  const quelle = await daten.cardImage(cardId, "de");
  if (!quelle) return null;
  await runFfmpeg(["-i", quelle, "-vf", "scale=340:-1:flags=lanczos", "-q:v", "3", "-y", ziel]);
  return name;
}

/** Einzelne Karten über ihre Id — für Vergleiche, die kein Bereich hergibt. */
const einzeln = arg("--karten");
/** Bewegungen der letzten Tage — `--bewegung up|down`. */
const bewegung = arg("--bewegung");
/** Schöne Karten unter einer Preisgrenze — das Gegenstück zu den Teuer-Ranglisten. */
const guenstig = arg("--guenstig");
const bereich = arg("--bereich");
const pokemon = arg("--pokemon");
const n = Number(arg("--n") ?? 9);
const basis = (arg("--basis") ?? "avg30") as "avg30" | "max" | "holo" | "normal";

if (bereich) {
  const [art, ...rest] = bereich.split(":");
  const wert = rest.join(":");
  const scope = art === "set" ? { set: wert }
    : art === "era" ? { era: wert }
    : art === "illu" ? { illustrator: wert }
    : art === "rar" ? { rarity: wert }
    : art === "poke" ? { pokemon: wert }
    : { illustrator: wert };
  const res = await daten.topCards({ scope, n, priceBasis: basis });
  console.log(`\n${res.scopeLabel} — ${res.scopeSub}`);
  console.log(`Preisstand ${res.priceStand}, Summe ${eur(res.totalEur)}`);
  console.log(`Abdeckung: ${res.coverage.priced} von ${res.coverage.cardsInScope} Karten bepreist` +
    (res.coverage.skipped ? `, ${res.coverage.skipped} nicht nachbepreist` : ""));
  const karten: string[] = [], preise: string[] = [], namen: string[] = [];
  for (const c of res.cards) {
    const f = daten.cardFacts(c.id, "de");
    const bild = await bildHolen(c.id);
    karten.push(bild ?? "");
    preise.push(eur(c.priceEur));
    namen.push(c.name);
    console.log(`  ${String(c.rank).padStart(2)}. ${c.name} ${c.localId}  ${eur(c.priceEur).padStart(9)}  ` +
      `${f?.rarity ?? "?"}  ${f?.illustrator ?? "?"}  ${bild ? "" : "KEIN BILD"}`);
  }
  console.log(`\n  karten: ${JSON.stringify(karten)},`);
  console.log(`  preise: ${JSON.stringify(preise)},`);
  console.log(`  namen:  ${JSON.stringify(namen)},`);
}

if (pokemon) {
  // Der Provider kennt keine Namenssuche; der Katalog liegt aber als Datei
  // daneben und wird hier nur gelesen.
  const kat = new Database(path.join(env.MP_DATA_DIR, "cache", "binderplan.db"), { readonly: true });
  const zeilen = kat.prepare(`
    SELECT c.id, COALESCE(c.name_de, c.name_en) AS name, c.local_id, c.rarity, c.illustrator,
           s.name AS setname, s.release_date, p.eur_avg30, p.eur
      FROM cards c
      JOIN sets s ON s.id = c.set_id
      JOIN card_prices p ON p.card_id = c.id
     WHERE (c.name_de LIKE ? OR c.name_en LIKE ?)
       AND COALESCE(p.eur_avg30, p.eur) >= 20
     ORDER BY s.release_date
  `).all(`%${pokemon}%`, `%${pokemon}%`) as Record<string, string | number | null>[];
  console.log(`\n${zeilen.length} Karten für „${pokemon}“ ab 20 €:\n`);
  for (const z of zeilen) {
    const preis = Number(z["eur_avg30"] ?? z["eur"]);
    console.log(`  ${String(z["release_date"]).slice(0, 7)}  ${String(z["setname"]).padEnd(28)} ` +
      `${String(z["name"]).padEnd(22)} ${String(z["local_id"]).padStart(4)}  ${eur(preis).padStart(10)}  ` +
      `${String(z["rarity"] ?? "").padEnd(22)} ${z["id"]}`);
  }
  kat.close();
}

if (einzeln) {
  const kat = new Database(path.join(env.MP_DATA_DIR, "cache", "binderplan.db"), { readonly: true });
  const karten: string[] = [], preise: string[] = [], namen: string[] = [];
  for (const id of einzeln.split(",")) {
    const z = kat.prepare(`
      SELECT COALESCE(c.name_de, c.name_en) AS name, c.local_id, c.rarity, c.illustrator,
             s.name AS setname, s.release_date, p.eur_avg30, p.eur
        FROM cards c JOIN sets s ON s.id = c.set_id
        LEFT JOIN card_prices p ON p.card_id = c.id
       WHERE c.id = ?`).get(id) as Record<string, string | number | null> | undefined;
    if (!z) { console.log(`  ${id}: unbekannt`); continue; }
    const preis = Number(z["eur_avg30"] ?? z["eur"] ?? 0);
    const bild = await bildHolen(id);
    karten.push(bild ?? "");
    preise.push(eur(preis));
    namen.push(String(z["name"]));
    console.log(`  ${String(z["name"]).padEnd(20)} ${String(z["local_id"]).padStart(4)}  ${eur(preis).padStart(9)}  ` +
      `${String(z["setname"])} (${String(z["release_date"]).slice(0, 7)})  ${String(z["rarity"] ?? "")}  ${bild ? bild : "KEIN BILD"}`);
  }
  console.log(`\n  karten: ${JSON.stringify(karten)},`);
  console.log(`  preise: ${JSON.stringify(preise)},`);
  console.log(`  namen:  ${JSON.stringify(namen)},`);
  kat.close();
}

if (bewegung) {
  /**
   * `minPoints` ist hier hoch angesetzt: Zwei Messpunkte ergeben rechnerisch
   * eine Bewegung, aber keine Aussage. Fünf Punkte in sieben Tagen heißt, der
   * Preis wurde fast täglich gesehen — was danach noch als Sprung dasteht, ist
   * einer.
   */
  const res = await daten.priceMovers({ days: 7, direction: bewegung as "up" | "down", minBaseEur: 60, n: 8, minPoints: 5 });
  console.log(`\n${res.scopeLabel}, Stand ${res.priceStand}, ${res.withHistory} Karten mit Verlauf im Fenster`);
  const karten: string[] = [], preise: string[] = [], namen: string[] = [];
  for (const c of res.cards) {
    const bild = await bildHolen(c.id);
    karten.push(bild ?? "");
    preise.push(`${c.changePct > 0 ? "+" : ""}${Math.round(c.changePct)} %`);
    namen.push(c.name);
    console.log(`  ${c.name.padEnd(22)} ${c.localId.padStart(5)}  ${eur(c.baseEur)} → ${eur(c.priceEur)}  ` +
      `(${c.changePct > 0 ? "+" : ""}${c.changePct.toFixed(1)} %)  ${c.setName}  ${bild ? "" : "KEIN BILD"}`);
  }
  console.log(`\n  karten: ${JSON.stringify(karten)},`);
  console.log(`  preise: ${JSON.stringify(preise)},`);
  console.log(`  namen:  ${JSON.stringify(namen)},`);
}

if (guenstig) {
  // Schöne Seltenheiten zum kleinen Preis: dieselbe Bauart wie eine
  // Teuer-Rangliste, nur andersherum — und ohne Karten ohne Scan.
  const kat = new Database(path.join(env.MP_DATA_DIR, "cache", "binderplan.db"), { readonly: true });
  const grenze = Number(guenstig);
  const zeilen = kat.prepare(`
    SELECT c.id, COALESCE(c.name_de, c.name_en) AS name, c.local_id, c.rarity, c.illustrator,
           s.name AS setname, COALESCE(p.eur_avg30, p.eur) AS preis
      FROM cards c
      JOIN sets s ON s.id = c.set_id
      JOIN card_prices p ON p.card_id = c.id
     WHERE c.rarity LIKE '%illustration rare%'
       AND s.region = 'intl' AND COALESCE(c.image_de, c.image_en) IS NOT NULL
       AND COALESCE(p.eur_avg30, p.eur) BETWEEN 2 AND ?
     GROUP BY c.first_dex
     ORDER BY preis DESC LIMIT ?
  `).all(grenze, n) as Record<string, string | number | null>[];
  const karten: string[] = [], preise: string[] = [], namen: string[] = [];
  for (const z of zeilen) {
    const bild = await bildHolen(String(z["id"]));
    karten.push(bild ?? "");
    preise.push(eur(Number(z["preis"])));
    namen.push(String(z["name"]));
    console.log(`  ${String(z["name"]).padEnd(20)} ${String(z["local_id"]).padStart(4)}  ${eur(Number(z["preis"])).padStart(8)}  ` +
      `${String(z["setname"]).padEnd(24)} ${String(z["rarity"])}  ${bild ? "" : "KEIN BILD"}`);
  }
  console.log(`\n  Summe: ${eur(zeilen.reduce((s2, z) => s2 + Number(z["preis"]), 0))}`);
  console.log(`  karten: ${JSON.stringify(karten)},`);
  console.log(`  preise: ${JSON.stringify(preise)},`);
  console.log(`  namen:  ${JSON.stringify(namen)},`);
  kat.close();
}

daten.close();
