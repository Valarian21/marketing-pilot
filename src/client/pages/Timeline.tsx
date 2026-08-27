import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { TimelineItem, TimelineView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Card, Notice, PageHeader, Pill } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ChannelTag } from "../components/ChannelLink.js";

export function TimelinePage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<TimelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ item: TimelineItem; channel: string } | null>(null);

  useEffect(() => { api<TimelineView>(`/projects/${id}/timeline`).then(setView).catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler")); }, [id]);
  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  const weeks = Array.from({ length: view.weeks }, (_, i) => i + 1);
  const start = new Date(`${view.startDate}T00:00:00Z`);
  const weekLabel = (w: number) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + (w - 1) * 7); return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); };

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="12 Wochen" title="Timeline" actions={<span className="mp-legend"><span className="mp-bar mp-bar--done" /> veröffentlicht <span className="mp-bar mp-bar--planned" /> geplant</span>} />
      {error && <Notice kind="bad">{error}</Notice>}
      <div className="mp-timeline-layout">
        <Card className="mp-timeline-card">
          <div className="mp-timeline-scroll">
            <div className="mp-timeline" style={{ ["--weeks" as string]: view.weeks }}>
              <div className="mp-tl-head mp-tl-label">Kanal</div>
              {weeks.map((w) => <div key={w} className={`mp-tl-head${view.todayWeek === w ? " is-today" : ""}`}><span className="mp-label">W{w}</span><span className="mp-small mp-muted">{weekLabel(w)}</span></div>)}
              {view.rows.length === 0 && <div className="mp-tl-empty">Noch keine Kanäle – erst Strategie und Aufgaben erzeugen.</div>}
              {view.rows.map((row) => (
                <div key={row.channel} className="mp-tl-row">
                  <div className="mp-tl-label" title={row.channel}><ChannelTag name={row.channel} projectId={id} className="mp-tl-channel" /></div>
                  {weeks.map((w) => {
                    const items = row.items.filter((it) => it.week === w);
                    return (
                      <div key={w} className={`mp-tl-cell${view.todayWeek === w ? " is-today" : ""}`}>
                        {items.slice(0, 3).map((it) => (
                          <button key={it.id} type="button" title={it.title} className={`mp-bar mp-bar--full ${it.planned ? "mp-bar--planned" : "mp-bar--done"}${it.kind === "piece" ? " mp-bar--piece" : ""}`} onClick={() => setSel({ item: it, channel: row.channel })} />
                        ))}
                        {items.length > 3 && <button type="button" className="mp-tl-more mp-linkbtn" title={items.slice(3).map((i) => i.title).join("\n")} onClick={() => setSel({ item: items[3]!, channel: row.channel })}>+{items.length - 3}</button>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </Card>
        {sel && (
          <aside className="mp-drawer">
            <Card>
              <div className="mp-card-head"><h2>{sel.item.kind === "task" ? "Aufgabe" : "Content-Stück"}</h2><button type="button" className="mp-btn" onClick={() => setSel(null)}>Schließen</button></div>
              <p><strong>{sel.item.title}</strong></p>
              <dl className="mp-dl">
                <dt>Kanal</dt><dd><ChannelTag name={sel.channel} projectId={id} className="" /></dd>
                <dt>Woche</dt><dd>{sel.item.week}</dd>
                <dt>Status</dt><dd><Pill kind={sel.item.planned ? "todo" : "done"}>{sel.item.status}</Pill></dd>
                <dt>Typ</dt><dd>{sel.item.type}</dd>
                {sel.item.assignedTo && <><dt>Zuständig</dt><dd>{sel.item.assignedTo === "agent" ? "Agent" : "Ich"}</dd></>}
                {sel.item.date && <><dt>Datum</dt><dd>{new Date(sel.item.date).toLocaleDateString("de-DE")}</dd></>}
              </dl>
              <Link className="mp-btn mp-btn--primary" to={sel.item.kind === "task" ? `/projects/${id}/tasks` : `/projects/${id}/review?piece=${sel.item.id}`}>Öffnen</Link>
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}
