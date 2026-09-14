/**
 * Freigaben: die Übersicht ist die Seite.
 *
 * Alle offenen Beiträge als Kacheln — Vorschau links, fertiger Text rechts,
 * App-Fassungen als Reiter, Freigeben und Ablehnen direkt daran. Die
 * Einzelansicht (Text bearbeiten, Bündel steuern, neu erzeugen) gibt es nur
 * noch für ein bestimmtes Stück (`?piece=`), erreichbar über „Öffnen" und die
 * Links aus Pipeline, Mediathek und Startseite. Bis zum 14.09.2026 waren beide
 * gleichrangige Modi mit einem Umschalter, und die Einzelansicht war der
 * Standard — zehn fertige Reels durchzuwinken hieß zehn Seiten.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ContentPiece } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, fmtDateTime, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { markdownToHtml } from "../../shared/markdown.js";
import { VideoGallery } from "./Video.js";
import { bundleIdOf } from "./Studio.js";
import { ShotGallery } from "../components/Lightbox.js";
import { ReviseBox, fmtUsd } from "../components/Revise.js";
import { useProfiles } from "../components/ChannelLink.js";
import { STAGES, stageAtLeast } from "../../shared/channels.js";
import { Themen, type ThemenStueck } from "../components/Themen.js";

/**
 * Kurzes Format-Etikett vor dem Titel in der Schlange. Ohne das war ein Reel
 * von einem Carousel nicht zu unterscheiden — die Titel sind dieselben.
 */

const STATUS: Record<ContentPiece["status"], { label: string; kind: PillKind }> = { draft: { label: "Entwurf", kind: "todo" }, review: { label: "in Freigabe", kind: "review" }, approved: { label: "freigegeben", kind: "done" }, published: { label: "veröffentlicht", kind: "done" }, rejected: { label: "abgelehnt", kind: "kind" } };

export function ReviewPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<ContentPiece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offeneMedien, setOffeneMedien] = useState<ThemenStueck[] | null>(null);

  /**
   * Geladen wird, was zur Prüfung ansteht — nicht das ganze Archiv.
   *
   * Vorher holte diese Seite alle Stücke des Projekts (2,4 MB, 3,5 s) und
   * suchte im Browser die sechs offenen heraus. „Alle anzeigen" lädt den Rest
   * nach, und ein per Adresse angesteuertes Stück (`?piece=`) wird einzeln
   * geholt, falls es nicht in der Warteschlange steht.
   */
  const load = useCallback(async () => {
    try {
      const offene = await api<ContentPiece[]>(`/projects/${id}/content?status=review`);
      setPieces((vorher) => {
        const behalten = vorher.filter((p) => p.status !== "review" && !offene.some((o) => o.id === p.id));
        return [...offene, ...behalten];
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  /**
   * Die Übersicht holt dieselben Stücke über die Mediathek-Schnittstelle: Dort
   * hängen Vorschaubild, Videodatei und Gruppenschlüssel schon dran, und genau
   * die braucht die Kachel.
   */
  const ladeUebersicht = useCallback(async () => {
    try {
      /**
       * Geladen werden **alle** Fassungen des Projekts, nicht nur die offenen.
       * Sonst verschwindet eine bereits freigegebene App-Fassung aus ihrer
       * Kachel, und das Thema steht mit einem einzigen Reiter da — es sieht
       * aus, als fehlten Medien. Gezeigt werden dann nur Themen, in denen noch
       * etwas auf Freigabe wartet.
       */
      const alle = await api<ThemenStueck[]>(`/media?projectId=${id}&limit=400`);
      const offeneGruppen = new Set(alle.filter((m) => m.status === "review").map((m) => m.gruppe));
      setOffeneMedien(alle.filter((m) => offeneGruppen.has(m.gruppe)));
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void ladeUebersicht(); }, [ladeUebersicht]);

  /** Ein Thema freigeben — ohne Umweg über die Einzelansicht. Auf Kanälen ab „Freigeben“ plant der Server dabei ein. */
  const freigeben = async (stuecke: ThemenStueck[]) => {
    setBusy(true);
    try {
      for (const st of stuecke) await api(`/content/${st.id}`, { method: "PATCH", json: { status: "approved" } });
      await Promise.all([load(), ladeUebersicht()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  /** Ein Thema ablehnen — ein Grund für alle Fassungen, wird protokolliert. */
  const ablehnen = async (stuecke: ThemenStueck[]) => {
    const reason = window.prompt(stuecke.length > 1 ? `Grund der Ablehnung für alle ${stuecke.length} Fassungen (wird protokolliert):` : "Grund der Ablehnung (wird protokolliert):");
    if (!reason) return;
    setBusy(true);
    try {
      for (const st of stuecke) await api(`/content/${st.id}`, { method: "PATCH", json: { status: "rejected", reason } });
      await Promise.all([load(), ladeUebersicht()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  // Die Stufe des Kanals entscheidet, was „Freigeben" hier heißt: selbst posten oder einplanen lassen.
  const profiles = useProfiles(id);
  const stageFor = (p: ContentPiece) => profiles.find((x) => x.platform === String(p.meta["platform"] ?? p.channel).toLowerCase())?.stage ?? "off";

  // Ein Bündel (Shot 7) steht als ein Eintrag in der Warteschlange: vier Plattform-
  // Stücke aus einem Lauf sind eine Entscheidung, nicht vier.
  const queue = useMemo(() => {
    const seen = new Set<string>();
    return pieces.filter((p) => p.status === "review").filter((p) => {
      const b = bundleIdOf(p);
      if (!b) return true;
      if (seen.has(b)) return false;
      seen.add(b);
      return true;
    });
  }, [pieces]);
  // Gezählt werden Themen (ein Reel = drei App-Fassungen), nicht Fassungen —
  // die Kopfzeile sagte „59 Themen", als es 21 Themen mit 59 Fassungen waren.
  const offeneThemen = offeneMedien ? new Set(offeneMedien.filter((m) => m.status === "review").map((m) => m.gruppe)).size : queue.length;
  const focusId = params.get("piece");
  // Ohne `?piece=` gibt es keine Einzelansicht — die Übersicht ist die Seite.
  const current = focusId ? pieces.find((p) => p.id === focusId) ?? null : null;

  // Ein Stück, das über die Adresse angesteuert wurde (aus Medien, Speicher,
  // einer Aufgabe), steht nicht zwingend in der Warteschlange — dann einzeln holen.
  useEffect(() => {
    if (!focusId || pieces.some((p) => p.id === focusId)) return;
    api<ContentPiece>(`/content/${focusId}`).then((p) => setPieces((v) => v.some((x) => x.id === p.id) ? v : [...v, p])).catch(() => undefined);
  }, [focusId, pieces]);
  const bundleId = current ? bundleIdOf(current) : null;
  // Die Geschwister eines Bündels können bereits einen anderen Status haben
  // (teilweise freigegeben) und fehlen dann in der schlanken Liste.
  useEffect(() => {
    if (!bundleId) return;
    api<ContentPiece[]>(`/content/${bundleId}/bundle`).then((gruppe) => setPieces((v) => [...v, ...gruppe.filter((g) => !v.some((x) => x.id === g.id))])).catch(() => undefined);
  }, [bundleId]);

  const siblings = useMemo(() => (bundleId ? pieces.filter((p) => bundleIdOf(p) === bundleId).sort((a, b) => (a.id === bundleId ? -1 : b.id === bundleId ? 1 : a.channel.localeCompare(b.channel))) : []), [pieces, bundleId]);
  const idx = current ? queue.findIndex((p) => p.id === current.id || (bundleId !== null && bundleIdOf(p) === bundleId)) : -1;
  useEffect(() => setDraft(null), [current?.id]);

  const go = (p: ContentPiece | undefined) => { if (p) setParams({ piece: p.id }); else setParams({}); };
  const zurueck = () => setParams({});
  const act = async (status: ContentPiece["status"] | "regenerate", thenPackage = false) => {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      if (status === "regenerate") {
        const hint = window.prompt("Hinweis für die Neu-Generierung (was soll anders werden?):") ?? "";
        await api(`/content/${current.id}/regenerate`, { method: "POST", json: { hint } });
      } else {
        const reason = status === "rejected" ? window.prompt("Grund der Ablehnung (wird protokolliert):") : undefined;
        if (status === "rejected" && !reason) return;
        await api(`/content/${current.id}`, { method: "PATCH", json: { status, ...(reason ? { reason } : {}), ...(draft !== null && draft !== current.body ? { body: draft } : {}) } });
      }
      await load();
      if (status === "approved" && thenPackage) { void navigate(`/projects/${id}/publish/${current.id}`); return; }
      if (status === "approved" || status === "rejected") go(queue[idx + 1] ?? queue.find((p) => p.id !== current.id && bundleIdOf(p) !== bundleId));
      void ladeUebersicht();
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };
  /** Ein Klick fuer das ganze Buendel - serverseitig ein Audit-Eintrag statt vier. */
  const actBundle = async (status: "approved" | "rejected") => {
    if (!current || !bundleId) return;
    const reason = status === "rejected" ? window.prompt(`Grund der Ablehnung für alle ${siblings.length} Stücke (wird protokolliert):`) : "";
    if (status === "rejected" && !reason) return;
    setBusy(true); setError(null);
    try {
      await api(`/content/${current.id}/bundle/status`, { method: "POST", json: { status, reason: reason ?? "" } });
      await load(); void ladeUebersicht();
      go(queue.find((p) => bundleIdOf(p) !== bundleId && p.id !== current.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };
  /**
   * Das ganze Bündel freigeben und alles einplanen, was einen Zeitplan hat.
   *
   * Vier Varianten eines Themas sind **eine** Entscheidung. Vorher brauchte es
   * dafür zwei Schritte: erst „Alle freigeben", dann jedes Stück einzeln
   * einplanen — und wer den zweiten vergaß, hatte vier Stücke ohne Termin.
   */
  const bundleFreigebenUndEinplanen = async () => {
    if (!current || !bundleId) return;
    setBusy(true); setError(null);
    try {
      if (draft !== null && draft !== current.body) await api(`/content/${current.id}`, { method: "PATCH", json: { body: draft } });
      await api(`/content/${current.id}/bundle/status`, { method: "POST", json: { status: "approved", reason: "" } });
      const geplant: string[] = [];
      for (const p of siblings) {
        if (!stageAtLeast(stageFor(p), "approve")) continue;
        const res = await api<{ platform: string; scheduledAt: string }[]>(`/content/${p.id}/publish/schedule`, { method: "POST", json: { platforms: [], scheduledAt: undefined } }).catch(() => [] as { platform: string; scheduledAt: string }[]);
        for (const x of res) geplant.push(`${x.platform}: ${new Date(x.scheduledAt).toLocaleString("de-DE")}`);
      }
      window.alert(geplant.length ? `Eingeplant:\n${geplant.join("\n")}` : "Freigegeben. Kein Kanal steht auf „Freigeben“ — die Stücke stehen jetzt unter „Handarbeit“.");
      await load(); void ladeUebersicht();
      go(queue.find((p) => bundleIdOf(p) !== bundleId && p.id !== current.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };

  /** Freigeben und gleich in den nächsten Slot des Kanals legen (Shot 10). */
  const approveAndSchedule = async () => {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      await api(`/content/${current.id}`, { method: "PATCH", json: { status: "approved", ...(draft !== null && draft !== current.body ? { body: draft } : {}) } });
      const planned = await api<{ platform: string; scheduledAt: string }[]>(`/content/${current.id}/publish/schedule`, { method: "POST", json: { platforms: [], scheduledAt: undefined } });
      window.alert(planned.map((p) => `${p.platform}: ${new Date(p.scheduledAt).toLocaleString("de-DE")}`).join("\n"));
      await load(); void ladeUebersicht();
      go(queue[idx + 1] ?? queue.find((p) => p.id !== current.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };
  const saveText = async () => { if (!current || draft === null) return; setBusy(true); try { await api(`/content/${current.id}`, { method: "PATCH", json: { body: draft } }); await load(); } finally { setBusy(false); } };

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Inhalte" title={current ? "Freigabe im Einzelnen" : "Freigaben"} actions={
        <div className="mp-inline">
          <span className="mp-label">{offeneThemen} {offeneThemen === 1 ? "Thema" : "Themen"} · {queue.length} {queue.length === 1 ? "Stück wartet" : "Stücke warten"}</span>
          {current && <Button onClick={zurueck}>← Zur Übersicht</Button>}
          {current && idx >= 0 && <Button disabled={!queue[idx + 1]} onClick={() => go(queue[idx + 1])}>Nächstes →</Button>}
        </div>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {!current && focusId && <Notice kind="info">Dieses Stück wird geladen oder ist nicht mehr vorhanden.</Notice>}
      {!current && offeneMedien && offeneMedien.length === 0 && (
        <Card className="mp-empty"><h2>Nichts zu prüfen</h2><p>Hier stehen alle Beiträge, die auf Freigabe warten — aus „Erstellen“, aus Serien und aus den Reel-Skripten.</p><Link className="mp-btn mp-btn--primary" to={`/projects/${id}/studio`}>Zum Erstellen</Link></Card>
      )}
      {!current && offeneMedien && offeneMedien.length > 0 && (
        <Themen items={offeneMedien} busy={busy}
                linkFor={(st) => `/projects/${st.projectId}/review?piece=${st.id}`}
                aufFreigabe={(stuecke) => void freigeben(stuecke)}
                aufAblehnung={(stuecke) => void ablehnen(stuecke)}
                aufSammelFreigabe={(stuecke) => void freigeben(stuecke)} />
      )}
      {current && (
        <div className="mp-review mp-review--einzeln">
          <Card className="mp-review-main">
            <div className="mp-card-head">
              <div>
                <div className="mp-label">{current.format} · {current.channel || "–"}{current.aiTellScore !== null && <> · AI-Tell {current.aiTellScore}/10</>} · Kosten {fmtUsd(current.costUsd)}</div>
                <h2>{current.title || "(ohne Titel)"}</h2>
                <div className="mp-small mp-muted">Erstellt {fmtDateTime(current.createdAt)} · Zuletzt bearbeitet {fmtDateTime(current.updatedAt)}{typeof current.meta["renderedAt"] === "string" && <> · Zuletzt gerendert {fmtDateTime(current.meta["renderedAt"] as string)}</>}</div>
              </div>
              <div className="mp-inline">
                <Pill kind={STATUS[current.status].kind}>{STATUS[current.status].label}</Pill>
                {current.humanEdited && <Pill kind="review">von dir bearbeitet</Pill>}
                {idx >= 0 && <span className="mp-label">Stück {idx + 1} von {queue.length}</span>}
              </div>
            </div>
            {siblings.length > 1 && (
              <nav className="mp-subnav" aria-label="Plattformen im Bündel">
                {siblings.map((p) => <button key={p.id} type="button" className={`mp-subnav-item mp-linkbtn${p.id === current.id ? " is-active" : ""}`} onClick={() => go(p)}>{p.channel}{p.format === "story" && " · Story"}{p.status !== "review" && ` · ${STATUS[p.status].label}`}</button>)}
              </nav>
            )}
            <Preview piece={current} text={draft ?? current.body} />
            {current.format === "video" ? (
              <details className="mp-details mp-small"><summary className="mp-label">Skript als Text (bearbeiten in der <Link to={`/projects/${id}/studio/video?piece=${current.id}`}>Video-Fabrik</Link>)</summary><pre className="mp-pre">{current.body}</pre></details>
            ) : (
              <label className="mp-field"><span>Text (Änderungen setzen „von dir bearbeitet“)</span>
                <textarea className="mp-piece-body" rows={Math.min(28, Math.max(6, (draft ?? current.body).split("\n").length + 2))} value={draft ?? current.body} onChange={(e) => setDraft(e.target.value)} disabled={current.status === "published"} />
              </label>
            )}
            {/* Zwei Wege sichtbar, der Rest ausklappbar: vorher standen hier bis
                zu sechs gleichrangige Knöpfe, und keiner war der offensichtliche. */}
            <div className="mp-form-actions mp-review-actions">
              {current.status === "review" && (siblings.length > 1 ? (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => void bundleFreigebenUndEinplanen()}>Alle {siblings.length} freigeben &amp; einplanen</Button>
                  <Button variant="danger" disabled={busy} onClick={() => void actBundle("rejected")}>Alle ablehnen</Button>
                  <details className="mp-details mp-small">
                    <summary className="mp-label">Nur dieses Stück</summary>
                    <div className="mp-form-actions">
                      {stageAtLeast(stageFor(current), "approve") && <Button disabled={busy} onClick={() => void approveAndSchedule()}>Freigeben &amp; einplanen</Button>}
                      <Button disabled={busy} onClick={() => void act("approved", true)}>Freigeben &amp; selbst posten</Button>
                      <Button disabled={busy} onClick={() => void act("approved")}>Nur freigeben</Button>
                      <Button disabled={busy} onClick={() => void actBundle("approved")}>Alle freigeben, nicht einplanen</Button>
                      <Button variant="danger" disabled={busy} onClick={() => void act("rejected")}>Dieses ablehnen</Button>
                    </div>
                  </details>
                </>
              ) : (
                <>
                  {stageAtLeast(stageFor(current), "approve")
                    ? <Button variant="primary" disabled={busy} title={`Kanal auf „${STAGES[stageFor(current)].label}“: der Pilot postet zum nächsten Slot`} onClick={() => void approveAndSchedule()}>Freigeben &amp; einplanen</Button>
                    : <Button variant="primary" disabled={busy} title="Kanal auf „Vorbereiten“: du postest selbst — das Paket hat Text, Dateien und den Link zur Plattform" onClick={() => void act("approved", true)}>Freigeben &amp; posten</Button>}
                  <Button variant="danger" disabled={busy} onClick={() => void act("rejected")}>Ablehnen</Button>
                  <details className="mp-details mp-small">
                    <summary className="mp-label">Weitere Wege</summary>
                    <div className="mp-form-actions">
                      {stageAtLeast(stageFor(current), "approve") && <Button disabled={busy} onClick={() => void act("approved", true)}>Freigeben &amp; selbst posten</Button>}
                      <Button disabled={busy} onClick={() => void act("approved")}>Nur freigeben</Button>
                      <Button disabled={busy} onClick={() => void act("regenerate")}>Neu erzeugen</Button>
                    </div>
                  </details>
                </>
              ))}
              {current.status !== "review" && (
                <>
                  <Link className="mp-btn mp-btn--primary" to={`/projects/${id}/publish/${current.id}`}>Paket öffnen</Link>
                  {draft !== null && draft !== current.body && <Button disabled={busy} onClick={() => void saveText()}>Text speichern</Button>}
                </>
              )}
              {current.status === "review" && draft !== null && draft !== current.body && <Button disabled={busy} onClick={() => void saveText()}>Text speichern</Button>}
            </div>
            <ReviseBox piece={current} onDone={load} />
            {current.aiTellNotes && <details className="mp-details mp-small"><summary className="mp-label">{current.format === "video" ? "Render-Hinweise" : "AI-Tell-Prüfer"}</summary><pre className="mp-pre">{current.aiTellNotes}</pre></details>}
            {current.rejectionReason && <Notice kind="warn">Abgelehnt: {current.rejectionReason}</Notice>}
          </Card>
        </div>
      )}
    </>
  );
}

/** Preview roughly the way the platform shows it. */
function Preview({ piece, text }: { piece: ContentPiece; text: string }) {
  const platform = String(piece.meta["platform"] ?? piece.channel).toLowerCase();
  if (piece.format === "data_reel") {
    const cards = Array.isArray(piece.meta["cards"]) ? (piece.meta["cards"] as { rank: number; name: string; priceEur: number }[]) : [];
    const plan = piece.meta["reelPlan"] as { secondsPerCard: number; dropped: string[]; totalMs: number } | undefined;
    return (
      <div className="mp-preview">
        <VideoGallery piece={piece} />
        <p className="mp-small mp-muted">
          {String(piece.meta["scopeLabel"] ?? "")} · {cards.length} Karten
          {plan && <> · {(plan.totalMs / 1000).toFixed(0)} s, {plan.secondsPerCard.toFixed(1)} s je Karte{plan.dropped.length > 0 && ` (${plan.dropped.length} gekappt)`}</>}
          {" · "}{String(piece.meta["footer"] ?? "")}
        </p>
        <div className="mp-post"><p>{text}</p></div>
      </div>
    );
  }
  /**
   * Kunstseiten-Reel: die MP4 aus dem Paket, darunter Seite und echte Karten.
   * Ohne diesen Zweig fiel das Stück auf die Text-Vorschau zurück — das Reel
   * stand in der Schlange und war doch unsichtbar.
   */
  if (piece.format === "artwork_reel") {
    const art = (piece.meta["artwork"] ?? {}) as { titel?: string; stil?: string; karten?: { name: string }[]; bildFaecher?: number; gesamtFaecher?: number };
    const segs = Array.isArray(piece.meta["reelSegments"]) ? (piece.meta["reelSegments"] as { ms: number }[]) : [];
    const sek = segs.reduce((n, x) => n + x.ms, 0) / 1000;
    return (
      <div className="mp-preview">
        <VideoGallery piece={piece} />
        <p className="mp-small mp-muted">
          Kunstseite „{art.titel ?? String(piece.meta["scopeLabel"] ?? "")}“ · Stil {art.stil ?? "–"} · {(art.karten ?? []).map((k) => k.name).filter(Boolean).join(", ") || "–"} echt
          {sek > 0 && <> · {sek.toFixed(1)} s, {segs.length} Slides</>}
        </p>
        <div className="mp-post"><p>{text}</p></div>
      </div>
    );
  }
  if (piece.format === "artwork_carousel") {
    const art = (piece.meta["artwork"] ?? {}) as { titel?: string; stil?: string; karten?: { name: string }[] };
    const karten = (art.karten ?? []).map((k) => k.name);
    // Reihenfolge wie gerendert: Deckseite, je echte Karte, Auflösung, Schritte, Abschluss.
    const label = (i: number, n: number) => i === 0 ? "Deckseite" : i === n - 1 ? "Abschluss" : i === n - 2 ? "So entsteht sie" : i === n - 3 ? "Verbunden" : `Echt: ${karten[i - 1] ?? `Karte ${i}`}`;
    return (
      <div className="mp-preview">
        <ShotGallery shots={piece.assets.map((a, i) => ({ id: a, url: `/api/mp/assets/${a}/file`, label: label(i, piece.assets.length) }))} />
        <p className="mp-small mp-muted">Kunstseite „{art.titel ?? ""}“ · Stil {art.stil ?? "–"} · {String(piece.meta["size"] ?? "")} · {String(piece.meta["footer"] ?? "")}</p>
        <div className="mp-post"><p>{text}</p></div>
      </div>
    );
  }
  if (piece.format === "data_carousel") {
    // Alle Slides dieses Stuecks haben dieselbe Groesse - die Plattform bestimmt sie.
    const cards = Array.isArray(piece.meta["cards"]) ? (piece.meta["cards"] as { rank: number; name: string; setName: string; localId: string; priceEur: number }[]) : [];
    return (
      <div className="mp-preview">
        <ShotGallery shots={dataSlides(piece, cards)} />
        <p className="mp-small mp-muted">{String(piece.meta["scopeLabel"] ?? "")} · {String(piece.meta["size"] ?? "")} · {cards.length} Karten · {String(piece.meta["footer"] ?? "")}</p>
        {cards.length > 0 && (
          <details className="mp-details mp-small"><summary className="mp-label">Zahlen der Rangliste (kommen so aus den Produktdaten)</summary>
            <table className="mp-table"><tbody>{cards.map((c) => (
              <tr key={c.rank}><td className="mp-nowrap mp-muted">{c.rank}</td><td>{c.name}</td><td className="mp-muted">{c.setName} {c.localId}</td>
                <td className="mp-num-cell">{c.priceEur.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td></tr>))}
            </tbody></table>
          </details>
        )}
        <div className="mp-post"><p>{text}</p></div>
      </div>
    );
  }
  if (piece.format === "carousel" || piece.format === "pin" || piece.format === "image" || piece.format === "ad_creative" || piece.format === "directory_entry") {
    const sizes = piece.format === "carousel" ? ["1080x1080"] : null;
    return (
      <div className="mp-preview">
        <ShotGallery shots={(piece.format === "carousel" ? piece.assets.slice(0, Math.ceil(piece.assets.length / 2)) : piece.assets).map((a, i) => ({ id: a, url: `/api/mp/assets/${a}/file`, label: piece.format === "carousel" ? `Slide ${i + 1}` : "" }))} />
        {sizes && <p className="mp-small mp-muted">Beide Größen (1080×1080, 1080×1350) liegen im Publish-Paket.</p>}
        {piece.format === "carousel" && <div className="mp-post"><p>{String(piece.meta["caption"] ?? "")}</p></div>}
      </div>
    );
  }
  if (piece.format === "story") {
    return (
      <div className="mp-preview">
        <ShotGallery shots={piece.assets.map((a) => ({ id: a, url: `/api/mp/assets/${a}/file`, label: "Story 1080×1920" }))} />
        <p className="mp-small mp-muted">
          24 Stunden sichtbar · {String(piece.meta["storyHint"] ?? "")}
          {" · "}Sticker und antippbare Links gibt die API nicht her — der Hinweis steht im Bild.
        </p>
      </div>
    );
  }
  if (piece.format === "video") {
    return <div className="mp-preview"><VideoGallery piece={piece} /><p className="mp-small mp-muted">Skript und Varianten: <Link to={`/projects/${piece.projectId}/studio/video?piece=${piece.id}`}>Video-Fabrik</Link></p></div>;
  }
  if (piece.format === "article") {
    return <div className="mp-preview mp-article" dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }} />;
  }
  const limit = Number(piece.meta["limit"] ?? 0);
  return (
    <div className={`mp-preview mp-post mp-post--${platform}`}>
      <div className="mp-post-head"><span className="mp-avatar" /><div><strong>Du</strong><div className="mp-small mp-muted">{platform} · jetzt</div></div></div>
      <p className="mp-post-text">{text}</p>
      {limit > 0 && <div className={`mp-small ${text.length > limit ? "mp-over" : "mp-muted"}`}>{text.length}/{limit} Zeichen</div>}
    </div>
  );
}

/**
 * Die Slides eines Daten-Stücks mit sprechenden Beschriftungen: die Reihenfolge
 * ist immer Cover, Karten in Anzeigereihenfolge, CTA — so wie sie gerendert wurde.
 */
function dataSlides(piece: ContentPiece, cards: { rank: number; name: string }[]): { id: string; url: string; label: string }[] {
  const countdown = (piece.meta["dataQuery"] as { countdown?: boolean } | undefined)?.countdown !== false;
  const order = countdown ? [...cards].reverse() : cards;
  return piece.assets.map((a, i) => {
    const card = order[i - 1];
    const label = i === 0 ? "Cover" : i === piece.assets.length - 1 ? "Abschluss" : card ? `Platz ${card.rank} · ${card.name}` : `Slide ${i}`;
    return { id: a, url: `/api/mp/assets/${a}/file`, label };
  });
}
