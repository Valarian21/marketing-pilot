import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { AnalysisView, Project } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Card, Notice, PageHeader, Pill, Stat } from "../components/ui.js";

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project>(`/projects/${id}`).then(setProject).catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
    api<AnalysisView>(`/projects/${id}/analysis`).then(setAnalysis).catch(() => undefined);
  }, [id]);

  if (error) return <Notice kind="bad">{error} – <Link to="/">zurück zur Übersicht</Link></Notice>;
  if (!project) return null;

  return (
    <>
      <PageHeader label="Projekt" title={project.name} />
      <div className="mp-stats mp-stats--4 mp-stats--tiles">
        <Stat label="Offene Aufgaben" value={0} />
        <Stat label="In Freigabe" value={0} />
        <Stat label="Signups 7 Tage" value={0} highlight />
        <Stat label="GEO-Sichtbarkeit" value={analysis?.geo.visibility == null ? "–" : `${Math.round(analysis.geo.visibility * 100)} %`} />
      </div>
      <div className="mp-two-col">
        <Card>
          <h2>Produkt</h2>
          <p><a href={project.url} target="_blank" rel="noreferrer">{project.url}</a></p>
          {analysis?.brief ? <p><strong>{analysis.brief.oneLiner}</strong></p> : <p className="mp-muted">Brief, Personas und Attention Map erscheinen hier nach der Analyse.</p>}
        </Card>
        <Card>
          <div className="mp-card-head"><h2>Analyse</h2>
            {analysis?.run && <Pill kind={analysis.run.status === "done" ? "done" : analysis.run.status === "running" ? "progress" : "review"}>{analysis.run.status === "done" ? "abgeschlossen" : analysis.run.status === "running" ? "läuft" : "fehlgeschlagen"}</Pill>}
            {analysis?.briefMeta.confirmedAt && <Pill kind="done">Brief bestätigt</Pill>}
          </div>
          <p className="mp-muted">„URL rein, Brief raus“ – Crawl, Product Brief, Wettbewerber, Personas, Attention Map, GEO-Baseline.</p>
          <Link to={`/projects/${id}/analysis`} className="mp-btn mp-btn--primary">{analysis?.run ? "Zur Analyse" : "Analyse starten"}</Link>
        </Card>
      </div>
    </>
  );
}
