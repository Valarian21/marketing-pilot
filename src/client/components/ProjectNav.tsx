/** Sub-navigation shown on every project page; remembers the last project for the global nav. */
import { useEffect } from "react";
import { NavLink } from "react-router";

/**
 * Die Reiter in der Reihenfolge des Arbeitswegs: Heute → Freigaben → Pipeline →
 * Handarbeit → Kanäle. Freigaben und Pipeline fehlten hier bis zum 14.09.2026,
 * obwohl sie der tägliche Weg sind — man musste dafür in die Seitenleiste,
 * die auf dem Handy hinter „Mehr" liegt. Der Produkt-Brief (Analyse) ist der
 * einmalige Einrichtungsschritt und steht deshalb hinten.
 */
const TABS = [
  { to: "", label: "Heute" }, { to: "/review", label: "Freigaben" }, { to: "/pipeline", label: "Pipeline" },
  // TikTok und YouTube haben keine Veroeffentlichungs-API — ihre Warteschlange
  // braucht einen eigenen Ort, sonst liegt fertiger Inhalt ungenutzt herum.
  { to: "/handarbeit", label: "Handarbeit" }, { to: "/channels", label: "Kanäle" },
  { to: "/uebersicht", label: "Übersicht" }, { to: "/analysis", label: "Produkt-Brief" },
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
