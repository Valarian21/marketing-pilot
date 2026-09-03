/** „Heute": die Startseite des Content-Piloten. Drei Blöcke, je eine Aktion — freigeben, posten, erledigen —
 *  dazu der Stand der Kanäle. Produkt und Datenquelle stehen unten. Der Marketing-Teil (Leads, Strategie) ist ausgeblendet. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { AnalysisView, ContentPiece, Project, PublishView, Task, TodayView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, Stat, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ProfilesCard } from "../components/Profiles.js";
import { ProductDataCard } from "../components/ProductData.js";
import { ChannelTag } from "../components/ChannelLink.js";
import { PLATFORMS, STAGES, STAGE_ORDER, type ChannelStage } from "../../shared/channels.js";

const FORMAT_LABEL: Record<string, string> = { text: "Text-Post", carousel: "Carousel", pin: "Pin", image: "Bild", ad_creative: "Ad", article: "Artikel", directory_entry: "Verzeichnis", video: "Video", community_reply: "Antwort" };
const TYPE_LABEL: Record<Task["type"], string> = { research: "Recherche", strategy: "Strategie", content: "Content", publish: "Posten", community: "Community", ads: "Ads", measure: "Messen" , setup: "Einrichtung" };
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
  const [publish, setPublish] = useState<PublishView | null>(null);
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
    api<PublishView>(`/projects/${id}/publish`).then(setPublish).catch(() => undefined);
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
  const nothing = v.review.length + v.toPost.length + v.myTasks.length === 0;
  const channelsOn = publish?.board.filter((c) => c.stage !== "off") ?? [];
  const blocked = channelsOn.filter((c) => !c.ready);
  const setupHints: { text: string; to: string }[] = [];
  // Maßgeblich ist, ob der Brief nutzbar ist (so prüft es auch der Generator) — nicht das alte Bestätigungs-Flag.
  const briefOk = publish ? publish.setup.briefConfirmed : v.setup.briefConfirmed;
  if (!briefOk) setupHints.push({ text: "Produkt-Brief fehlt – Analyse ausführen und Brief bestätigen, sonst weiß der Pilot nicht, worüber er schreibt.", to: `/projects/${id}/analysis` });
  if (publish && channelsOn.length === 0) setupHints.push({ text: "Noch kein Kanal eingeschaltet – auf der Kanäle-Seite wählen, welche Plattformen bespielt werden und auf welcher Stufe.", to: `/projects/${id}/channels` });
  for (const c of blocked) setupHints.push({ text: `${c.label} steht auf „${STAGES[c.stage].label}“, läuft aber nicht: ${c.requirements.filter((r) => !r.ok && r.blocking).map((r) => r.label).join(", ")}.`, to: `/projects/${id}/channels` });
  if (!v.setup.voiceProfile && briefOk) setupHints.push({ text: "Kein Voice-Profil – Texte klingen generisch. 5–20 eigene Texte im Studio hinterlegen.", to: `/projects/${id}/studio?tab=brand` });
  // Stau statt Fehler: die Serie liefert schneller, als freigegeben wird.
  for (const st of v.seriesStuck) setupHints.push({ text: `Serie „${st.name}“: ${st.pending} Ausgaben liegen unfreigegeben – entweder freigeben oder die Kadenz senken.`, to: `/projects/${id}/series` });

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label={project.name} title="Heute" actions={publish && (
        <span className="mp-label mp-stage-summary">{channelsOn.length === 0 ? "Kein Kanal eingeschaltet" : STAGE_ORDER.filter((st) => st !== "off").map((st: ChannelStage) => <span key={st}><b className="mp-num">{channelsOn.filter((c) => c.stage === st).length}</b> {STAGES[st].label.toLowerCase()}</span>)}</span>
      )} />
      {error && <Notice kind="bad">{error}</Notice>}
      {nothing && <Card className="mp-empty"><h2>Nichts offen</h2><p>Keine Freigaben, nichts zu posten, nichts zu erledigen. {channelsOn.length === 0 ? <Link to={`/projects/${id}/channels`}>Kanäle einschalten</Link> : <Link to={`/projects/${id}/studio`}>Etwas erstellen</Link>} oder eine <Link to={`/projects/${id}/series`}>Serie</Link> anlegen, die von selbst liefert.</p></Card>}

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
          <div className="mp-card-head"><h2><span className="mp-today-no">3</span> Kanäle <span className="mp-today-count">{channelsOn.length}</span></h2><Link className="mp-btn" to={`/projects/${id}/channels`}>Einrichten</Link></div>
          {!publish ? null : channelsOn.length === 0 ? <p className="mp-muted mp-small">Noch kein Kanal eingeschaltet — dort wählst du, welche Plattformen bespielt werden und wie viel der Pilot von selbst tut.</p> : (
            <ul className="mp-today-list">{channelsOn.map((c) => (
              <li key={c.platform}><div className="mp-today-main"><span className="mp-today-title">{c.label}</span><span className="mp-small mp-muted">{STAGES[c.stage].label}{c.stats.waitingReview > 0 && <> · {c.stats.waitingReview} in Freigabe</>}{c.stats.queued > 0 && <> · {c.stats.queued} eingeplant</>}{c.stats.posted7d > 0 && <> · {c.stats.posted7d} gepostet (7 T)</>}</span></div><Pill kind={c.ready ? "done" : "review"}>{c.ready ? "läuft" : "fehlt etwas"}</Pill></li>
            ))}</ul>
          )}
        </Card>

        <Card className="mp-today-block">
          <div className="mp-card-head"><h2><span className="mp-today-no">4</span> Zu erledigen <span className="mp-today-count">{v.myTasks.length}</span></h2><Link className="mp-btn" to={`/projects/${id}/tasks`}>Alle</Link></div>
          {v.myTasks.length === 0 ? <p className="mp-muted mp-small">Nichts zu erledigen. Hier landen Post-Aufgaben aus Serien und gescheiterte automatische Beiträge.</p> : (
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

      {v.agentTasks.length > 0 && <Card className="mp-today-agent">
        <div className="mp-card-head"><h2>Der Agent kann jetzt <span className="mp-today-count">{v.agentTasks.length}</span></h2>{v.agentTasks.length > 1 && <Button variant="primary" disabled={busy !== null} onClick={() => void runAll(v.agentTasks)}>{busy === "all" ? "läuft …" : `Alle ${v.agentTasks.length} ausführen`}</Button>}</div>
        {v.agentTasks.length === 0 ? <p className="mp-muted mp-small">Keine offenen Agent-Aufgaben bis einschließlich dieser Woche.</p> : (
          <ul className="mp-today-list mp-today-list--compact">{v.agentTasks.map((t) => (
            <li key={t.id}><div className="mp-today-main"><span className="mp-today-title">{t.title}</span><span className="mp-small mp-muted">{TYPE_LABEL[t.type]}{t.channel && <> · <ChannelTag name={t.channel} projectId={id} className="" /></>} · Ergebnis landet in der Freigabe</span></div><Button disabled={busy !== null} onClick={() => void runOne(t)}>{busy === t.id ? "läuft …" : "Ausführen"}</Button></li>
          ))}</ul>
        )}
      </Card>}

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
        <Stat label="Kanäle an" value={channelsOn.length} highlight />
        <Stat label="Gepostet (7 T)" value={channelsOn.reduce((n, c) => n + c.stats.posted7d, 0)} />
      </div>
      <div className="mp-two-col">
        <Card>
          <h2>Produkt</h2>
          <p><a href={project.url} target="_blank" rel="noreferrer">{project.url} ↗</a></p>
          {analysis?.brief ? <p><strong>{analysis.brief.oneLiner}</strong></p> : <p className="mp-muted">Brief, Personas und Attention Map erscheinen hier nach der Analyse.</p>}
          <div className="mp-inline">
            {analysis?.run && <Pill kind={analysis.run.status === "done" ? "done" : analysis.run.status === "running" ? "progress" : "review"}>Analyse {analysis.run.status === "done" ? "abgeschlossen" : analysis.run.status === "running" ? "läuft" : "fehlgeschlagen"}</Pill>}
            <Link to={`/projects/${id}/analysis`} className="mp-btn">{analysis?.run ? "Produkt-Brief" : "Analyse starten"}</Link>
            <Link to={`/projects/${id}/studio?tab=brand`} className="mp-btn">Marke & Stimme</Link>
          </div>
        </Card>
        <div id="profile"><ProfilesCard projectId={id} /></div>
      </div>
      <div id="produktdaten"><ProductDataCard projectId={id} /></div>
    </>
  );
}
