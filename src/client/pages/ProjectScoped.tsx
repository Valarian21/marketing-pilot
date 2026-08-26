/** Global nav entries (Timeline, Aufgaben, …) are project pages: jump to the last used project or let the user pick one. */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Project } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Card, PageHeader } from "../components/ui.js";
import { lastProject } from "../components/ProjectNav.js";

export function ProjectScoped({ page, title }: { page: string; title: string }) {
  const nav = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => {
    api<Project[]>("/projects").then((ps) => {
      const last = lastProject();
      const target = ps.find((p) => p.id === last) ?? (ps.length === 1 ? ps[0] : undefined);
      if (target) nav(`/projects/${target.id}/${page}`, { replace: true }); else setProjects(ps);
    }).catch(() => setProjects([]));
  }, [nav, page]);
  if (!projects) return null;
  return (
    <>
      <PageHeader label="Projekt wählen" title={title} />
      <Card>
        {projects.length === 0 ? <p className="mp-muted">Noch kein Projekt – lege zuerst eines an.</p> : (
          <ul className="mp-plain-list">{projects.map((p) => <li key={p.id}><Link to={`/projects/${p.id}/${page}`}>{p.name}</Link></li>)}</ul>
        )}
      </Card>
    </>
  );
}
