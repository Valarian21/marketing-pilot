/**
 * Übersicht — die eine Seite, die sagt, ob das Marketing wirkt.
 *
 * Aufgebaut wie die Frage, die man wirklich hat, von oben nach unten:
 * 1. Was ist in diesem Zeitraum passiert? (Kennzahlen mit Vergleich)
 * 2. Wie hat es sich entwickelt? (der Verlauf der gewählten Kennzahl)
 * 3. Wo bricht es ab? (der Weg vom Aufruf bis zum Kunden)
 * 4. Welcher Kanal trägt? (je Kanal Bestand, Summe, eigener Verlauf)
 * 5. Kommt es im Produkt an? (Konten, zahlende Kunden, Umsatz)
 * 6. Welcher Beitrag war es? (Tabelle, sortiert nach Aufrufen)
 *
 * Zwei Dinge, die die Seite bewusst **nicht** tut: sie legt keine zwei
 * Größenordnungen in ein Achsenkreuz (Aufrufe und Konten sind zwei Diagramme),
 * und sie zeigt keine Null, wo nichts gemessen wurde — ein Strich sagt „unbekannt",
 * eine Null sagt „niemand", und das ist ein Unterschied.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { CockpitView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { Balken, Kennzahl, Sparkline, Tagesbalken, Zeitreihe, euro, kanalFarbe, prozent, tagKurz, tagLang, zahl, type Punkt, type Serie } from "../components/charts.js";

const ZEITRAEUME = [7, 30, 90] as const;

/** Welche Kennzahl das große Diagramm zeigt — jede mit ihrer eigenen Herkunft. */
const KURVEN = {
  aufrufe: { label: "Aufrufe", quelle: "kanal", hinweis: "Wie oft Inhalte der Kanäle abgespielt oder angezeigt wurden — auch ältere Beiträge zählen mit." },
  interaktionen: { label: "Interaktionen", quelle: "kanal", hinweis: "Likes, Kommentare, Speichern und Teilen zusammen." },
  reichweite: { label: "Reichweite", quelle: "kanal", hinweis: "Konten, die etwas gesehen haben. Nur Instagram meldet das je Tag." },
  profilaufrufe: { label: "Profilaufrufe", quelle: "kanal", hinweis: "Wie oft jemand das Profil geöffnet hat — der Weg zum Link in der Bio." },
  follower: { label: "Follower", quelle: "bestand", hinweis: "Bestand über alle Kanäle. Erst ab dem ersten vollständigen Abruf." },
  klicks: { label: "Klicks auf die Seite", quelle: "pilot", hinweis: "Klicks auf die Kurzlinks des Piloten." },
  konten: { label: "Konten im Produkt", quelle: "bestand", hinweis: "Bestand laut Produktdatenbank." },
  neueKonten: { label: "Neue Konten", quelle: "produkt", hinweis: "An diesem Tag angelegte Konten." },
  umsatz: { label: "Umsatz", quelle: "produkt", hinweis: "Bezahlte Bestellungen des Tages, brutto." },
} as const;
type KurvenId = keyof typeof KURVEN;

export function UebersichtPage() {
  const { id = "" } = useParams();
  const [tage, setTage] = useState<number>(30);
  const [view, setView] = useState<CockpitView | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kurve, setKurve] = useState<KurvenId>("aufrufe");
  const [tabelle, setTabelle] = useState(false);

  const laden = useCallback(async () => {
    try { setView(await api<CockpitView>(`/projects/${id}/cockpit?tage=${tage}`)); setFehler(null); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Fehler"); }
  }, [id, tage]);
  useEffect(() => { void laden(); }, [laden]);

  const abrufen = async () => {
    setBusy(true); setFehler(null);
    try {
      await api(`/projects/${id}/kanal-stats/run`, { method: "POST" });
      // Der Job läuft im Worker; nach ein paar Sekunden steht das Ergebnis.
      await new Promise((r) => setTimeout(r, 6000));
      await laden();
    } catch (e) { setFehler(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };

  const tagesliste = useMemo(() => view?.verlauf.map((v) => v.tag) ?? [], [view]);
  const marker = useMemo(() => (view?.verlauf ?? []).filter((v) => v.beitraege > 0).map((v) => ({ tag: v.tag, titel: `${v.beitraege} Beiträge` })), [view]);

  if (!view) return <><ProjectNav id={id} />{fehler ? <Notice kind="bad">{fehler}</Notice> : <p className="mp-muted">Lade…</p>}</>;

  const k = (kid: string) => view.kennzahlen.find((x) => x.id === kid);
  const punkte = (feld: KurvenId): Punkt[] => view.verlauf.map((v) => ({ tag: v.tag, wert: (v[feld] ?? null) as number | null }));
  const kurveDef = KURVEN[kurve];
  const kurvenSerie: Serie[] = [{ id: kurve, label: kurveDef.label, farbe: "var(--mp-serie-1)", punkte: punkte(kurve) }];

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader
        label="Wachstum"
        title="Übersicht"
        actions={
          <>
            <div className="mp-zeitraum" role="group" aria-label="Zeitraum">
              {ZEITRAEUME.map((z) => (
                <button key={z} type="button" className={`mp-zeitraum-knopf${tage === z ? " is-aktiv" : ""}`} onClick={() => setTage(z)}>{z} Tage</button>
              ))}
            </div>
            <Button disabled={busy} onClick={() => void abrufen()}>{busy ? "Hole Zahlen…" : "Zahlen holen"}</Button>
          </>
        }
      />
      {fehler && <Notice kind="bad">{fehler}</Notice>}
      <p className="mp-small mp-muted mp-stand">
        {tagLang(view.zeitraum.von)} bis {tagLang(view.zeitraum.bis)}
        {view.kanalStatus.letzterLauf && ` · Kanalzahlen zuletzt geholt am ${new Date(view.kanalStatus.letzterLauf).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`}
        {view.kanalStatus.laeuft && " · Abruf läuft gerade"}
      </p>

      {/* 1. Was ist passiert */}
      <div className="mp-kennzahlen">
        {(["aufrufe", "interaktionen", "klicks", "follower", "konten", "zahlende"] as const).map((kid) => {
          const kz = k(kid);
          if (!kz) return null;
          const feld: KurvenId | null = kid === "zahlende" ? null : (kid as KurvenId);
          return (
            <Kennzahl key={kid} label={kz.label} wert={kz.wert} davor={kz.davor}
              einheit={kz.einheit === "euro" ? "euro" : "zahl"}
              hinweis={kz.hinweis}
              aktiv={feld ? kurve === feld : false}
              {...(feld ? { onClick: () => setKurve(feld), verlauf: punkte(feld) } : {})}
            />
          );
        })}
      </div>

      {/* 2. Wie es sich entwickelt hat */}
      <Card>
        <div className="mp-card-head">
          <h2>{kurveDef.label} im Verlauf <span className="mp-muted mp-small">{kurveDef.hinweis}</span></h2>
          <div className="mp-inline">
            <label className="mp-field mp-field--inline">
              <span className="mp-sr-only">Kennzahl</span>
              <select value={kurve} onChange={(e) => setKurve(e.target.value as KurvenId)}>
                {Object.entries(KURVEN).map(([id2, def]) => <option key={id2} value={id2}>{def.label}</option>)}
              </select>
            </label>
            <Button onClick={() => setTabelle((v) => !v)}>{tabelle ? "Diagramm" : "Als Tabelle"}</Button>
          </div>
        </div>
        {tabelle ? (
          <div className="mp-table-wrap">
            <table className="mp-table">
              <thead><tr><th>Tag</th><th className="mp-num-cell">Aufrufe</th><th className="mp-num-cell">Interakt.</th><th className="mp-num-cell">Reichweite</th><th className="mp-num-cell">Klicks</th><th className="mp-num-cell">Beiträge</th><th className="mp-num-cell">Neue Konten</th><th className="mp-num-cell">Umsatz</th></tr></thead>
              <tbody>{[...view.verlauf].reverse().map((v) => (
                <tr key={v.tag}>
                  <td className="mp-nowrap">{tagKurz(v.tag)}</td>
                  <td className="mp-num-cell">{zahl(v.aufrufe)}</td>
                  <td className="mp-num-cell">{zahl(v.interaktionen)}</td>
                  <td className="mp-num-cell">{zahl(v.reichweite)}</td>
                  <td className="mp-num-cell">{zahl(v.klicks)}</td>
                  <td className="mp-num-cell">{v.beitraege || "–"}</td>
                  <td className="mp-num-cell">{zahl(v.neueKonten)}</td>
                  <td className="mp-num-cell">{v.umsatz ? euro(v.umsatz) : "–"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <>
            <Zeitreihe serien={kurvenSerie} tage={tagesliste} flaeche hoehe={240} marker={marker}
              einheit={kurve === "umsatz" ? "euro" : "zahl"}
              tooltipZusatz={(tag) => { const v = view.verlauf.find((x) => x.tag === tag); return v?.beitraege ? `${v.beitraege} Beiträge veröffentlicht` : null; }} />
            <p className="mp-small mp-muted mp-chart-fuss"><span className="mp-chart-marker-legende" aria-hidden="true" /> Tage, an denen der Pilot etwas veröffentlicht hat</p>
          </>
        )}
      </Card>

      {/* 3. Wo es abbricht */}
      <div className="mp-two-col">
        <Card>
          <h2>Vom Aufruf zum Kunden <span className="mp-muted mp-small">im gewählten Zeitraum</span></h2>
          <Balken stufig zeilen={view.trichter.map((t, i) => {
            const vorher = view.trichter[i - 1]?.wert;
            const quote = typeof t.wert === "number" && typeof vorher === "number" && vorher > 0 ? t.wert / vorher : null;
            return { id: t.id, label: t.label, wert: t.wert, zusatz: quote !== null ? `${prozent(quote, 1)} der Stufe davor` : t.erklaerung };
          })} />
          <p className="mp-small mp-muted">Die Stufen stammen aus verschiedenen Quellen und sind keine Kohorte: die Aufrufe sind Kanalzahlen, die Klicks zählt der Pilot selbst, die Konten meldet das Produkt. Der Trichter zeigt Größenordnungen, keine einzelne Nutzerreise.</p>
        </Card>
        <Card>
          <h2>Was diese Zahlen nicht sagen</h2>
          {view.hinweise.length === 0
            ? <p className="mp-muted">Nichts Auffälliges — alle eingerichteten Kanäle liefern Zahlen.</p>
            : <ul className="mp-plain-list mp-small">{view.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>}
        </Card>
      </div>

      {/* 4. Welcher Kanal trägt */}
      <Card>
        <div className="mp-card-head"><h2>Kanäle</h2><Link className="mp-small" to={`/projects/${id}/channels`}>Kanäle einrichten</Link></div>
        <div className="mp-kanal-grid">
          {view.kanaele.map((kn) => (
            <div key={kn.platform} className="mp-kanal">
              <div className="mp-kanal-kopf">
                <span className="mp-chart-key" style={{ background: kanalFarbe(kn.platform) }} aria-hidden="true" />
                <strong>{kn.label}</strong>
                {!kn.eingerichtet && <Pill kind="todo">kein Zugang</Pill>}
                {!kn.messbar && kn.eingerichtet && <Pill kind="review">nur von Hand</Pill>}
              </div>
              <dl className="mp-kanal-zahlen">
                <div><dt>Follower</dt><dd className="mp-num">{zahl(kn.follower)}</dd></div>
                <div><dt>Aufrufe</dt><dd className="mp-num">{zahl(kn.aufrufe)}</dd></div>
                <div><dt>Interaktionen</dt><dd className="mp-num">{zahl(kn.interaktionen)}</dd></div>
                <div><dt>Beiträge</dt><dd className="mp-num">{kn.beitraege || "–"}</dd></div>
              </dl>
              <Sparkline punkte={kn.verlauf.map((v) => ({ tag: v.tag, wert: v.aufrufe }))} farbe={kanalFarbe(kn.platform)} breite={200} hoehe={40} />
              {kn.fehler && <p className="mp-small mp-kanal-fehler">{kn.fehler}</p>}
              {!kn.fehler && kn.aufrufe === null && kn.messbar && <p className="mp-small mp-muted">Diese Plattform meldet keine Aufrufe je Kanal.</p>}
            </div>
          ))}
        </div>
        {view.kanaele.filter((kn) => kn.verlauf.some((v) => v.aufrufe !== null)).length > 1 && (
          <>
            <h3 className="mp-h3">Aufrufe je Kanal</h3>
            <Zeitreihe tage={tagesliste} hoehe={200}
              serien={view.kanaele.filter((kn) => kn.verlauf.some((v) => v.aufrufe !== null)).map((kn) => ({
                id: kn.platform, label: kn.label, farbe: kanalFarbe(kn.platform),
                punkte: kn.verlauf.map((v) => ({ tag: v.tag, wert: v.aufrufe })),
              }))} />
          </>
        )}
      </Card>

      {/* 5. Kommt es im Produkt an */}
      <Card>
        <div className="mp-card-head">
          <h2>Produkt <span className="mp-muted mp-small">{view.produkt.hinweis}</span></h2>
          {view.produkt.stand && <span className="mp-label">Stand {new Date(view.produkt.stand).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>}
        </div>
        {!view.produkt.verfuegbar ? (
          <p className="mp-muted">Keine Produktzahlen verfügbar. {view.produkt.hinweis}</p>
        ) : (
          <>
            <div className="mp-produkt-zahlen">
              <div className="mp-ministat"><div className="mp-label">Konten</div><div className="mp-num">{zahl(view.produkt.konten)}</div></div>
              <div className="mp-ministat mp-ministat--hi"><div className="mp-label">Zahlende Kunden</div><div className="mp-num">{zahl(view.produkt.zahlende)}</div></div>
              <div className="mp-ministat"><div className="mp-label">Monatlich wiederkehrend</div><div className="mp-num">{euro(view.produkt.mrr)}</div></div>
              <div className="mp-ministat"><div className="mp-label">Umsatz gesamt</div><div className="mp-num">{euro(view.produkt.umsatzGesamt)}</div></div>
            </div>
            <div className="mp-two-col mp-produkt-diagramme">
              <div>
                <h3 className="mp-h3">Konten insgesamt</h3>
                <Zeitreihe tage={tagesliste} hoehe={170} flaeche
                  serien={[{ id: "konten", label: "Konten", farbe: "var(--mp-serie-1)", punkte: punkte("konten") }]} />
              </div>
              <div>
                <h3 className="mp-h3">Umsatz je Tag</h3>
                <Tagesbalken punkte={punkte("umsatz")} einheit="euro" farbe="var(--mp-serie-2)" />
              </div>
            </div>
            {view.produkt.tarife.length > 0 && (
              <Balken zeilen={view.produkt.tarife.map((t) => ({ id: t.tarif, label: t.tarif, wert: t.anzahl }))} />
            )}
          </>
        )}
      </Card>

      {/* 6. Welcher Beitrag */}
      <Card>
        <div className="mp-card-head">
          <h2>Beiträge im Zeitraum <span className="mp-muted mp-small">Zahlen der Plattform, Gesamtstand je Beitrag</span></h2>
          <Link className="mp-small" to={`/projects/${id}/insights`}>Alle Zahlen und Wochenberichte</Link>
        </div>
        {view.beitraege.length === 0 ? <p className="mp-muted">In diesem Zeitraum wurde nichts veröffentlicht.</p> : (() => {
          // Beiträge ohne jede Zahl (meist abgelaufene Stories) stehen unten und
          // eingeklappt: sie sind erklärungsbedürftig, aber sie dürfen die Liste
          // der Beiträge, um die es geht, nicht überwuchern.
          const mitZahlen = view.beitraege.filter((b) => b.aufrufe !== null || b.likes !== null);
          const ohneZahlen = view.beitraege.filter((b) => b.aufrufe === null && b.likes === null);
          const tabelle2 = (zeilen: typeof view.beitraege) => (
            <div className="mp-table-wrap">
              <table className="mp-table">
                <thead><tr><th>Beitrag</th><th>Kanal</th><th className="mp-num-cell">Aufrufe</th><th className="mp-num-cell">Reichw.</th><th className="mp-num-cell">Likes</th><th className="mp-num-cell">Komm.</th><th className="mp-num-cell">Saves</th><th className="mp-num-cell">Quote</th><th className="mp-num-cell">Klicks</th></tr></thead>
                <tbody>{zeilen.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/projects/${id}/publish/${b.pieceId}`}>{b.titel || b.format || "ohne Titel"}</Link>
                      <br /><span className="mp-small mp-muted">{b.postedAt ? tagKurz(b.postedAt.slice(0, 10)) : "–"}{b.externalUrl && <> · <a href={b.externalUrl} target="_blank" rel="noreferrer">ansehen</a></>}{b.fehler && <> · {b.fehler}</>}</span>
                    </td>
                    <td className="mp-small"><span className="mp-chart-key" style={{ background: kanalFarbe(b.platform) }} aria-hidden="true" /> {b.platform}</td>
                    <td className="mp-num-cell">{zahl(b.aufrufe)}</td>
                    <td className="mp-num-cell">{zahl(b.reichweite)}</td>
                    <td className="mp-num-cell">{zahl(b.likes)}</td>
                    <td className="mp-num-cell">{zahl(b.kommentare)}</td>
                    <td className="mp-num-cell">{zahl(b.saves)}</td>
                    <td className="mp-num-cell">{prozent(b.quote)}</td>
                    <td className="mp-num-cell">{b.klicks || "–"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          );
          return <>
            {mitZahlen.length > 0 ? tabelle2(mitZahlen) : <p className="mp-muted">Für die Beiträge dieses Zeitraums liegen noch keine Zahlen vor.</p>}
            {ohneZahlen.length > 0 && (
              <details className="mp-details mp-ohne-zahlen">
                <summary className="mp-label">{ohneZahlen.length} Beiträge ohne Zahlen</summary>
                {tabelle2(ohneZahlen)}
              </details>
            )}
          </>;
        })()}
      </Card>
    </>
  );
}
