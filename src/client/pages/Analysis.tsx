import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { AnalysisStep, AnalysisStepName, AnalysisView, Brief, GeoSnapshot } from "../../shared/schemas.js";
import { api, ApiError } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, Stat, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const STEP_LABEL: Record<AnalysisStepName, string> = { crawl: "Website crawlen", brief: "Product Brief", competitors: "Wettbewerber", personas: "Personas", attention: "Attention Map", geo: "GEO-Baseline" };
const STEP_PILL: Record<AnalysisStep["status"], { kind: PillKind; label: string }> = {
  pending: { kind: "todo", label: "wartet" }, running: { kind: "progress", label: "läuft" }, done: { kind: "done", label: "fertig" },
  failed: { kind: "review", label: "Fehler" }, skipped: { kind: "kind", label: "übersprungen" },
};
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");
const dur = (a: string | null, b: string | null) => (a && b ? `${Math.round((Date.parse(b) - Date.parse(a)) / 1000)} s` : "");

export function AnalysisPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<AnalysisView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelFilter, setModelFilter] = useState<string>("alle");
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try { setView(await api<AnalysisView>(`/projects/${id}/analysis`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Laden fehlgeschlagen."); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const running = view?.run?.status === "running";
  useEffect(() => {
    if (!running) { if (timer.current) window.clearInterval(timer.current); timer.current = null; return; }
    timer.current = window.setInterval(() => void load(), 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running, load]);

  const start = async (from?: AnalysisStepName) => {
    if (view?.briefMeta.userEdited && (!from || from === "crawl" || from === "brief") && !window.confirm("Der Brief wurde von dir bearbeitet. Ein neuer Lauf überschreibt ihn. Fortfahren?")) return;
    setBusy(true); setError(null);
    try { await api(`/projects/${id}/analysis/run`, { method: "POST", json: from ? { from } : {} }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Start fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  const saveBrief = async (patch: Partial<Brief>) => {
    try { setView(await api<AnalysisView>(`/projects/${id}/brief`, { method: "PATCH", json: patch })); }
    catch (e) { setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); }
  };
  const confirm = async () => {
    setBusy(true);
    try { setView(await api<AnalysisView>(`/projects/${id}/brief/confirm`, { method: "POST" })); }
    catch (e) { setError(e instanceof Error ? e.message : "Bestätigen fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  const geoRows = useMemo(() => {
    if (!view) return [] as GeoSnapshot[];
    const rows = modelFilter === "alle" ? view.geo.snapshots : view.geo.snapshots.filter((x) => x.engine === modelFilter);
    return [...rows].sort((a, b) => a.query.localeCompare(b.query) || a.engine.localeCompare(b.engine));
  }, [view, modelFilter]);

  if (error && !view) return <><ProjectNav id={id} /><Notice kind="bad">{error} – <Link to="/">zurück</Link></Notice></>;
  if (!view) return null;
  const run = view.run;
  const confirmed = Boolean(view.briefMeta.confirmedAt);

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Grundlage" title="Analyse" actions={
        <>
          <Button variant="primary" disabled={busy || running} onClick={() => void start()}>{run ? "Analyse neu starten" : "Analyse starten"}</Button>
          <Button variant="primary" disabled={busy || running || !view.brief || confirmed} onClick={() => void confirm()}>{confirmed ? "Brief bestätigt" : "Brief bestätigen"}</Button>
        </>
      } />
      {error && <Notice kind="bad">{error}</Notice>}
      {confirmed && <Notice kind="info">Brief bestätigt am {new Date(view.briefMeta.confirmedAt!).toLocaleString("de-DE")} – die Strategie-Stufe (Shot 2) ist freigeschaltet.</Notice>}

      <div className="mp-stats mp-stats--4 mp-stats--tiles">
        <Stat label="Seiten gecrawlt" value={view.pages.length} />
        <Stat label="Wettbewerber" value={view.competitors.length} />
        <Stat label="Personas" value={view.personas.length} />
        <Stat label="GEO-Sichtbarkeit" value={view.geo.visibility === null ? "–" : `${Math.round(view.geo.visibility * 100)} %`} highlight />
      </div>

      <Card className="mp-steps">
        <div className="mp-card-head"><h2>Fortschritt</h2>{run && <span className="mp-label">Lauf gestartet {fmtTime(run.startedAt)} · {run.status === "running" ? "läuft" : run.status === "done" ? "abgeschlossen" : "fehlgeschlagen"}</span>}</div>
        {!run ? <p className="mp-muted">Noch kein Lauf. „Analyse starten“ crawlt die Website, schreibt den Brief, sucht Wettbewerber, leitet Personas und Kanäle ab und misst die GEO-Baseline.</p> : (
          <ol className="mp-step-list">
            {run.steps.map((st) => {
              const pill = STEP_PILL[st.status];
              return (
                <li key={st.name} className={`mp-step mp-step--${st.status}`}>
                  <div className="mp-step-main">
                    <Pill kind={pill.kind}>{pill.label}</Pill>
                    <span className="mp-step-name">{STEP_LABEL[st.name]}</span>
                    <span className="mp-muted mp-step-summary">{st.error ?? st.summary}</span>
                  </div>
                  <div className="mp-step-side">
                    <span className="mp-label">{dur(st.startedAt, st.finishedAt)}</span>
                    {!running && st.status !== "pending" && <Button onClick={() => void start(st.name)} disabled={busy}>ab hier neu</Button>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {run?.error && <Notice kind="bad">{run.error}</Notice>}
      </Card>

      {view.brief && <BriefEditor brief={view.brief} meta={view.briefMeta} onSave={saveBrief} disabled={running} />}

      {view.screenshots.length > 0 && (
        <Card>
          <h2>Screenshots</h2>
          <div className="mp-shots">
            {view.screenshots.map((sc) => (
              <figure key={sc.id} className="mp-shot">
                <img src={`/api/mp/assets/${sc.id}/file`} alt={String(sc.meta["url"] ?? "")} loading="lazy" />
                <figcaption className="mp-label">{String(sc.meta["kind"] ?? "")}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      )}

      {view.competitors.length > 0 && (
        <Card>
          <h2>Wettbewerber</h2>
          <div className="mp-grid">
            {view.competitors.map((c) => (
              <div key={c.id} className="mp-sub">
                <div className="mp-sub-head"><strong>{c.name}</strong><a href={c.url} target="_blank" rel="noreferrer" className="mp-small">{c.url.replace(/^https?:\/\/(www\.)?/, "")}</a></div>
                <p>{c.positioning}</p>
                <p className="mp-small"><span className="mp-label">Preis</span> {c.pricing || "unbekannt"}</p>
                {c.complaints.length > 0 && (
                  <ul className="mp-complaints">
                    {c.complaints.map((x, i) => <li key={i}>{x.text}{x.quote && <q>{x.quote}</q>}<a href={x.url} target="_blank" rel="noreferrer" className="mp-small">{x.source}</a></li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {view.personas.length > 0 && (
        <Card>
          <h2>Personas</h2>
          <div className="mp-grid">
            {view.personas.map((p) => (
              <div key={p.id} className="mp-sub mp-persona">
                <div className="mp-sub-head"><strong>{p.name}</strong><Pill kind="kind">{p.language}</Pill></div>
                <p>{p.description}</p>
                <PersonaList label="So reden sie" items={p.phrases} quote />
                <PersonaList label="Schmerzpunkte" items={p.painPoints} />
                <PersonaList label="Einwände" items={p.objections} />
                <PersonaList label="Kaufauslöser" items={p.buyingTriggers} />
                <PersonaList label="Wo sie sind" items={p.whereTheyHangOut} />
                {p.evidence.length > 0 && <details className="mp-evidence"><summary className="mp-label">Belege ({p.evidence.length})</summary><ul>{p.evidence.map((e, i) => <li key={i}>{e.claim}{e.quote && <q>{e.quote}</q>}<a href={e.url} target="_blank" rel="noreferrer" className="mp-small">Quelle</a></li>)}</ul></details>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {view.channels.length > 0 && (
        <Card>
          <h2>Attention Map <span className="mp-muted mp-small">Kanäle nach Erreichbarkeit, Budget 0–300 €/Monat</span></h2>
          <ol className="mp-rank">
            {view.channels.map((c) => (
              <li key={c.id} className="mp-rank-item">
                <span className="mp-num mp-rank-no">{c.priority}</span>
                <div className="mp-rank-body">
                  <div className="mp-rank-head"><strong>{c.platform}</strong>{c.meta.format && <Pill kind="kind">{c.meta.format}</Pill>}</div>
                  <p>{c.rationale}</p>
                  <div className="mp-rank-meta mp-small">
                    {c.cadence && <span><span className="mp-label">Kadenz</span> {c.cadence}</span>}
                    {c.meta.reach && <span><span className="mp-label">Reichweite</span> {c.meta.reach}</span>}
                    {c.meta.costEstimate && <span><span className="mp-label">Kosten</span> {c.meta.costEstimate}</span>}
                    {c.meta.effort && <span><span className="mp-label">Aufwand</span> {c.meta.effort}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {view.geo.snapshots.length > 0 && (
        <Card>
          <div className="mp-card-head">
            <h2>GEO-Baseline <span className="mp-muted mp-small">Wird das Produkt in Chatbot-Antworten genannt?</span></h2>
            <label className="mp-field mp-field--inline"><span>Modell</span>
              <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
                <option value="alle">alle</option>
                {view.geo.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <div className="mp-stats mp-stats--4">
            {view.geo.perModel.map((m) => <div key={m.model} className="mp-ministat"><div className="mp-label">{m.model}</div><div className="mp-num">{m.asked ? Math.round((m.mentioned / m.asked) * 100) : 0} %</div><div className="mp-small mp-muted">{m.mentioned}/{m.asked} genannt</div></div>)}
          </div>
          <div className="mp-table-wrap">
            <table className="mp-table">
              <thead><tr><th>Frage</th><th>Modell</th><th>Genannt</th><th>Position</th><th>Genannte Wettbewerber</th></tr></thead>
              <tbody>{geoRows.map((g) => (
                <tr key={g.id}>
                  <td title={g.rawAnswer.slice(0, 600)}>{g.query}</td>
                  <td className="mp-num-cell mp-small">{g.engine}</td>
                  <td><Pill kind={g.mentioned ? "done" : "todo"}>{g.mentioned ? "ja" : "nein"}</Pill></td>
                  <td className="mp-num-cell">{g.position ?? "–"}</td>
                  <td className="mp-small">{g.competitorsMentioned.join(", ")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function PersonaList({ label, items, quote = false }: { label: string; items: string[]; quote?: boolean }) {
  if (!items.length) return null;
  return (<div className="mp-plist"><div className="mp-label">{label}</div><ul>{items.map((x, i) => <li key={i}>{quote ? <q>{x}</q> : x}</li>)}</ul></div>);
}

/** Inline brief editor: every field saves on blur; changes are flagged "vom Nutzer korrigiert". */
function BriefEditor({ brief, meta, onSave, disabled }: { brief: Brief; meta: AnalysisView["briefMeta"]; onSave: (p: Partial<Brief>) => Promise<void>; disabled: boolean }) {
  const text = (key: keyof Brief, label: string, rows = 2) => (
    <TextField label={label} value={String(brief[key])} rows={rows} disabled={disabled} edited={meta.editedFields.includes(key)} onCommit={(v) => onSave({ [key]: v } as Partial<Brief>)} />
  );
  const lines = (key: "features" | "usp" | "keywords" | "sources", label: string) => (
    <TextField label={`${label} (eine je Zeile)`} value={brief[key].join("\n")} rows={Math.max(3, Math.min(10, brief[key].length + 1))} disabled={disabled} edited={meta.editedFields.includes(key)}
      onCommit={(v) => onSave({ [key]: v.split("\n").map((x) => x.trim()).filter(Boolean) } as Partial<Brief>)} />
  );
  return (
    <Card>
      <div className="mp-card-head">
        <h2>Product Brief</h2>
        <div className="mp-inline">
          {meta.userEdited && <Pill kind="review">vom Nutzer korrigiert</Pill>}
          {meta.model && <span className="mp-label">{meta.model}</span>}
        </div>
      </div>
      <div className="mp-brief-grid">
        {text("productName", "Produktname", 1)}
        {text("oneLiner", "Kernnutzen in einem Satz")}
        {text("category", "Kategorie (englisch, für Suchen)", 1)}
        {text("language", "Sprache (ISO)", 1)}
        {text("targetAudience", "Zielgruppe (Selbstbeschreibung)", 3)}
        {text("tone", "Tonalität", 3)}
        {lines("features", "Funktionen")}
        {lines("usp", "Alleinstellung")}
        <TextField label="Preise (Plan | Preis | Notiz, eine je Zeile)" rows={Math.max(3, brief.pricing.length + 1)} disabled={disabled} edited={meta.editedFields.includes("pricing")}
          value={brief.pricing.map((p) => [p.plan, p.price, p.notes].join(" | ")).join("\n")}
          onCommit={(v) => onSave({ pricing: v.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0]).map((p) => ({ plan: p[0] ?? "", price: p[1] ?? "", notes: p[2] ?? "" })) })} />
        {lines("keywords", "Suchbegriffe")}
        {lines("sources", "Quellen")}
      </div>
    </Card>
  );
}

function TextField({ label, value, rows, disabled, edited, onCommit }: { label: string; value: string; rows: number; disabled: boolean; edited: boolean; onCommit: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="mp-field">
      <span>{label}{edited && <em className="mp-edited"> · korrigiert</em>}</span>
      <textarea value={v} rows={rows} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) void onCommit(v); }} />
    </label>
  );
}
