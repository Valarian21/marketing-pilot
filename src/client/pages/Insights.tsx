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
      <PageHeader label="Wachstum" title="Insights" actions={<Button variant="primary" disabled={busy} onClick={() => void run(() => api(`/projects/${id}/reports/run`, { method: "POST", json: {} }))}>{busy ? "…" : "Wochen-Report jetzt erzeugen"}</Button>} />
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

      <PostMetrikCard id={id} posts={view.posts} busy={busy} run={run} />

      <div className="mp-two-col">
        <Card>
          <h2>Beste und schwächste Stücke <span className="mp-muted mp-small">veröffentlicht · Klicks über den Kurzlink, Signups über utm_content</span></h2>
          {view.pieces.length === 0 ? <p className="mp-muted">Noch nichts veröffentlicht.</p> : (
            <table className="mp-table"><thead><tr><th>Stück</th><th>Kanal</th><th>Klicks</th><th>Signups</th></tr></thead>
              <tbody>{view.pieces.map((p) => <tr key={p.pieceId}><td><Link to={`/projects/${id}/publish/${p.pieceId}`}>{p.title || p.format}</Link></td><td className="mp-small">{p.channel}</td><td className="mp-num-cell">{p.clicks}</td><td className="mp-num-cell">{p.signups}</td></tr>)}</tbody></table>
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

const NUM = (x: number | null | undefined) => (typeof x === "number" ? x.toLocaleString("de-DE") : "–");
const FELDER = [
  { key: "reichweite" as const, label: "Reichweite" },
  { key: "aufrufe" as const, label: "Aufrufe" },
  { key: "likes" as const, label: "Likes" },
  { key: "kommentare" as const, label: "Kommentare" },
  { key: "saves" as const, label: "Saves" },
  { key: "shares" as const, label: "Shares" },
];

/**
 * Was die Plattformen über die einzelnen Beiträge melden.
 *
 * Eigene Karte und nicht in „Beste und schwächste Stücke" hineingemischt: dort
 * ist die Einheit das Stück, hier der Beitrag auf einer Plattform. Dasselbe
 * Carousel läuft auf Instagram und Facebook und hat dort zwei Reichweiten.
 */
function PostMetrikCard({ id, posts, busy, run }: { id: string; posts: InsightsView["posts"]; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [offen, setOffen] = useState<string | null>(null);
  const [werte, setWerte] = useState<Record<string, string>>({});
  const fehler = posts.find((p) => p.metrics?.fehler)?.metrics?.fehler ?? "";
  const ohneZahlen = posts.filter((p) => !p.nurHand && !p.metricsAt).length;

  const speichern = async (postId: string) => {
    const body: Record<string, number | null> = {};
    for (const f of FELDER) {
      const roh = werte[f.key]?.trim();
      if (roh !== undefined && roh !== "") body[f.key] = Number(roh.replace(/[.\s]/g, "").replace(",", "."));
    }
    await run(() => api(`/scheduled/${postId}/metrics`, { method: "PUT", json: body }));
    setOffen(null); setWerte({});
  };

  return (
    <Card>
      <div className="mp-card-head">
        <h2>Zahlen je Beitrag <span className="mp-muted mp-small">was die Plattform selbst meldet</span></h2>
        <Button disabled={busy} onClick={() => void run(() => api(`/projects/${id}/metrics/run`, { method: "POST" }))}>Jetzt abrufen</Button>
      </div>
      {fehler && <Notice kind="warn">Meta lehnt den Abruf ab: <em>{fehler}</em><br />Meist fehlt dem Token ein Recht — Instagram braucht <code className="mp-code">instagram_manage_insights</code>, die Facebook-Seite <code className="mp-code">read_insights</code>. Token im Graph API Explorer mit diesen Rechten neu holen und auf der Kanäle-Seite eintragen.</Notice>}
      {posts.length === 0 ? <p className="mp-muted">Noch nichts über den Piloten veröffentlicht.</p> : (
        <>
          {ohneZahlen > 0 && !fehler && <p className="mp-small mp-muted">{ohneZahlen} Beiträge noch ohne Abruf — der Sammler läuft einmal täglich.</p>}
          <div className="mp-table-wrap">
            <table className="mp-table">
              <thead><tr><th>Beitrag</th><th>Kanal</th>{FELDER.map((f) => <th key={f.key} className="mp-num-cell">{f.label}</th>)}<th></th></tr></thead>
              <tbody>{posts.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/projects/${id}/publish/${p.pieceId}`}>{p.title || p.format}</Link>
                    <br /><span className="mp-small mp-muted">{p.postedAt ? new Date(p.postedAt).toLocaleDateString("de-DE") : "–"}{p.metrics?.quelle === "hand" && " · von Hand"}</span></td>
                  <td className="mp-small">{p.platform}</td>
                  {FELDER.map((f) => <td key={f.key} className="mp-num-cell">{NUM(p.metrics?.[f.key])}</td>)}
                  <td>{(p.nurHand || p.metrics?.fehler) && <Button onClick={() => { setOffen(offen === p.id ? null : p.id); setWerte({}); }}>{offen === p.id ? "Abbrechen" : "Eintragen"}</Button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {offen && (
            <div className="mp-sub">
              <p className="mp-small mp-muted">Zahlen aus dem Analytics-Bildschirm der Plattform abschreiben. Leere Felder bleiben, wie sie sind.</p>
              <div className="mp-form mp-form--row">
                {FELDER.map((f) => <label key={f.key} className="mp-field mp-field--short"><span>{f.label}</span><input inputMode="numeric" value={werte[f.key] ?? ""} onChange={(e) => setWerte({ ...werte, [f.key]: e.target.value })} placeholder="–" /></label>)}
                <div className="mp-form-actions"><Button variant="primary" disabled={busy} onClick={() => void speichern(offen)}>Speichern</Button></div>
              </div>
            </div>
          )}
        </>
      )}
      <p className="mp-small mp-muted">TikTok gibt ohne bestandenen Content-Posting-Audit keine Zahlen heraus — dort ist die Handeingabe der einzige Weg.</p>
    </Card>
  );
}
