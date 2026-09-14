/** Sub-navigation shown on every project page; remembers the last project for the global nav. */
import { useEffect } from "react";
import { NavLink } from "react-router";

/**
 * Vier Reiter, die täglich gebraucht werden — der Rest hinter „Mehr". Bis zum
 * 14.09.2026 standen hier sieben gleichrangig; benutzt wurden Pipeline,
 * Freigaben, Medien und die Zahlen.
 */
const TABS = [
  { to: "/pipeline", label: "Pipeline" }, { to: "/review", label: "Freigaben" },
  { to: "/uebersicht", label: "Zahlen" },
];
const MEHR = [
  { to: "", label: "Heute" }, { to: "/handarbeit", label: "Handarbeit" }, { to: "/channels", label: "Kanäle" },
  { to: "/studio", label: "Erstellen" }, { to: "/series", label: "Serien" }, { to: "/analysis", label: "Produkt-Brief" },
  { to: "/community", label: "Community" }, { to: "/insights", label: "Wochenbericht" },
];

export function rememberProject(id: string): void { try { localStorage.setItem("mp_project", id); } catch { /* ignore */ } }
export function lastProject(): string | null { try { return localStorage.getItem("mp_project"); } catch { return null; } }

export function ProjectNav({ id }: { id: string }) {
  useEffect(() => rememberProject(id), [id]);
  return (
    <nav className="mp-subnav" aria-label="Projektbereiche">
      {TABS.map((t) => <NavLink key={t.to} to={`/projects/${id}${t.to}`} className={({ isActive }) => `mp-subnav-item${isActive ? " is-active" : ""}`}>{t.label}</NavLink>)}
      <NavLink to="/media" className={({ isActive }) => `mp-subnav-item${isActive ? " is-active" : ""}`}>Medien</NavLink>
      <details className="mp-subnav-mehr">
        <summary className="mp-subnav-item">Mehr ▾</summary>
        <div className="mp-subnav-mehr-liste">
          {MEHR.map((t) => <NavLink key={t.to} to={`/projects/${id}${t.to}`} end={t.to === ""} className={({ isActive }) => `mp-subnav-item${isActive ? " is-active" : ""}`}>{t.label}</NavLink>)}
        </div>
      </details>
    </nav>
  );
}
