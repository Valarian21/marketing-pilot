/** Sidebar + main area. The sidebar is the module's own; the host adds only a back link.
 *  Top of the sidebar: the project you are working in (from the URL or the last one used) with a quick switcher. */
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useHost } from "../host.js";
import { api } from "../api.js";
import { Icons, type IconName } from "./icons.js";
import { Button } from "./ui.js";
import { lastProject, rememberProject } from "./ProjectNav.js";

/**
 * Die Navigation des Content-Piloten: erst die Kanäle (was läuft wo, auf welcher
 * Stufe), dann der Weg des Contents — erstellen, Serien, freigeben, Medien. Der
 * Marketing-Teil (Analyse, Strategie, Aufgaben, Timeline, Community, Insights)
 * bleibt gebaut, ist aber eingeklappt: er kommt später wieder nach vorn.
 */
const NAV: { group: string; to: string; label: string; icon: IconName; end?: boolean; later?: boolean }[] = [
  { group: "Content Pilot", to: "/projects", label: "Projekte", icon: "projects", end: true },
  { group: "Content Pilot", to: "/channels", label: "Kanäle", icon: "send" },
  { group: "Content Pilot", to: "/studio", label: "Erstellen", icon: "studio" },
  { group: "Content Pilot", to: "/series", label: "Serien", icon: "series" },
  { group: "Content Pilot", to: "/review", label: "Freigaben", icon: "review" },
  { group: "Content Pilot", to: "/pipeline", label: "Pipeline", icon: "timeline" },
  { group: "Content Pilot", to: "/media", label: "Medien", icon: "media" },
  { group: "Content Pilot", to: "/music", label: "Musik", icon: "media" },
  { group: "Betrieb", to: "/activity", label: "Aktivität", icon: "activity" },
  { group: "Betrieb", to: "/storage", label: "Speicher", icon: "storage" },
  { group: "Betrieb", to: "/settings", label: "Einstellungen", icon: "settings" },
  { group: "Marketing · später", to: "/tasks", label: "Aufgaben", icon: "tasks", later: true },
  { group: "Marketing · später", to: "/timeline", label: "Timeline", icon: "timeline", later: true },
  { group: "Marketing · später", to: "/community", label: "Community", icon: "community", later: true },
  { group: "Marketing · später", to: "/insights", label: "Insights", icon: "insights", later: true },
];
const GROUPS = Array.from(new Set(NAV.map((n) => n.group)));
const LATER_KEY = "mp_nav_later_open";

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
  const [laterOpen, setLaterOpen] = useState<boolean>(() => { try { return localStorage.getItem(LATER_KEY) === "1"; } catch { return false; } });
  // Wer gerade auf einer Marketing-Seite ist, soll den Eintrag auch sehen.
  const onLaterPage = NAV.some((n) => n.later && pathname.includes(n.to));
  const toggleLater = () => setLaterOpen((v) => { try { localStorage.setItem(LATER_KEY, v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  return (
    <div className="mp-shell">
      <aside className="mp-sidebar">
        <div className="mp-brand">
          <span className="mp-brand-icon"><Icons.leaf /></span>
          <span className="mp-brand-name mp-display">Marketing Pilot</span>
        </div>
        <ProjectBox projects={projects} />
        <nav className="mp-nav" aria-label="Hauptnavigation">
          {GROUPS.map((g) => {
            const later = NAV.find((n) => n.group === g)?.later ?? false;
            const open = !later || laterOpen || onLaterPage;
            return (
            <div key={g} className={`mp-nav-group${later ? " mp-nav-group--later" : ""}`}>
              {later
                ? <button type="button" className="mp-nav-group-label mp-linkbtn" onClick={toggleLater} aria-expanded={open}>{g}<span aria-hidden="true">{open ? "−" : "+"}</span></button>
                : <div className="mp-nav-group-label">{g}</div>}
              {open && NAV.filter((n) => n.group === g).map((n) => {
                const Icon = Icons[n.icon];
                return (
                  <NavLink key={n.to} to={n.to} end={n.end ?? false} className={({ isActive }) => `mp-nav-item${isActive ? " is-active" : ""}`}>
                    <span className="mp-nav-icon"><Icon /></span>{n.label}{(badge(n.to) ?? 0) > 0 && <span className="mp-nav-badge">{badge(n.to)}</span>}
                  </NavLink>
                );
              })}
            </div>
            );
          })}
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
        {info?.llmPaused && (
          <div className="mp-pause-banner" role="status">
            <strong>OpenRouter pausiert.</strong> Texte entstehen zurzeit über die Claude-Sitzung — Serienläufe, „Neu generieren“ und das Bildmodell sind aus. Veröffentlichen, Rendern und Zahlen laufen weiter.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
