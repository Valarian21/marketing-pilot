import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { StrategyVersion, StrategyView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const fmt = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

export function StrategyPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<StrategyView | null>(null);
  const [shown, setShown] = useState<StrategyVersion | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try { const v = await api<StrategyView>(`/projects/${id}/strategy`); setView(v); setShown((cur) => (cur && v.current && cur.version !== v.current.version ? v.current : cur ?? v.current)); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const running = view?.running ?? false;
  useEffect(() => {
    if (!running) { if (timer.current) window.clearInterval(timer.current); timer.current = null; return; }
    timer.current = window.setInterval(() => void load(), 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running, load]);

  const run = async (tasksOnly = false) => {
    setBusy(true); setError(null);
    try { await api(`/projects/${id}/${tasksOnly ? "tasks/generate" : "strategy/run"}`, { method: "POST", json: { note } }); setNote(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Start fehlgeschlagen"); }
    finally { setBusy(false); }
  };
  const showVersion = async (v: number) => { setShown(await api<StrategyVersion>(`/projects/${id}/strategy/versions/${v}`)); };

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  const plan = shown?.plan ?? null;
  const isCurrent = shown?.version === view.current?.version;

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Plan" title="Strategie" actions={
        <Button variant="primary" disabled={busy || running || !view.briefConfirmed} onClick={() => void run(false)}>{view.current ? "Plan anpassen (neue Version)" : "Strategie erzeugen"}</Button>
      } />
      {error && <Notice kind="bad">{error}</Notice>}
      {view.error && <Notice kind="bad">Letzter Lauf fehlgeschlagen: {view.error}</Notice>}
      {!view.briefConfirmed && <Notice kind="warn">Der Strategie-Agent braucht einen bestätigten Brief – <Link to={`/projects/${id}/analysis`}>zur Analyse</Link>.</Notice>}
      {running && <Notice kind="info">Der Strategie-Agent arbeitet (Plan + Aufgaben für 4 Wochen) …</Notice>}

      {view.current && (
        <Card className="mp-form-card">
          <div className="mp-form mp-form--row">
            <label className="mp-field"><span>Hinweis für die nächste Version (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. „Reels erst ab Woche 4, Fokus auf Directories“" /></label>
            <label className="mp-field mp-field--inline"><span>Version</span>
              <select value={shown?.version ?? ""} onChange={(e) => void showVersion(Number(e.target.value))}>
                {view.versions.map((v) => <option key={v.version} value={v.version}>v{v.version} · {fmt(v.createdAt)} · {v.createdBy}{v.note ? ` · ${v.note}` : ""}</option>)}
              </select>
            </label>
            <div className="mp-form-actions"><Button disabled={busy || running} onClick={() => void run(true)}>Aufgaben neu erzeugen</Button></div>
          </div>
        </Card>
      )}

      {!plan ? (
        <Card className="mp-empty"><h2>Noch kein Plan</h2><p>Der Agent liest Brief, Personas, Attention Map und GEO-Baseline und schlägt 2–3 Startkanäle, 30/60/90-Tage-Ziele und ein Testbudget vor. Danach erzeugt er die Aufgaben der ersten vier Wochen.</p></Card>
      ) : (
        <>
          <Card>
            <div className="mp-card-head"><h2>Zusammenfassung</h2><div className="mp-inline"><Pill kind={isCurrent ? "done" : "kind"}>{isCurrent ? "aktuelle Version" : `Version ${shown?.version}`}</Pill><span className="mp-label">Start {plan.startDate}</span></div></div>
            <p>{plan.summary}</p>
            <details className="mp-details"><summary><strong>Kernbotschaft:</strong> {plan.coreMessage.text}</summary><p className="mp-muted">{plan.coreMessage.rationale}</p></details>
            {shown && shown.diff.length > 0 && shown.version > 1 && (
              <details className="mp-details"><summary className="mp-label">Änderungen gegenüber v{shown.version - 1} ({shown.diff.length})</summary>
                <ul className="mp-diff">{shown.diff.map((d, i) => <li key={i}><code className="mp-code">{d.path}</code><span className="mp-diff-before">{JSON.stringify(d.before)}</span><span className="mp-diff-after">{JSON.stringify(d.after)}</span></li>)}</ul>
              </details>
            )}
          </Card>
          <Card>
            <h2>Kanäle</h2>
            <div className="mp-grid">
              {plan.channels.map((c) => (
                <details key={c.platform} className="mp-sub mp-details" open={c.role === "start"}>
                  <summary className="mp-sub-head"><strong>{c.platform}</strong><span className="mp-inline"><Pill kind={c.role === "start" ? "done" : "todo"}>{c.role === "start" ? "Start" : "später"}</Pill></span></summary>
                  <p><span className="mp-label">Format</span> {c.format || "–"} · <span className="mp-label">Kadenz</span> {c.cadence || "–"}</p>
                  <p>{c.rationale}</p>
                  {c.evidenceRefs.length > 0 && <p className="mp-small mp-muted">Bezug: {c.evidenceRefs.join(", ")}</p>}
                </details>
              ))}
            </div>
          </Card>
          <div className="mp-two-col">
            <Card>
              <h2>Ziele</h2>
              <table className="mp-table"><thead><tr><th>Horizont</th><th>Messgröße</th><th>Ziel</th></tr></thead>
                <tbody>{plan.goals.map((g) => <tr key={g.horizonDays}><td className="mp-num-cell">{g.horizonDays} Tage</td><td>{g.metric}</td><td className="mp-num-cell">{g.target}</td></tr>)}</tbody></table>
              {plan.goals.map((g) => <details key={g.horizonDays} className="mp-details mp-small"><summary>Begründung {g.horizonDays} Tage</summary><p className="mp-muted">{g.rationale}</p></details>)}
            </Card>
            <Card>
              <h2>Testbudget <span className="mp-num">{plan.budget.monthlyEur} €</span><span className="mp-muted mp-small"> / Monat</span></h2>
              <p className="mp-muted">{plan.budget.rationale}</p>
              {plan.budget.items.length > 0 && <ul className="mp-plain-list">{plan.budget.items.map((i) => <li key={i.item}><strong>{i.item}</strong> – {i.eur} €<div className="mp-small mp-muted">{i.rationale}</div></li>)}</ul>}
              {plan.risks.length > 0 && <><h2>Risiken</h2><ul className="mp-plain-list">{plan.risks.map((r, i) => <li key={i}>{r.text}<div className="mp-small mp-muted">→ {r.mitigation}</div></li>)}</ul></>}
            </Card>
          </div>
          <Card>
            <div className="mp-card-head"><h2>Aufgaben</h2><Link className="mp-btn mp-btn--primary" to={`/projects/${id}/tasks`}>{view.taskCount} Aufgaben öffnen</Link></div>
          </Card>
        </>
      )}
    </>
  );
}
