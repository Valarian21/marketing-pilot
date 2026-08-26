/** Community radar: leads by score, editable draft, "copy and open thread", mark as answered. No auto-posting - not built on purpose. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import type { CommunityLead, CommunitySource, CommunityView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const STATUS: Record<CommunityLead["status"], { label: string; kind: PillKind }> = { new: { label: "neu", kind: "todo" }, drafted: { label: "Entwurf", kind: "review" }, answered: { label: "beantwortet", kind: "done" }, dismissed: { label: "verworfen", kind: "kind" } };

export function CommunityPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<CommunityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);
  const [editSources, setEditSources] = useState(false);
  const [sources, setSources] = useState<CommunitySource[]>([]);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => { try { const v = await api<CommunityView>(`/projects/${id}/community`); setView(v); setSources(v.sources); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const scanning = view?.scanning ?? false;
  useEffect(() => {
    if (!scanning) { if (timer.current) window.clearInterval(timer.current); timer.current = null; return; }
    timer.current = window.setInterval(() => void load(), 4000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [scanning, load]);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); } };
  const scan = () => run(() => api(`/projects/${id}/community/scan`, { method: "POST" }));
  const saveSources = () => run(async () => { await api(`/projects/${id}/community/sources`, { method: "PUT", json: sources }); setEditSources(false); });
  const patch = (lead: CommunityLead, body: Record<string, unknown>) => run(() => api(`/community/${lead.id}`, { method: "PATCH", json: body }));
  const copyAndOpen = async (lead: CommunityLead) => {
    const text = drafts[lead.id] ?? lead.draftReply;
    if (text !== lead.draftReply) await api(`/community/${lead.id}`, { method: "PATCH", json: { draftReply: text } });
    await navigator.clipboard.writeText(text).catch(() => undefined);
    window.open(lead.url, "_blank", "noopener");
  };
  const markAnswered = (lead: CommunityLead) => { const url = window.prompt("URL deiner Antwort (optional):") ?? ""; void patch(lead, { status: "answered", externalUrl: url }); };

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  const leads = view.leads.filter((l) => showDone || (l.status !== "answered" && l.status !== "dismissed"));

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Stufe 5" title="Community-Radar" actions={
        <div className="mp-inline">
          {view.lastScanAt && <span className="mp-label">letzter Scan {new Date(view.lastScanAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>}
          <Button variant="primary" disabled={busy || scanning} onClick={() => void scan()}>{scanning ? "Scan läuft …" : "Jetzt scannen"}</Button>
        </div>
      } />
      {error && <Notice kind="bad">{error}</Notice>}
      <Notice kind="info">Nur lesen und entwerfen: Antworten postest du selbst. Ein automatisches Posten ist bewusst nicht eingebaut. {!view.redditAuth && "Reddit läuft ohne OAuth-App über die öffentlichen Endpunkte (langsam, gedrosselt) – REDDIT_CLIENT_ID/SECRET in der .env beschleunigen das."}</Notice>

      <Card className="mp-form-card">
        <div className="mp-card-head"><h2>Quellen <span className="mp-muted mp-small">täglich gescannt</span></h2><Button onClick={() => setEditSources((v) => !v)}>{editSources ? "Abbrechen" : "Bearbeiten"}</Button></div>
        {!editSources ? (
          <div className="mp-inline mp-wrap">{view.sources.map((sx, i) => <Pill key={i} kind={sx.enabled ? "done" : "kind"}>{sx.type === "reddit" ? `r/${sx.value}` : sx.type === "hn" ? `HN: ${sx.value || "Kategorie"}` : sx.label || sx.value}</Pill>)}{view.sources.length === 0 && <span className="mp-muted">Keine Quellen aus der Analyse ableitbar – bitte anlegen.</span>}</div>
        ) : (
          <div className="mp-form">
            {sources.map((sx, i) => (
              <div key={i} className="mp-action-row">
                <select value={sx.type} onChange={(e) => setSources(sources.map((x, j) => (j === i ? { ...x, type: e.target.value as CommunitySource["type"] } : x)))}><option value="reddit">Subreddit</option><option value="hn">Hacker News (Suchbegriff)</option><option value="rss">RSS/Atom-Feed</option></select>
                <input value={sx.value} placeholder={sx.type === "reddit" ? "lehrerzimmer" : sx.type === "hn" ? "worksheet generator" : "https://forum.example/feed.rss"} onChange={(e) => setSources(sources.map((x, j) => (j === i ? { ...x, value: e.target.value, label: "" } : x)))} />
                <label className="mp-inline mp-small"><input type="checkbox" checked={sx.enabled} onChange={(e) => setSources(sources.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} /> aktiv</label>
                <Button variant="danger" onClick={() => setSources(sources.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <div className="mp-form-actions"><Button onClick={() => setSources([...sources, { type: "reddit", value: "", label: "", enabled: true }])}>Quelle hinzufügen</Button><Button variant="primary" disabled={busy} onClick={() => void saveSources()}>Speichern</Button></div>
          </div>
        )}
      </Card>

      <div className="mp-card-head"><h2>Leads <span className="mp-muted mp-small">Score ≥ 60 aus Persona-Schmerzpunkten</span></h2><button type="button" className="mp-linkbtn mp-small" onClick={() => setShowDone((v) => !v)}>{showDone ? "nur offene" : "auch erledigte"}</button></div>
      {leads.length === 0 && <Card className="mp-empty"><h2>Noch keine Leads</h2><p>Der nächste Scan läuft automatisch (täglich) – oder jetzt per Knopf.</p></Card>}
      {leads.map((l) => {
        const st = STATUS[l.status]; const isOpen = open === l.id; const meta = l.meta as { community?: string; reason?: string; rulesNote?: string; askingForTools?: boolean; linksAllowed?: boolean; answeredUrl?: string };
        return (
          <Card key={l.id} className="mp-lead">
            <div className="mp-card-head">
              <button type="button" className="mp-linkbtn mp-lead-title" onClick={() => setOpen(isOpen ? null : l.id)}>
                <span className="mp-num mp-rank-no">{l.score}</span>
                <div><strong>{l.title}</strong><div className="mp-small mp-muted">{meta.community ?? l.platform} · {meta.reason}</div></div>
              </button>
              <div className="mp-inline">{meta.askingForTools && <Pill kind="done">fragt nach Tools</Pill>}{meta.linksAllowed === false && <Pill kind="review">keine Links</Pill>}<Pill kind={st.kind}>{st.label}</Pill></div>
            </div>
            {isOpen && (
              <>
                <blockquote className="mp-quote">{l.excerpt}</blockquote>
                {meta.rulesNote && <p className="mp-small"><span className="mp-label">Regeln</span> {meta.rulesNote}</p>}
                <label className="mp-field"><span>Antwortentwurf</span><textarea className="mp-piece-body" rows={Math.min(18, Math.max(5, (drafts[l.id] ?? l.draftReply).split("\n").length + 2))} value={drafts[l.id] ?? l.draftReply} onChange={(e) => setDrafts({ ...drafts, [l.id]: e.target.value })} disabled={l.status === "answered"} /></label>
                <div className="mp-form-actions">
                  <Button variant="primary" onClick={() => void copyAndOpen(l)}>Kopieren und Thread öffnen</Button>
                  {l.status !== "answered" && <Button onClick={() => markAnswered(l)}>Als beantwortet markieren</Button>}
                  {l.status !== "answered" && l.status !== "dismissed" && <Button variant="danger" onClick={() => void patch(l, { status: "dismissed" })}>Verwerfen</Button>}
                  {meta.answeredUrl && <a className="mp-small" href={meta.answeredUrl} target="_blank" rel="noreferrer">deine Antwort</a>}
                  <a className="mp-small" href={l.url} target="_blank" rel="noreferrer">Thread</a>
                </div>
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}
