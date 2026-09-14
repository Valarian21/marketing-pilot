/**
 * Themen-Ansicht: ein Beitrag je Kachel, die App-Fassungen als Reiter.
 *
 * Ein Reel entsteht dreimal — für Instagram, TikTok und Shorts —, ist aber
 * **ein** Thema. Als drei getrennte Kacheln nebeneinander war das in der
 * Mediathek nicht zu lesen. Hier steht links die Vorschau, rechts der fertige
 * Text der gewählten App, und die Reiter schalten beides gemeinsam um.
 *
 * Die Ansicht wird von der Mediathek und von der Freigabe benutzt; beide füttern
 * sie aus `/api/mp/media`, damit Vorschau, Text und Gruppierung aus derselben
 * Quelle kommen.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { PLATTFORM_ALIAS, plattformName, sichtbareZeichen } from "../../shared/channels.js";
import { formatName, statusName } from "../../shared/labels.js";
import { POST_ARTEN, type PostArt } from "../../shared/postarten.js";
import { Button, Card, Pill } from "./ui.js";

export interface ThemenStueck {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  format: string;
  status: string;
  platform: string;
  body: string;
  gruppe: string;
  thumbUrl: string | null;
  videoUrl: string | null;
  createdAt: string;
  /** Post-Art aus dem Playbook, falls die Liste sie mitliefert. */
  postArt?: string | undefined;
}

/**
 * Wie lang ein Text in der jeweiligen App sein darf und wie viel davon ohne
 * Antippen zu sehen ist. Die Sichtgrenze ist der wichtigere Wert: Was dahinter
 * steht, liest im Feed niemand.
 */
/** Die harte Grenze der Plattform und ein Satz dazu; die Sichtgrenze kommt aus `channels.ts`. */
const GRENZEN: Record<string, { grenze: number; hinweis: string }> = {
  instagram: { grenze: 2200, hinweis: "Vor dem „mehr“ stehen rund 125 Zeichen." },
  tiktok: { grenze: 2200, hinweis: "Sichtbar sind etwa 100 Zeichen." },
  youtube: { grenze: 1000, hinweis: "Der Titel trägt, die Beschreibung liest kaum jemand." },
  threads: { grenze: 500, hinweis: "Kein Link — er kostet Reichweite." },
  facebook: { grenze: 2200, hinweis: "Die ersten Zeilen entscheiden." },
  pinterest: { grenze: 500, hinweis: "Beschreibung wird durchsucht — Begriffe hineinschreiben." },
};
const grenzeFuer = (p: string) => ({
  ...(GRENZEN[p] ?? GRENZEN[PLATTFORM_ALIAS[p] ?? ""] ?? { grenze: 2200, hinweis: "" }),
  sicht: sichtbareZeichen(p),
});

const appName = (p: string) => plattformName(p);
/** Kürzel für schmale Schirme — nebeneinander lesbar, statt dreimal untereinander. */
const KURZ: Record<string, string> = { instagram: "IG", tiktok: "TT", youtube: "YT", shorts: "YT", threads: "TH", facebook: "FB", pinterest: "PIN" };
const appKurz = (p: string) => KURZ[p] ?? appName(p).slice(0, 2).toUpperCase();

/** Reihenfolge der Reiter: erst die drei, für die wir bauen, dann der Rest alphabetisch. */
const REIHE = ["instagram", "tiktok", "shorts", "youtube", "threads"];
const sortiere = (a: string, b: string) => {
  const ia = REIHE.indexOf(a), ib = REIHE.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

export interface Thema {
  gruppe: string;
  titel: string;
  format: string;
  stuecke: ThemenStueck[];
}

/** Stücke zu Themen bündeln — gleiche `gruppe`, Reiter nach Plattform sortiert. */
export function alsThemen(items: ThemenStueck[]): Thema[] {
  const map = new Map<string, Thema>();
  for (const i of items) {
    const t = map.get(i.gruppe) ?? { gruppe: i.gruppe, titel: i.title.replace(/\s+·\s+\w+$/, ""), format: i.format, stuecke: [] };
    /**
     * Je App nur die jüngste Fassung. Ein neu gebautes Reel ersetzt das alte,
     * das alte bleibt aber in der Datenbank stehen — ohne diese Regel stünden
     * am Thema zwei Reiter „Instagram".
     */
    const schon = t.stuecke.findIndex((s) => s.platform === i.platform);
    if (schon < 0) t.stuecke.push(i);
    else if (i.createdAt > t.stuecke[schon]!.createdAt) t.stuecke[schon] = i;
    map.set(i.gruppe, t);
  }
  for (const t of map.values()) t.stuecke.sort((a, b) => sortiere(a.platform, b.platform));
  return [...map.values()];
}

function Kachel({ thema, nummer, gewaehlt, aufWahl, aufFreigabe, aufAblehnung, linkFor }: {
  thema: Thema;
  nummer: number;
  gewaehlt: boolean;
  aufWahl?: ((gruppe: string, an: boolean) => void) | undefined;
  aufFreigabe?: ((stuecke: ThemenStueck[]) => void) | undefined;
  aufAblehnung?: ((stuecke: ThemenStueck[]) => void) | undefined;
  linkFor: (s: ThemenStueck) => string;
}) {
  const [app, setApp] = useState(thema.stuecke[0]?.platform ?? "");
  const [kopiert, setKopiert] = useState(false);
  const aktiv = thema.stuecke.find((s) => s.platform === app) ?? thema.stuecke[0]!;
  /**
   * Freigegeben wird das **Thema**, nicht die gerade sichtbare App: Ein Reel
   * geht auf allen Kanälen gleichzeitig raus, und drei Klicks für dieselbe
   * Entscheidung sind zwei zu viel.
   */
  const offene = thema.stuecke.filter((s) => s.status === "review");
  const g = grenzeFuer(aktiv.platform);
  const zeichen = aktiv.body.length;
  // Die erste Zeile ist das, was im Feed steht — sie bekommt deshalb eine eigene Marke.
  const ersteZeile = aktiv.body.split("\n")[0] ?? "";
  /**
   * Schlagworte stehen am Textende und werden abgetrennt dargestellt — im Feed
   * sind sie eine eigene Zeile, und beim Prüfen will man sehen, ob es sechs
   * sind oder sechzehn. Kopiert wird trotzdem der ganze Text.
   */
  const zeilen = aktiv.body.trimEnd().split("\n");
  const letzte = zeilen[zeilen.length - 1] ?? "";
  const tags = /^\s*#\S/.test(letzte) ? letzte.trim() : "";
  const rumpf = tags ? zeilen.slice(0, -1).join("\n").trimEnd() : aktiv.body;

  const kopieren = () => {
    navigator.clipboard?.writeText(aktiv.body).then(() => {
      setKopiert(true);
      setTimeout(() => setKopiert(false), 1600);
    }).catch(() => undefined);
  };

  return (
    <Card className="mp-thema">
      <div className="mp-thema-kopf">
        {aufWahl && (
          <label className="mp-thema-haken">
            <input type="checkbox" checked={gewaehlt} onChange={(e) => aufWahl(thema.gruppe, e.target.checked)}
                   aria-label={`${thema.titel} auswählen`} />
          </label>
        )}
        <span className="mp-thema-nr">{String(nummer).padStart(2, "0")}</span>
        <h3 className="mp-thema-titel">{thema.titel || "(ohne Titel)"}</h3>
        {aktiv.postArt && POST_ARTEN[aktiv.postArt as PostArt] && (
          <span className={`mp-art mp-art--${POST_ARTEN[aktiv.postArt as PostArt].farbe}`} title={POST_ARTEN[aktiv.postArt as PostArt].kurz}>
            {aktiv.postArt} · {POST_ARTEN[aktiv.postArt as PostArt].name}
          </span>
        )}
        <Pill kind="kind">{formatName(thema.format)}</Pill>
        <span className="mp-small mp-muted">{statusName(aktiv.status)}</span>
      </div>
      <div className="mp-thema-inhalt">
        <div className="mp-thema-schau">
          {aktiv.videoUrl
            ? <video key={aktiv.id} controls playsInline
                     preload={aktiv.thumbUrl ? "none" : "metadata"}
                     poster={aktiv.thumbUrl ?? undefined}
                     src={aktiv.thumbUrl ? aktiv.videoUrl : `${aktiv.videoUrl}#t=1`} />
            : aktiv.thumbUrl
              ? <img src={aktiv.thumbUrl} alt="" loading="lazy" />
              : <div className="mp-thema-leer">{formatName(thema.format)}</div>}
          {thema.stuecke.length > 1 && (
            <div className="mp-thema-reiter" role="tablist">
              {thema.stuecke.map((s) => (
                <button key={s.id} type="button" role="tab" aria-selected={s.platform === app}
                        onClick={() => setApp(s.platform)}
                        title={s.status === "review" ? "wartet auf Freigabe" : statusName(s.status)}>
                  <span className="mp-app-voll">{appName(s.platform)}</span>
                  <span className="mp-app-kurz">{appKurz(s.platform)}</span>
                  {s.status !== "review" ? " ✓" : ""}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mp-thema-text">
          <div className="mp-thema-textkopf">
            <strong>{appName(aktiv.platform)}</strong>
            <span className={`mp-small ${zeichen > g.grenze ? "mp-thema-eng" : "mp-muted"}`}>
              {zeichen} / {g.grenze} Zeichen
            </span>
            <Button onClick={kopieren}>{kopiert ? "Kopiert" : "Text kopieren"}</Button>
            <Link className="mp-btn mp-btn--secondary" to={linkFor(aktiv)}>Öffnen</Link>
            {aufFreigabe && offene.length > 0 && (
              <Button variant="primary" onClick={() => aufFreigabe(offene)}>
                {offene.length > 1 ? `Alle ${offene.length} freigeben` : "Freigeben"}
              </Button>
            )}
            {aufAblehnung && offene.length > 0 && (
              <Button variant="danger" onClick={() => aufAblehnung(offene)} title="Alle offenen Fassungen dieses Themas ablehnen">
                Ablehnen
              </Button>
            )}
          </div>
          <pre className="mp-thema-body">{rumpf || "(kein Text)"}</pre>
          {tags && <div className="mp-thema-tags">{tags}</div>}
          <p className="mp-small mp-muted">
            {ersteZeile.length > g.sicht
              ? `Achtung: Die erste Zeile ist ${ersteZeile.length} Zeichen lang, sichtbar sind rund ${g.sicht}.`
              : g.hinweis}
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Die Liste der Themen samt Auswahl und Sammel-Freigabe.
 *
 * `aufFreigabe` fehlt in der reinen Mediathek — dort wird nur angesehen; die
 * Freigabe-Seite reicht sie herein und bekommt damit Häkchen, „Alle auswählen"
 * und „Auswahl freigeben".
 */
export function Themen({ items, linkFor, aufFreigabe, aufAblehnung, aufSammelFreigabe, busy }: {
  items: ThemenStueck[];
  linkFor: (s: ThemenStueck) => string;
  aufFreigabe?: ((stuecke: ThemenStueck[]) => void) | undefined;
  /** Fehlt in der Mediathek — nur die Freigabe lehnt ab. */
  aufAblehnung?: ((stuecke: ThemenStueck[]) => void) | undefined;
  aufSammelFreigabe?: ((stuecke: ThemenStueck[]) => void) | undefined;
  busy?: boolean | undefined;
}) {
  const themen = useMemo(() => alsThemen(items), [items]);
  const [wahl, setWahl] = useState<Set<string>>(new Set());
  const waehlbar = aufSammelFreigabe !== undefined;

  const offene = themen.filter((t) => t.stuecke.some((s) => s.status === "review"));
  const gewaehlteStuecke = themen
    .filter((t) => wahl.has(t.gruppe))
    .flatMap((t) => t.stuecke.filter((s) => s.status === "review"));

  const alleAn = offene.length > 0 && offene.every((t) => wahl.has(t.gruppe));
  const umschalten = (gruppe: string, an: boolean) =>
    setWahl((v) => { const n = new Set(v); if (an) n.add(gruppe); else n.delete(gruppe); return n; });

  return (
    <>
      {waehlbar && offene.length > 0 && (
        <div className="mp-thema-leiste">
          <label className="mp-inline mp-small">
            <input type="checkbox" checked={alleAn}
                   onChange={(e) => setWahl(e.target.checked ? new Set(offene.map((t) => t.gruppe)) : new Set())} />
            Alle auswählen <span className="mp-muted">({offene.length} offen)</span>
          </label>
          <span className="mp-small mp-muted">
            {gewaehlteStuecke.length > 0
              ? `${wahl.size} Themen · ${gewaehlteStuecke.length} Beiträge`
              : `${offene.reduce((n, t2) => n + t2.stuecke.filter((s2) => s2.status === "review").length, 0)} Beiträge offen`}
          </span>
          <Button variant="primary" disabled={busy || gewaehlteStuecke.length === 0}
                  onClick={() => { aufSammelFreigabe?.(gewaehlteStuecke); setWahl(new Set()); }}>
            Auswahl freigeben
          </Button>
        </div>
      )}
      <div className="mp-themen">
        {themen.map((t, i) => (
          <Kachel key={t.gruppe} thema={t} nummer={i + 1} gewaehlt={wahl.has(t.gruppe)}
                  aufWahl={waehlbar ? umschalten : undefined}
                  aufFreigabe={aufFreigabe} aufAblehnung={aufAblehnung} linkFor={linkFor} />
        ))}
      </div>
    </>
  );
}
