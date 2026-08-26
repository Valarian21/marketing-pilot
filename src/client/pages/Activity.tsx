import { useEffect, useState } from "react";
import type { AgentRun, AuditEntry } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Card, Notice, PageHeader, Pill, Stat, type PillKind } from "../components/ui.js";
import { fmtUsd } from "../components/Revise.js";

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

  const total = runs.reduce((n, r) => n + r.costUsd, 0);
  const byProvider = new Map<string, number>();
  for (const r of runs) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + r.costUsd);
  const since7 = Date.now() - 7 * 86_400_000;
  const total7 = runs.filter((r) => Date.parse(r.startedAt) >= since7).reduce((n, r) => n + r.costUsd, 0);
  return (
    <>
      <PageHeader label="Beobachtbarkeit" title="Aktivität" />
      {error && <Notice kind="bad">{error}</Notice>}
      <div className="mp-stats mp-stats--4 mp-stats--tiles">
        <Stat label="Kosten letzte 7 Tage" value={fmtUsd(total7)} highlight />
        <Stat label="Kosten gesamt (100 Läufe)" value={fmtUsd(total)} />
        {[...byProvider.entries()].slice(0, 2).map(([prov, v]) => <Stat key={prov} label={prov} value={fmtUsd(v)} />)}
      </div>
      <div className="mp-stack">
        <Card>
          <h2>Agenten-Läufe</h2>
          {runs.length === 0 ? <p className="mp-muted">Noch kein Lauf. Jeder Aufruf eines Modells erscheint hier mit Tokens, Kosten und Dauer.</p> : (
            <div className="mp-table-wrap"><table className="mp-table">
              <thead><tr><th>Start</th><th>Aufgabe</th><th>Modell</th><th>Stück</th><th>Tokens</th><th>Kosten</th><th>Dauer</th><th>Status</th></tr></thead>
              <tbody>{runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmt(r.startedAt)}</td><td>{r.task}</td><td>{r.model ?? "–"}</td><td className="mp-small">{r.pieceId ? r.pieceId.slice(0, 8) : "–"}</td>
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
                  <td><span className="mp-trunc" title={String(a.content["name"] ?? a.entityId ?? "")}>{String(a.content["name"] ?? a.entityId ?? "")}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </>
  );
}
