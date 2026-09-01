/**
 * Veröffentlichen: Zugangsdaten, Slots, Zeitplan und Bio-Seite.
 *
 * Die Seite sagt zu jeder Plattform ehrlich, was geht und was nicht — und
 * warum. „Manuell" ist hier keine fehlende Funktion, sondern eine Entscheidung
 * mit Begründung, und die steht daneben.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { ChannelProfile, PlatformPosting, PublishView, Weekday } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, fmtDateTime, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

const DAYS: { id: Weekday; label: string }[] = [
  { id: "mon", label: "Mo" }, { id: "tue", label: "Di" }, { id: "wed", label: "Mi" }, { id: "thu", label: "Do" },
  { id: "fri", label: "Fr" }, { id: "sat", label: "Sa" }, { id: "sun", label: "So" },
];
const MODE: Record<PlatformPosting["mode"], { label: string; kind: PillKind }> = {
  api: { label: "postet automatisch", kind: "done" },
  needs_setup: { label: "Zugang fehlt", kind: "review" },
  needs_audit: { label: "manuell (Audit nötig)", kind: "todo" },
  manual: { label: "manuell (bewusst)", kind: "todo" },
  blocked: { label: "nie automatisch", kind: "kind" },
};
const STATUS: Record<string, PillKind> = { queued: "progress", posted: "done", failed: "review", cancelled: "kind" };

export function PublishingPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<PublishView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, Record<string, string>>>({});
  const [profiles, setProfiles] = useState<ChannelProfile[]>([]);
  const [bio, setBio] = useState<PublishView["bio"] | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api<PublishView>(`/projects/${id}/publish`);
      setView(v); setProfiles(v.profiles); setBio(v.bio); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(null); }
  };
  if (!view || !bio) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;

  const setProfile = (platform: string, patch: Partial<ChannelProfile>) =>
    setProfiles((cur) => cur.map((p) => (p.platform === platform ? { ...p, ...patch } : p)));
  const toggleSlot = (platform: string, day: Weekday, hour: number) =>
    setProfiles((cur) => cur.map((p) => {
      if (p.platform !== platform) return p;
      const has = p.slots.some((sl) => sl.day === day && sl.hour === hour);
      return { ...p, slots: has ? p.slots.filter((sl) => !(sl.day === day && sl.hour === hour)) : [...p.slots, { day, hour }] };
    }));

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Inhalte" title="Veröffentlichen" />
      {error && <Notice kind="bad">{error}</Notice>}
      {!view.workerAlive && <Notice kind="bad">Der Worker läuft nicht (<code className="mp-code">app-marketing-pilot-worker</code>) – geplante Beiträge bleiben liegen.</Notice>}

      {view.autoToday.length > 0 && (
        <Card>
          <h2>Heute automatisch gepostet</h2>
          <ul className="mp-plain-list">{view.autoToday.map((x) => (
            <li key={x.id} className="mp-small">{x.platform} · {x.title} · {fmtDateTime(x.postedAt ?? x.scheduledAt)}
              {x.externalUrl && <> · <a href={x.externalUrl} target="_blank" rel="noreferrer">ansehen und ggf. löschen</a></>}</li>
          ))}</ul>
        </Card>
      )}

      <Card>
        <div className="mp-card-head"><h2>Plattformen</h2>
          <Button variant="primary" disabled={busy !== null} onClick={() => void run("creds", () => api(`/projects/${id}/publish/credentials`, { method: "PUT", json: creds }))}>{busy === "creds" ? "…" : "Zugangsdaten speichern"}</Button>
        </div>
        <p className="mp-small mp-muted">Gespeicherte Geheimnisse werden nie zurückgelesen – ein leeres Feld lässt den vorhandenen Wert stehen, ein neuer Wert ersetzt ihn.</p>
        <div className="mp-table-wrap"><table className="mp-table">
          <thead><tr><th>Plattform</th><th>Status</th><th>Warum</th><th>Zugang</th></tr></thead>
          <tbody>{view.platforms.map((p) => (
            <tr key={p.platform}>
              <td><strong>{p.label}</strong></td>
              <td><Pill kind={MODE[p.mode].kind}>{MODE[p.mode].label}</Pill>{p.configured && p.mode === "api" && <div className="mp-small mp-muted">eingerichtet</div>}</td>
              <td className="mp-small mp-muted">{p.reason}</td>
              <td>
                {p.fields.length === 0 ? <span className="mp-small mp-muted">–</span> : p.fields.map((f) => (
                  <label key={f.key} className="mp-field mp-field--short mp-small"><span>{f.label}</span>
                    <input type={f.secret ? "password" : "text"} autoComplete="off" placeholder={p.configured ? "•••• (gespeichert)" : ""}
                      value={creds[p.platform]?.[f.key] ?? ""}
                      onChange={(e) => setCreds({ ...creds, [p.platform]: { ...(creds[p.platform] ?? {}), [f.key]: e.target.value } })} />
                  </label>
                ))}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>

      <Card>
        <div className="mp-card-head"><h2>Slots & Automatik</h2>
          <Button variant="primary" disabled={busy !== null} onClick={() => void run("profiles", () => api(`/projects/${id}/profiles`, { method: "PUT", json: profiles }))}>{busy === "profiles" ? "…" : "Speichern"}</Button>
        </div>
        <p className="mp-small mp-muted">
          <strong>manuell</strong>: nichts passiert von selbst. <strong>geplant</strong>: nach deiner Freigabe postet der Pilot zum nächsten Slot.
          <strong> voll automatisch</strong>: Serien-Stücke dieses Kanals gehen ohne Einzelfreigabe raus – nur Daten-Formate, nur bis zum Wochendeckel, und du siehst sie oben im Digest.
        </p>
        {profiles.map((p) => (
          <div key={p.platform} className="mp-sub">
            <div className="mp-sub-head">
              <strong>{p.label || p.platform}</strong>
              <div className="mp-inline">
                <select value={p.publishMode} onChange={(e) => setProfile(p.platform, { publishMode: e.target.value as ChannelProfile["publishMode"] })}>
                  <option value="manual">manuell</option><option value="scheduled">geplant</option><option value="auto">voll automatisch</option>
                </select>
                {p.publishMode === "auto" && (
                  <label className="mp-field mp-field--inline mp-small"><span>max./Woche</span>
                    <input type="number" min={1} max={50} value={p.autoWeeklyCap} onChange={(e) => setProfile(p.platform, { autoWeeklyCap: Number(e.target.value) })} /></label>
                )}
              </div>
            </div>
            <div className="mp-small mp-muted">Slots (Europe/Berlin) – ohne Slot wird eine Stunde nach der Freigabe gepostet.</div>
            <div className="mp-inline" style={{ flexWrap: "wrap" }}>
              {DAYS.map((d) => [9, 12, 17, 19].map((h) => {
                const on = p.slots.some((sl) => sl.day === d.id && sl.hour === h);
                return <button key={`${d.id}${h}`} type="button" className={`mp-btn${on ? " mp-btn--primary" : ""}`} onClick={() => toggleSlot(p.platform, d.id, h)}>{d.label} {h}</button>;
              }))}
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <div className="mp-card-head"><h2>Link in Bio</h2>
          <Button variant="primary" disabled={busy !== null} onClick={() => void run("bio", () => api(`/projects/${id}/publish/bio`, { method: "PUT", json: bio }))}>{busy === "bio" ? "…" : "Speichern"}</Button>
        </div>
        <p className="mp-small mp-muted">Eine Adresse fürs Instagram- und TikTok-Profil. Sie zeigt immer auf das Aktuelle; jeder Klick zählt auf das jeweilige Stück.</p>
        <div className="mp-form mp-form--row">
          <label className="mp-field mp-field--short"><span>Aktiv</span><select value={bio.enabled ? "1" : "0"} onChange={(e) => setBio({ ...bio, enabled: e.target.value === "1" })}><option value="0">aus</option><option value="1">an</option></select></label>
          <label className="mp-field"><span>Überschrift</span><input value={bio.headline} onChange={(e) => setBio({ ...bio, headline: e.target.value })} placeholder="Binderplan" /></label>
          <label className="mp-field mp-field--short"><span>Zuletzt veröffentlicht</span><select value={bio.latest} onChange={(e) => setBio({ ...bio, latest: Number(e.target.value) })}>{[0, 3, 5, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
        <label className="mp-field"><span>Einleitung (optional)</span><input value={bio.intro} onChange={(e) => setBio({ ...bio, intro: e.target.value })} /></label>
        {view.bioUrl && <p className="mp-small">Deine Adresse: <a href={view.bioUrl} target="_blank" rel="noreferrer"><code className="mp-code">{view.bioUrl}</code></a></p>}
      </Card>

      <Card>
        <div className="mp-card-head"><h2>Zeitplan</h2>
          <Button disabled={busy !== null || !view.workerAlive} onClick={() => void run("now", () => api(`/projects/${id}/publish/run`, { method: "POST" }))}>{busy === "now" ? "…" : "Fällige jetzt posten"}</Button>
        </div>
        {view.scheduled.length === 0 ? (
          <p className="mp-muted">Nichts eingeplant. In der <Link to={`/projects/${id}/review`}>Freigabe</Link> steht bei jedem freigegebenen Stück „Einplanen“.</p>
        ) : (
          <div className="mp-table-wrap"><table className="mp-table">
            <thead><tr><th>Wann</th><th>Kanal</th><th>Stück</th><th>Herkunft</th><th>Status</th><th></th></tr></thead>
            <tbody>{view.scheduled.map((x) => (
              <tr key={x.id}>
                <td className="mp-small mp-nowrap">{fmtDateTime(x.scheduledAt)}</td>
                <td className="mp-small">{x.platform}</td>
                <td className="mp-small">{x.title}{x.externalUrl && <> · <a href={x.externalUrl} target="_blank" rel="noreferrer">ansehen</a></>}</td>
                <td className="mp-small mp-muted">{x.origin === "auto" ? "Serie (automatisch)" : "freigegeben"}</td>
                <td><Pill kind={STATUS[x.status] ?? "todo"}>{x.status}</Pill>{x.error && <div className="mp-small mp-over">{x.error}</div>}</td>
                <td>{x.status === "queued" && <Button variant="danger" disabled={busy !== null} onClick={() => void run(`c-${x.id}`, () => api(`/scheduled/${x.id}`, { method: "DELETE" }))}>Absagen</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
