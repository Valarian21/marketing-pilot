/** Sidebar + main area. The sidebar is the module's own; the host adds only a back link.
 *  Top of the sidebar: the project you are working in (from the URL or the last one used) with a quick switcher. */
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useHost } from "../host.js";
import { api } from "../api.js";
import { Icons, type IconName } from "./icons.js";
import { Button } from "./ui.js";
import { lastProject, rememberProject } from "./ProjectNav.js";

const NAV: { group: string; to: string; label: string; icon: IconName; end?: boolean }[] = [
  { group: "Planung", to: "/projects", label: "Projekte", icon: "projects", end: true },
  { group: "Planung", to: "/timeline", label: "Timeline", icon: "timeline" },
  { group: "Planung", to: "/tasks", label: "Aufgaben", icon: "tasks" },
  { group: "Inhalte", to: "/studio", label: "Content Studio", icon: "studio" },
  { group: "Inhalte", to: "/series", label: "Serien", icon: "series" },
  { group: "Inhalte", to: "/media", label: "Medien", icon: "media" },
  { group: "Inhalte", to: "/review", label: "Freigaben", icon: "review" },
  { group: "Inhalte", to: "/publishing", label: "Veröffentlichen", icon: "send" },
  { group: "Wachstum", to: "/community", label: "Community", icon: "community" },
  { group: "Wachstum", to: "/insights", label: "Insights", icon: "insights" },
  { group: "Betrieb", to: "/activity", label: "Aktivität", icon: "activity" },
  { group: "Betrieb", to: "/storage", label: "Speicher", icon: "storage" },
  { group: "Betrieb", to: "/settings", label: "Einstellungen", icon: "settings" },
];
const GROUPS = Array.from(new Set(NAV.map((n) => n.group)));

interface ProjectLite { id: string; name: string; url: string; piecesInReview?: number; openTasksThisWeek?: number }

/** Current project: the one in the URL, else the last one used. */
function useCurrentProject(projects: ProjectLite[]): ProjectLite | null {
  const { pathname } = useLocation();
  const fromUrl = /^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const id = fromUrl ?? lastProject();
  useEffect(() => { if (fromUrl) rememberProject(fromUrl); }, [fromUrl]);
  // nothing remembered yet (fresh browser): the first project is the sensible default
  return projects.find((p) => p.id === id) ?? projects[0] ?? null;
}

function ProjectBox({ projects }: { projects: ProjectLite[] }) {
  const current = useCurrentProject(projects);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const switchTo = (id: string) => {
    if (!id) return;
    rememberProject(id);
    // stay in the same section when the page is project-scoped, otherwise open the project overview
    const m = /^\/projects\/[^/]+(\/[a-z]+)?/.exec(pathname);
    void navigate(m ? `/projects/${id}${m[1] ?? ""}` : `/projects/${id}`);
  };
  if (!current) {
    return (
      <div className="mp-project-box mp-project-box--none">
        <span className="mp-label">Projekt</span>
        <span className="mp-small mp-muted">Kein Projekt gewählt</span>
        <div className="mp-project-switch">
          <select value="" onChange={(e) => switchTo(e.target.value)} aria-label="Projekt wählen"><option value="">Wählen …</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
      </div>
    );
  }
  return (
    <div className="mp-project-box">
      <span className="mp-label">Aktuelles Projekt</span>
      <Link className="mp-project-name" to={`/projects/${current.id}`} title={current.url}>{current.name}</Link>
      <div className="mp-project-switch">
        <select value={current.id} onChange={(e) => switchTo(e.target.value)} aria-label="Projekt wechseln">{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <Link to="/projects">Alle</Link>
      </div>
    </div>
  );
}

export function Shell() {
  const { info, logout } = useHost();
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const { pathname } = useLocation();
  const reloadKey = pathname.startsWith("/projects/") ? "" : pathname;   // project list changes only via the projects page
  useEffect(() => { api<ProjectLite[]>("/overview").then(setProjects).catch(() => setProjects([])); }, [reloadKey, pathname]);
  const current = useCurrentProject(projects);
  const badge = (to: string): number | null => !current ? null : to === "/review" ? (current.piecesInReview ?? null) : to === "/tasks" ? (current.openTasksThisWeek ?? null) : null;
  return (
    <div className="mp-shell">
      <aside className="mp-sidebar">
        <div className="mp-brand">
          <span className="mp-brand-icon"><Icons.leaf /></span>
          <span className="mp-brand-name mp-display">Marketing Pilot</span>
        </div>
        <ProjectBox projects={projects} />
        <nav className="mp-nav" aria-label="Hauptnavigation">
          {GROUPS.map((g) => (
            <div key={g} className="mp-nav-group">
              <div className="mp-nav-group-label">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => {
                const Icon = Icons[n.icon];
                return (
                  <NavLink key={n.to} to={n.to} end={n.end ?? false} className={({ isActive }) => `mp-nav-item${isActive ? " is-active" : ""}`}>
                    <span className="mp-nav-icon"><Icon /></span>{n.label}{(badge(n.to) ?? 0) > 0 && <span className="mp-nav-badge">{badge(n.to)}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mp-sidebar-foot">
          {info?.backLink && (
            <a className="mp-nav-item mp-nav-item--ext" href={info.backLink}>
              <span className="mp-nav-icon"><Icons.back /></span>{info.backLabel ?? "Zurück"}
            </a>
          )}
          <div className="mp-user">
            <div className="mp-label">{info?.mode === "standalone" ? "Standalone" : "Dashboard"}</div>
            <div className="mp-user-name">{info?.user?.name ?? "–"}</div>
            {info?.mode === "standalone" && <Button onClick={() => void logout()}>Abmelden</Button>}
          </div>
        </div>
      </aside>
      <main className="mp-main">
        <Outlet />
      </main>
    </div>
  );
}
