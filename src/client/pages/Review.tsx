/** Review queue: one piece at a time, platform-style preview, inline edit, approve / reject / regenerate. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { ContentPiece } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { markdownToHtml } from "../../shared/markdown.js";

const STATUS: Record<ContentPiece["status"], { label: string; kind: PillKind }> = { draft: { label: "Entwurf", kind: "todo" }, review: { label: "in Freigabe", kind: "review" }, approved: { label: "freigegeben", kind: "done" }, published: { label: "veröffentlicht", kind: "done" }, rejected: { label: "abgelehnt", kind: "kind" } };

export function ReviewPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [pieces, setPieces] = useState<ContentPiece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => { try { setPieces(await api<ContentPiece[]>(`/projects/${id}/content`)); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  const queue = useMemo(() => pieces.filter((p) => p.status === "review"), [pieces]);
  const focusId = params.get("piece");
  const current = pieces.find((p) => p.id === focusId) ?? queue[0] ?? null;
  const idx = current ? queue.findIndex((p) => p.id === current.id) : -1;
  useEffect(() => setDraft(null), [current?.id]);

  const go = (p: ContentPiece | undefined) => { if (p) setParams({ piece: p.id }); else setParams({}); };
  const act = async (status: ContentPiece["status"] | "regenerate") => {
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
      if (status === "approved" || status === "rejected") go(queue[idx + 1] ?? queue.find((p) => p.id !== current.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };
  const saveText = async () => { if (!current || draft === null) return; setBusy(true); try { await api(`/content/${current.id}`, { method: "PATCH", json: { body: draft } }); await load(); } finally { setBusy(false); } };

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Stufe 3" title="Freigaben" actions={<span className="mp-label">{queue.length} in der Warteschlange</span>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {!current && <Card className="mp-empty"><h2>Nichts zu prüfen</h2><p>Entwürfe aus dem Content Studio und aus Agent-Aufgaben landen hier.</p><Link className="mp-btn mp-btn--primary" to={`/projects/${id}/studio`}>Zum Content Studio</Link></Card>}
      {current && (
        <div className="mp-review">
          <Card className="mp-review-main">
            <div className="mp-card-head">
              <div>
                <div className="mp-label">{current.format} · {current.channel || "–"}{current.aiTellScore !== null && <> · AI-Tell {current.aiTellScore}/10</>}</div>
                <h2>{current.title || "(ohne Titel)"}</h2>
              </div>
              <div className="mp-inline">
                <Pill kind={STATUS[current.status].kind}>{STATUS[current.status].label}</Pill>
                {current.humanEdited && <Pill kind="review">von dir bearbeitet</Pill>}
                {idx >= 0 && <span className="mp-label">{idx + 1}/{queue.length}</span>}
              </div>
            </div>
            <Preview piece={current} text={draft ?? current.body} />
            <label className="mp-field"><span>Text (Änderungen setzen „von dir bearbeitet“)</span>
              <textarea className="mp-piece-body" rows={Math.min(28, Math.max(6, (draft ?? current.body).split("\n").length + 2))} value={draft ?? current.body} onChange={(e) => setDraft(e.target.value)} disabled={current.status === "published"} />
            </label>
            <div className="mp-form-actions mp-review-actions">
              {current.status === "review" && <><Button variant="primary" disabled={busy} onClick={() => void act("approved")}>Freigeben</Button><Button variant="danger" disabled={busy} onClick={() => void act("rejected")}>Ablehnen</Button></>}
              {current.status !== "published" && <Button disabled={busy} onClick={() => void act("regenerate")}>{busy ? "…" : "Neu generieren"}</Button>}
              {draft !== null && draft !== current.body && current.status !== "published" && <Button disabled={busy} onClick={() => void saveText()}>Text speichern</Button>}
              {(current.status === "approved" || current.status === "published") && <Link className="mp-btn mp-btn--primary" to={`/projects/${id}/publish/${current.id}`}>Publish-Paket</Link>}
              {queue.length > 1 && <span className="mp-inline"><Button disabled={idx <= 0} onClick={() => go(queue[idx - 1])}>← zurück</Button><Button disabled={idx < 0 || idx >= queue.length - 1} onClick={() => go(queue[idx + 1])}>weiter →</Button></span>}
            </div>
            {current.aiTellNotes && <details className="mp-details mp-small"><summary className="mp-label">AI-Tell-Prüfer</summary><pre className="mp-pre">{current.aiTellNotes}</pre></details>}
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
  if (piece.format === "carousel" || piece.format === "pin" || piece.format === "image" || piece.format === "ad_creative" || piece.format === "directory_entry") {
    const sizes = piece.format === "carousel" ? ["1080x1080"] : null;
    return (
      <div className="mp-preview">
        <div className="mp-shots">{(piece.format === "carousel" ? piece.assets.slice(0, Math.ceil(piece.assets.length / 2)) : piece.assets).map((a) => <figure key={a} className="mp-shot"><img src={`/api/mp/assets/${a}/file`} alt="" loading="lazy" /></figure>)}</div>
        {sizes && <p className="mp-small mp-muted">Beide Größen (1080×1080, 1080×1350) liegen im Publish-Paket.</p>}
        {piece.format === "carousel" && <div className="mp-post"><p>{String(piece.meta["caption"] ?? "")}</p></div>}
      </div>
    );
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
