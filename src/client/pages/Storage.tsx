/** Storage: free disk, what the tool created (per project/piece), delete intermediates, recordings or everything of a piece. */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, Stat } from "../components/ui.js";

interface StorageFile { path: string; bytes: number; kind: string; assetId: string | null; mtime: string }
interface StoragePiece { pieceId: string; title: string; format: string; status: string; bytes: number; files: StorageFile[] }
interface StorageProject { projectId: string; name: string; bytes: number; pieces: StoragePiece[]; otherBytes: number }
interface StorageView { disk: { totalBytes: number; freeBytes: number; usedBytes: number; path: string }; dataDirBytes: number; dbBytes: number; projects: StorageProject[]; orphanBytes: number }

const FORMAT_LABEL: Record<string, string> = { text: "Text", carousel: "Carousel", pin: "Pin", image: "Bild", directory_entry: "Verzeichnis", article: "Artikel", video: "Video" };
export const fmtBytes = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);

export function StoragePage() {
  const [view, setView] = useState<StorageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { try { setView(await api<StorageView>("/storage")); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(label); setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(null); } };
  const del = (piece: StoragePiece, scope: "intermediates" | "recordings" | "all") => {
    const what = scope === "all" ? "ALLE Dateien (auch fertige Videos)" : scope === "recordings" ? "Aufnahmen + Zwischendateien (fertige Videos bleiben)" : "Zwischendateien";
    if (!window.confirm(`„${piece.title}“: ${what} löschen?`)) return;
    void run(piece.pieceId + scope, () => api(`/storage/pieces/${piece.pieceId}?scope=${scope}`, { method: "DELETE" }));
  };

  if (!view) return <>{error && <Notice kind="bad">{error}</Notice>}</>;
  const pct = Math.round((view.disk.usedBytes / view.disk.totalBytes) * 100);
  return (
    <>
      <PageHeader label="Betrieb" title="Speicher" actions={<div className="mp-inline"><Button disabled={busy !== null} onClick={() => void run("cleanup", () => api("/storage/cleanup", { method: "POST", json: { scope: "intermediates" } }))}>Alle Zwischendateien löschen</Button><Button disabled={busy !== null} onClick={() => void run("orphans", () => api("/storage/cleanup", { method: "POST", json: { scope: "orphans" } }))}>Verwaiste Ordner löschen</Button></div>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {pct >= 85 && <Notice kind="bad">Die Platte ist zu {pct} % voll – Zwischendateien und alte Aufnahmen löschen.</Notice>}
      <div className="mp-stats mp-stats--4 mp-stats--tiles">
        <Stat label="Frei auf der Platte" value={fmtBytes(view.disk.freeBytes)} highlight />
        <Stat label="Belegt gesamt" value={`${fmtBytes(view.disk.usedBytes)} · ${pct} %`} />
        <Stat label="Marketing Pilot (data/)" value={fmtBytes(view.dataDirBytes)} />
        <Stat label="Datenbank" value={fmtBytes(view.dbBytes)} />
      </div>
      <Card className="mp-form-card"><div className="mp-progress mp-progress--wide" title={`${pct} % belegt`}><div className="mp-progress-bar" style={{ width: `${pct}%` }} /></div><p className="mp-small mp-muted">Zwischendateien (Szenen-Segmente, Overlays) werden nach jedem Render automatisch entfernt; Aufnahmen (.webm) bleiben, damit „nur Text ändern“ ohne neue Aufnahme geht. Fertige Videos und Bilder bleiben, bis du sie hier löschst.{view.orphanBytes > 0 && ` Verwaiste Ordner: ${fmtBytes(view.orphanBytes)}.`}</p></Card>
      {view.projects.map((p) => (
        <Card key={p.projectId}>
          <div className="mp-card-head"><h2>{p.name} <span className="mp-muted mp-small">{fmtBytes(p.bytes)}</span></h2><span className="mp-label">{p.pieces.length} Stücke mit Dateien · Sonstiges (Crawl, Brand) {fmtBytes(p.otherBytes)}</span></div>
          {p.pieces.length === 0 ? <p className="mp-muted">Keine Video-/Bilddateien.</p> : (
            <div className="mp-table-wrap"><table className="mp-table">
              <thead><tr><th>Stück</th><th>Format</th><th>Status</th><th>Größe</th><th></th></tr></thead>
              <tbody>{p.pieces.map((pc) => (
                <>
                  <tr key={pc.pieceId}>
                    <td><button type="button" className="mp-linkbtn" onClick={() => setOpen(open === pc.pieceId ? null : pc.pieceId)}>{pc.title}</button> <Link className="mp-small" to={`/projects/${p.projectId}/review?piece=${pc.pieceId}`}>öffnen</Link></td>
                    <td><Pill kind="kind">{FORMAT_LABEL[pc.format] ?? pc.format}</Pill></td><td className="mp-small">{pc.status}</td>
                    <td className="mp-num-cell">{fmtBytes(pc.bytes)}</td>
                    <td className="mp-inline">{pc.format === "video" && <><Button disabled={busy !== null} onClick={() => del(pc, "intermediates")}>Zwischendateien</Button><Button disabled={busy !== null} onClick={() => del(pc, "recordings")}>Aufnahmen</Button></>}<Button variant="danger" disabled={busy !== null} onClick={() => del(pc, "all")}>Alles</Button></td>
                  </tr>
                  {open === pc.pieceId && <tr key={pc.pieceId + "-files"}><td colSpan={5}><ul className="mp-files">{pc.files.map((f) => <li key={f.path}><code className="mp-code">{f.path.split("/").slice(-1)[0]}</code> <span className="mp-label">{f.kind}</span> <span className="mp-num-cell">{fmtBytes(f.bytes)}</span>{f.assetId && <Button variant="danger" disabled={busy !== null} onClick={() => { if (window.confirm(`${f.path.split("/").slice(-1)[0]} löschen?`)) void run(f.assetId!, () => api(`/assets/${f.assetId}`, { method: "DELETE" })); }}>×</Button>}</li>)}</ul></td></tr>}
                </>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      ))}
    </>
  );
}
