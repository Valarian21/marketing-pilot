/** Review queue: one piece at a time, platform-style preview, inline edit, approve / reject / regenerate. */
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

const STATUS: Record<ContentPiece["status"], { label: string; kind: PillKind }> = { draft: { label: "Entwurf", kind: "todo" }, review: { label: "in Freigabe", kind: "review" }, approved: { label: "freigegeben", kind: "done" }, published: { label: "veröffentlicht", kind: "done" }, rejected: { label: "abgelehnt", kind: "kind" } };

export function ReviewPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<ContentPiece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => { try { setPieces(await api<ContentPiece[]>(`/projects/${id}/content`)); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [id]);
  useEffect(() => { void load(); }, [load]);

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
  const focusId = params.get("piece");
  const current = pieces.find((p) => p.id === focusId) ?? queue[0] ?? null;
  const bundleId = current ? bundleIdOf(current) : null;
  const siblings = useMemo(() => (bundleId ? pieces.filter((p) => bundleIdOf(p) === bundleId).sort((a, b) => (a.id === bundleId ? -1 : b.id === bundleId ? 1 : a.channel.localeCompare(b.channel))) : []), [pieces, bundleId]);
  const idx = current ? queue.findIndex((p) => p.id === current.id || (bundleId !== null && bundleIdOf(p) === bundleId)) : -1;
  useEffect(() => setDraft(null), [current?.id]);

  const go = (p: ContentPiece | undefined) => { if (p) setParams({ piece: p.id }); else setParams({}); };
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
      if (status === "approved" || status === "rejected") go(queue[idx + 1] ?? queue.find((p) => p.id !== current.id));
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
      await load();
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
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };
  const saveText = async () => { if (!current || draft === null) return; setBusy(true); try { await api(`/content/${current.id}`, { method: "PATCH", json: { body: draft } }); await load(); } finally { setBusy(false); } };

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Inhalte" title="Freigaben" actions={<span className="mp-label">{queue.length} in der Warteschlange</span>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {!current && <Card className="mp-empty"><h2>Nichts zu prüfen</h2><p>Entwürfe aus dem Content Studio und aus Agent-Aufgaben landen hier.</p><Link className="mp-btn mp-btn--primary" to={`/projects/${id}/studio`}>Zum Content Studio</Link></Card>}
      {current && (
        <div className="mp-review">
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
                {idx >= 0 && <span className="mp-label">{idx + 1}/{queue.length}</span>}
              </div>
            </div>
            {siblings.length > 1 && (
              <nav className="mp-subnav" aria-label="Plattformen im Bündel">
                {siblings.map((p) => <button key={p.id} type="button" className={`mp-subnav-item mp-linkbtn${p.id === current.id ? " is-active" : ""}`} onClick={() => go(p)}>{p.channel}{p.status !== "review" && ` · ${STATUS[p.status].label}`}</button>)}
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
            <div className="mp-form-actions mp-review-actions">
              {current.status === "review" && siblings.length > 1 && <><Button variant="primary" disabled={busy} onClick={() => void actBundle("approved")}>Alle {siblings.length} freigeben</Button><Button variant="danger" disabled={busy} onClick={() => void actBundle("rejected")}>Bündel ablehnen</Button></>}
              {current.status === "review" && <><Button variant="primary" disabled={busy} onClick={() => void act("approved", true)}>{siblings.length > 1 ? "Nur dieses freigeben & posten" : "Freigeben & posten"}</Button><Button disabled={busy} onClick={() => void act("approved")}>Nur freigeben</Button><Button disabled={busy} title="Freigeben und in den nächsten Slot dieses Kanals legen - der Pilot postet dann selbst" onClick={() => void approveAndSchedule()}>Freigeben &amp; einplanen</Button><Button variant="danger" disabled={busy} onClick={() => void act("rejected")}>Ablehnen</Button></>}
              {current.status !== "published" && <Button disabled={busy} onClick={() => void act("regenerate")}>{busy ? "…" : "Neu generieren"}</Button>}
              {draft !== null && draft !== current.body && current.status !== "published" && <Button disabled={busy} onClick={() => void saveText()}>Text speichern</Button>}
              {(current.status === "approved" || current.status === "published") && <Link className="mp-btn mp-btn--primary" to={`/projects/${id}/publish/${current.id}`}>Publish-Paket</Link>}
              {queue.length > 1 && <span className="mp-inline"><Button disabled={idx <= 0} onClick={() => go(queue[idx - 1])}>← zurück</Button><Button disabled={idx < 0 || idx >= queue.length - 1} onClick={() => go(queue[idx + 1])}>weiter →</Button></span>}
            </div>
            <ReviseBox piece={current} onDone={load} />
            {current.aiTellNotes && <details className="mp-details mp-small"><summary className="mp-label">{current.format === "video" ? "Render-Hinweise" : "AI-Tell-Prüfer"}</summary><pre className="mp-pre">{current.aiTellNotes}</pre></details>}
            {current.rejectionReason && <Notice kind="warn">Abgelehnt: {current.rejectionReason}</Notice>}
          </Card>
          <aside>
            <Card>
              <div className="mp-card-head"><h2>Warteschlange</h2><button type="button" className="mp-linkbtn mp-small" onClick={() => setShowAll((v) => !v)}>{showAll ? "nur offene" : "alle anzeigen"}</button></div>
              <ul className="mp-queue">{(showAll ? pieces : queue).map((p) => <li key={p.id} className={p.id === current.id ? "is-current" : ""}><button type="button" className="mp-linkbtn" onClick={() => go(p)}>{p.title || p.format}</button><Pill kind={STATUS[p.status].kind}>{STATUS[p.status].label}</Pill></li>)}</ul>
            </Card>
          </aside>
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
