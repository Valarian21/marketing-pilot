import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { ContentPiece, Task } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const TYPE_LABEL: Record<Task["type"], string> = { research: "Recherche", strategy: "Strategie", content: "Content", publish: "Veröffentlichen", community: "Community", ads: "Ads", measure: "Messen" };
const APPROVAL: Record<Task["approvalLevel"], { label: string; kind: PillKind }> = { auto: { label: "auto", kind: "done" }, review: { label: "review", kind: "review" }, human_only: { label: "nur Mensch", kind: "kind" } };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) : "");

export function TasksPage() {
  const { id = "" } = useParams();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("alle");
  const [whoFilter, setWhoFilter] = useState<string>("alle");
  const [executing, setExecuting] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", type: "content", week: 1, assignedTo: "human", channel: "" });

  const load = useCallback(async () => {
    try { setTasks(await api<Task[]>(`/projects/${id}/tasks`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const patch = async (t: Task, body: Record<string, unknown>) => {
    try { const u = await api<Task>(`/tasks/${t.id}`, { method: "PATCH", json: body }); setTasks((xs) => xs?.map((x) => (x.id === u.id ? u : x)) ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  };
  const remove = async (t: Task) => { if (!window.confirm(`„${t.title}“ löschen?`)) return; await api(`/tasks/${t.id}`, { method: "DELETE" }); await load(); };
  const execute = async (t: Task) => {
    setExecuting(t.id); setError(null);
    try { const piece = await api<ContentPiece>(`/tasks/${t.id}/execute`, { method: "POST" }); await load(); window.alert(`Entwurf „${piece.title}“ liegt in der Freigabe.`); }
    catch (e) { setError(e instanceof Error ? e.message : "Ausführung fehlgeschlagen"); await load(); }
    finally { setExecuting(null); }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    try { await api(`/projects/${id}/tasks`, { method: "POST", json: { ...form, week: Number(form.week) } }); setShowForm(false); setForm({ ...form, title: "" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Fehler"); }
  };

  const filtered = useMemo(() => (tasks ?? []).filter((t) => (typeFilter === "alle" || t.type === typeFilter) && (whoFilter === "alle" || t.assignedTo === whoFilter)), [tasks, typeFilter, whoFilter]);
  const weeks = useMemo(() => { const m = new Map<number, Task[]>(); for (const t of filtered) { if (!m.has(t.week)) m.set(t.week, []); m.get(t.week)!.push(t); } return [...m.entries()].sort((a, b) => a[0] - b[0]); }, [filtered]);

  const onDrop = async (e: DragEvent, target: Task) => {
    e.preventDefault();
    if (!dragId || dragId === target.id || !tasks) return;
    const src = tasks.find((t) => t.id === dragId);
    if (!src || src.week !== target.week) { setDragId(null); return; }
    const weekTasks = tasks.filter((t) => t.week === target.week).sort((a, b) => a.order - b.order);
    const ids = weekTasks.map((t) => t.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(target.id), 0, dragId);
    setDragId(null);
    try { setTasks(await api<Task[]>(`/projects/${id}/tasks/reorder`, { method: "POST", json: { ids } })); } catch (err) { setError(err instanceof Error ? err.message : "Fehler"); }
  };

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Stufe 2" title="Aufgaben" actions={<Button variant="primary" onClick={() => setShowForm((v) => !v)}>Aufgabe hinzufügen</Button>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {showForm && (
        <Card className="mp-form-card"><form className="mp-form mp-form--row" onSubmit={(e) => void create(e)}>
          <label className="mp-field"><span>Titel</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="mp-field mp-field--short"><span>Typ</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="mp-field mp-field--short"><span>Woche</span><input type="number" min={1} max={52} value={form.week} onChange={(e) => setForm({ ...form, week: Number(e.target.value) })} /></label>
          <label className="mp-field mp-field--short"><span>Kanal</span><input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} /></label>
          <label className="mp-field mp-field--short"><span>Wer</span><select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}><option value="human">Ich</option><option value="agent">Agent</option></select></label>
          <div className="mp-form-actions"><Button type="submit" variant="primary">Anlegen</Button></div>
        </form></Card>
      )}
      <Card className="mp-form-card"><div className="mp-form mp-form--row">
        <label className="mp-field mp-field--inline"><span>Typ</span><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="alle">alle</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="mp-field mp-field--inline"><span>Zuständig</span><select value={whoFilter} onChange={(e) => setWhoFilter(e.target.value)}><option value="alle">alle</option><option value="agent">Agent</option><option value="human">Ich</option></select></label>
        <span className="mp-muted mp-small">{filtered.length} Aufgaben · Reihenfolge per Ziehen innerhalb einer Woche</span>
      </div></Card>

      {tasks && tasks.length === 0 && <Card className="mp-empty"><h2>Noch keine Aufgaben</h2><p>Aufgaben entstehen aus dem Strategie-Plan – <Link to={`/projects/${id}/strategy`}>zur Strategie</Link> – oder manuell über „Aufgabe hinzufügen“.</p></Card>}

      {weeks.map(([week, list]) => {
        const done = list.filter((t) => t.status === "done" || t.status === "skipped").length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        return (
          <Card key={week} className="mp-week">
            <div className="mp-card-head">
              <h2>Woche {week} <span className="mp-muted mp-small">{fmtDate(list[0]?.dueAt ?? null)}</span></h2>
              <div className="mp-progress" title={`${done}/${list.length} erledigt`}><div className="mp-progress-bar" style={{ width: `${pct}%` }} /><span className="mp-label">{done}/{list.length}</span></div>
            </div>
            <ul className="mp-task-list">
              {list.sort((a, b) => a.order - b.order).map((t) => (
                <li key={t.id} className={`mp-task mp-task--${t.status}${dragId === t.id ? " is-dragging" : ""}`} draggable onDragStart={() => setDragId(t.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onDrop(e, t)}>
                  <button type="button" className={`mp-check${t.status === "done" ? " is-done" : ""}`} aria-label={t.status === "done" ? "Als offen markieren" : "Als erledigt markieren"} onClick={() => void patch(t, { status: t.status === "done" ? "todo" : "done" })} />
                  <div className="mp-task-body">
                    <div className="mp-task-title">{t.title}</div>
                    {t.description && <div className="mp-small mp-muted">{t.description}</div>}
                    <div className="mp-task-meta">
                      <Pill kind="kind">{TYPE_LABEL[t.type]}</Pill>
                      <Pill kind={t.assignedTo === "agent" ? "progress" : "todo"}>{t.assignedTo === "agent" ? "Agent" : "Ich"}</Pill>
                      <Pill kind={APPROVAL[t.approvalLevel].kind}>{APPROVAL[t.approvalLevel].label}</Pill>
                      {t.channel && <span className="mp-label">{t.channel}</span>}
                      {t.dueAt && <span className="mp-label">{fmtDate(t.dueAt)}</span>}
                      {t.status === "review" && <Pill kind="review">in Freigabe</Pill>}
                      {t.status === "in_progress" && <Pill kind="progress">läuft</Pill>}
                    </div>
                  </div>
                  <div className="mp-task-actions">
                    {t.outputRefs.length > 0 && <Link className="mp-btn" to={`/projects/${id}/review?piece=${t.outputRefs[t.outputRefs.length - 1]}`}>Ergebnis</Link>}
                    {t.assignedTo === "agent" && t.status !== "done" && t.type !== "publish" && t.type !== "ads" && <Button variant="primary" disabled={executing !== null} onClick={() => void execute(t)}>{executing === t.id ? "läuft …" : "Jetzt ausführen"}</Button>}
                    <Button variant="danger" onClick={() => void remove(t)} aria-label="Löschen">×</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}
