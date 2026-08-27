/** Sub-navigation shown on every project page; remembers the last project for the global nav. */
import { useEffect } from "react";
import { NavLink } from "react-router";

// Only the pages the sidebar does not offer - everything else (Aufgaben, Studio, Freigaben, …) is one click away there.
const TABS = [
  { to: "", label: "Heute" }, { to: "/analysis", label: "Analyse" }, { to: "/strategy", label: "Strategie" },
];

export function rememberProject(id: string): void { try { localStorage.setItem("mp_project", id); } catch { /* ignore */ } }
export function lastProject(): string | null { try { return localStorage.getItem("mp_project"); } catch { return null; } }

export function ProjectNav({ id }: { id: string }) {
  useEffect(() => rememberProject(id), [id]);
  return (
    <nav className="mp-subnav" aria-label="Projektbereiche">
      {TABS.map((t) => <NavLink key={t.to} to={`/projects/${id}${t.to}`} end={t.to === ""} className={({ isActive }) => `mp-subnav-item${isActive ? " is-active" : ""}`}>{t.label}</NavLink>)}
    </nav>
  );
}
