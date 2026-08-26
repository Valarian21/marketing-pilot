/** Sidebar + main area. The sidebar is the module's own; the host adds only a back link. */
import { NavLink, Outlet } from "react-router";
import { useHost } from "../host.js";
import { Icons, type IconName } from "./icons.js";
import { Button } from "./ui.js";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Projekte", icon: "projects", end: true },
  { to: "/timeline", label: "Timeline", icon: "timeline" },
  { to: "/tasks", label: "Aufgaben", icon: "tasks" },
  { to: "/studio", label: "Content Studio", icon: "studio" },
  { to: "/review", label: "Freigaben", icon: "review" },
  { to: "/community", label: "Community", icon: "community" },
  { to: "/insights", label: "Insights", icon: "insights" },
  { to: "/activity", label: "Aktivität", icon: "activity" },
  { to: "/storage", label: "Speicher", icon: "storage" },
  { to: "/settings", label: "Einstellungen", icon: "settings" },
];

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
          {NAV.map((n) => {
            const Icon = Icons[n.icon];
            return (
              <NavLink key={n.to} to={n.to} end={n.end ?? false} className={({ isActive }) => `mp-nav-item${isActive ? " is-active" : ""}`}>
                <span className="mp-nav-icon"><Icon /></span>{n.label}
              </NavLink>
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
        <Outlet />
      </main>
    </div>
  );
}
