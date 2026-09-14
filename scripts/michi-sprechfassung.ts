/**
 * Sprechfassung des Michi-Videos bauen: aus den Untertiteln wird der Text, der später
 * **einmal** an ElevenLabs geht.
 *
 * Warum eine eigene Fassung und nicht einfach die .srt: der Untertitel muss lesbar sein,
 * der Sprechtext muss aussprechbar sein. „Special Illustration Rare" steht im Bild richtig
 * geschrieben da, gesprochen wird es aber „Späschel Illustrejschen Rär" — eine deutsche
 * Stimme liest die englische Schreibung sonst deutsch. Dieselbe Trennung, die ElevenLabs
 * mit einem Aussprache-Wörterbuch (Alias-Regeln) macht; wir machen sie hier selbst, weil
 * unser API-Schlüssel nur Text-to-Speech darf und für Wörterbücher die Rechte fehlen.
 * Das Ergebnis ist identisch — ElevenLabs rechnet Alias-Regeln ebenfalls vor der Synthese
 * in den Text hinein und stellt die ersetzte Länge in Rechnung.
 *
 * Pausen: Eleven v3 kennt **keine** `<break>`-Tags. Gesteuert wird über Absätze
 * (Leerzeile = lange Pause), Zeilenumbrüche und Auslassungspunkte. Die Pausenlängen kommen
 * aus der Aufnahme selbst — wo im Video zwischen zwei Untertiteln eine Lücke war, steht
 * hier ein Absatz.
 *
 * Aufruf: pnpm exec tsx scripts/michi-sprechfassung.ts [--srt <datei>]
 */
import fs from "node:fs";
import path from "node:path";

const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const ORDNER = process.env.MICHI_AUSGABE || path.join(process.cwd(), "data", "video-michi");
const SRT = arg("--srt") || path.join(ORDNER, "sprechtext.srt");
const ZIEL = path.join(process.cwd(), "assets", "stimme");

/**
 * Ersetzungen für die Stimme. Links steht, was im Untertitel steht, rechts, was gesprochen
 * werden soll. Am 13.09.2026 in drei Runden gegen die Stimme geprüft — übrig ist **eine**.
 *
 * **Englische Begriffe nicht anfassen.** „Special Illustration Rare", „Michi Method",
 * „Artwork-Seite", „Master Set", „Etsy", „PDF" und „E-Mail" kommen englisch bzw. normal
 * geschrieben richtig heraus. Die deutschen Lautumschriften („Späschel Illustrejschen Rär",
 * „Michi Mäthod", „Ettsi", „Peh-Deh-Eff", „Ih-Mejl") waren durchweg schlechter: Deutsch hat
 * kein „th", und aus „Illustrejschen" wird „Illustre-jschen". Das Modell kann Englisch trotz
 * `language_code: de`. **Nachbauen macht es kaputt, nicht heil.**
 *
 * **Ziffern auch nicht anfassen.** Geprüft und gut: „30-Jahre-Set", „199 Karten",
 * „80 im Monat für 3,99 Euro", „63 auf 88 Millimeter" — alle als Ziffern. Ausgeschrieben
 * („Dreißig-Jahre-Set") war hörbar schlechter.
 *
 * **Deutsche Pokémon-Namen** (Feelinara, Mauzi, Arktos, Zapdos, Lavados) liest eine deutsche
 * Stimme regelgerecht.
 *
 * Bleibt das TCG-Suffix **„ex"**. Vier Schreibweisen durchprobiert — „ex", „Ex", „Äx",
 * „ecks", „-ex" und sogar Lautschrift „/ɛks/": **jedes Mal buchstabiert das Modell „Eh–X"**.
 * Ein zweibuchstabiges Anhängsel hinter einem Eigennamen ist für jedes TTS eine Abkürzung,
 * dagegen kommt man mit Schreibweise nicht an. Also fällt es aus dem **Sprechtext** — im
 * Untertitel steht weiterhin „Feelinara ex", und genau dafür sind die beiden Fassungen
 * getrennt. Gesagt wird der Kartenname, gelesen die vollständige Bezeichnung.
 */
const ERSETZUNGEN: [RegExp, string, string][] = [
  // Ausdruck             gesprochen     Grund
  [/Feelinara ex/g, "Feelinara", "TTS buchstabiert jedes ex als Eh-X, egal wie geschrieben"],
];

/** Wenige, gezielte Betonungen. Großschreibung ist bei v3 die Lautstärke-Schraube. */
const BETONUNG: [string, string][] = [
  ["Die erste Seite machen wir also umsonst.", "Die erste Seite machen wir also UMSONST."],
  ["Das ist nicht nachgemalt.", "Das ist NICHT nachgemalt."],
  ["Das hab ich nicht vorgegeben. Das kam aus den Karten selbst.", "Das hab ich nicht vorgegeben … das kam aus den Karten selbst."],
  ["Es sagt dir vorher, ob die Karten zusammenpassen.", "Es sagt dir VORHER, ob die Karten zusammenpassen."],
  ["Und da ist sie.", "Und … da ist sie."],
];

/**
 * Szenenanfänge. Die Untertitel der Aufnahme stoßen lückenlos aneinander (jede Zeile endet,
 * wenn die nächste beginnt), aus den Zeitstempeln lässt sich eine Sprechpause deshalb nicht
 * ablesen — es kamen nur drei heraus. Die Gliederung des Videos steht dagegen fest: an jedem
 * Szenenwechsel gehört ein Absatz, und ein Absatz ist bei v3 die lange Pause.
 */
const SZENENANFANG = [
  "Die Sache heißt Michi Method.",
  "Kurz anmelden, dann können wir loslegen.",
  "Ganz kurz, damit du dich zurechtfindest.",
  "Neuer Binder, und zwar ein leerer.",
  "Seite eins. Eine Karte, in die Mitte.",
  "Seite zwei. Die drei Mauzis — Kanto, Alola, Galar.",
  "Und Seite drei: die Mittelreihe für die drei Vögel.",
  "So, jetzt das eigentliche.",
  "Das Startguthaben ist damit weg.",
  "Seite zwei ist der interessantere Fall.",
  "Letzte Seite. Und ehrlich gesagt meine liebste.",
  "Und jetzt der Teil, den die meisten nicht erwarten.",
  "Die Frage hier ist die Antwort auf den Anfang:",
  "Und so sieht der Binder jetzt aus.",
];

type Cue = { start: number; ende: number; text: string };

function lies(datei: string): Cue[] {
  return fs.readFileSync(datei, "utf8").split(/\n\n+/).map((b) => {
    const z = b.trim().split("\n").filter(Boolean);
    const m = z[1]?.match(/^(\d\d):(\d\d):(\d\d),(\d+) --> (\d\d):(\d\d):(\d\d),(\d+)/);
    if (!m) return null;
    const s = (h: string, min: string, sek: string, ms: string) => +h * 3600 + +min * 60 + +sek + +ms / 1000;
    return { start: s(m[1], m[2], m[3], m[4]), ende: s(m[5], m[6], m[7], m[8]), text: z.slice(2).join(" ") };
  }).filter(Boolean) as Cue[];
}

function lauf() {
  const cues = lies(SRT);
  const roh = cues.map((c) => c.text);

  // Betonungen zuerst: sie greifen auf dem Originalsatz.
  let zeilen = roh.map((t) => BETONUNG.find(([a]) => a === t)?.[1] ?? t);

  // Dann die Aussprache-Ersetzungen, mit Protokoll.
  const protokoll: string[] = [];
  zeilen = zeilen.map((t) => {
    let neu = t;
    for (const [muster, ersatz, grund] of ERSETZUNGEN) {
      const treffer = neu.match(muster);
      if (!treffer) continue;
      neu = neu.replace(muster, ersatz);
      for (const tr of treffer) if (tr !== ersatz) protokoll.push(`  „${tr}" → „${ersatz}"   (${grund})`);
    }
    return neu;
  });

  // Pausen aus der Aufnahme: die Lücke zwischen zwei Untertiteln entscheidet über den Umbruch.
  // v3 kennt keine <break>-Tags — Absatz ist die lange Pause, Zeilenumbruch die kurze.
  const stueck: string[] = [zeilen[0]];
  const fehlend = SZENENANFANG.filter((a) => !roh.includes(a));
  if (fehlend.length) console.log(`  Szenenanker ohne Treffer: ${fehlend.join(" | ")}`);
  for (let i = 1; i < zeilen.length; i++) {
    const luecke = cues[i].start - cues[i - 1].ende;
    const szenenwechsel = SZENENANFANG.includes(roh[i]);
    stueck.push(szenenwechsel || luecke >= 2.5 ? `\n\n${zeilen[i]}` : luecke >= 0.9 ? `\n${zeilen[i]}` : ` ${zeilen[i]}`);
  }
  const text = stueck.join("").replace(/\n{3,}/g, "\n\n").trim();

  fs.mkdirSync(ZIEL, { recursive: true });
  const datei = path.join(ZIEL, "michi-sprechfassung.txt");
  fs.writeFileSync(datei, text + "\n");

  // Zusätzlich maschinenlesbar: welcher Untertitel wird als welcher Satz gesprochen, und
  // welcher Trenner steht davor. `michi-stimme.ts` baut daraus denselben Text noch einmal
  // zusammen und weiß dabei, an welcher Zeichenstelle jede Zeile beginnt — nur so lässt
  // sich die Zeitmessung von ElevenLabs auf die einzelnen Untertitel zurückrechnen.
  const trenner = stueck.map((st, i) => (i === 0 ? "" : st.slice(0, st.length - zeilen[i].length)));
  fs.writeFileSync(path.join(ZIEL, "michi-sprechfassung.json"), JSON.stringify({
    zeilen: zeilen.map((g, i) => ({ nr: i, untertitel: roh[i], gesprochen: g, trenner: trenner[i] })),
  }, null, 1));

  const absaetze = text.split(/\n\n/).length;
  console.log(`Sprechfassung: ${datei}`);
  console.log(`  ${text.length} Zeichen · ${cues.length} Zeilen · ${absaetze} Absätze (= lange Pausen)`);
  console.log(`  Untertitel-Original: ${roh.join(" ").length} Zeichen`);
  if (text.length > 5000) console.log(`  ACHTUNG: über 5.000 Zeichen — v3 nimmt nicht mehr in einem Aufruf.`);
  else console.log(`  Passt in einen einzigen v3-Aufruf (Grenze 5.000 Zeichen), Reserve ${5000 - text.length}.`);
  console.log(`\n${protokoll.length} Ersetzungen:`);
  for (const z of [...new Set(protokoll)]) console.log(z);
}

lauf();
