/** "Heute": the one page to start from. Four blocks, one primary action each - approve, post, answer, this week's tasks -
 *  plus what the agent can do right now. Project facts (product, analysis, channels) sit below. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { AnalysisView, ContentPiece, Project, Task, TodayView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, Stat, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ProfilesCard } from "../components/Profiles.js";
import { ProductDataCard } from "../components/ProductData.js";
import { ChannelTag } from "../components/ChannelLink.js";
import { PLATFORMS } from "../../shared/channels.js";

const FORMAT_LABEL: Record<string, string> = { text: "Text-Post", carousel: "Carousel", pin: "Pin", image: "Bild", ad_creative: "Ad", article: "Artikel", directory_entry: "Verzeichnis", video: "Video", community_reply: "Antwort" };
const TYPE_LABEL: Record<Task["type"], string> = { research: "Recherche", strategy: "Strategie", content: "Content", publish: "Posten", community: "Community", ads: "Ads", measure: "Messen" };
const PIECE_PILL: Record<string, PillKind> = { draft: "todo", review: "review", approved: "done", published: "done", rejected: "kind" };

/** Where a task leads: its piece (review or package), or the studio with the format pre-filled. */
export function taskTarget(t: Task): { to: string; label: string } | null {
  const pid = t.projectId;
  if (t.link) {
    const l = t.link;
    if (l.status === "approved" || l.status === "published") return { to: `/projects/${pid}/publish/${l.pieceId}`, label: t.type === "publish" ? "Paket öffnen" : "Paket" };
    if (l.format === "video" && l.status === "draft") return { to: `/projects/${pid}/studio/video?piece=${l.pieceId}`, label: "Zum Skript" };
    return { to: `/projects/${pid}/review?piece=${l.pieceId}`, label: l.status === "review" ? "Prüfen" : "Ergebnis" };
  }
  if (t.type === "publish" || t.type === "content") {
    const q = new URLSearchParams({ topic: t.title, hint: t.description });
    if (/reel|video|short|demo/i.test(`${t.title} ${t.channel}`)) return { to: `/projects/${pid}/studio/video?${q.toString()}`, label: "Im Studio erstellen" };
    if (/carousel|karussell/i.test(t.title)) q.set("format", "carousel");
    const platform = Object.keys(PLATFORMS).find((k) => PLATFORMS[k]!.match.test(t.channel));
    if (platform) q.set("platform", platform);
    return { to: `/projects/${pid}/studio?${q.toString()}`, label: "Im Studio erstellen" };
  }
  if (t.type === "community") return { to: `/projects/${pid}/community`, label: "Community-Radar" };
  return null;
}

export function TodayPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<TodayView | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setView(await api<TodayView>(`/projects/${id}/today`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => {
    void load();
    api<Project>(`/projects/${id}`).then(setProject).catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
    api<AnalysisView>(`/projects/${id}/analysis`).then(setAnalysis).catch(() => undefined);
  }, [id, load]);

  const runAll = async (tasks: Task[]) => {
    setBusy("all");
    try { for (const t of tasks) { await api(`/tasks/${t.id}/execute`, { method: "POST" }); await load(); } }
    catch (e) { setError(e instanceof Error ? e.message : "Ausführung fehlgeschlagen"); }
    finally { setBusy(null); await load(); }
  };
  const runOne = async (t: Task) => {
    setBusy(t.id);
    try { await api(`/tasks/${t.id}/execute`, { method: "POST" }); } catch (e) { setError(e instanceof Error ? e.message : "Ausführung fehlgeschlagen"); }
    finally { setBusy(null); await load(); }
  };
  const doneTask = async (t: Task) => {
    let externalUrl = "";
    if (t.type === "publish") { externalUrl = window.prompt("Link zum veröffentlichten Beitrag (optional):") ?? ""; }
    try {
      await api(`/tasks/${t.id}`, { method: "PATCH", json: { status: "done" } });
      if (t.type === "publish" && t.link && t.link.status !== "published") await api(`/content/${t.link.pieceId}`, { method: "PATCH", json: { status: "published", externalUrl } });
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    await load();
  };
  const copyAndOpen = async (p: ContentPiece, url: string | null) => {
    try { const pkg = await api<{ text: string }>(`/content/${p.id}/package`); await navigator.clipboard.writeText(pkg.text); setCopied(p.id); setTimeout(() => setCopied(null), 2000); } catch { /* clipboard blocked - the package page still has the text */ }
    if (url) window.open(url, "_blank", "noopener");
  };

  if (error && !view) return <><ProjectNav id={id} /><Notice kind="bad">{error} – <Link to="/projects">zurück zur Übersicht</Link></Notice></>;
  if (!view || !project) return <ProjectNav id={id} />;
  const v = view;
  const nothing = v.review.length + v.toPost.length + v.leads.count + v.myTasks.length + v.agentTasks.length === 0;
  const setupHints: { text: string; to: string }[] = [];
  if (!v.setup.briefConfirmed) setupHints.push({ text: "Analyse ausführen und Brief bestätigen – ohne Brief kein Plan, kein Content.", to: `/projects/${id}/analysis` });
  else if (!v.setup.planVersion) setupHints.push({ text: "Strategie erzeugen – daraus entstehen die Aufgaben der ersten vier Wochen.", to: `/projects/${id}/strategy` });
  if (v.setup.profilesMissing > 0) setupHints.push({ text: `${v.setup.profilesMissing} Kanal-Profil${v.setup.profilesMissing > 1 ? "e" : ""} ohne URL – unten unter „Kanäle & Profile“ eintragen, dann führen alle Kanal-Links direkt auf deine Seiten.`, to: "#profile" });
  if (!v.setup.voiceProfile && v.setup.briefConfirmed) setupHints.push({ text: "Kein Voice-Profil – Texte klingen generisch. 5–20 eigene Texte im Studio hinterlegen.", to: `/projects/${id}/studio?tab=brand` });
  if (!v.setup.eventsSeen && v.setup.planVersion) setupHints.push({ text: "Noch kein Signup gemessen – Snippet/Webhook aus den Insights ins Produkt einbauen.", to: `/projects/${id}/insights` });
  // Stau statt Fehler: die Serie liefert schneller, als freigegeben wird.
  for (const st of v.seriesStuck) setupHints.push({ text: `Serie „${st.name}“: ${st.pending} Ausgaben liegen unfreigegeben – entweder freigeben oder die Kadenz senken.`, to: `/projects/${id}/series` });

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label={`${project.name} · Woche ${v.week}${v.weekPlanned ? "" : " (Plan noch nicht gestartet)"}`} title="Heute" actions={<span className="mp-label">Woche {v.week}: {v.progress.done}/{v.progress.total} Aufgaben erledigt</span>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {nothing && <Card className="mp-empty"><h2>Nichts offen</h2><p>Keine Freigaben, nichts zu posten, keine Antworten, keine Aufgaben diese Woche. {v.setup.planVersion ? <Link to={`/projects/${id}/tasks`}>Zu den Aufgaben</Link> : <Link to={`/projects/${id}/analysis`}>Mit der Analyse starten</Link>}.</p></Card>}

      <div className="mp-today">
        <Card className="mp-today-block">
          <div className="mp-card-head"><h2><span className="mp-today-no">1</span> Freigeben <span className="mp-today-count">{v.review.length}</span></h2>{v.review.length > 0 && <Link className="mp-btn" to={`/projects/${id}/review`}>Alle prüfen</Link>}</div>
          {v.review.length === 0 ? <p className="mp-muted mp-small">Nichts wartet auf Freigabe.</p> : (
            <ul className="mp-today-list">{v.review.slice(0, 6).map((p) => (
              <li key={p.id}><div className="mp-today-main"><span className="mp-today-title">{p.title || FORMAT_LABEL[p.format]}</span><span className="mp-small mp-muted">{FORMAT_LABEL[p.format] ?? p.format} · <ChannelTag name={p.channel} projectId={id} className="" /></span></div><Link className="mp-btn mp-btn--primary" to={p.format === "video" && !p.assets.length ? `/projects/${id}/studio/video?piece=${p.id}` : `/projects/${id}/review?piece=${p.id}`}>Prüfen</Link></li>
            ))}{v.review.length > 6 && <li className="mp-small mp-muted">+{v.review.length - 6} weitere</li>}</ul>
          )}
        </Card>

        <Card className="mp-today-block">
          <div className="mp-card-head"><h2><span className="mp-today-no">2</span> Posten <span className="mp-today-count">{v.toPost.length}</span></h2></div>
          {v.toPost.length === 0 ? <p className="mp-muted mp-small">Nichts freigegeben, das noch zu posten wäre.</p> : (
            <ul className="mp-today-list">{v.toPost.map(({ piece: p, composeLink, profileLink, appOnly, platform }) => (
              <li key={p.id}>
                <div className="mp-today-main"><span className="mp-today-title">{p.title || FORMAT_LABEL[p.format]}</span><span className="mp-small mp-muted">{FORMAT_LABEL[p.format] ?? p.format} · <ChannelTag name={p.channel || platform} projectId={id} className="" />{appOnly ? " · Upload per App" : ""}</span></div>
                <div className="mp-inline">
                  <Button variant="primary" onClick={() => void copyAndOpen(p, composeLink ?? profileLink)}>{copied === p.id ? "Text kopiert" : `Text kopieren & ${PLATFORMS[platform]?.label ?? platform} öffnen`}</Button>
                  <Link className="mp-btn" to={`/projects/${id}/publish/${p.id}`}>Paket</Link>
                </div>
              </li>
            ))}</ul>
          )}
        </Card>

        <Card className="mp-today-block">
          <div className="mp-card-head"><h2><span className="mp-today-no">3</span> Antworten <span className="mp-today-count">{v.leads.count}</span></h2>{v.leads.count > 0 && <Link className="mp-btn" to={`/projects/${id}/community`}>Alle Leads</Link>}</div>
          {v.leads.count === 0 ? <p className="mp-muted mp-small">Keine offenen Community-Leads.</p> : (
            <ul className="mp-today-list">{v.leads.top.map((l) => (
              <li key={l.id}><div className="mp-today-main"><span className="mp-today-title"><span className="mp-num mp-today-score">{l.score}</span>{l.title}</span><span className="mp-small mp-muted">{String((l.meta as { community?: string }).community ?? l.platform)}</span></div><Link className="mp-btn mp-btn--primary" to={`/projects/${id}/community?lead=${l.id}`}>Antwort ansehen</Link></li>
            ))}</ul>
          )}
        </Card>

        <Card className="mp-today-block">
          <div className="mp-card-head"><h2><span className="mp-today-no">4</span> Meine Aufgaben <span className="mp-today-count">{v.myTasks.length}</span></h2><Link className="mp-btn" to={`/projects/${id}/tasks`}>Alle Wochen</Link></div>
          {v.myTasks.length === 0 ? <p className="mp-muted mp-small">Keine offenen Aufgaben für dich bis einschließlich dieser Woche.</p> : (
            <ul className="mp-today-list">{v.myTasks.map((t) => { const tgt = taskTarget(t); return (
              <li key={t.id}>
                <button type="button" className="mp-check" aria-label="Als erledigt markieren" onClick={() => void doneTask(t)} />
                <div className="mp-today-main"><span className="mp-today-title">{t.title}</span><span className="mp-small mp-muted">{TYPE_LABEL[t.type]}{t.channel && <> · <ChannelTag name={t.channel} projectId={id} className="" /></>}{t.week < v.week && <> · <span className="mp-over">aus Woche {t.week}</span></>}{t.link && <> · <Pill kind={PIECE_PILL[t.link.status] ?? "todo"}>{t.link.status === "approved" ? "freigegeben" : t.link.status === "review" ? "in Freigabe" : t.link.status === "published" ? "veröffentlicht" : t.link.status}</Pill></>}</span></div>
                {tgt && <Link className={`mp-btn${t.link ? " mp-btn--primary" : ""}`} to={tgt.to}>{tgt.label}</Link>}
              </li>
            ); })}</ul>
          )}
        </Card>
      </div>

      <Card className="mp-today-agent">
        <div className="mp-card-head"><h2>Der Agent kann jetzt <span className="mp-today-count">{v.agentTasks.length}</span></h2>{v.agentTasks.length > 1 && <Button variant="primary" disabled={busy !== null} onClick={() => void runAll(v.agentTasks)}>{busy === "all" ? "läuft …" : `Alle ${v.agentTasks.length} ausführen`}</Button>}</div>
        {v.agentTasks.length === 0 ? <p className="mp-muted mp-small">Keine offenen Agent-Aufgaben bis einschließlich dieser Woche.</p> : (
          <ul className="mp-today-list mp-today-list--compact">{v.agentTasks.map((t) => (
            <li key={t.id}><div className="mp-today-main"><span className="mp-today-title">{t.title}</span><span className="mp-small mp-muted">{TYPE_LABEL[t.type]}{t.channel && <> · <ChannelTag name={t.channel} projectId={id} className="" /></>} · Ergebnis landet in der Freigabe</span></div><Button disabled={busy !== null} onClick={() => void runOne(t)}>{busy === t.id ? "läuft …" : "Ausführen"}</Button></li>
          ))}</ul>
        )}
      </Card>

      {setupHints.length > 0 && (
        <Card>
          <h2>Einrichtung</h2>
          <ul className="mp-plain-list">{setupHints.map((h, i) => <li key={i}>{h.to.startsWith("#") ? <a href={h.to}>{h.text}</a> : <Link to={h.to}>{h.text}</Link>}</li>)}</ul>
        </Card>
      )}

      <h2 className="mp-section">Projekt</h2>
      <div className="mp-stats mp-stats--4 mp-stats--tiles">
        <Stat label="Freigaben offen" value={v.review.length} />
        <Stat label="Zu posten" value={v.toPost.length} />
        <Stat label="Woche erledigt" value={`${v.progress.done}/${v.progress.total}`} highlight />
        <Stat label="GEO-Sichtbarkeit" value={analysis?.geo.visibility == null ? "–" : `${Math.round(analysis.geo.visibility * 100)} %`} />
      </div>
      <div className="mp-two-col">
        <Card>
          <h2>Produkt</h2>
          <p><a href={project.url} target="_blank" rel="noreferrer">{project.url} ↗</a></p>
          {analysis?.brief ? <p><strong>{analysis.brief.oneLiner}</strong></p> : <p className="mp-muted">Brief, Personas und Attention Map erscheinen hier nach der Analyse.</p>}
          <div className="mp-inline">
            {analysis?.run && <Pill kind={analysis.run.status === "done" ? "done" : analysis.run.status === "running" ? "progress" : "review"}>Analyse {analysis.run.status === "done" ? "abgeschlossen" : analysis.run.status === "running" ? "läuft" : "fehlgeschlagen"}</Pill>}
            {v.setup.planVersion && <Pill kind="done">Plan v{v.setup.planVersion}</Pill>}
            <Link to={`/projects/${id}/analysis`} className="mp-btn">{analysis?.run ? "Zur Analyse" : "Analyse starten"}</Link>
            <Link to={`/projects/${id}/strategy`} className="mp-btn">Strategie</Link>
          </div>
        </Card>
        <div id="profile"><ProfilesCard projectId={id} /></div>
      </div>
      <div id="produktdaten"><ProductDataCard projectId={id} /></div>
    </>
  );
}
