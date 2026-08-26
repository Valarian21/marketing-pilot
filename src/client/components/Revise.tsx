/** "Ändere …" box: one instruction, the agent revises the piece (text) or the script + re-render (video). */
import { useState } from "react";
import type { ContentPiece, Job } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Notice } from "./ui.js";

export const fmtUsd = (v: number): string => (v >= 1 ? `${v.toFixed(2)} $` : v > 0 ? `${v.toFixed(3)} $` : "0 $");

export function ReviseBox({ piece, onDone }: { piece: ContentPiece; onDone: () => void | Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isVideo = piece.format === "video";
  const submit = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api<{ changed: string; job: Job | null; needsRecording: boolean }>(`/content/${piece.id}/revise`, { method: "POST", json: { instruction: text } });
      setMsg(`${r.changed}${isVideo ? (r.job ? (r.needsRecording ? " – wird neu aufgenommen und gerendert." : " – wird ohne neue Aufnahme neu gerendert.") : " – Skript geändert; Render bitte manuell starten (Worker nicht aktiv oder Job läuft).") : ""}`);
      setText(""); await onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  return (
    <div className="mp-revise">
      <label className="mp-field"><span>Änderungswunsch an den Agenten</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={isVideo ? "z. B. „Sekunde 12–20 ist falsch: nimm die Szene neu auf und zeige dabei das fertige Arbeitsblatt“ oder „Untertitel in Szene 2 kürzer“" : "z. B. „Kürzer, ohne den zweiten Absatz, und am Ende eine konkrete Zahl“"} disabled={busy || piece.status === "published"} />
      </label>
      <div className="mp-form-actions"><Button variant="primary" disabled={busy || text.trim().length < 3 || piece.status === "published"} onClick={() => void submit()}>{busy ? "Agent arbeitet …" : "Anpassen lassen"}</Button><span className="mp-label">Kosten bisher {fmtUsd(piece.costUsd)}</span></div>
      {msg && <Notice kind="info">{msg}</Notice>}
      {err && <Notice kind="bad">{err}</Notice>}
      {Array.isArray(piece.meta["revisions"]) && (piece.meta["revisions"] as { at: string; instruction: string; changed: string }[]).length > 0 && (
        <details className="mp-details mp-small"><summary className="mp-label">Bisherige Änderungen ({(piece.meta["revisions"] as unknown[]).length})</summary>
          <ul className="mp-plain-list">{(piece.meta["revisions"] as { at: string; instruction: string; changed: string }[]).map((r, i) => <li key={i}><strong>{r.instruction}</strong><div className="mp-muted">{r.changed} · {new Date(r.at).toLocaleString("de-DE")}</div></li>)}</ul>
        </details>
      )}
    </div>
  );
}
