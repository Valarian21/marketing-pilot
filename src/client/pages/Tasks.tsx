import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { ContentPiece, Task } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ChannelTag } from "../components/ChannelLink.js";
import { taskTarget } from "./Today.js";

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
  const [openWeeks, setOpenWeeks] = useState<Set<number> | null>(null);
  const [thisWeek, setThisWeek] = useState<number>(1);
  const [form, setForm] = useState({ title: "", type: "content", week: 1, assignedTo: "human", channel: "" });

  const load = useCallback(async () => {
    try {
      const [list, today] = await Promise.all([api<Task[]>(`/projects/${id}/tasks`), api<{ week: number }>(`/projects/${id}/today`).catch(() => ({ week: 1 }))]);
      setTasks(list); setThisWeek(today.week); setError(null);
      setOpenWeeks((cur) => cur ?? new Set([today.week]));
    }
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
    try { const piece = await api<ContentPiece>(`/tasks/${t.id}/execute`, { method: "POST" }); await load(); setError(null); window.alert(`„${piece.title}“ liegt ${piece.format === "video" ? "als Skript in der Video-Fabrik" : "in der Freigabe"}.`); }
    catch (e) { setError(e instanceof Error ? e.message : "Ausführung fehlgeschlagen"); await load(); }
    finally { setExecuting(null); }
  };
  const executeWeek = async (list: Task[]) => {
    setExecuting("week"); setError(null);
    try { for (const t of list) { await api(`/tasks/${t.id}/execute`, { method: "POST" }); await load(); } }
    catch (e) { setError(e instanceof Error ? e.message : "Ausführung fehlgeschlagen"); }
    finally { setExecuting(null); await load(); }
  };
  /** Checking a publish task also marks its piece as published (with the post URL) - one click instead of two pages. */
  const toggleDone = async (t: Task) => {
    if (t.status === "done") return patch(t, { status: "todo" });
    if (t.type === "publish" && t.link && t.link.status !== "published") {
      const externalUrl = window.prompt("Link zum veröffentlichten Beitrag (optional):") ?? "";
      try { await api(`/content/${t.link.pieceId}`, { method: "PATCH", json: { status: "published", externalUrl } }); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    }
    await patch(t, { status: "done" });
  };
  const canRun = (t: Task) => t.assignedTo === "agent" && t.status === "todo" && t.type !== "publish" && t.type !== "ads";
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
      <PageHeader label={`Woche ${thisWeek} läuft`} title="Aufgaben" actions={<Button variant="primary" onClick={() => setShowForm((v) => !v)}>Aufgabe hinzufügen</Button>} />
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
        <span style={{ flex: 1 }} />
        <button type="button" className="mp-linkbtn mp-small" onClick={() => setOpenWeeks(new Set(weeks.map(([w]) => w)))}>alle aufklappen</button>
        <button type="button" className="mp-linkbtn mp-small" onClick={() => setOpenWeeks(new Set([thisWeek]))}>nur diese Woche</button>
      </div></Card>

      {tasks && tasks.length === 0 && <Card className="mp-empty"><h2>Noch keine Aufgaben</h2><p>Aufgaben entstehen aus dem Strategie-Plan – <Link to={`/projects/${id}/strategy`}>zur Strategie</Link> – oder manuell über „Aufgabe hinzufügen“.</p></Card>}

      {weeks.map(([week, list]) => {
        const done = list.filter((t) => t.status === "done" || t.status === "skipped").length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        const isOpen = openWeeks?.has(week) ?? week === thisWeek;
        const runnable = list.filter(canRun);
        const rel = week === thisWeek ? "diese Woche" : week < thisWeek ? "vergangen" : week === thisWeek + 1 ? "nächste Woche" : "";
        return (
          <Card key={week} className={`mp-week${week === thisWeek ? " mp-week--now" : ""}${week < thisWeek && done < list.length ? " mp-week--late" : ""}`}>
            <div className="mp-card-head mp-week-head" onClick={() => setOpenWeeks((cur) => { const n = new Set(cur ?? [thisWeek]); if (n.has(week)) n.delete(week); else n.add(week); return n; })} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <h2><span className="mp-week-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span> Woche {week} <span className="mp-muted mp-small">{fmtDate(list[0]?.dueAt ?? null)}{rel && ` · ${rel}`}</span>{week < thisWeek && done < list.length && <Pill kind="review">{list.length - done} offen</Pill>}</h2>
              <div className="mp-inline" onClick={(e) => e.stopPropagation()}>
                {isOpen && runnable.length > 1 && <Button disabled={executing !== null} onClick={() => void executeWeek(runnable)}>{executing === "week" ? "läuft …" : `Agent: alle ${runnable.length} ausführen`}</Button>}
                <div className="mp-progress" title={`${done}/${list.length} erledigt`}><div className="mp-progress-bar" style={{ width: `${pct}%` }} /><span className="mp-label">{done}/{list.length}</span></div>
              </div>
            </div>
            {isOpen && <ul className="mp-task-list">
              {list.sort((a, b) => a.order - b.order).map((t) => (
                <li key={t.id} className={`mp-task mp-task--${t.status}${dragId === t.id ? " is-dragging" : ""}`} draggable onDragStart={() => setDragId(t.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onDrop(e, t)}>
                  <button type="button" className={`mp-check${t.status === "done" ? " is-done" : ""}`} aria-label={t.status === "done" ? "Als offen markieren" : "Als erledigt markieren"} onClick={() => void toggleDone(t)} />
                  <div className="mp-task-body">
                    <div className="mp-task-title">{t.title}</div>
                    {t.description && <div className="mp-small mp-muted">{t.description}</div>}
                    <div className="mp-task-meta">
                      <Pill kind="kind">{TYPE_LABEL[t.type]}</Pill>
                      <Pill kind={t.assignedTo === "agent" ? "progress" : "todo"}>{t.assignedTo === "agent" ? "Agent" : "Ich"}</Pill>
                      <Pill kind={APPROVAL[t.approvalLevel].kind}>{APPROVAL[t.approvalLevel].label}</Pill>
                      {t.channel && <ChannelTag name={t.channel} projectId={id} />}
                      {t.dueAt && <span className="mp-label">{fmtDate(t.dueAt)}</span>}
                      {t.status === "review" && <Pill kind="review">in Freigabe</Pill>}
                      {t.status === "in_progress" && <Pill kind="progress">läuft</Pill>}
                      {t.link && t.type === "publish" && <span className="mp-small mp-muted">→ {t.link.title || t.link.format} <Pill kind={t.link.status === "approved" || t.link.status === "published" ? "done" : t.link.status === "review" ? "review" : "todo"}>{t.link.status === "approved" ? "freigegeben" : t.link.status === "review" ? "in Freigabe" : t.link.status === "published" ? "veröffentlicht" : t.link.status === "draft" ? "Entwurf" : t.link.status}</Pill></span>}
                    </div>
                  </div>
                  <div className="mp-task-actions">
                    {(() => { const tgt = t.status !== "done" ? taskTarget(t) : (t.link ? taskTarget(t) : null); return tgt ? <Link className={`mp-btn${t.link && t.status !== "done" ? " mp-btn--primary" : ""}`} to={tgt.to}>{tgt.label}</Link> : null; })()}
                    {t.assignedTo === "agent" && t.status !== "done" && t.type !== "publish" && t.type !== "ads" && <Button variant={t.link ? "secondary" : "primary"} disabled={executing !== null} onClick={() => void execute(t)}>{executing === t.id ? "läuft …" : t.link ? "Nochmal" : "Jetzt ausführen"}</Button>}
                    <button type="button" className="mp-task-del" onClick={() => void remove(t)} aria-label="Löschen" title="Aufgabe löschen">×</button>
                  </div>
                </li>
              ))}
            </ul>}
          </Card>
        );
      })}
    </>
  );
}
