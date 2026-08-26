import { useEffect, useState } from "react";
import type { AgentRun, AuditEntry } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Card, Notice, PageHeader, Pill, type PillKind } from "../components/ui.js";

const RUN_PILL: Record<AgentRun["status"], PillKind> = { running: "progress", done: "done", failed: "review" };
const fmt = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

export function ActivityPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<AgentRun[]>("/runs?limit=100"), api<AuditEntry[]>("/audit?limit=100")])
      .then(([r, a]) => { setRuns(r); setAudit(a); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, []);

  return (
    <>
      <PageHeader label="Beobachtbarkeit" title="Aktivität" />
      {error && <Notice kind="bad">{error}</Notice>}
      <div className="mp-two-col">
        <Card>
          <h2>Agenten-Läufe</h2>
          {runs.length === 0 ? <p className="mp-muted">Noch kein Lauf. Jeder Aufruf eines Modells erscheint hier mit Tokens, Kosten und Dauer.</p> : (
            <div className="mp-table-wrap"><table className="mp-table">
              <thead><tr><th>Start</th><th>Aufgabe</th><th>Modell</th><th>Tokens</th><th>Kosten</th><th>Dauer</th><th>Status</th></tr></thead>
              <tbody>{runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmt(r.startedAt)}</td><td>{r.task}</td><td>{r.model ?? "–"}</td>
                  <td className="mp-num-cell">{r.tokensIn + r.tokensOut}</td>
                  <td className="mp-num-cell">{r.costUsd.toFixed(4)} $</td>
                  <td className="mp-num-cell">{r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)} s` : "–"}</td>
                  <td><Pill kind={RUN_PILL[r.status]}>{r.status === "done" ? "fertig" : r.status === "failed" ? "Fehler" : "läuft"}</Pill></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card>
          <h2>Audit-Log</h2>
          {audit.length === 0 ? <p className="mp-muted">Noch keine Einträge.</p> : (
            <div className="mp-table-wrap"><table className="mp-table">
              <thead><tr><th>Zeit</th><th>Nutzer</th><th>Aktion</th><th>Objekt</th></tr></thead>
              <tbody>{audit.map((a) => (
                <tr key={a.id}>
                  <td>{fmt(a.createdAt)}</td><td>{a.user}</td>
                  <td><code className="mp-code">{a.action}</code></td>
                  <td>{String(a.content["name"] ?? a.entityId ?? "")}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </>
  );
}
