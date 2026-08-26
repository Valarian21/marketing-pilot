/** Minimal review list (Shot 2). Shot 3 turns this into the full queue with platform preview and publish package. */
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type { ContentPiece } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const STATUS: Record<ContentPiece["status"], { label: string; kind: PillKind }> = { draft: { label: "Entwurf", kind: "todo" }, review: { label: "in Freigabe", kind: "review" }, approved: { label: "freigegeben", kind: "done" }, published: { label: "veröffentlicht", kind: "done" }, rejected: { label: "abgelehnt", kind: "kind" } };

export function ReviewPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const focus = params.get("piece");
  const [pieces, setPieces] = useState<ContentPiece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(focus);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => { try { setPieces(await api<ContentPiece[]>(`/projects/${id}/content`)); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  const act = async (p: ContentPiece, status: ContentPiece["status"]) => {
    const reason = status === "rejected" ? window.prompt("Grund der Ablehnung (wird protokolliert):") ?? "" : undefined;
    if (status === "rejected" && reason === "") return;
    const body = drafts[p.id];
    try { await api(`/content/${p.id}`, { method: "PATCH", json: { status, ...(reason !== undefined ? { reason } : {}), ...(body !== undefined && body !== p.body ? { body } : {}) } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  };

  const queue = pieces.filter((p) => p.status === "review");
  const rest = pieces.filter((p) => p.status !== "review");
  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Stufe 3 (Vorstufe)" title="Freigaben" />
      {error && <Notice kind="bad">{error}</Notice>}
      {pieces.length === 0 && <Card className="mp-empty"><h2>Nichts zu prüfen</h2><p>Agent-Aufgaben mit „Jetzt ausführen“ legen ihre Entwürfe hier ab.</p></Card>}
      {[...queue, ...rest].map((p) => {
        const st = STATUS[p.status]; const isOpen = open === p.id;
        return (
          <Card key={p.id} className={isOpen ? "mp-piece is-open" : "mp-piece"}>
            <div className="mp-card-head">
              <button type="button" className="mp-linkbtn" onClick={() => setOpen(isOpen ? null : p.id)}><h2>{p.title || p.format}</h2></button>
              <div className="mp-inline"><Pill kind="kind">{p.format}</Pill>{p.channel && <span className="mp-label">{p.channel}</span>}<Pill kind={st.kind}>{st.label}</Pill>{p.humanEdited && <Pill kind="review">bearbeitet</Pill>}</div>
            </div>
            {isOpen && (
              <>
                <textarea className="mp-piece-body" rows={Math.min(30, Math.max(8, p.body.split("\n").length + 2))} value={drafts[p.id] ?? p.body} onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })} disabled={p.status === "published"} />
                <div className="mp-form-actions">
                  {p.status === "review" && <><Button variant="primary" onClick={() => void act(p, "approved")}>Freigeben</Button><Button variant="danger" onClick={() => void act(p, "rejected")}>Ablehnen</Button></>}
                  {p.status === "approved" && <Button variant="primary" onClick={() => void act(p, "published")}>Als veröffentlicht markieren</Button>}
                  {p.status !== "published" && drafts[p.id] !== undefined && drafts[p.id] !== p.body && <Button onClick={() => void act(p, p.status)}>Text speichern</Button>}
                </div>
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}
