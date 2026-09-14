/**
 * Anleitungsvideo „Michi Method fürs 30-Jahre-Set" — Bildschirmaufnahme von binderplan.app.
 *
 * Das Video zeigt den ganzen Weg von der Startseite bis zur ausgedruckten Seite: anmelden,
 * Binder anlegen, drei Seiten bauen, drei Kunstseiten erzeugen, durchblättern. Aufgenommen
 * wird das **echte Produkt**, nicht eine Nachbildung — nur der Malschritt selbst läuft für
 * das Vorführkonto aus dem Bestand (siehe `DEMO_QUELLEN` in artwork.py des Binderplan-Repos).
 * Wartezeit, Ladeanimation, Credit-Abbuchung und Ergebnisansicht sind dadurch dieselben wie
 * bei einem zahlenden Nutzer.
 *
 * Aufgenommen wird in 1920×1080, gelayoutet aber wie auf 1600×900: `body { zoom: 1.2 }`.
 * Direkt in 1600 aufzunehmen und hochzuskalieren kostet sichtbar Schärfe (gemessen 12.09.),
 * direkt in 1920 zu layouten macht die Oberfläche für ein Video zu klein.
 *
 * Zustandsabfragen gehen als Zeichenkette an evaluate, nicht als Funktion: `S` ist in
 * kern.js eine `let`-Bindung und hängt damit **nicht** am window. `window.S` ist undefined,
 * ein blankes `S` in einem als Text übergebenen Ausdruck findet die Bindung dagegen.
 *
 * Untertitel und Zeiger liegen als Ebenen **neben** dem Rumpf (an `documentElement`), also
 * außerhalb des Zooms — sonst stimmen Zeigerkoordinaten und Mausposition nicht überein.
 * Die Untertitel werden mitaufgenommen; parallel entsteht eine .srt mit denselben Zeiten,
 * die später als Sprechtext dient. Eine Stimme hat das Video bewusst noch nicht.
 *
 * Aufruf:
 *   pnpm exec tsx scripts/video-michi.ts --konto probe [--bis 5] [--schnell]
 *   pnpm exec tsx scripts/video-michi.ts --konto daniel          (der echte Lauf)
 *
 * `--schnell` kürzt alle Standzeiten und überspringt die echten Wartezeiten — nur zum
 * Prüfen der Klickwege, das Ergebnis taugt nicht als Video.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Page, type BrowserContext } from "playwright";

const BASIS = process.env.BP_BASIS || "http://127.0.0.1:8103";
const AUSGABE = process.env.MICHI_AUSGABE || path.join(process.cwd(), "data", "video-michi");
const arg = (n: string): string | null => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const flagge = (n: string) => process.argv.includes(n);

const SCHNELL = flagge("--schnell");
const BIS = Number(arg("--bis") || "99");
// Szenen vor `--ab` laufen im Eiltempo durch: der Zustand (angemeldet, Binder gebaut)
// entsteht trotzdem, nur eben in Sekunden statt in Minuten. Nur zum Prüfen.
const AB = Number(arg("--ab") || "0");
// Beim Üben anmelden statt registrieren: die Registrierung ist auf fünf Versuche je
// Stunde und IP gedrosselt. Für den echten Lauf bleibt es bei der Registrierung.
const NUR_ANMELDEN = flagge("--anmelden");
let eilig = SCHNELL;

// --- Konto -------------------------------------------------------------------
// Beide Adressen stehen in ARTWORK_DEMO_MAIL der Binderplan-.env. „probe" ist zum Üben da,
// „daniel" ist das Konto, das im fertigen Video zu sehen ist und im Video neu angelegt wird.
const KONTEN = {
  probe: { mail: "probe@binderplan.app", pw: "ProbeBinder2026", geb: "17.04.1992" },
  daniel: { mail: "daniel@binderplan.app", pw: "MeinBinder2026", geb: "17.04.1992" },
};
const KONTO = KONTEN[(arg("--konto") || "probe") as keyof typeof KONTEN];
if (!KONTO) throw new Error("--konto probe|daniel");
const VORNAME = (arg("--konto") || "probe") === "daniel" ? "Daniel" : "Probe";

// --- Die drei Seiten ---------------------------------------------------------
// Die Fächer müssen exakt zu den Ankern der vorhandenen Kunstseiten passen, sonst
// beschriftet die Fächer-Ansicht die falschen Kacheln. Reihenfolge ist Absicht:
// Seite 1 kostet 12 Credits und geht damit vom Startguthaben eines frischen Kontos.
type Karte = { fach: number; id: string; suche: string; name: string };
const SEITEN: { titel: string; karten: Karte[]; wunsch?: string; credits: number; warten: number }[] = [
  {
    titel: "Feelinara", credits: 12, warten: 66,
    karten: [{ fach: 4, id: "cel30-153", suche: "Feelinara ex", name: "Feelinara ex" }],
  },
  {
    titel: "Mauzi", credits: 14, warten: 36,
    wunsch: "Die drei Tageszeiten zu einer Stadtszene verbinden",
    karten: [
      { fach: 2, id: "cel30-141", suche: "Galarian Mauzi", name: "Galar-Mauzi" },
      { fach: 4, id: "cel30-144", suche: "Mauzi", name: "Mauzi" },
      { fach: 6, id: "cel30-139", suche: "Alolan Mauzi", name: "Alola-Mauzi" },
    ],
  },
  {
    titel: "Vögel", credits: 14, warten: 39,
    karten: [
      { fach: 3, id: "cel30-130", suche: "Lavados", name: "Lavados" },
      { fach: 4, id: "cel30-132", suche: "Arktos", name: "Arktos" },
      { fach: 5, id: "cel30-133", suche: "Zapdos", name: "Zapdos" },
    ],
  },
];

// --- Ebenen im Bild (Zeiger, Untertitel, Schlussbild) ------------------------
// Liegen an documentElement, nicht im Rumpf: der Rumpf ist um 1,2 gezoomt, die Ebenen
// sollen in echten Bildschirmpunkten rechnen.
const EBENEN = `
(() => {
  if (window.__michi) return;
  window.__michi = true;
  const bau = () => {
    if (!document.documentElement || document.getElementById('mz-ebene')) return;
    document.body && (document.body.style.zoom = '1.2');
    const stil = document.createElement('style');
    stil.textContent = \`
      #mz-ebene{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      #mz-zeiger{position:absolute;left:-100px;top:-100px;width:26px;height:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45));transition:transform .09s ease-out}
      #mz-zeiger.druck{transform:scale(.82)}
      #mz-welle{position:absolute;left:-100px;top:-100px;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid rgba(20,40,120,.85);opacity:0;transform:scale(1)}
      @keyframes mzWelle{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(3.1)}}
      #mz-welle.an{animation:mzWelle .5s ease-out}
      #mz-ut{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);max-width:1180px;width:max-content;
        background:rgba(12,14,20,.86);color:#fff;padding:13px 26px;border-radius:13px;font-size:30px;line-height:1.34;
        font-weight:600;text-align:center;letter-spacing:-.2px;opacity:0;transition:opacity .16s ease;text-wrap:balance}
      #mz-ut.an{opacity:1}
      /* Vorspann-Bühne. Die Kunstseiten sind 1920x2650 — hochkant. Als background-size cover
         in einem 16:9-Rahmen bleiben davon 41 % der Höhe übrig, der alte Zoom schnitt nochmal
         weg: man sah weder das ganze Bild noch eine ganze Karte. Jetzt stehen die Seiten als
         img mit fester Höhe nebeneinander — ganz, unbeschnitten, ohne Fahrt.
         (Keine Backticks in diesem Kommentar: das CSS steckt in einem Template-String
         innerhalb eines Template-Strings, ein Backtick schließt den inneren.)
         Unten bleiben 132 px für den Untertitel frei. */
      #mz-vor{position:absolute;inset:0;background:#0b0d12;opacity:0;transition:opacity .45s ease;
        display:flex;align-items:center;justify-content:center;gap:24px;padding:34px 34px 132px}
      #mz-vor.an{opacity:1}
      #mz-vor figure{margin:0;border-radius:10px;overflow:hidden;background:#11141b;
        box-shadow:0 18px 46px rgba(0,0,0,.55);opacity:0;transform:translateY(20px);
        transition:opacity .45s ease,transform .45s cubic-bezier(.2,.7,.3,1)}
      #mz-vor figure.da{opacity:1;transform:none}
      #mz-vor img{display:block;height:100%;width:auto}
      #mz-vor.drei figure{height:820px}
      #mz-vor.eins figure{height:900px}
      #mz-schluss{position:absolute;inset:0;background:#1637b4;color:#fff;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:18px;opacity:0;transition:opacity .5s ease}
      #mz-schluss.an{opacity:1}
      #mz-schluss .adr{font-family:Bungee,system-ui,sans-serif;font-size:76px;letter-spacing:1px}
      #mz-schluss .cl{font-size:31px;opacity:.92;font-weight:600}
    \`;
    document.documentElement.appendChild(stil);
    const e = document.createElement('div');
    e.id = 'mz-ebene';
    e.innerHTML = \`
      <div id="mz-welle"></div>
      <svg id="mz-zeiger" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 2.5 L4 20.5 L8.7 16.2 L11.6 22.6 L14.9 21.1 L12 14.9 L18.6 14.6 Z"
              fill="#fff" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
      <div id="mz-vor"></div>
      <div id="mz-ut"></div>
      <div id="mz-schluss"><div class="adr">binderplan.app</div><div class="cl">Plan deinen Binder. Fach für Fach.</div></div>\`;
    document.documentElement.appendChild(e);
  };
  bau();
  document.addEventListener('DOMContentLoaded', bau);
  window.__mzZeiger = (x, y) => { const z = document.getElementById('mz-zeiger'); if (z) { z.style.left = (x - 4) + 'px'; z.style.top = (y - 2) + 'px'; } };
  window.__mzDruck = (an) => { const z = document.getElementById('mz-zeiger'); if (!z) return; z.classList.toggle('druck', an);
    if (an) { const w = document.getElementById('mz-welle'); const r = z.getBoundingClientRect();
      w.style.left = (r.left + 4) + 'px'; w.style.top = (r.top + 2) + 'px'; w.classList.remove('an'); void w.offsetWidth; w.classList.add('an'); } };
  window.__mzSagen = (text) => { const u = document.getElementById('mz-ut'); if (!u) return;
    if (!text) { u.classList.remove('an'); return; } u.innerHTML = text; u.classList.add('an'); };
  window.__mzVorspann = (modus, urls) => {
    const v = document.getElementById('mz-vor'); if (!v) return;
    if (!modus) { v.classList.remove('an'); return; }
    v.className = modus;
    v.innerHTML = (urls || []).map((u) => '<figure><img src="' + u + '"></figure>').join('');
    v.classList.add('an');
    // Versetzt einblenden: die Seiten kommen nacheinander, damit das Auge sie einzeln
    // aufnimmt statt drei Bilder auf einmal zu sehen.
    [...v.querySelectorAll('figure')].forEach((f, i) => setTimeout(() => f.classList.add('da'), 90 + i * 190));
  };
  window.__mzSchluss = (an) => { const s = document.getElementById('mz-schluss'); if (s) s.classList.toggle('an', an); };
})();`;

// --- Bühne: menschliche Bedienung + Untertitel -------------------------------
const schlaf = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, eilig ? Math.min(ms, 90) : ms)));
const zufall = (a: number, b: number) => a + Math.random() * (b - a);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Cue = { start: number; ende: number; text: string };

class Buehne {
  page: Page;
  t0: number;
  x = 960; y = 540;
  cues: Cue[] = [];
  schnitte: { start: number; ende: number; grund: string }[] = [];
  offen: { start: number; text: string } | null = null;

  constructor(page: Page, t0: number) { this.page = page; this.t0 = t0; }

  /** Sekunden seit Aufnahmebeginn. */
  zeit() { return (Date.now() - this.t0) / 1000; }

  /** Untertitelzeile zeigen und die Zeit mitschreiben. `ms` = wie lange sie steht. */
  async sag(text: string, ms?: number) {
    await this.schliesseCue();
    const gemessen = sprechdauer(text);
    const dauer = Math.max(ms ?? lesezeit(text), gemessen === null ? 0 : gemessen + STIMM_PAUSE_MS);
    this.offen = { start: this.zeit(), text };
    await this.page.evaluate((t) => (window as any).__mzSagen?.(t), text).catch(() => {});
    await schlaf(dauer);
  }

  /** Untertitel ausblenden (z. B. vor einer langen stillen Einstellung). */
  async still(ms = 0) {
    await this.schliesseCue();
    await this.page.evaluate(() => (window as any).__mzSagen?.("")).catch(() => {});
    if (ms) await schlaf(ms);
  }

  private async schliesseCue() {
    if (!this.offen) return;
    const { start, text } = this.offen;
    this.offen = null;
    const ende = this.zeit();
    if (ende - start > 0.4 && !eilig) this.cues.push({ start, ende, text: text.replace(/<br\s*\/?>/g, "\n") });
  }

  /** Maus mit Beschleunigung, leichtem Überschwingen und Zielkorrektur. */
  async zeigeAuf(sel: string, versatz?: { dx?: number; dy?: number }) {
    const el = await this.page.waitForSelector(sel, { state: "visible", timeout: 20000 });
    await el.scrollIntoViewIfNeeded();
    await schlaf(zufall(90, 220));
    const box = await el.boundingBox();
    if (!box) throw new Error("kein Kasten für " + sel);
    const zx = box.x + box.width / 2 + (versatz?.dx ?? zufall(-box.width / 6, box.width / 6));
    const zy = box.y + box.height / 2 + (versatz?.dy ?? zufall(-box.height / 6, box.height / 6));
    await this.fahre(zx, zy);
    return el;
  }

  private async fahre(zx: number, zy: number) {
    const sx = this.x, sy = this.y;
    const weg = Math.hypot(zx - sx, zy - sy);
    if (weg < 2) return;
    // Überschwingen nur auf längeren Wegen – kurze Korrekturen macht auch ein Mensch direkt.
    const ueber = weg > 260 ? zufall(0.03, 0.07) : 0;
    const schritte = Math.max(10, Math.min(46, Math.round(weg / 16)));
    const ms = Math.max(170, Math.min(780, weg * zufall(0.95, 1.5)));
    for (let i = 1; i <= schritte; i++) {
      const t = easeInOut(i / schritte);
      const f = t * (1 + ueber * Math.sin(Math.PI * t));
      const x = sx + (zx - sx) * f, y = sy + (zy - sy) * f;
      await this.page.mouse.move(x, y);
      await this.page.evaluate(([a, b]) => (window as any).__mzZeiger?.(a, b), [x, y]).catch(() => {});
      await schlaf(ms / schritte);
    }
    if (ueber) {   // zurückkorrigieren
      for (let i = 1; i <= 6; i++) {
        const x = this.lerp(zx + (zx - sx) * ueber * 0.5, zx, i / 6);
        const y = this.lerp(zy + (zy - sy) * ueber * 0.5, zy, i / 6);
        await this.page.mouse.move(x, y);
        await this.page.evaluate(([a, b]) => (window as any).__mzZeiger?.(a, b), [x, y]).catch(() => {});
        await schlaf(16);
      }
    }
    this.x = zx; this.y = zy;
  }

  private lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

  /** Zielen, kurz innehalten, klicken. Das Innehalten ist der halbe Realismus.
   *
   *  Vor dem Druck wird nachgesehen, was unter dem Zeiger liegt. Zwischen Messen und
   *  Klicken vergeht fast eine Sekunde, und wenn die Seite in der Zeit noch nachscrollt,
   *  trifft der Klick etwas anderes — im Take vom 12.09. so das Fachmenü statt
   *  „Durchblättern". Ein stiller Fehlklick ist im fertigen Video nicht mehr zu reparieren. */
  async klick(sel: string, versatz?: { dx?: number; dy?: number }) {
    let el = await this.zeigeAuf(sel, versatz);
    await schlaf(zufall(180, 420));
    for (let versuch = 0; versuch < 2; versuch++) {
      // Geprüft wird gegen genau das Element, auf das gezielt wurde — nicht gegen den
      // ersten Treffer des Selektors. „Durchblättern" gibt es zweimal (Knopf und Menü),
      // und der Vergleich mit dem falschen davon meldete einen Fehler, wo keiner war.
      const treffer = await this.page.evaluate(
        ({ ziel, x, y }) => {
          const unter = document.elementFromPoint(x, y);
          return !!(unter && ziel && (ziel === unter || ziel.contains(unter) || unter.contains(ziel)));
        }, { ziel: el, x: this.x, y: this.y }).catch(() => true);
      if (treffer) break;
      if (versuch === 1) throw new Error(`Zeiger liegt nicht auf ${sel}`);
      el = await this.zeigeAuf(sel, { dx: 0, dy: 0 });
      await schlaf(zufall(150, 300));
    }
    await this.page.evaluate(() => (window as any).__mzDruck?.(true)).catch(() => {});
    await this.page.mouse.down();
    await schlaf(zufall(55, 110));
    await this.page.mouse.up();
    await this.page.evaluate(() => (window as any).__mzDruck?.(false)).catch(() => {});
    await schlaf(zufall(160, 340));
  }

  /** Tippen mit schwankendem Anschlag; `tippfehler` baut einen Vertipper samt Korrektur ein. */
  async tippe(sel: string, text: string, opt?: { tippfehler?: boolean }) {
    await this.klick(sel);
    const el = await this.page.$(sel);
    if (!el) throw new Error("Feld fehlt: " + sel);
    const fehlerBei = opt?.tippfehler ? Math.floor(text.length * zufall(0.35, 0.6)) : -1;
    for (let i = 0; i < text.length; i++) {
      if (i === fehlerBei) {
        const falsch = "asdfghjkl"[Math.floor(Math.random() * 9)];
        await el.type(falsch, { delay: 0 });
        await schlaf(zufall(200, 430));
        await this.page.keyboard.press("Backspace");
        await schlaf(zufall(120, 240));
      }
      await el.type(text[i], { delay: 0 });
      const c = text[i];
      await schlaf(c === " " ? zufall(70, 190) : zufall(45, 135));
    }
    await schlaf(zufall(220, 480));
  }

  /** Scrollen in Schüben statt in einem Sprung. */
  async scrolle(px: number, schuebe = 4) {
    for (let i = 0; i < schuebe; i++) {
      await this.page.mouse.wheel(0, px / schuebe);
      await schlaf(zufall(230, 480));
    }
  }

  /** Abschnitt, dessen Mitte im Schnitt herausfällt (die langen Wartezeiten). */
  merkeSchnitt(start: number, ende: number, grund: string) {
    if (ende - start > 1) this.schnitte.push({ start, ende, grund });
  }

  async fertig() { await this.schliesseCue(); }
}

/** Lesezeit einer Untertitelzeile: ~15 Zeichen/s, mindestens 1,6 s. Das ist zugleich
 *  ungefähr das Tempo, in dem die Zeile später gesprochen wird. */
function lesezeit(text: string) {
  const zeichen = text.replace(/<[^>]+>/g, "").length;
  return Math.max(1600, Math.min(7000, 900 + zeichen * 62));
}

/**
 * Gemessene Sprechdauern aus `stimme-zeiten.json` (erzeugt von `michi-stimme.ts`).
 *
 * Die Untertitel werden fest ins Bild aufgenommen. Eine Stimme, die erst hinterher unter das
 * fertige Video gelegt wird, läuft deshalb nach ein paar Minuten an den Untertiteln vorbei —
 * das Bild ist der Takt, nicht der Ton. Also andersherum: erst sprechen lassen, dann
 * aufnehmen. Jede Zeile steht mindestens so lange, wie sie gesprochen wird, plus Luft zum
 * Ausklingen. Wo die Bedienung ohnehin länger dauert, bleibt es bei der bisherigen Standzeit.
 * Ohne die Datei läuft alles wie vorher — dann eben ohne Stimme.
 */
const STIMM_PAUSE_MS = 350;
const STIMMZEITEN: Map<string, number> = (() => {
  const datei = process.env.MICHI_ZEITEN || path.join(AUSGABE, "stimme-zeiten.json");
  const m = new Map<string, number>();
  if (!fs.existsSync(datei)) return m;
  const d = JSON.parse(fs.readFileSync(datei, "utf8")) as { zeilen: { untertitel: string; startMs: number; endeMs: number }[] };
  for (const z of d.zeilen) m.set(z.untertitel, Math.max(m.get(z.untertitel) ?? 0, z.endeMs - z.startMs));
  return m;
})();
const sprechdauer = (text: string): number | null => STIMMZEITEN.get(text) ?? null;

// --- Hilfen ------------------------------------------------------------------
function srt(cues: Cue[]) {
  const zeit = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sek = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sek).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return cues.map((c, i) => `${i + 1}\n${zeit(c.start)} --> ${zeit(c.ende)}\n${c.text}\n`).join("\n");
}

/** Credits des Vorführkontos setzen – simuliert den Plus-Kauf zwischen Seite 1 und 2.
 *  Läuft über sudo, weil die Binderplan-Datenbank root gehört. */
function credits(mail: string, anzahl: number, plan: string) {
  execFileSync("sudo", ["/root/apps/binderplan/venv/bin/python", "-c",
    `import sqlite3;d=sqlite3.connect('/root/apps/binderplan/app.db');` +
    `d.execute("UPDATE users SET credits=?, credits_abo=?, plan=? WHERE email=?",(0,${anzahl},'${plan}','${mail}'));d.commit()`,
  ], { stdio: "ignore" });
}

/** Das Konto vor einem Probelauf restlos entfernen — im Video wird es ja neu angelegt,
 *  also muss die Adresse vorher frei sein. Nur für die beiden Vorführadressen. */
function kontoLoeschen(mail: string) {
  if (!/^(probe|daniel)@binderplan\.app$/.test(mail)) throw new Error("Nur Vorführkonten: " + mail);
  execFileSync("sudo", ["/root/apps/binderplan/venv/bin/python", "-c",
    `import sqlite3\n` +
    `d=sqlite3.connect('/root/apps/binderplan/app.db');d.row_factory=sqlite3.Row\n` +
    `r=d.execute("SELECT id FROM users WHERE email=?",("${mail}",)).fetchone()\n` +
    `if r:\n` +
    `    u=r["id"]\n` +
    `    for tab in ("artworks","binders","sessions"):\n` +
    `        d.execute(f"DELETE FROM {tab} WHERE user_id=?",(u,))\n` +
    `    d.execute("DELETE FROM users WHERE id=?",(u,))\n` +
    `    d.commit()\n` +
    `print("weg" if r else "gab es nicht")`,
  ], { stdio: "inherit" });
}

/** Die drei fertigen Seiten für den Vorspann. Über das Netz gehen sie nicht: `v=voll`
 *  verlangt Besitz, und die öffentliche Vorschau ist nur 900 px lang — hochskaliert
 *  sichtbar weich. Also einmal aus dem Bildspeicher holen, auf Bildbreite bringen und
 *  als Datenadresse einbetten. Immer nur eine im Bild, sonst stirbt der Renderer. */
function vorspannBilder(): string[] {
  const ziel = path.join(AUSGABE, "vorspann");
  fs.mkdirSync(ziel, { recursive: true });
  return ["LKaRP0k2qY_S", "oGTiqnIKyVjU", "fSq9nqKj0Q-5"].map((id) => {
    const jpg = path.join(ziel, id + ".jpg");
    if (!fs.existsSync(jpg)) {
      const roh = path.join(ziel, id + ".png");
      fs.writeFileSync(roh, execFileSync("sudo", ["cat", `/root/apps/binderplan/cache/artwork/${id}.png`],
        { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }));
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", roh, "-vf", "scale=1920:-2", "-q:v", "4", jpg]);
      fs.unlinkSync(roh);
    }
    return "data:image/jpeg;base64," + fs.readFileSync(jpg).toString("base64");
  });
}

// --- Griffe in der Werkbank --------------------------------------------------
// Alles über die sichtbare Oberfläche, nichts über die API: was hier nicht klickbar ist,
// kann ein Zuschauer auch nicht nachmachen.

/** Jedes Fach trägt seinen Platz im Binder als data-idx — verlässlicher als über die
 *  Position im DOM zu zählen. `idx` ist durchgehend über alle Seiten, nicht je Seite. */
const FACH = (idx: number) => `#wb-slots .slot[data-idx="${idx}"]`;
const IDX = (seite: number, fach: number) => seite * 9 + fach;

async function oeffneFilter(b: Buehne) {
  await b.klick("#btn-filter-lade");
  await b.page.waitForSelector("#f-set-btn", { state: "visible", timeout: 10000 });
  await schlaf(500);
}

async function schliesseFilter(b: Buehne) {
  // „Karten zeigen" steht nur am Handy unter den Feldern; am Schreibtisch schließt das ✕
  // in der Kopfzeile der Filterspalte.
  const knopf = (await b.page.isVisible("#f-zeigen-btn"))
    ? "#f-zeigen-btn" : 'button[aria-label="Filter schließen"]';
  await b.klick(knopf);
  await schlaf(900);
}

/** Es gibt drei Suchfelder: eins in der Filterspalte (#f-suche, nur sichtbar solange der
 *  Filter offen ist), eins im Kopf der Trefferliste (#f-suche-lade) und eins fürs Handy.
 *  Genommen wird das, was gerade zu sehen ist. */
async function suchfeld(b: Buehne) {
  for (const sel of ["#f-suche-lade", "#f-suche", "#f-suche-mobil"]) {
    if (await b.page.isVisible(sel)) return sel;
  }
  throw new Error("Kein sichtbares Suchfeld");
}

/** Kartenname ins Suchfeld und warten, bis der gewünschte Treffer in der Liste steht. */
async function sucheKarte(b: Buehne, k: Karte) {
  const feld = await suchfeld(b);
  await b.klick(feld);
  await b.page.fill(feld, "");
  await b.tippe(feld, k.suche);
  await b.page.waitForFunction(`(S.ergebnisse || []).some(x => x.id === ${JSON.stringify(k.id)})`,
    undefined, { timeout: 15000 });
  await schlaf(700);
}

/** Den Treffer anklicken, der wirklich gemeint ist. „Mauzi" liefert 60 Karten und vier
 *  davon heißen im Jubiläumsset gleich — über die Position in S.ergebnisse ist es eindeutig. */
async function legeAn(b: Buehne, k: Karte) {
  const i = await b.page.evaluate<number>(`(S.ergebnisse || []).findIndex(x => x.id === ${JSON.stringify(k.id)})`);
  if (i < 0) throw new Error("Treffer fehlt: " + k.id);
  // Steht der Knopf wirklich auf einem Fach? Bei mehr oder keiner Auswahl hängt er an.
  const ziel = await b.page.evaluate<number[]>("[...S.auswahl]");
  if (ziel.length > 1) throw new Error(`Mehrere Fächer gewählt (${ziel.join(",")}) – ${k.id} würde angehängt`);
  await b.klick(`#ergebnisse .tk:nth-of-type(${i + 1}) .hinzu`);
  await schlaf(900);
}

/** Ein Fach anwählen – der Hinzufügen-Knopf der Trefferkarte zeigt danach dorthin.
 *
 *  Der Haken: `fachKlick` schaltet ein Fach um und räumt die übrige Auswahl **nicht** weg.
 *  Nach dem Einsetzen rückt die Auswahl von selbst auf das nächste freie Fach — wer dann
 *  ein anderes anklickt, hat zwei gewählt, und zwei Fächer heißen für den Hinzufügen-Knopf
 *  „ans Ende anhängen". Genau so landeten Mauzi und Arktos im falschen Fach. Also erst das
 *  abwählen, was schon gewählt ist, dann das Ziel — und danach nachsehen, ob es stimmt. */
async function waehleFach(b: Buehne, seite: number, fach: number) {
  const ziel = IDX(seite, fach);
  for (let versuch = 0; versuch < 3; versuch++) {
    const gewaehlt = await b.page.evaluate<number[]>("[...S.auswahl]");
    for (const idx of gewaehlt) {
      if (idx === ziel) continue;
      await b.klick(FACH(idx));
      await schlaf(220);
    }
    if (!(await b.page.evaluate<boolean>(`S.auswahl.has(${ziel})`))) {
      await b.klick(FACH(ziel));
      await schlaf(400);
    }
    const jetzt = await b.page.evaluate<number[]>("[...S.auswahl]");
    if (jetzt.length === 1 && jetzt[0] === ziel) { await schlaf(400); return; }
  }
  throw new Error(`Fach ${ziel} ließ sich nicht allein wählen`);
}

/** Karte von Fach zu Fach ziehen. Chromium löst beim gedrückten Ziehen echtes
 *  HTML5-Drag aus – deshalb genügt Maus runter, bewegen, loslassen. */
async function ziehe(b: Buehne, von: number, nach: number) {
  const z = await (await b.page.waitForSelector(FACH(nach))).boundingBox();
  if (!z) throw new Error("Fach fehlt");
  await b.zeigeAuf(FACH(von), { dx: 0, dy: 0 });
  await schlaf(320);
  await b.page.mouse.down();
  await b.page.evaluate(() => (window as any).__mzDruck?.(true));
  const zx = z.x + z.width / 2, zy = z.y + z.height / 2;
  const sx = b.x, sy = b.y;
  for (let i = 1; i <= 26; i++) {
    const t = easeInOut(i / 26);
    const x = sx + (zx - sx) * t, y = sy + (zy - sy) * t;
    await b.page.mouse.move(x, y);
    await b.page.evaluate(([a, c]) => (window as any).__mzZeiger?.(a, c), [x, y]);
    await schlaf(26);
  }
  b.x = zx; b.y = zy;
  await schlaf(380);
  await b.page.mouse.up();
  await b.page.evaluate(() => (window as any).__mzDruck?.(false));
  await schlaf(1100);
}

/** Sitzt jede Karte im vorgesehenen Fach? Wenn nicht, malt das Modell zwar dasselbe Bild
 *  (zugeordnet wird über die Kartennummern), aber die Fächer-Ansicht beschriftet die
 *  falschen Kacheln — und genau das sieht man im Video sofort. Also hier hart prüfen. */
async function pruefeSeiten(b: Buehne) {
  const items = await b.page.evaluate<(string | null)[]>(
    "(S.binder && S.binder.items || []).map(x => x && x.type === 'card' ? x.id : null)");
  const fehler: string[] = [];
  SEITEN.forEach((s, seite) => {
    for (const k of s.karten) {
      const ist = items[seite * 9 + k.fach];
      if (ist !== k.id) fehler.push(`Seite ${seite + 1} Fach ${k.fach + 1}: ${ist || "leer"} statt ${k.id}`);
    }
  });
  if (fehler.length) throw new Error("Seiten stimmen nicht:\n  " + fehler.join("\n  "));
  console.log("      Seiten geprüft: alle 7 Karten sitzen richtig");
}

/** „Wie sollen wir dich nennen?" — kommt einmal je frisch angelegtem Konto, und zwar
 *  sobald die Startseite das erste Mal aufgeht. Bei einem bestehenden Konto bleibt die
 *  Frage aus; deshalb nur kurz warten und sonst weitergehen. */
async function namenFrageBeantworten(b: Buehne) {
  await b.page.waitForSelector("#modal-name:not(.hidden)", { timeout: 4000 }).catch(() => {});
  if (!(await b.page.isVisible("#modal-name"))) return;
  await b.sag("Ach ja — den Namen will es noch wissen.");
  await b.tippe("#name-neu", VORNAME);
  await b.klick('[onclick="nameNeuSpeichern()"]');
  await b.page.waitForSelector("#modal-name.hidden", { timeout: 8000 }).catch(() => {});
  await schlaf(900);
}

/** Zur Startseite und warten, bis sie wirklich oben liegt. Die Orte sind Ebenen, die
 *  übereinander aufgehen — wer zu früh weiterklickt, klickt gegen eine verdeckte Seite. */
async function zurStartseite(b: Buehne) {
  await b.klick("#seg-start");
  await b.page.waitForSelector("#startseite:not(.hidden)", { timeout: 10000 }).catch(() => {});
  await b.page.waitForTimeout(900);
  await namenFrageBeantworten(b);
  const griff = 'span.mehr[onclick="vorlagenOeffnen()"]';
  if (!(await b.page.isVisible(griff))) {
    await b.klick(".logo");                 // zweiter Weg: das Zeichen oben links
    await b.page.waitForTimeout(1200);
  }
  await b.page.waitForSelector(griff, { state: "visible", timeout: 10000 });
  await schlaf(600);
}

async function neueSeite(b: Buehne) {
  await oeffneSeitenMenue(b);
  await b.klick('[onclick="seiteAnhaengen()"]');
  await schlaf(1300);
}

/** Alles Offene zumachen, bevor der nächste Griff kommt. Ein stehen gebliebener Dialog
 *  schluckt sonst jeden weiteren Klick, ohne dass man es dem Bild ansieht. */
async function freieBuehne(b: Buehne) {
  for (let i = 0; i < 3; i++) {
    const offen = await b.page.evaluate<number>(
      "document.querySelectorAll('.overlay:not(.hidden), .menu:not(.hidden)').length");
    if (!offen) break;
    await b.page.keyboard.press("Escape");
    await b.page.waitForTimeout(500);
  }
  // Schwebende Fachmenüs hören nicht auf Escape, wohl aber auf einen Klick daneben.
  if (await b.page.evaluate<number>("document.querySelectorAll('.menu:not(.hidden)').length")) {
    await b.page.mouse.click(120, 980);
    await b.page.waitForTimeout(500);
  }
  // Und nach oben, wo die Werkzeugleiste steht: nach drei Kunstseiten steht der Binder
  // weit unten, und der Knopf „Durchblättern" wäre gar nicht im Bild.
  await b.scrolle(-2200, 4);
  await b.page.waitForTimeout(500);
}

async function oeffneSeitenMenue(b: Buehne) {
  // Die Seitenleiste mit „Seite …" gibt es nur im Zustand „Eine Seite"; in „Alle Seiten"
  // ist sie weg. Wer von der Startseite in einen Binder springt, landet in „Alle Seiten".
  if (!(await b.page.isVisible('[onclick="seiteMenueOeffnen()"]'))) {
    await b.klick('button[onclick="binderAnsicht(false)"]');
    await schlaf(1100);
  }
  await b.klick('[onclick="seiteMenueOeffnen()"]');
  await schlaf(500);
}

async function oeffneArtwork(b: Buehne) {
  await oeffneSeitenMenue(b);
  await b.klick('[onclick="artworkOeffnen()"]');
  await b.page.waitForSelector("#modal-artwork:not(.hidden)", { timeout: 10000 });
  await schlaf(900);
}

/** Zur Seite `nr` blättern (0-basiert), so wie ein Mensch: über die Pfeile. */
async function zuSeite(b: Buehne, nr: number) {
  for (let i = 0; i < 12; i++) {
    const jetzt = await b.page.evaluate<number>("S.seite || 0");
    if (jetzt === nr) return;
    await b.klick(jetzt < nr ? '[onclick="seiteWechsel(1)"]' : '[onclick="seiteWechsel(-1)"]');
    await schlaf(700);
  }
}

// --- Drehbuch ----------------------------------------------------------------
async function lauf() {
  fs.mkdirSync(AUSGABE, { recursive: true });
  const browser = await chromium.launch({ args: ["--hide-scrollbars", "--disable-blink-features=AutomationControlled"] });
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "de-DE",
    reducedMotion: "no-preference",
    recordVideo: { dir: path.join(AUSGABE, "roh"), size: { width: 1920, height: 1080 } },
  });
  const t0 = Date.now();
  await ctx.addInitScript(EBENEN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  JS-Fehler:", String(e).slice(0, 160)));
  const b = new Buehne(page, t0);
  const BILDER = vorspannBilder();

  const szene = async (nr: number, name: string, fn: () => Promise<void>) => {
    if (nr > BIS) return;
    eilig = SCHNELL || nr < AB;
    console.log(`  [${b.zeit().toFixed(0).padStart(4)}s] Szene ${nr}: ${name}${eilig ? " (Eiltempo)" : ""}`);
    try {
      await fn();
    } catch (e) {
      // Ein danebenliegender Selektor ist ohne Bild nicht zu finden: festhalten, was oben lag.
      const bild = path.join(AUSGABE, `abbruch-szene${nr}.png`);
      await page.screenshot({ path: bild }).catch(() => {});
      const ebenen = await page.evaluate(() => {
        const o: Record<string, string> = {};
        for (const id of ["startseite", "vitrineseite", "sammlungseite", "marktseite", "profilseite"]) {
          const el = document.getElementById(id);
          if (el) o[id] = el.classList.contains("hidden") ? "zu" : "OFFEN";
        }
        o.adresse = location.href;
        o.modale = [...document.querySelectorAll(".overlay:not(.hidden)")].map((x) => x.id).join(",") || "keins";
        o.menues = [...document.querySelectorAll(".menu:not(.hidden)")].map((x) => x.id).join(",") || "keins";
        return o;
      }).catch(() => ({}));
      console.log("  Abbruch in Szene", nr, "· Zustand:", JSON.stringify(ebenen));
      console.log("  Bild:", bild);
      throw e;
    }
  };

  // --- 1 · Kaltstart: das Ergebnis zuerst ------------------------------------
  // Zwei Einstellungen statt dreier Zoomfahrten. Erst alle drei Seiten ganz nebeneinander,
  // dann eine einzelne groß — die Vogelseite, weil dort drei echte Karten in der Mittelreihe
  // stecken und genau das der gesprochene Satz behauptet. Der letzte Satz läuft schon über
  // dem Produkt: das spart vier Sekunden Standbild und bringt den Zuschauer früher hinein.
  await szene(1, "Kaltstart", async () => {
    await page.goto(`${BASIS}/?landing=1`, { waitUntil: "networkidle" });
    await schlaf(500);
    await page.evaluate(([u]) => (window as any).__mzVorspann?.("drei", u), [BILDER]);
    await schlaf(700);
    await b.sag("Das hier sind drei Seiten aus meinem 30-Jahre-Binder.");
    await b.sag("Kein Sticker, kein gekauftes PDF.");
    await page.evaluate(([u]) => (window as any).__mzVorspann?.("eins", [u[2]]), [BILDER]);
    await schlaf(620);
    await b.sag("Die Karten stecken wirklich in den Fächern — das drumrum ist gemalt.");
    await page.evaluate(() => (window as any).__mzVorspann?.(""));
    await b.sag("Gebaut hab ich die drei in ungefähr zehn Minuten. Zeig ich dir.");
    await schlaf(400);
  });

  // --- 2 · Worum es geht -----------------------------------------------------
  await szene(2, "Landingpage", async () => {
    await b.sag("Die Sache heißt Michi Method.");
    await b.sag("Statt neun Karten in neun Fächer kommt eine rein — und drumherum Bild.");
    await b.scrolle(1400, 5);
    await b.sag("Auf Etsy kosten die fertigen Vorlagen zwölf, fünfzehn Euro.");
    await b.sag("Nur: die kennen deine Karten nicht.");
    await b.scrolle(1200, 4);
    await b.sag("Wir machen's andersrum.");
    await b.sag("Du sagst, welche Karte in welches Fach kommt — das Bild wird drumrum gemalt.");
    await b.sag("Heute mit dem 30-Jahre-Set.");
  });

  // --- 3 · Anmelden ----------------------------------------------------------
  await szene(3, "Anmelden", async () => {
    // location.replace statt goto: sonst bleibt die Landingpage als vorheriger Eintrag im
    // Verlauf stehen, und das history.back() beim Schließen eines Dialogs springt irgendwann
    // dorthin zurück. Genau so landete der erste echte Take mitten in Szene 5 auf der
    // Preisliste (12.09.2026).
    // Der Aufruf muss aus dem evaluate heraus verzögert werden: sonst reißt die Navigation
    // den Ausführungskontext weg, bevor evaluate zurückkommt („Execution context destroyed").
    await page.evaluate(() => { setTimeout(() => location.replace("/app"), 10); });
    await page.waitForURL("**/app", { timeout: 20000 });
    await page.waitForLoadState("networkidle");
    // Dialoge schließen über history.back() (siehe `modalSchliessen` in werkbank.js). Kommt
    // dabei ein back() zu viel — und das passiert —, verlässt die Aufnahme die Seite: der
    // erste echte Take landete so auf about:blank. Ein paar Pufferstände auf derselben
    // Adresse fangen das ab, ohne am Verhalten der App etwas zu ändern.
    await page.evaluate(() => { for (let i = 0; i < 8; i++) history.pushState({ puffer: i }, "", location.href); });
    await schlaf(1400);
    await b.sag("Kurz anmelden, dann können wir loslegen.");
    await b.klick("#btn-konto");
    await schlaf(600);
    if (!NUR_ANMELDEN) await b.klick("#auth-tab-reg");
    await b.sag("E-Mail, Passwort, Geburtsdatum. Mehr will das Ding nicht.");
    await b.tippe("#auth-email", KONTO.mail);
    await b.tippe("#auth-pw", KONTO.pw, { tippfehler: !NUR_ANMELDEN });
    if (!NUR_ANMELDEN) {
      await b.tippe("#auth-geb", KONTO.geb);
      await b.klick("#auth-agb-check");
      await b.sag("Und du kriegst zwölf Credits geschenkt.");
    }
    await b.klick("#auth-senden");
    await schlaf(2600);
    // Ohne diese Prüfung läuft das Skript blind weiter und klickt danach minutenlang gegen
    // den offenen Dialog. Die Registrierung ist auf fünf Versuche je Stunde und IP gedrosselt —
    // beim Üben war genau das die Ursache, nicht ein falscher Selektor.
    const fehler = (await page.textContent("#auth-fehler").catch(() => "") || "").trim();
    const drin = await page.evaluate<boolean>("!!S.user");
    if (!drin) throw new Error("Anmeldung fehlgeschlagen" + (fehler ? ": " + fehler : ""));
    // Direkt nach der Registrierung fragt die App nach dem Rufnamen. Der Dialog verdeckt
    // die Kopfzeile — im Take vom 12.09. klickte danach alles ins Leere.
    await namenFrageBeantworten(b);
    await b.sag("Zwölf Credits sind genau eine Artwork-Seite.");
    await b.sag("Die erste Seite machen wir also umsonst.");
  });

  // --- 4 · Orientierung ------------------------------------------------------
  await szene(4, "Orientierung", async () => {
    await b.sag("Ganz kurz, damit du dich zurechtfindest.");
    for (const [ziel, zeile] of [
      ["#seg-suche", "Hier drin sind deine Binder. Damit arbeiten wir gleich."],
      ["#seg-sammlung", "Das ist deine Sammlung — was du wirklich besitzt, mit Preisen in Euro."],
      ["#seg-markt", "Der Markt zeigt, was gerade steigt und fällt."],
      ["#seg-vitrine", "Und die Vitrine: da stellen andere ihre Kunstseiten rein."],
    ] as [string, string][]) {
      await b.klick(ziel);
      await page.waitForTimeout(600);   // nicht schlaf(): auch im Eiltempo muss die Ebene aufgehen
      await schlaf(1200);
      await b.sag(zeile);
      await schlaf(700);
    }
    await b.sag("Da kommen unsere drei am Ende übrigens auch hin.");
    await b.sag("Mehr musst du fürs Erste nicht wissen.");
  });

  // --- 5 · Binder anlegen und die drei Seiten bauen --------------------------
  await szene(5, "Binder bauen", async () => {
    await zurStartseite(b);
    await b.sag("Neuer Binder, und zwar ein leerer.");
    // Die große „+"-Kachel gibt es erst, wenn schon ein Binder da ist — bei einem frischen
    // Konto ist der Link in der Überschrift „Deine Binder" der einzige sichere Griff.
    await b.klick('span.mehr[onclick="vorlagenOeffnen()"]');
    await schlaf(700);
    await b.sag("Master Set ginge auch — dann sind alle 199 Karten schon drin.");
    await b.sag("Aber wir wollen ja bewusst leere Fächer haben.");
    await b.klick("[onclick=\"vorlage('leer')\"]");
    await schlaf(1600);
    // „Leerer Binder" legt den Binder nur an; der Ort wechselt nicht von selbst.
    if (!(await page.isVisible("#f-suche-lade")) && !(await page.isVisible("#wb-slots"))) {
      await b.klick("#seg-suche"); await schlaf(1200);
    }

    // Set einmal einstellen – danach findet die Suche nur noch Karten aus dem Jubiläumsset.
    await b.sag("Als Erstes stell ich die Suche auf das 30-Jahre-Set.");
    await oeffneFilter(b);
    await b.klick("#f-set-btn");
    await schlaf(500);
    await b.tippe("#set-popover-suche", "30th");
    await b.klick("#set-popover-liste button[onclick=\"setWaehlen('cel30')\"]");
    await schlaf(1500);
    await b.sag("199 Karten. Jede einzelne davon in Folie, zum ersten Mal überhaupt.");
    await schliesseFilter(b);

    // Seite 1: eine Karte, in die Mitte gezogen.
    await b.sag("Seite eins. Eine Karte, in die Mitte.");
    await sucheKarte(b, SEITEN[0].karten[0]);
    await b.sag("Feelinara ex — das ist eine Special Illustration Rare.");
    await b.sag("Zu schade, um zwischen acht anderen Karten unterzugehen.");
    await legeAn(b, SEITEN[0].karten[0]);
    await schlaf(1200);
    await b.sag("Gelandet ist sie im ersten Fach. Ich will sie aber in die Mitte.");
    await ziehe(b, 0, 4);
    await b.sag("Das ist die ganze Idee: eine Karte kriegt die ganze Seite.");

    // Seite 2 und 3
    for (const seite of SEITEN.slice(1)) {
      await neueSeite(b);
      if (seite.titel === "Mauzi") {
        await b.sag("Seite zwei. Die drei Mauzis — Kanto, Alola, Galar.");
        await b.sag("Ich setz die nicht nebeneinander, sondern diagonal.");
      } else {
        await b.sag("Und Seite drei: die Mittelreihe für die drei Vögel.");
      }
      for (const k of seite.karten) {
        // Erst suchen, dann das Fach wählen: ein Klick ins Suchfeld kann die Auswahl
        // aufheben, und der Hinzufügen-Knopf zielt auf das, was zuletzt gewählt wurde.
        await sucheKarte(b, k);
        await waehleFach(b, SEITEN.indexOf(seite), k.fach);
        await legeAn(b, k);
        await schlaf(600);
      }
      if (seite.titel === "Mauzi") {
        await b.sag("Oben rechts, Mitte, unten links. Sieht erstmal komisch aus.");
        await b.sag("Wird gleich Sinn ergeben.");
      } else {
        await b.sag("Arktos, Zapdos, Lavados. Alle drei Illustration Rare.");
        await b.sag("Über und unter denen ist jetzt nichts. Absicht.");
        await b.sag("Das sind die sechs Fächer, die gleich gemalt werden.");
      }
    }
    await pruefeSeiten(b);
  });

  // --- 6/7/8 · Die drei Kunstseiten -----------------------------------------
  for (let i = 0; i < SEITEN.length; i++) {
    const seite = SEITEN[i];
    await szene(6 + i, `Kunstseite ${seite.titel}`, async () => {
      await zuSeite(b, i);
      if (i === 1) {
        // Das Startguthaben ist weg. Der Plus-Tarif ist der ehrliche nächste Schritt —
        // das Konto bekommt ihn hier, während der Untertitel ihn nennt.
        await b.sag("Das Startguthaben ist damit weg.");
        await b.sag("Für die nächsten zwei Seiten brauche ich mehr Credits.");
        await b.sag("Die gibt's im Plus-Tarif — 80 im Monat für 3,99 Euro.");
        // Kein Neuladen nötig: der Artwork-Dialog holt den Kontostand beim Öffnen frisch.
        credits(KONTO.mail, 80, "plus");
        await b.sag("Macht bei acht Seiten im Monat ungefähr 50 Cent pro Seite.");
      }
      await oeffneArtwork(b);
      await schlaf(1200);

      if (i === 0) {
        await b.sag("So, jetzt das eigentliche.");
        await b.sag("Das Raster hier zeigt dir die Seite.");
        await b.sag("Die Karte bleibt im Fach — antippen würde sie übermalen lassen.");
        await b.sag("Die acht leeren Fächer werden gemalt.");
        await b.sag("Stil lass ich auf „Karte“: es malt im Stil der Karte weiter.");
        await b.zeigeAuf("#aw-kont");
        await b.sag("Zwölf Credits. Genau das Startguthaben. Los.");
      } else if (i === 1) {
        await b.sag("Seite zwei ist der interessantere Fall.");
        await b.sag("Drei Karten, die gar nicht zusammengehören.");
        await b.sag("Kanto-Mauzi am Tag, Alola bei Sonnenuntergang, Galar nachts.");
        await b.sag("Deswegen schreib ich einen Wunsch dazu.");
        await b.tippe("#aw-wunsch", seite.wunsch!, { tippfehler: true });
        await b.zeigeAuf("#aw-passung").catch(() => {});
        await b.sag("Und hier unten steht das Beste am Werkzeug:");
        await b.sag("Es sagt dir vorher, ob die Karten zusammenpassen.");
        await b.sag("Bevor du Credits ausgibst.");
        await b.sag("Vierzehn Credits diesmal, weil es drei Karten sind. Los.");
      } else {
        await b.sag("Letzte Seite. Und ehrlich gesagt meine liebste.");
        await b.sag("Drei Legendäre, drei verschiedene Elemente.");
        await b.sag("Feuer, Eis, Blitz. In einer Landschaft.");
        await b.sag("Ich geb diesmal gar keinen Wunsch ein. Mal sehen.");
      }

      // Starten und echt warten. Die Mitte der Wartezeit fällt im Schnitt heraus.
      await b.klick("#aw-start");
      const wartenAb = b.zeit();
      if (i === 0) {
        await b.sag("Das dauert jetzt gut eine Minute.");
        await b.sag("Das Modell schaut sich die Karte an —");
        await b.sag("die Farben, die Tageszeit, wo der Horizont liegt —");
        await b.sag("und malt die Szene über die anderen acht Fächer weiter.");
      } else {
        await b.sag("Und wieder warten.");
      }
      const stillAb = b.zeit();
      await b.still();
      if (!SCHNELL) await page.waitForSelector("#aw-ergebnis:not(.hidden)", { timeout: 200_000 });
      b.merkeSchnitt(stillAb + 2, b.zeit() - 1.5, `Wartezeit ${seite.titel}`);
      console.log(`      Wartezeit ${seite.titel}: ${(b.zeit() - wartenAb).toFixed(0)} s`);
      await schlaf(1500);

      // Ergebnis zeigen
      if (i === 0) {
        await b.sag("Und da ist sie.");
        await b.sag("Das ist die Fächer-Ansicht — so sieht's im Binder aus.");
        await b.klick("#aw-tab-voll");
        await b.sag("Und das die ganze Seite am Stück.");
        await b.sag("Die Karte in der Mitte ist der echte Scan, pixelgenau eingesetzt.");
        await b.sag("Das ist nicht nachgemalt.");
        await b.klick("#aw-tab-faecher");
      } else if (i === 1) {
        await b.sag("Schau dir an, was es aus der Diagonale gemacht hat.");
        await b.klick("#aw-tab-voll");
        await b.sag("Es hat die drei mit einer Feuertreppe verbunden.");
        await b.sag("Das hab ich nicht vorgegeben. Das kam aus den Karten selbst.");
        await b.klick("#aw-tab-faecher");
      } else {
        await b.klick("#aw-tab-voll");
        await b.sag("Da wo Lavados und Arktos aufeinandertreffen — der rosa Dampf.");
        await b.sag("Sowas denkt sich kein Vorlagen-PDF aus.");
        await b.sag("Das geht nur, weil es deine drei Karten kennt.");
        await schlaf(1800);
        // Drucken erklären wir am letzten Blatt, da ist die Seite am stärksten.
        await b.klick("#aw-tab-faecher");
        await b.sag("Und jetzt der Teil, den die meisten nicht erwarten.");
        await b.klick("#aw-mit-karten");
        await b.sag("Druckbogen als PDF — die acht Fächer einzeln, in echter Kartengröße.");
        await b.klick('[onclick="artworkPdf()"]');
        await schlaf(2600);
        await b.sag("Ausdrucken, an den Linien schneiden, in die leeren Hüllen stecken.");
        await b.sag("63 auf 88 Millimeter. Passt in jede normale Hülle.");
      }
      await b.klick('[onclick="artworkUebernehmen()"]');
      await schlaf(1600);
      // Nach dem Übernehmen fragt das Werkzeug, ob die Seite in die Vitrine soll. Bei den
      // ersten beiden lehnen wir kommentarlos ab; beim letzten Blatt ist es der Moment,
      // die Runde zu schließen — genau diese Seiten liefen im Vorspann über den Schirm.
      const frage = await page.waitForSelector("#modal-aw-teilen:not(.hidden)", { timeout: 8000 }).catch(() => null);
      if (frage) {
        // Freigeben wird nur erzählt, nicht geklickt: das Veröffentlichen verlangt danach
        // einen Anzeigenamen und öffnet den Profil-Dialog — ein Umweg, der mitten im
        // Schlussteil vom Thema wegführt (im Probelauf am 12.09. genau daran gescheitert).
        if (i === SEITEN.length - 1) {
          await b.sag("Die Frage hier ist die Antwort auf den Anfang:");
          await b.sag("Du kannst deine Seite in die Vitrine stellen —");
          await b.sag("übernimmt sie jemand, bekommst du Credits zurück.");
          await b.sag("Ich lass sie heute privat.");
        }
        await b.klick('#modal-aw-teilen [onclick="modalSchliessen()"]');
        await schlaf(1500);
      }
    });
  }

  // --- 9 · Durchblättern -----------------------------------------------------
  await szene(9, "Durchblättern", async () => {
    await b.sag("Und so sieht der Binder jetzt aus.");
    await freieBuehne(b);
    // „Durchblättern" steht an zwei Stellen: als Knopf über dem Binder und im Seitenmenü.
    // Der Knopf ist der kürzere Weg; nur wenn er nicht zu sehen ist, geht es übers Menü.
    const chip = '.chip[onclick="blaetternOeffnen()"]';
    const imMenue = '#menu-seite [onclick="blaetternOeffnen()"]';
    let weg = chip;
    if (!(await page.isVisible(chip))) { await oeffneSeitenMenue(b); weg = imMenue; }
    await b.klick(weg);
    await page.waitForSelector("#blaettern:not(.hidden)", { timeout: 10000 });
    await schlaf(2600);
    await b.sag("Drei Seiten, ungefähr zehn Minuten Arbeit.");
    for (let i = 0; i < 2; i++) {
      await b.klick("#bv-vor");
      await schlaf(2400);
    }
    await b.sag("Die erste war gratis, die anderen beiden zusammen unter einem Euro.");
    await schlaf(1500);
  });

  // --- 10 · Abspann ----------------------------------------------------------
  await szene(10, "Abspann", async () => {
    await b.still(600);
    await page.evaluate(() => (window as any).__mzSchluss?.(true));
    await schlaf(1000);
    await b.sag("Der Binder ist verlinkt — da kannst du dir die Seiten anschauen.");
    await b.sag("Viel Spaß beim Bauen.");
    await b.still(1800);
  });

  await b.fertig();
  const ergebnis = { cues: b.cues, schnitte: b.schnitte, dauer: b.zeit() };
  fs.writeFileSync(path.join(AUSGABE, "cues.json"), JSON.stringify(ergebnis, null, 1));
  fs.writeFileSync(path.join(AUSGABE, "untertitel.srt"), srt(b.cues));

  await ctx.close();
  const roh = fs.readdirSync(path.join(AUSGABE, "roh")).filter((f) => f.endsWith(".webm"));
  await browser.close();
  console.log(`\nRohaufnahme: ${path.join(AUSGABE, "roh", roh[roh.length - 1] || "?")}`);
  console.log(`Länge: ${(ergebnis.dauer / 60).toFixed(1)} min · ${b.cues.length} Untertitel`);
}

if (flagge("--loeschen")) kontoLoeschen(KONTO.mail);
lauf().catch((e) => { console.error(e); process.exit(1); });
