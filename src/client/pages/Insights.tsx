/** Insights: signups per channel and week, best/worst pieces, GEO visibility over time, weekly reports, landing snippet. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { InsightsView, WeeklyReport } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, Stat } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { markdownToHtml } from "../../shared/markdown.js";

export function InsightsPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<InsightsView | null>(null);
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [snippet, setSnippet] = useState<{ snippet: string; webhookUrl: string; tokenConfigured: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSnippet, setShowSnippet] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, r, sn] = await Promise.all([api<InsightsView>(`/projects/${id}/insights`), api<WeeklyReport[]>(`/projects/${id}/reports`), api<{ snippet: string; webhookUrl: string; tokenConfigured: boolean }>(`/projects/${id}/insights/snippet`)]);
      setView(v); setReports(r); setSnippet(sn); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); } };

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  const last = view.weeks[view.weeks.length - 1];
  const geoNow = view.geoHistory[view.geoHistory.length - 1];
  const maxSignups = Math.max(1, ...view.weeks.map((w) => w.signups));

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Stufe 5" title="Insights" actions={<Button variant="primary" disabled={busy} onClick={() => void run(() => api(`/projects/${id}/reports/run`, { method: "POST", json: {} }))}>{busy ? "…" : "Wochen-Report jetzt erzeugen"}</Button>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {!view.webhookConfigured && <Notice kind="warn"><code className="mp-code">MP_EVENTS_TOKEN</code> fehlt in der .env – der Webhook nimmt nur Browser-Signups ohne Token an. Token setzen und im Produkt-Backend mitschicken.</Notice>}

      <div className="mp-stats mp-stats--4 mp-stats--tiles">
        <Stat label="Signups diese Woche" value={last?.signups ?? 0} highlight />
        <Stat label="Aktiviert / bezahlt (Woche)" value={`${last?.activated ?? 0} / ${last?.paid ?? 0}`} />
        <Stat label="Events gesamt" value={view.totalEvents} />
        <Stat label="GEO-Sichtbarkeit" value={geoNow ? `${Math.round(geoNow.visibility * 100)} %` : "–"} />
      </div>

      <div className="mp-two-col">
        <Card>
          <h2>Signups pro Woche</h2>
          {view.weeks.length === 0 ? <p className="mp-muted">Noch keine Events. Snippet einbauen oder Webhook aus dem Backend aufrufen.</p> : (
            <ul className="mp-bars">{view.weeks.map((w) => <li key={w.weekStart}><span className="mp-label">{w.weekStart}</span><span className="mp-bar-track"><span className="mp-bar-fill" style={{ width: `${(w.signups / maxSignups) * 100}%` }} /></span><span className="mp-num-cell">{w.signups}<span className="mp-muted mp-small"> · {w.activated} akt. · {w.paid} bez.</span></span></li>)}</ul>
          )}
        </Card>
        <Card>
          <h2>Signups pro Kanal</h2>
          {view.byChannel.length === 0 ? <p className="mp-muted">–</p> : (
            <table className="mp-table"><thead><tr><th>Quelle (utm_source)</th><th>Signups</th><th>Aktiviert</th><th>Bezahlt</th></tr></thead>
              <tbody>{view.byChannel.map((c) => <tr key={c.source}><td>{c.source}</td><td className="mp-num-cell">{c.signups}</td><td className="mp-num-cell">{c.activated}</td><td className="mp-num-cell">{c.paid}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>

      <div className="mp-two-col">
        <Card>
          <h2>Beste und schwächste Stücke <span className="mp-muted mp-small">veröffentlicht, nach utm_content</span></h2>
          {view.pieces.length === 0 ? <p className="mp-muted">Noch nichts veröffentlicht.</p> : (
            <table className="mp-table"><thead><tr><th>Stück</th><th>Kanal</th><th>Signups</th></tr></thead>
              <tbody>{view.pieces.map((p) => <tr key={p.pieceId}><td><Link to={`/projects/${id}/publish/${p.pieceId}`}>{p.title || p.format}</Link></td><td className="mp-small">{p.channel}</td><td className="mp-num-cell">{p.signups}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card>
          <h2>GEO-Sichtbarkeit im Verlauf <span className="mp-muted mp-small">wöchentlich neu gemessen</span></h2>
          {view.geoHistory.length === 0 ? <p className="mp-muted">Noch keine Messung – Analyse ausführen.</p> : (
            <ul className="mp-bars">{view.geoHistory.map((g) => <li key={g.batch}><span className="mp-label">{new Date(g.takenAt).toLocaleDateString("de-DE")}</span><span className="mp-bar-track"><span className="mp-bar-fill" style={{ width: `${g.visibility * 100}%` }} /></span><span className="mp-num-cell">{Math.round(g.visibility * 100)} %<span className="mp-muted mp-small"> · {g.asked} Antworten</span></span></li>)}</ul>
          )}
        </Card>
      </div>

      <Card>
        <div className="mp-card-head"><h2>Wochen-Reports</h2></div>
        {reports.length === 0 ? <p className="mp-muted">Sonntags erzeugt der Agent einen Klartext-Report mit Plan-Vorschlag – oder oben per Knopf.</p> : reports.map((r) => (
          <div key={r.id} className="mp-sub mp-report">
            <div className="mp-sub-head"><strong>Woche ab {r.weekStart}</strong><div className="mp-inline"><Pill kind={r.status === "adopted" ? "done" : r.status === "dismissed" ? "kind" : "review"}>{r.status === "adopted" ? "übernommen" : r.status === "dismissed" ? "verworfen" : "Vorschlag"}</Pill><span className="mp-label">{r.diff.length} Plan-Änderungen</span></div></div>
            <div className="mp-report-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(r.report) }} />
            {r.diff.length > 0 && <details className="mp-details"><summary className="mp-label">Vorgeschlagene Änderungen</summary><ul className="mp-diff">{r.diff.map((d, i) => <li key={i}><code className="mp-code">{d.path}</code><span className="mp-diff-before">{JSON.stringify(d.before)}</span><span className="mp-diff-after">{JSON.stringify(d.after)}</span></li>)}</ul></details>}
            {r.status === "proposed" && <div className="mp-form-actions"><Button variant="primary" disabled={busy} onClick={() => void run(() => api(`/reports/${r.id}/adopt`, { method: "POST" }))}>Als Plan-Update übernehmen (+ Aufgaben nächste Woche)</Button><Button disabled={busy} onClick={() => void run(() => api(`/reports/${r.id}/dismiss`, { method: "POST" }))}>Verwerfen</Button></div>}
          </div>
        ))}
      </Card>

      <Card>
        <div className="mp-card-head"><h2>Messung einbauen</h2><Button onClick={() => setShowSnippet((v) => !v)}>{showSnippet ? "Ausblenden" : "Snippet anzeigen"}</Button></div>
        <p className="mp-small mp-muted">Webhook: <code className="mp-code">POST {snippet?.webhookUrl}</code> mit <code className="mp-code">Authorization: Bearer MP_EVENTS_TOKEN</code> und Body <code className="mp-code">{`{"project":"${id}","event":"signup|activated|paid","userRef":"…","utm":{"source","medium","campaign","content"}}`}</code>. Das Snippet (≈1 KB) hält UTM-Parameter 90 Tage im Cookie und schickt sie beim Signup mit.</p>
        {showSnippet && snippet && <><pre className="mp-pre">{snippet.snippet}</pre><Button onClick={() => void navigator.clipboard.writeText(snippet.snippet)}>Snippet kopieren</Button></>}
      </Card>
    </>
  );
}
