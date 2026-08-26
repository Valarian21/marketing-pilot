import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { Project } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Card, EmptyState, Notice, PageHeader, Stat } from "../components/ui.js";

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project>(`/projects/${id}`).then(setProject).catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
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
        <Stat label="GEO-Sichtbarkeit" value="–" />
      </div>
      <div className="mp-two-col">
        <Card>
          <h2>Produkt</h2>
          <p><a href={project.url} target="_blank" rel="noreferrer">{project.url}</a></p>
          <p className="mp-muted">Brief, Personas und Attention Map erscheinen hier nach der Analyse.</p>
        </Card>
        <EmptyState title="Analyse" text="„URL rein, Brief raus“ – Crawl, Product Brief, Wettbewerber, Personas, GEO-Baseline." shot={1} />
      </div>
    </>
  );
}
