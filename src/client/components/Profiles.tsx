/** "Kanäle & Profile" card: one row per platform with the project's own page URL. Every channel name in the app links here. */
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PLATFORMS, type ChannelProfile } from "../../shared/channels.js";
import { Button, Card, Notice } from "./ui.js";
import { loadProfiles, useProfiles } from "./ChannelLink.js";

const PLATFORM_KEYS = Object.keys(PLATFORMS).filter((k) => PLATFORMS[k]!.home);

export function ProfilesCard({ projectId }: { projectId: string }) {
  const stored = useProfiles(projectId);
  const [rows, setRows] = useState<ChannelProfile[]>([]);
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!edit) setRows(stored); }, [stored, edit]);

  const save = async () => {
    setBusy(true); setError(null);
    try { await api(`/projects/${projectId}/profiles`, { method: "PUT", json: rows }); await loadProfiles(projectId, true); setEdit(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  const missing = stored.filter((p) => !p.url).length;
  return (
    <Card>
      <div className="mp-card-head"><h2>Kanäle &amp; Profile</h2><Button onClick={() => setEdit((v) => !v)}>{edit ? "Abbrechen" : "Bearbeiten"}</Button></div>
      {error && <Notice kind="bad">{error}</Notice>}
      {!edit ? (
        <>
          {stored.length === 0 && <p className="mp-muted">Noch keine Kanäle – sie entstehen aus dem Strategie-Plan oder hier per „Bearbeiten“.</p>}
          <ul className="mp-profile-list">
            {stored.map((p, i) => (
              <li key={i}>
                <span className="mp-profile-name">{PLATFORMS[p.platform]?.label ?? p.platform}{p.label && p.label !== PLATFORMS[p.platform]?.label && <span className="mp-muted"> · {p.label}</span>}</span>
                {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="mp-profile-url">{p.url.replace(/^https?:\/\/(www\.)?/, "")}<span className="mp-ext" aria-hidden="true">↗</span></a> : <span className="mp-muted mp-small">URL fehlt</span>}
              </li>
            ))}
          </ul>
          {missing > 0 && <p className="mp-small mp-muted">{missing} Kanal{missing > 1 ? "e" : ""} ohne URL – bis dahin öffnen Links die Plattform-Startseite.</p>}
        </>
      ) : (
        <div className="mp-form">
          {rows.map((p, i) => (
            <div key={i} className="mp-action-row">
              <select value={p.platform} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, platform: e.target.value, label: x.label || PLATFORMS[e.target.value]?.label || "" } : x)))}>{PLATFORM_KEYS.map((k) => <option key={k} value={k}>{PLATFORMS[k]!.label}</option>)}</select>
              <input style={{ flex: "0 1 180px" }} value={p.label} placeholder="Bezeichnung (z. B. Gruppe Grundschule)" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input value={p.url} placeholder={`${PLATFORMS[p.platform]?.home ?? "https://"}…`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <Button variant="danger" aria-label="Entfernen" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <div className="mp-form-actions">
            <Button onClick={() => setRows([...rows, { platform: "instagram", label: "Instagram", url: "" }])}>Kanal hinzufügen</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "…" : "Speichern"}</Button>
            <span className="mp-small mp-muted">Mehrere Einträge je Plattform sind erlaubt (z. B. mehrere Facebook-Gruppen).</span>
          </div>
        </div>
      )}
    </Card>
  );
}
