/**
 * Serien: wiederkehrender Content, den niemand mehr anstoßen muss.
 *
 * Die Seite zeigt vor allem zwei Dinge ehrlich: wann die Serie das nächste Mal
 * läuft, und ob sich ihre Ausgaben in der Freigabe stapeln. Das Zweite ist
 * wichtiger — eine Serie, die schneller produziert als Marcel freigibt, ist
 * keine Hilfe, sondern eine Halde.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { Job, SeriesCatalogEntry, SeriesParams, SeriesView, Weekday } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, fmtDateTime } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const DAYS: { id: Weekday; label: string }[] = [
  { id: "mon", label: "Mo" }, { id: "tue", label: "Di" }, { id: "wed", label: "Mi" }, { id: "thu", label: "Do" },
  { id: "fri", label: "Fr" }, { id: "sat", label: "Sa" }, { id: "sun", label: "So" },
];
const PLATFORMS = ["instagram", "tiktok", "pinterest", "facebook", "bluesky", "x"];

export function SeriesPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<SeriesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api<SeriesView>(`/projects/${id}/series`));
      const v = await api<{ jobs: Job[] }>(`/projects/${id}/video`);
      setJobs(v.jobs.filter((j) => j.kind === "series.run").slice(0, 5));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [active, load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(null); }
  };

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Inhalte" title="Serien" actions={<span className="mp-label">{view.series.filter((x) => x.status === "active").length} aktiv</span>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {!view.hasData && <Notice kind="warn">Serien brauchen eine Produktdatenquelle. Auf der <Link to={`/projects/${id}`}>Projektseite</Link> unter „Produktdaten“ eine auswählen.</Notice>}
      {!view.workerAlive && <Notice kind="bad">Der Worker läuft nicht (<code className="mp-code">app-marketing-pilot-worker</code>) – Serien werden angelegt, aber nicht ausgeführt.</Notice>}

      {view.series.length === 0 ? (
        <Card className="mp-empty"><h2>Noch keine Serie</h2><p>Eine Serie legt einmal fest, worüber und wann – danach landen die Bündel von selbst in der Freigabe, ohne dass sich ein Set wiederholt.</p></Card>
      ) : (
        <Card>
          <h2>Laufende Serien</h2>
          <div className="mp-table-wrap"><table className="mp-table">
            <thead><tr><th>Serie</th><th>Kadenz</th><th>Zuletzt</th><th>Als Nächstes</th><th>Gezeigt</th><th>Status</th><th></th></tr></thead>
            <tbody>{view.series.map((x) => (
              <tr key={x.id}>
                <td>
                  <strong>{x.name}</strong>
                  <div className="mp-small mp-muted">{x.kind} · {x.params.formats.join(" + ")} · {x.params.platforms.join(", ")}</div>
                  {x.pendingReview >= 2 && <div className="mp-small mp-over">{x.pendingReview} Ausgaben liegen unfreigegeben – Kadenz zu hoch?</div>}
                </td>
                <td className="mp-small mp-nowrap">{x.cadence.days.map((d) => DAYS.find((y) => y.id === d)?.label).join(", ")} · {String(x.cadence.hour).padStart(2, "0")}:00</td>
                <td className="mp-small mp-nowrap">{x.lastRunAt ? fmtDateTime(x.lastRunAt) : "–"}</td>
                <td className="mp-small mp-nowrap">{x.nextRunAt ? fmtDateTime(x.nextRunAt) : "pausiert"}</td>
                <td className="mp-small mp-muted" title={x.coverage.used.map((u) => u.label || u.key).join(", ")}>{x.coverage.used.length}</td>
                <td><Pill kind={x.status === "active" ? "done" : "todo"}>{x.status === "active" ? "aktiv" : "pausiert"}</Pill></td>
                <td className="mp-inline">
                  <Button disabled={busy !== null || !view.workerAlive} onClick={() => void run(`run-${x.id}`, () => api(`/series/${x.id}/run`, { method: "POST", json: { preview: false } }))}>{busy === `run-${x.id}` ? "…" : "Jetzt ausführen"}</Button>
                  <Button disabled={busy !== null || !view.workerAlive} title="Erzeugt ein Bündel, verbraucht die Rotation aber nicht" onClick={() => void run(`prev-${x.id}`, () => api(`/series/${x.id}/run`, { method: "POST", json: { preview: true } }))}>Vorschau</Button>
                  <Button disabled={busy !== null} onClick={() => void run(`t-${x.id}`, () => api(`/series/${x.id}`, { method: "PATCH", json: { status: x.status === "active" ? "paused" : "active" } }))}>{x.status === "active" ? "Pausieren" : "Fortsetzen"}</Button>
                  <Button variant="danger" disabled={busy !== null} onClick={() => { if (window.confirm(`Serie „${x.name}" löschen? Erzeugte Stücke bleiben.`)) void run(`d-${x.id}`, () => api(`/series/${x.id}`, { method: "DELETE" })); }}>×</Button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      {jobs.length > 0 && (
        <Card>
          <h2>Letzte Läufe</h2>
          <ul className="mp-plain-list">{jobs.map((j) => (
            <li key={j.id} className="mp-small">
              <Pill kind={j.status === "done" ? "done" : j.status === "failed" ? "review" : j.status === "running" ? "progress" : "todo"}>{j.status}</Pill>{" "}
              {fmtDateTime(j.createdAt)} · {j.steps.map((st) => st.detail).filter(Boolean).join(" · ") || "…"}
              {typeof j.result["skipped"] === "boolean" && j.result["skipped"] === true && <span className="mp-muted"> (ausgefallen: {String(j.result["reason"] ?? "")})</span>}
              {j.error && <span className="mp-over"> — {j.error}</span>}
            </li>
          ))}</ul>
          <p className="mp-small mp-muted">Ein ausgefallener Lauf ist kein Fehler: die Serie hatte nichts Neues zu zeigen und hat deshalb geschwiegen.</p>
        </Card>
      )}

      <Card>
        <h2>Katalog <span className="mp-muted mp-small">Vorlage wählen, Parameter anpassen, anlegen</span></h2>
        <ul className="mp-plain-list">{view.catalog.map((c) => (
          <li key={c.kind} className="mp-sub">
            <div className="mp-sub-head">
              <div>
                <strong>{c.name}</strong> {!c.available && <Pill kind="todo">noch nicht gebaut</Pill>}
                <div className="mp-small mp-muted">{c.description}</div>
                {c.note && <div className="mp-small mp-muted">{c.note}</div>}
              </div>
              {c.available && <Button disabled={!view.hasData} onClick={() => setOpen(open === c.kind ? null : c.kind)}>{open === c.kind ? "Abbrechen" : "Anlegen"}</Button>}
            </div>
            {open === c.kind && <NewSeriesForm entry={c} busy={busy} onCreate={(body) => run("create", async () => { await api(`/projects/${id}/series`, { method: "POST", json: body }); setOpen(null); })} />}
          </li>
        ))}</ul>
      </Card>
    </>
  );
}

function NewSeriesForm({ entry, busy, onCreate }: { entry: SeriesCatalogEntry; busy: string | null; onCreate: (body: unknown) => void }) {
  const [name, setName] = useState(entry.name);
  const [days, setDays] = useState<Weekday[]>(entry.cadence.days);
  const [hour, setHour] = useState(entry.cadence.hour);
  const [params, setParams] = useState<SeriesParams>(entry.defaults);
  const toggleDay = (d: Weekday) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  const togglePlatform = (p: string) => setParams((cur) => ({ ...cur, platforms: cur.platforms.includes(p) ? cur.platforms.filter((x) => x !== p) : [...cur.platforms, p] }));
  const toggleFormat = (f: "data_carousel" | "data_reel") => setParams((cur) => ({ ...cur, formats: cur.formats.includes(f) ? cur.formats.filter((x) => x !== f) : [...cur.formats, f] }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate({ name, kind: entry.kind, cadence: { days, hour }, params });
  };
  const wantsReel = params.formats.includes("data_reel");
  return (
    <form className="mp-form" onSubmit={submit}>
      <div className="mp-form mp-form--row">
        <label className="mp-field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="mp-field mp-field--short"><span>Uhrzeit (Berlin)</span><select value={hour} onChange={(e) => setHour(Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
        <label className="mp-field mp-field--short"><span>Umfang</span><select value={params.n} onChange={(e) => setParams({ ...params, n: Number(e.target.value) })}>{[5, 10, 15, 20].map((v) => <option key={v} value={v}>Top {v}</option>)}</select></label>
      </div>
      <fieldset className="mp-field"><span>Wochentage</span>
        <div className="mp-inline">{DAYS.map((d) => <label key={d.id} className="mp-inline mp-small"><input type="checkbox" checked={days.includes(d.id)} onChange={() => toggleDay(d.id)} /> {d.label}</label>)}</div>
      </fieldset>
      <fieldset className="mp-field"><span>Formate</span>
        <div className="mp-inline">
          <label className="mp-inline mp-small"><input type="checkbox" checked={params.formats.includes("data_carousel")} onChange={() => toggleFormat("data_carousel")} /> Carousel</label>
          <label className="mp-inline mp-small"><input type="checkbox" checked={params.formats.includes("data_reel")} onChange={() => toggleFormat("data_reel")} /> Reel</label>
        </div>
      </fieldset>
      <fieldset className="mp-field"><span>Plattformen</span>
        <div className="mp-inline">{PLATFORMS.map((p) => <label key={p} className="mp-inline mp-small"><input type="checkbox" checked={params.platforms.includes(p)} onChange={() => togglePlatform(p)} /> {p}</label>)}</div>
      </fieldset>
      {wantsReel && (
        <div className="mp-form mp-form--row">
          <label className="mp-field mp-field--short"><span>Standzeit je Karte</span><select value={params.secondsPerCard} onChange={(e) => setParams({ ...params, secondsPerCard: Number(e.target.value) })}>{[1.4, 1.6, 1.8, 2.0, 2.2, 2.5].map((v) => <option key={v} value={v}>{v.toFixed(1)} s</option>)}</select></label>
          <label className="mp-field mp-field--short"><span>Ton</span><select value={params.voiceover ? "voice" : "mute"} onChange={(e) => setParams({ ...params, voiceover: e.target.value === "voice" })}><option value="mute">stumm</option><option value="voice">Voiceover</option></select></label>
        </div>
      )}
      {entry.kind === "custom" && (
        <div className="mp-form mp-form--row">
          <label className="mp-field mp-field--short"><span>Set-ID</span><input value={params.set} onChange={(e) => setParams({ ...params, set: e.target.value, era: "" })} placeholder="swsh12" /></label>
          <label className="mp-field mp-field--short"><span>oder Ära-ID</span><input value={params.era} onChange={(e) => setParams({ ...params, era: e.target.value, set: "" })} placeholder="swsh" /></label>
        </div>
      )}
      {entry.kind !== "price_movers" && entry.kind !== "custom" && (
        <label className="mp-field mp-field--short"><span>Sperrfrist je Bereich</span><select value={params.minWeeksBetweenRepeats} onChange={(e) => setParams({ ...params, minWeeksBetweenRepeats: Number(e.target.value) })}>{[0, 12, 26, 52, 104].map((v) => <option key={v} value={v}>{v === 0 ? "keine" : `${v} Wochen`}</option>)}</select></label>
      )}
      <div className="mp-form-actions"><Button type="submit" variant="primary" disabled={busy !== null || days.length === 0 || params.platforms.length === 0 || params.formats.length === 0}>{busy === "create" ? "legt an …" : "Serie anlegen"}</Button></div>
    </form>
  );
}
