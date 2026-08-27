import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { lastProject } from "../components/ProjectNav.js";
import type { Project, ProjectOverview } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, EmptyState, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";
import { Icons } from "../components/icons.js";

const STATUS_LABEL: Record<Project["status"], { label: string; kind: PillKind }> = {
  draft: { label: "Entwurf", kind: "todo" },
  active: { label: "Aktiv", kind: "done" },
  paused: { label: "Pausiert", kind: "review" },
  archived: { label: "Archiv", kind: "kind" },
};

/** `autoOpen`: the start page jumps straight into the cockpit of the (last used or only) project - the list stays reachable via "Alle". */
export function ProjectsPage({ autoOpen = false }: { autoOpen?: boolean }) {
  const nav = useNavigate();
  const [projects, setProjects] = useState<ProjectOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api<ProjectOverview[]>("/overview");
      if (autoOpen && list.length > 0) { const last = lastProject(); const target = list.find((p) => p.id === last) ?? (list.length === 1 ? list[0] : undefined); if (target) { nav(`/projects/${target.id}`, { replace: true }); return; } }
      setProjects(list); setError(null);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Laden fehlgeschlagen."); }
  }, [autoOpen, nav]);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api<Project>("/projects", { method: "POST", json: { name, url } });
      setName(""); setUrl(""); setShowForm(false);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Anlegen fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  const remove = async (p: Project) => {
    if (!window.confirm(`Projekt „${p.name}“ mit allen Daten löschen?`)) return;
    try { await api(`/projects/${p.id}`, { method: "DELETE" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen."); }
  };

  return (
    <>
      <PageHeader label="Übersicht" title="Projekte" actions={
        <Button variant="primary" onClick={() => setShowForm((v) => !v)}><Icons.plus /> Neues Projekt</Button>
      } />
      {error && <Notice kind="bad">{error}</Notice>}
      {showForm && (
        <Card className="mp-form-card">
          <form onSubmit={(e) => void create(e)} className="mp-form mp-form--row">
            <label className="mp-field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Lehreule" required maxLength={120} /></label>
            <label className="mp-field"><span>URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" type="url" required /></label>
            <div className="mp-form-actions">
              <Button type="button" onClick={() => setShowForm(false)}>Abbrechen</Button>
              <Button type="submit" variant="primary" disabled={busy}>{busy ? "…" : "Anlegen"}</Button>
            </div>
          </form>
        </Card>
      )}
      {projects === null ? null : projects.length === 0 ? (
        <EmptyState title="Noch kein Projekt" text="Lege das erste zu bewerbende Produkt an: Name und URL genügen, die Analyse (Shot 1) holt den Rest." />
      ) : (
        <div className="mp-grid">
          {projects.map((p) => {
            const st = STATUS_LABEL[p.status];
            return (
              <Card key={p.id} className="mp-project-card">
                <div className="mp-project-head">
                  <Link to={`/projects/${p.id}`} className="mp-project-title">{p.name}</Link>
                  <Pill kind={st.kind}>{st.label}</Pill>
                </div>
                <a className="mp-project-url" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
                <Link to={`/projects/${p.id}`} className="mp-btn mp-btn--primary" style={{ alignSelf: "flex-start" }}>Heute öffnen</Link>
                <div className="mp-stats mp-stats--4">
                  <div className="mp-ministat" title="Offene Aufgaben diese Woche"><div className="mp-label">Aufgaben</div><div className="mp-num">{p.openTasksThisWeek}</div></div>
                  <div className="mp-ministat" title="Stücke in Freigabe"><div className="mp-label">Freigabe</div><div className="mp-num">{p.piecesInReview}</div></div>
                  <div className="mp-ministat mp-ministat--hi" title="Signups letzte 7 Tage"><div className="mp-label">Signups 7T</div><div className="mp-num">{p.signups7d}</div></div>
                  <div className="mp-ministat" title="GEO-Sichtbarkeit"><div className="mp-label">GEO</div><div className="mp-num">{p.geoVisibility === null ? "–" : `${Math.round(p.geoVisibility * 100)} %`}</div></div>
                </div>
                {p.latestReport && p.latestReport.status === "proposed" && (
                  <Link to={`/projects/${p.id}/insights`} className="mp-report-card"><span className="mp-label">Wochen-Report {p.latestReport.weekStart} · Vorschlag</span><span className="mp-small">{p.latestReport.excerpt}…</span></Link>
                )}
                <div className="mp-project-foot">
                  <span className="mp-label">{p.planVersion ? `Plan v${p.planVersion}` : p.briefConfirmed ? "Brief bestätigt" : `Angelegt ${new Date(p.createdAt).toLocaleDateString("de-DE")}`}</span>
                  <button type="button" className="mp-linkbtn mp-small mp-muted" onClick={() => void remove(p)}>Projekt löschen</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
