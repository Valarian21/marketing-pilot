/** Video factory: script editor (scenes, hooks, CTA), "record and render" with per-step progress, gallery of variants. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { ContentPiece, Job, VideoAction, VideoScript, VideoView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const STEP_LABEL: Record<string, string> = { record: "Aufnehmen", voice: "Voiceover", overlays: "Overlays", reels: "Reels rendern", landscape: "Landscape rendern", assets: "Assets speichern" };
const STEP_PILL: Record<string, PillKind> = { pending: "todo", running: "progress", done: "done", failed: "review", skipped: "kind" };
const ACTION_TYPES: VideoAction["type"][] = ["goto", "click", "type", "scroll", "wait", "hover", "press"];

export function VideoPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<VideoView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("Onboarding-Demo");
  const [script, setScript] = useState<VideoScript | null>(null);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => { try { setView(await api<VideoView>(`/projects/${id}/video`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  const pieceId = params.get("piece");
  const piece = view?.pieces.find((p) => p.id === pieceId) ?? view?.pieces[0] ?? null;
  const activeJob = view?.jobs.find((j) => (j.status === "queued" || j.status === "running") && j.payload["pieceId"] === piece?.id) ?? null;
  const lastJob = view?.jobs.find((j) => j.payload["pieceId"] === piece?.id) ?? null;

  useEffect(() => { if (piece && !dirty) setScript((piece.meta["script"] as VideoScript | undefined) ?? null); }, [piece, dirty]);
  useEffect(() => {
    if (!activeJob) { if (timer.current) window.clearInterval(timer.current); timer.current = null; return; }
    timer.current = window.setInterval(() => void load(), 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [activeJob, load]);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); } };
  const createScript = () => run(async () => { const p = await api<ContentPiece>(`/projects/${id}/video/script`, { method: "POST", json: { topic, hint: "" } }); setDirty(false); setParams({ piece: p.id }); });
  const saveScript = () => run(async () => { if (!piece || !script) return; await api(`/content/${piece.id}/script`, { method: "PUT", json: script }); setDirty(false); });
  const render = () => run(async () => { if (!piece) return; if (dirty && script) await api(`/content/${piece.id}/script`, { method: "PUT", json: script }); setDirty(false); await api(`/content/${piece.id}/video/render`, { method: "POST", json: { variants: 3, landscape: true } }); });

  const edit = (fn: (sc: VideoScript) => VideoScript) => { if (script) { setScript(fn(script)); setDirty(true); } };
  const renders = (piece?.meta["variants"] as { variant: string; hook: string; durationMs: number }[] | undefined) ?? [];

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Stufe 4" title="Video-Fabrik" actions={
        <div className="mp-inline">
          <input className="mp-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="z. B. Reel #1: Onboarding-Demo" />
          <Button variant="primary" disabled={busy} onClick={() => void createScript()}>{busy ? "…" : "Skript erzeugen"}</Button>
        </div>
      } />
      {error && <Notice kind="bad">{error}</Notice>}
      {!view.workerAlive && <Notice kind="bad">Der Render-Worker läuft nicht (<code className="mp-code">app-marketing-pilot-worker</code>) – Skripte gehen, Renders nicht.</Notice>}
      {!view.demoConfigured && <Notice kind="warn">Keine Demo-Instanz konfiguriert (<code className="mp-code">MP_DEMO_BASE_URL</code>, <code className="mp-code">MP_DEMO_USER</code>, <code className="mp-code">MP_DEMO_PASSWORD</code>) – die Aufnahme läuft dann nur über öffentliche Seiten.</Notice>}
      {!view.voiceConfigured && <Notice kind="warn">Kein ElevenLabs-Key (<code className="mp-code">ELEVENLABS_API_KEY</code>, <code className="mp-code">ELEVENLABS_VOICE_ID</code>) – Videos werden ohne Sprache gerendert, Captions kommen aus dem Skript-Timing.</Notice>}
      {view.musicTracks === 0 && <Notice kind="info">Keine Musik in <code className="mp-code">marketing-pilot/assets/music/</code> – Renders laufen ohne Musikbett.</Notice>}

      {view.pieces.length > 1 && (
        <Card className="mp-form-card"><label className="mp-field mp-field--inline"><span>Skript</span>
          <select value={piece?.id ?? ""} onChange={(e) => { setDirty(false); setParams({ piece: e.target.value }); }}>{view.pieces.map((p) => <option key={p.id} value={p.id}>{p.title} · {new Date(p.createdAt).toLocaleDateString("de-DE")}</option>)}</select>
        </label></Card>
      )}

      {!piece || !script ? (
        <Card className="mp-empty"><h2>Noch kein Skript</h2><p>Der Skript-Agent baut aus Brief, Persona und Aufgabe Szenen mit Voiceover, UI-Aktionen und Captions, dazu 5 Hook-Varianten.</p></Card>
      ) : (
        <div className="mp-two-col mp-video-layout">
          <Card>
            <div className="mp-card-head">
              <div><div className="mp-label">Skript · {script.devices.join(" + ")} · {script.scenes.length} Szenen</div><h2>{script.title}</h2></div>
              <div className="mp-inline">{dirty && <Pill kind="review">ungespeichert</Pill>}<Button disabled={busy || !dirty} onClick={() => void saveScript()}>Speichern</Button><Button variant="primary" disabled={busy || Boolean(activeJob) || !view.workerAlive} onClick={() => void render()}>{activeJob ? "läuft …" : "Aufnehmen und rendern"}</Button></div>
            </div>
            <label className="mp-field"><span>Ziel</span><input value={script.goal} onChange={(e) => edit((sc) => ({ ...sc, goal: e.target.value }))} /></label>
            <div className="mp-form mp-form--row">
              <label className="mp-field mp-field--short"><span>Geräte</span>
                <select value={script.devices.join(",")} onChange={(e) => edit((sc) => ({ ...sc, devices: e.target.value.split(",") as VideoScript["devices"] }))}><option value="mobile">mobile</option><option value="desktop">desktop</option><option value="mobile,desktop">mobile + desktop</option></select>
              </label>
              <label className="mp-field"><span>CTA</span><input value={script.cta.text} onChange={(e) => edit((sc) => ({ ...sc, cta: { ...sc.cta, text: e.target.value } }))} /></label>
              <label className="mp-field"><span>CTA-URL</span><input value={script.cta.url} onChange={(e) => edit((sc) => ({ ...sc, cta: { ...sc.cta, url: e.target.value } }))} /></label>
            </div>
            <h2>Hooks <span className="mp-muted mp-small">erste 2 Sekunden, je Variante eine</span></h2>
            {script.hooks.map((h, i) => <div key={i} className="mp-inline mp-hook-row"><span className="mp-num mp-rank-no">{i + 1}</span><input value={h} onChange={(e) => edit((sc) => ({ ...sc, hooks: sc.hooks.map((x, j) => (j === i ? e.target.value : x)) }))} /><Button variant="danger" disabled={script.hooks.length <= 1} onClick={() => edit((sc) => ({ ...sc, hooks: sc.hooks.filter((_, j) => j !== i) }))}>×</Button></div>)}
            {script.hooks.length < 8 && <Button onClick={() => edit((sc) => ({ ...sc, hooks: [...sc.hooks, ""] }))}>Hook hinzufügen</Button>}
            <h2>Szenen</h2>
            {script.scenes.map((sc, i) => (
              <div key={sc.id} className="mp-sub mp-scene">
                <div className="mp-sub-head"><strong>Szene {i + 1} <span className="mp-label">{sc.id}</span></strong><div className="mp-inline"><label className="mp-field mp-field--inline"><span>min. ms</span><input type="number" min={800} max={20000} step={100} value={sc.durationMs} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, durationMs: Number(e.target.value) } : x)) }))} /></label><Button variant="danger" disabled={script.scenes.length <= 1} onClick={() => edit((s0) => ({ ...s0, scenes: s0.scenes.filter((_, j) => j !== i) }))}>×</Button></div></div>
                <label className="mp-field"><span>Voiceover (max. 2 Sätze)</span><textarea rows={2} value={sc.voiceover} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, voiceover: e.target.value } : x)) }))} /></label>
                <label className="mp-field"><span>Caption</span><input value={sc.caption} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) }))} /></label>
                <div className="mp-label">Aktionen</div>
                {sc.actions.map((a, k) => (
                  <div key={k} className="mp-action-row">
                    <select value={a.type} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: x.actions.map((y, l) => (l === k ? { ...y, type: e.target.value as VideoAction["type"] } : y)) } : x)) }))}>{ACTION_TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}</select>
                    {a.type === "goto" && <input placeholder="URL" value={a.url ?? ""} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: x.actions.map((y, l) => (l === k ? { ...y, url: e.target.value } : y)) } : x)) }))} />}
                    {(a.type === "click" || a.type === "type" || a.type === "hover") && <input placeholder="Ziel (Text oder Selektor)" value={a.target ?? ""} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: x.actions.map((y, l) => (l === k ? { ...y, target: e.target.value } : y)) } : x)) }))} />}
                    {(a.type === "type" || a.type === "press") && <input placeholder={a.type === "press" ? "Taste" : "Text"} value={a.text ?? ""} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: x.actions.map((y, l) => (l === k ? { ...y, text: e.target.value } : y)) } : x)) }))} />}
                    {a.type === "scroll" && <input type="number" placeholder="px" value={a.y ?? 600} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: x.actions.map((y, l) => (l === k ? { ...y, y: Number(e.target.value) } : y)) } : x)) }))} />}
                    {a.type === "wait" && <input type="number" placeholder="ms" value={a.ms ?? 1000} onChange={(e) => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: x.actions.map((y, l) => (l === k ? { ...y, ms: Number(e.target.value) } : y)) } : x)) }))} />}
                    <Button variant="danger" onClick={() => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: x.actions.filter((_, l) => l !== k) } : x)) }))}>×</Button>
                  </div>
                ))}
                <Button onClick={() => edit((s0) => ({ ...s0, scenes: s0.scenes.map((x, j) => (j === i ? { ...x, actions: [...x.actions, { type: "click", target: "" }] } : x)) }))}>Aktion hinzufügen</Button>
              </div>
            ))}
            <Button onClick={() => edit((s0) => ({ ...s0, scenes: [...s0.scenes, { id: `s${s0.scenes.length + 1}`, voiceover: "", caption: "", actions: [], durationMs: 3500 }] }))}>Szene hinzufügen</Button>
          </Card>
          <div>
            {(activeJob ?? lastJob) && <JobCard job={activeJob ?? lastJob!} />}
            <Card>
              <div className="mp-card-head"><h2>Fertige Varianten</h2>{piece.status !== "draft" && <Link className="mp-btn" to={`/projects/${id}/review?piece=${piece.id}`}>Zur Freigabe</Link>}</div>
              {renders.length === 0 ? <p className="mp-muted">Noch nichts gerendert.</p> : <VideoGallery piece={piece} />}
              {piece.aiTellNotes && <details className="mp-details mp-small"><summary className="mp-label">Render-Hinweise</summary><pre className="mp-pre">{piece.aiTellNotes}</pre></details>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function JobCard({ job }: { job: Job }) {
  return (
    <Card className="mp-steps">
      <div className="mp-card-head"><h2>Render-Job</h2><Pill kind={job.status === "done" ? "done" : job.status === "failed" ? "review" : job.status === "running" ? "progress" : "todo"}>{job.status}</Pill></div>
      <ol className="mp-step-list">{job.steps.map((st) => (
        <li key={st.name} className={`mp-step mp-step--${st.status}`}><div className="mp-step-main"><Pill kind={STEP_PILL[st.status] ?? "todo"}>{st.status}</Pill><span className="mp-step-name">{STEP_LABEL[st.name] ?? st.name}</span><span className="mp-muted mp-step-summary">{st.detail}</span></div></li>
      ))}</ol>
      {job.error && <Notice kind="bad">{job.error}</Notice>}
    </Card>
  );
}

/** Video assets of a piece with <video> players (used here and in the review). */
export function VideoGallery({ piece }: { piece: ContentPiece }) {
  const [assets, setAssets] = useState<{ id: string; kind: string; url: string; filename: string; aiGenerated: boolean }[]>([]);
  useEffect(() => { api<{ assets: { id: string; kind: string; url: string; filename: string; aiGenerated: boolean }[] }>(`/content/${piece.id}/package`).then((p) => setAssets(p.assets)).catch(() => setAssets([])); }, [piece.id]);
  const renders = assets.filter((a) => a.kind === "render");
  return (
    <div className="mp-videos">
      {renders.map((a) => (
        <figure key={a.id} className={`mp-video${a.filename.startsWith("landscape") ? " mp-video--wide" : ""}`}>
          <video controls preload="metadata" src={a.url} />
          <figcaption className="mp-small"><a href={a.url} download={a.filename}>{a.filename}</a>{a.aiGenerated && <Pill kind="kind">KI-Kennzeichnung</Pill>}</figcaption>
        </figure>
      ))}
    </div>
  );
}
