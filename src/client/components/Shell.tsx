/** Sidebar + main area. The sidebar is the module's own; the host adds only a back link. */
import { NavLink, Outlet } from "react-router";
import { useHost } from "../host.js";
import { Icons, type IconName } from "./icons.js";
import { Button } from "./ui.js";

const NAV: { group: string; to: string; label: string; icon: IconName; end?: boolean }[] = [
  { group: "Planung", to: "/", label: "Projekte", icon: "projects", end: true },
  { group: "Planung", to: "/timeline", label: "Timeline", icon: "timeline" },
  { group: "Planung", to: "/tasks", label: "Aufgaben", icon: "tasks" },
  { group: "Inhalte", to: "/studio", label: "Content Studio", icon: "studio" },
  { group: "Inhalte", to: "/media", label: "Medien", icon: "media" },
  { group: "Inhalte", to: "/review", label: "Freigaben", icon: "review" },
  { group: "Wachstum", to: "/community", label: "Community", icon: "community" },
  { group: "Wachstum", to: "/insights", label: "Insights", icon: "insights" },
  { group: "Betrieb", to: "/activity", label: "Aktivität", icon: "activity" },
  { group: "Betrieb", to: "/storage", label: "Speicher", icon: "storage" },
  { group: "Betrieb", to: "/settings", label: "Einstellungen", icon: "settings" },
];
const GROUPS = Array.from(new Set(NAV.map((n) => n.group)));

export function Shell() {
  const { info, logout } = useHost();
  return (
    <div className="mp-shell">
      <aside className="mp-sidebar">
        <div className="mp-brand">
          <span className="mp-brand-icon"><Icons.leaf /></span>
          <span className="mp-brand-name mp-display">Marketing Pilot</span>
        </div>
        <nav className="mp-nav" aria-label="Hauptnavigation">
          {GROUPS.map((g) => (
            <div key={g} className="mp-nav-group">
              <div className="mp-nav-group-label">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => {
                const Icon = Icons[n.icon];
                return (
                  <NavLink key={n.to} to={n.to} end={n.end ?? false} className={({ isActive }) => `mp-nav-item${isActive ? " is-active" : ""}`}>
                    <span className="mp-nav-icon"><Icon /></span>{n.label}
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
