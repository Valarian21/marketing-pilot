/**
 * Karte „Produktdaten“ auf der Projektseite: Datenquelle waehlen, Status sehen
 * und – der eigentliche Zweck – eine Rangliste zur Probe ziehen, bevor in Shot 7
 * Slides daraus werden. Wer die Zahlen hier nicht glaubt, soll sie auch nicht
 * posten.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import type { DataPreview, ProductDataView } from "../../shared/schemas.js";
import { Button, Card, Notice, Pill } from "./ui.js";

const eur = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const datum = (iso: string) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "–");
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

export function ProductDataCard({ projectId }: { projectId: string }) {
  const [view, setView] = useState<ProductDataView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DataPreview | null>(null);

  const [kind, setKind] = useState<"top" | "movers">("top");
  const [scope, setScope] = useState("");          // "set:swsh12" oder "era:swsh"
  const [n, setN] = useState(15);
  const [basis, setBasis] = useState<"max" | "normal" | "holo">("max");
  const [days, setDays] = useState<7 | 30>(7);

  const load = useCallback(async () => {
    try { setView(await api<ProductDataView>(`/projects/${projectId}/data`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  // Vorbelegung: das neueste internationale Set. Rein nach Datum waere das
  // neueste Set oft ein japanisches – fuer ein deutschsprachiges Produkt der
  // falsche Einstieg.
  useEffect(() => {
    if (scope || !view?.sets.length) return;
    const first = view.sets.find((x) => x.region === "intl") ?? view.sets[0]!;
    setScope(`set:${first.id}`);
  }, [view, scope]);

  const setSource = async (provider: "none" | "binderplan") => {
    setBusy(true);
    try { await api(`/projects/${projectId}/data-source`, { method: "PUT", json: { provider } }); setPreview(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };

  const runPreview = async () => {
    setBusy(true); setError(null);
    const [art, wert] = scope.split(":");
    const q = new URLSearchParams({ kind, n: String(n), basis });
    if (kind === "movers") { q.set("days", String(days)); q.set("direction", "up"); q.set("minBaseEur", "5"); }
    else if (art === "set") q.set("set", wert ?? "");
    else if (art === "era") q.set("era", wert ?? "");
    try { setPreview(await api<DataPreview>(`/projects/${projectId}/data/preview?${q}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); setPreview(null); } finally { setBusy(false); }
  };

  const s = view?.status;
  return (
    <Card>
      <div className="mp-card-head">
        <h2>Produktdaten</h2>
        <select value={view?.source.provider ?? "none"} disabled={busy} onChange={(e) => void setSource(e.target.value as "none" | "binderplan")}>
          <option value="none">Keine Datenquelle</option>
          <option value="binderplan">Binderplan</option>
        </select>
      </div>
      {error && <Notice kind="bad">{error}</Notice>}

      {view?.source.provider === "none" && (
        <p className="mp-muted">
          Ohne Datenquelle schreibt das Studio wie bisher aus Brief und Persona. Mit Binderplan als
          Quelle entstehen zusätzlich Ranglisten aus echten Karten- und Preisdaten.
        </p>
      )}

      {view && view.source.provider !== "none" && !s?.available && <Notice kind="warn">{s?.detail}</Notice>}

      {view && s?.available && (
        <>
          <dl className="mp-dl">
            <dt>Bestand</dt><dd>{s.cards.toLocaleString("de-DE")} Karten · {s.sets} Sets · {s.eras} Ären</dd>
            <dt>Preise</dt><dd>
              {s.pricesTotal.toLocaleString("de-DE")} bekannt, davon {s.pricesFresh.toLocaleString("de-DE")} frisch
              {" "}<Pill kind={s.pricesFresh > 0 ? "done" : "review"}>{s.pricesTotal ? Math.round((s.pricesFresh / s.pricesTotal) * 100) : 0} %</Pill>
            </dd>
            <dt>Schnappschuss</dt><dd>{datum(s.dbUpdatedAt ?? "")} {s.dbUpdatedAt && new Date(s.dbUpdatedAt).toLocaleTimeString("de-DE", { timeStyle: "short" })} <span className="mp-muted mp-small">stündlich über <code className="mp-code">binderplan-snapshot.timer</code></span></dd>
            <dt>Preislauf der Quelle</dt><dd>{datum(s.sourceLastPriceRun ?? "")}</dd>
            <dt>Bildcache</dt><dd>{s.imageCacheFiles} Dateien · {mb(s.imageCacheBytes)}</dd>
          </dl>
          <p className="mp-small mp-muted">
            Binderplan wird ausschließlich gelesen. Fehlende und veraltete Preise holt der Pilot selbst
            von TCGdex und legt sie in seiner eigenen Datenbank ab.
          </p>

          <div className="mp-action-row">
            <select value={kind} onChange={(e) => setKind(e.target.value as "top" | "movers")}>
              <option value="top">Teuerste Karten</option>
              <option value="movers">Preis-Raketen</option>
            </select>
            {kind === "top" ? (
              <select value={scope} style={{ flex: "1 1 220px" }} onChange={(e) => setScope(e.target.value)}>
                <optgroup label="Ären">
                  {view.eras.map((e) => <option key={e.id} value={`era:${e.id}`}>{e.name} ({e.setCount} Sets)</option>)}
                </optgroup>
                <optgroup label="Sets (international)">
                  {view.sets.filter((x) => x.region === "intl").map((x) => <option key={x.id} value={`set:${x.id}`}>{x.name} · {x.releaseDate.slice(0, 4)}</option>)}
                </optgroup>
                <optgroup label="Sets (Japan)">
                  {view.sets.filter((x) => x.region === "jp").map((x) => <option key={x.id} value={`set:${x.id}`}>{x.name} · {x.releaseDate.slice(0, 4)}</option>)}
                </optgroup>
              </select>
            ) : (
              <select value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30)}>
                <option value={7}>letzte 7 Tage</option>
                <option value={30}>letzte 30 Tage</option>
              </select>
            )}
            <select value={n} onChange={(e) => setN(Number(e.target.value))}>
              {[10, 15, 20].map((v) => <option key={v} value={v}>Top {v}</option>)}
            </select>
            {kind === "top" && (
              <select value={basis} onChange={(e) => setBasis(e.target.value as "max" | "normal" | "holo")} title="Welche Kartenvariante den Preis stellt">
                <option value="max">teuerste Variante</option>
                <option value="normal">normal</option>
                <option value="holo">holo</option>
              </select>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void runPreview()}>{busy ? "…" : "Vorschau"}</Button>
          </div>
        </>
      )}

      {preview && (
        <>
          <div className="mp-inline" style={{ marginTop: "0.75rem" }}>
            <strong>{preview.scopeLabel}</strong>
            {preview.totalEur > 0 && <span className="mp-muted">Gesamtwert {eur(preview.totalEur)} €</span>}
            <span className="mp-muted mp-small">{(preview.tookMs / 1000).toFixed(1)} s</span>
          </div>
          {preview.cards.length === 0 ? (
            <Notice kind="warn">Keine Karte mit Preis im gewählten Bereich – der Pilot erfindet keine Zahlen.</Notice>
          ) : (
            <table className="mp-table">
              <thead><tr><th /><th /><th>Karte</th><th>Set</th><th style={{ textAlign: "right" }}>Preis</th></tr></thead>
              <tbody>
                {preview.cards.map((c) => (
                  <tr key={c.id}>
                    <td className="mp-nowrap mp-muted">{c.rank}</td>
                    <td><img src={`/api/mp/projects/${projectId}/data/card-image/${encodeURIComponent(c.id)}?lang=${c.imageLang ?? "de"}`}
                             alt="" loading="lazy" style={{ width: 34, height: 47, objectFit: "contain" }} /></td>
                    <td>{c.name}<span className="mp-muted mp-small"> · {c.rarity}</span></td>
                    <td className="mp-muted mp-small">{c.setName} {c.localId}</td>
                    <td className="mp-nowrap" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {eur(c.priceEur)} €
                      {preview.kind === "movers" && c.changePct !== undefined && (
                        <span className="mp-muted mp-small"> {c.changePct > 0 ? "▲" : "▼"} {Math.abs(c.changePct)} %</span>
                      )}
                      {preview.kind === "top" && c.priceBasisUsed === "holo" && <span className="mp-muted mp-small"> holo</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Genau diese Zeile gehoert spaeter als Fusszeile auf jede Slide. */}
          <p className="mp-small mp-muted">Preise: Cardmarket-Trend · Stand {preview.priceStand ? new Date(preview.priceStand).toLocaleDateString("de-DE") : "–"} · binderplan.app</p>
          {preview.coverage && preview.coverage.skipped > 0 && (
            <p className="mp-small mp-muted">
              {preview.coverage.priced.toLocaleString("de-DE")} von {preview.coverage.cardsInScope.toLocaleString("de-DE")} Karten
              im Bereich haben einen Preis; {preview.coverage.skipped.toLocaleString("de-DE")} wurden nicht nachgeladen
              (Deckel je Abfrage). Für ein einzelnes Set wird immer alles bepreist.
            </p>
          )}
          {preview.kind === "movers" && (
            <p className="mp-small mp-muted">Beruht auf {preview.withHistory} Karten mit Preisverlauf in Binderplan.</p>
          )}
        </>
      )}
    </Card>
  );
}
