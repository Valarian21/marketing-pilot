/**
 * Diagramme des Piloten — reines SVG, keine Bibliothek.
 *
 * Die Regeln, nach denen hier gezeichnet wird, und warum:
 *
 * - **Nie zwei Achsen in einem Bild.** Aufrufe (Hunderte) und Konten (eine
 *   Handvoll) in ein Achsenkreuz zu legen, erfindet einen Zusammenhang, den die
 *   Daten nicht hergeben. Zwei Größen heißt zwei Diagramme.
 * - **Farbe gehört zur Sache, nicht zum Rang.** Instagram ist immer Blau,
 *   Facebook immer Orange, Threads immer Grün — auch wenn ein Kanal gerade
 *   vorne liegt oder ausgeblendet wird. Die Reihenfolge der Slots ist geprüft
 *   (Farbfehlsichtigkeit, Kontrast); ein vierter Kanal bekommt deshalb keine
 *   neue Farbe, sondern Grau.
 * - **Eine Lücke ist keine Null.** Fehlt eine Messung, bricht die Linie; sie
 *   fällt nicht auf null. Sonst liest sich ein nicht abgerufener Tag wie ein
 *   Einbruch.
 * - **Dünne Striche, ruhige Achsen, wenige Beschriftungen.** Beschriftet wird
 *   das Ende einer Linie und der Höchstwert, nicht jeder Punkt; alles andere
 *   steht im Tooltip und in der Tabelle darunter.
 */
import { useId, useState, type ReactNode } from "react";

export const SERIEN_FARBE = ["var(--mp-serie-1)", "var(--mp-serie-2)", "var(--mp-serie-3)"] as const;
/** Kanal → Farbslot. Fest verdrahtet, damit ein Kanal seine Farbe nie wechselt. */
export const KANAL_SLOT: Record<string, number> = { instagram: 0, facebook: 1, threads: 2 };
export const kanalFarbe = (platform: string): string => SERIEN_FARBE[KANAL_SLOT[platform] ?? -1] ?? "var(--mp-serie-rest)";

export const zahl = (x: number | null | undefined, stellen = 0): string =>
  typeof x === "number" ? x.toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen }) : "–";
export const euro = (x: number | null | undefined): string =>
  typeof x === "number" ? x.toLocaleString("de-DE", { style: "currency", currency: "EUR" }) : "–";
export const prozent = (x: number | null | undefined, stellen = 1): string =>
  typeof x === "number" ? `${(x * 100).toLocaleString("de-DE", { maximumFractionDigits: stellen })} %` : "–";
/** „05.09." — Tagesbeschriftung der Achse. */
export const tagKurz = (tag: string): string => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
export const tagLang = (tag: string): string => new Date(`${tag}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long" });

export interface Punkt { tag: string; wert: number | null }
export interface Serie { id: string; label: string; farbe: string; punkte: Punkt[]; einheit?: "zahl" | "euro" }

/** Runde Achsenmarken: 0 / 50 / 100 statt 0 / 47 / 94. */
function achsenMarken(max: number): number[] {
  if (max <= 0) return [0];
  const roh = max / 3;
  const groesse = 10 ** Math.floor(Math.log10(roh));
  const schritt = [1, 2, 2.5, 5, 10].map((f) => f * groesse).find((f) => f >= roh) ?? groesse * 10;
  const marken: number[] = [];
  for (let v = 0; v <= max + schritt * 0.001; v += schritt) marken.push(Math.round(v * 1000) / 1000);
  return marken;
}

/** Zusammenhängende Abschnitte einer Serie — eine Lücke trennt zwei Linien. */
function abschnitte(punkte: Punkt[]): { i: number; wert: number }[][] {
  const out: { i: number; wert: number }[][] = [];
  let lauf: { i: number; wert: number }[] = [];
  punkte.forEach((p, i) => {
    if (p.wert === null || p.wert === undefined) { if (lauf.length) out.push(lauf); lauf = []; return; }
    lauf.push({ i, wert: p.wert });
  });
  if (lauf.length) out.push(lauf);
  return out;
}

export interface ZeitreiheProps {
  serien: Serie[];
  /** Tage in Reihenfolge — alle Serien teilen diese Achse. */
  tage: string[];
  hoehe?: number;
  /** Fläche unter der Linie (nur sinnvoll bei einer Serie). */
  flaeche?: boolean;
  /** Tage, an denen etwas veröffentlicht wurde — als Marker unter der Achse, nicht als zweite Achse. */
  marker?: { tag: string; titel: string }[];
  einheit?: "zahl" | "euro";
  /** Zusätzliche Zeile im Tooltip, z. B. „2 Beiträge". */
  tooltipZusatz?: (tag: string) => string | null;
}

/**
 * Linien- (oder Flächen-)Diagramm über Tage.
 *
 * Der Fadenkreuz-Tooltip zeigt **alle** Serien des angepeilten Tages — man muss
 * also nicht die Linie treffen, nur die Spalte. Getastet wird mit den
 * Pfeiltasten, dieselbe Anzeige.
 */
export function Zeitreihe({ serien, tage, hoehe = 220, flaeche = false, marker = [], einheit = "zahl", tooltipZusatz }: ZeitreiheProps) {
  const [aktiv, setAktiv] = useState<number | null>(null);
  const id = useId();
  const B = 640, links = 46, rechts = 12, oben = 12, unten = 26;
  const iw = B - links - rechts, ih = hoehe - oben - unten;
  const werte = serien.flatMap((s) => s.punkte.map((p) => p.wert)).filter((v): v is number => typeof v === "number");
  const max = Math.max(1, ...werte);
  const marken = achsenMarken(max);
  const skalaMax = Math.max(max, marken[marken.length - 1] ?? max);
  const x = (i: number) => links + (tage.length <= 1 ? iw / 2 : (i / (tage.length - 1)) * iw);
  const y = (v: number) => oben + ih - (v / skalaMax) * ih;
  const fmt = (v: number | null) => (einheit === "euro" ? euro(v) : zahl(v));
  const markerTage = new Set(marker.map((m) => m.tag));

  // Achsenbeschriftung ausdünnen: höchstens acht Tage, sonst klebt alles aneinander.
  const schritt = Math.max(1, Math.ceil(tage.length / 8));

  return (
    <div className="mp-chart">
      <svg viewBox={`0 0 ${B} ${hoehe}`} className="mp-chart-svg" role="img"
        aria-label={`${serien.map((s) => s.label).join(", ")} vom ${tagLang(tage[0] ?? "")} bis ${tagLang(tage[tage.length - 1] ?? "")}`}
        onMouseLeave={() => setAktiv(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * B;
          const i = Math.round(((px - links) / iw) * (tage.length - 1));
          setAktiv(Math.min(tage.length - 1, Math.max(0, i)));
        }}>
        {marken.map((m) => (
          <g key={m}>
            <line x1={links} x2={B - rechts} y1={y(m)} y2={y(m)} className="mp-chart-grid" />
            <text x={links - 8} y={y(m) + 4} className="mp-chart-tick" textAnchor="end">{einheit === "euro" ? euro(m) : zahl(m)}</text>
          </g>
        ))}
        {tage.map((t, i) => (i % schritt === 0 || i === tage.length - 1) && (
          <text key={t} x={x(i)} y={hoehe - 8} className="mp-chart-tick" textAnchor="middle">{tagKurz(t)}</text>
        ))}

        {serien.map((s) => (
          <g key={s.id}>
            {flaeche && abschnitte(s.punkte).map((abs, k) => (
              <path key={k} d={`M ${x(abs[0]!.i)} ${oben + ih} ${abs.map((p) => `L ${x(p.i)} ${y(p.wert)}`).join(" ")} L ${x(abs[abs.length - 1]!.i)} ${oben + ih} Z`}
                fill={s.farbe} opacity="var(--mp-flaeche)" />
            ))}
            {abschnitte(s.punkte).map((abs, k) => (
              abs.length === 1
                ? <circle key={k} cx={x(abs[0]!.i)} cy={y(abs[0]!.wert)} r="3.5" fill={s.farbe} />
                : <path key={k} d={`M ${abs.map((p) => `${x(p.i)} ${y(p.wert)}`).join(" L ")}`} fill="none" stroke={s.farbe} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {/* Direktlabel am Ende der Linie: die eine Beschriftung, die immer trägt. */}
            {(() => {
              const letzte = [...s.punkte].reverse().find((p) => typeof p.wert === "number");
              if (!letzte) return null;
              const i = s.punkte.lastIndexOf(letzte);
              return <>
                <circle cx={x(i)} cy={y(letzte.wert!)} r="4" fill={s.farbe} stroke="var(--mp-surface)" strokeWidth="2" />
                {serien.length > 1 && <text x={x(i) - 8} y={y(letzte.wert!) - 8} className="mp-chart-endlabel" textAnchor="end">{s.label}</text>}
              </>;
            })()}
          </g>
        ))}

        {/* Tage mit Veröffentlichung: eine Markerzeile auf der Grundlinie, keine zweite Achse. */}
        {tage.map((t, i) => markerTage.has(t) && (
          <rect key={`m${t}`} x={x(i) - 2} y={oben + ih + 3} width="4" height="4" rx="1" className="mp-chart-marker" />
        ))}

        {aktiv !== null && tage[aktiv] && (
          <line x1={x(aktiv)} x2={x(aktiv)} y1={oben} y2={oben + ih} className="mp-chart-cross" />
        )}
      </svg>

      {aktiv !== null && tage[aktiv] && (
        <div className="mp-chart-tip" style={{ left: `${((x(aktiv) - links) / iw) * 100}%` }} role="status">
          <div className="mp-chart-tip-tag">{tagLang(tage[aktiv]!)}</div>
          {serien.map((s) => (
            <div key={s.id} className="mp-chart-tip-zeile">
              <span className="mp-chart-key" style={{ background: s.farbe }} aria-hidden="true" />
              <span className="mp-chart-tip-wert">{fmt(s.punkte[aktiv]?.wert ?? null)}</span>
              <span className="mp-chart-tip-label">{s.label}</span>
            </div>
          ))}
          {tooltipZusatz?.(tage[aktiv]!) && <div className="mp-chart-tip-zusatz">{tooltipZusatz(tage[aktiv]!)}</div>}
        </div>
      )}
      {serien.length > 1 && (
        <ul className="mp-legende" aria-label="Kanäle">
          {serien.map((s) => <li key={s.id}><span className="mp-chart-key" style={{ background: s.farbe }} aria-hidden="true" />{s.label}</li>)}
        </ul>
      )}
      <span className="mp-sr-only" id={id}>Die Zahlen stehen auch in der Tabelle unter dem Diagramm.</span>
    </div>
  );
}

/** Winziger Verlauf ohne Achsen — gehört in eine Kachel, nie allein auf die Seite. */
export function Sparkline({ punkte, farbe = "var(--mp-serie-1)", hoehe = 34, breite = 120 }: { punkte: Punkt[]; farbe?: string; hoehe?: number; breite?: number }) {
  const werte = punkte.map((p) => p.wert).filter((v): v is number => typeof v === "number");
  if (werte.length < 2) return <div className="mp-spark mp-spark--leer" aria-hidden="true" />;
  const max = Math.max(...werte), min = Math.min(...werte, 0);
  const spanne = max - min || 1;
  const x = (i: number) => (i / (punkte.length - 1)) * breite;
  const y = (v: number) => hoehe - 2 - ((v - min) / spanne) * (hoehe - 4);
  const teile = abschnitte(punkte);
  const letzter = teile[teile.length - 1]?.at(-1);
  return (
    <svg viewBox={`0 0 ${breite} ${hoehe}`} className="mp-spark" aria-hidden="true" preserveAspectRatio="none">
      {teile.map((abs, k) => (
        <g key={k}>
          <path d={`M ${x(abs[0]!.i)} ${hoehe} ${abs.map((p) => `L ${x(p.i)} ${y(p.wert)}`).join(" ")} L ${x(abs.at(-1)!.i)} ${hoehe} Z`} fill={farbe} opacity="var(--mp-flaeche)" />
          <path d={`M ${abs.map((p) => `${x(p.i)} ${y(p.wert)}`).join(" L ")}`} fill="none" stroke={farbe} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {letzter && <circle cx={x(letzter.i)} cy={y(letzter.wert)} r="2.5" fill={farbe} />}
    </svg>
  );
}

export interface BalkenZeile { id: string; label: string; wert: number | null; zusatz?: ReactNode; farbe?: string }

/**
 * Waagerechte Balken für Stufen und Ränge.
 *
 * Für Stufenfolgen (Trichter) kommt die Farbe aus **einer** Familie hell → dunkel,
 * damit die Reihenfolge sichtbar ist; für Ränge ohne eigene Ordnung bleibt es bei
 * einer Farbe für alle.
 */
export function Balken({ zeilen, einheit = "zahl", stufig = false }: { zeilen: BalkenZeile[]; einheit?: "zahl" | "euro"; stufig?: boolean }) {
  const max = Math.max(1, ...zeilen.map((z) => z.wert ?? 0));
  const stufen = ["var(--mp-stufe-1)", "var(--mp-stufe-2)", "var(--mp-stufe-3)", "var(--mp-stufe-4)", "var(--mp-stufe-5)"];
  return (
    <ul className="mp-balken">
      {zeilen.map((z, i) => (
        <li key={z.id}>
          <span className="mp-balken-label">{z.label}</span>
          <span className="mp-balken-spur">
            <span className="mp-balken-fuell" style={{
              width: `${((z.wert ?? 0) / max) * 100}%`,
              background: z.farbe ?? (stufig ? stufen[Math.min(i, stufen.length - 1)] : "var(--mp-serie-1)"),
            }} />
          </span>
          <span className="mp-balken-wert mp-num-cell">{einheit === "euro" ? euro(z.wert) : zahl(z.wert)}</span>
          {z.zusatz && <span className="mp-balken-zusatz mp-small mp-muted">{z.zusatz}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Tagesbalken (Umsatz, neue Konten) — Werte, die man addieren darf, gehören auf eine Grundlinie. */
export function Tagesbalken({ punkte, farbe = "var(--mp-serie-1)", einheit = "zahl", hoehe = 120 }: { punkte: Punkt[]; farbe?: string; einheit?: "zahl" | "euro"; hoehe?: number }) {
  const [aktiv, setAktiv] = useState<number | null>(null);
  const werte = punkte.map((p) => p.wert ?? 0);
  const max = Math.max(1, ...werte);
  const B = 640, oben = 8, unten = 22, links = 46;
  const ih = hoehe - oben - unten;
  const breite = (B - links - 12) / Math.max(1, punkte.length);
  const schritt = Math.max(1, Math.ceil(punkte.length / 8));
  return (
    <div className="mp-chart">
      <svg viewBox={`0 0 ${B} ${hoehe}`} className="mp-chart-svg" role="img" aria-label="Tageswerte" onMouseLeave={() => setAktiv(null)}>
        <line x1={links} x2={B - 12} y1={oben + ih} y2={oben + ih} className="mp-chart-grid" />
        <text x={links - 8} y={oben + 10} className="mp-chart-tick" textAnchor="end">{einheit === "euro" ? euro(max) : zahl(max)}</text>
        {punkte.map((p, i) => {
          const h = ((p.wert ?? 0) / max) * ih;
          return (
            <g key={p.tag} onMouseEnter={() => setAktiv(i)}>
              {/* Trefferfläche über die ganze Spalte: ein 3-px-Balken ist nicht zu treffen. */}
              <rect x={links + i * breite} y={oben} width={breite} height={ih} fill="transparent" />
              {h > 0 && <rect x={links + i * breite + 1} y={oben + ih - h} width={Math.max(2, breite - 2)} height={h} rx="2" fill={farbe} opacity={aktiv === null || aktiv === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {punkte.map((p, i) => (i % schritt === 0 || i === punkte.length - 1) && (
          <text key={`t${p.tag}`} x={links + i * breite + breite / 2} y={hoehe - 6} className="mp-chart-tick" textAnchor="middle">{tagKurz(p.tag)}</text>
        ))}
      </svg>
      {aktiv !== null && punkte[aktiv] && (
        <div className="mp-chart-tip mp-chart-tip--balken" style={{ left: `${((aktiv + 0.5) / punkte.length) * 100}%` }} role="status">
          <div className="mp-chart-tip-tag">{tagLang(punkte[aktiv]!.tag)}</div>
          <div className="mp-chart-tip-zeile"><span className="mp-chart-tip-wert">{einheit === "euro" ? euro(punkte[aktiv]!.wert) : zahl(punkte[aktiv]!.wert)}</span></div>
        </div>
      )}
    </div>
  );
}

/**
 * Kennzahl-Kachel: Zahl, Vergleich zur Vorperiode, kleiner Verlauf.
 *
 * Der Vergleich fehlt bewusst, wenn für die Vorperiode nichts vorliegt — ein
 * Pfeil „+100 %" gegen eine Nullmessung wäre eine Erfindung.
 */
export function Kennzahl({ label, wert, davor, einheit = "zahl", verlauf, farbe, hinweis, aktiv, onClick }: {
  label: string; wert: number | null; davor?: number | null; einheit?: "zahl" | "euro" | "prozent";
  verlauf?: Punkt[]; farbe?: string; hinweis?: string; aktiv?: boolean; onClick?: () => void;
}) {
  const fmt = einheit === "euro" ? euro : einheit === "prozent" ? (v: number | null) => prozent(v) : (v: number | null) => zahl(v);
  const delta = typeof wert === "number" && typeof davor === "number" && davor > 0 ? (wert - davor) / davor : null;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`mp-kennzahl${aktiv ? " is-aktiv" : ""}${onClick ? " mp-kennzahl--klick" : ""}`} onClick={onClick} title={hinweis} aria-pressed={onClick ? Boolean(aktiv) : undefined}>
      <span className="mp-label">{label}</span>
      <span className="mp-num mp-kennzahl-wert">{fmt(wert)}</span>
      <span className="mp-kennzahl-fuss">
        {delta !== null
          ? <span className={`mp-delta ${delta > 0 ? "is-auf" : delta < 0 ? "is-ab" : ""}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "→"} {prozent(Math.abs(delta), 0)}<span className="mp-muted"> ggü. davor</span></span>
          : <span className="mp-muted mp-small">{typeof davor === "number" ? `vorher ${fmt(davor)}` : "kein Vergleich"}</span>}
      </span>
      {verlauf && verlauf.length > 1 && <Sparkline punkte={verlauf} farbe={farbe ?? "var(--mp-serie-1)"} />}
    </Tag>
  );
}
