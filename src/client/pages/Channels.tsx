/**
 * Kanäle: die Steuerzentrale des Content-Piloten.
 *
 * Eine Karte je eingeschalteter Plattform. Auf jeder Karte steht die Stufe
 * (Vorbereiten · Freigeben · Vollautomatisch), ob sie wirklich läuft, und —
 * wenn nicht — genau das, was noch fehlt, mit dem Eingabefeld direkt darunter.
 * Ausgeschaltete Plattformen stehen als schlichte Liste unten und lassen sich
 * mit einem Klick einschalten.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { ChannelCard, ChannelPatch, ChannelStage, PublishView, Weekday } from "../../shared/schemas.js";
import { STAGES, STAGE_ORDER, stageAtLeast, stageRank } from "../../shared/channels.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, fmtDateTime, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { loadProfiles } from "../components/ChannelLink.js";

const DAYS: { id: Weekday; label: string }[] = [
  { id: "mon", label: "Mo" }, { id: "tue", label: "Di" }, { id: "wed", label: "Mi" }, { id: "thu", label: "Do" },
  { id: "fri", label: "Fr" }, { id: "sat", label: "Sa" }, { id: "sun", label: "So" },
];
const HOURS = [9, 12, 17, 19];
const STATUS: Record<string, PillKind> = { queued: "progress", posted: "done", failed: "review", cancelled: "kind" };

type Creds = Record<string, Record<string, string>>;

/** Das Stück Karte, das aufklappt, wenn ein Hinweis darauf zeigt. */
type Panel = "credentials" | "slots" | "url" | "cap" | null;

export function ChannelsPage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<PublishView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setView(await api<PublishView>(`/projects/${id}/publish`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); await load(); void loadProfiles(id, true); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(null); }
  };
  const patch = (platform: string, body: ChannelPatch) => run(`${platform}`, () => api(`/projects/${id}/publish/channel/${platform}`, { method: "PATCH", json: body }));
  const saveCreds = (platform: string, fields: Record<string, string>) => run(`creds-${platform}`, () => api(`/projects/${id}/publish/credentials`, { method: "PUT", json: { [platform]: fields } as Creds }));

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;

  const on = view.board.filter((c) => c.stage !== "off");
  const off = view.board.filter((c) => c.stage === "off");
  const count = (s: ChannelStage) => on.filter((c) => c.stage === s).length;
  const setupMissing: { text: string; to: string }[] = [];
  if (!view.setup.briefConfirmed) setupMissing.push({ text: "Produkt-Brief fehlt — ohne ihn weiß der Pilot nicht, worüber er schreibt. Analyse ausführen und Brief bestätigen.", to: `/projects/${id}/analysis` });
  if (!view.setup.brandKit) setupMissing.push({ text: "Marken-Kit noch nicht extrahiert — Slides tragen sonst das Standard-Grün des Piloten statt deiner Farben.", to: `/projects/${id}/studio?tab=brand` });
  if (view.setup.briefConfirmed && !view.setup.voiceProfile) setupMissing.push({ text: "Kein Voice-Profil — Texte klingen generisch. 5–20 eigene Texte im Studio hinterlegen.", to: `/projects/${id}/studio?tab=brand` });

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Content Pilot" title="Kanäle" actions={
        <span className="mp-label mp-stage-summary">
          {on.length === 0 ? "Noch kein Kanal eingeschaltet" : STAGE_ORDER.filter((s) => s !== "off").map((s) => <span key={s}><b className="mp-num">{count(s)}</b> {STAGES[s].label.toLowerCase()}</span>)}
        </span>
      } />
      {error && <Notice kind="bad">{error}</Notice>}
      {!view.workerAlive && on.some((c) => stageAtLeast(c.stage, "approve")) && <Notice kind="bad">Der Worker läuft nicht (<code className="mp-code">app-marketing-pilot-worker</code>) — Kanäle auf „Freigeben“ und „Vollautomatisch“ posten so lange nichts.</Notice>}

      <StageLegend />

      {setupMissing.length > 0 && (
        <Card>
          <h2>Bevor irgendein Kanal läuft</h2>
          <ul className="mp-plain-list">{setupMissing.map((h, i) => <li key={i}><Link to={h.to}>{h.text}</Link></li>)}</ul>
        </Card>
      )}

      {on.length === 0 ? (
        <Card className="mp-empty">
          <h2>Kein Kanal eingeschaltet</h2>
          <p>Wähle unten die Plattformen, die du bespielen willst. Jede startet auf „Vorbereiten“: der Pilot erstellt fertigen Content, du postest ihn selbst.</p>
        </Card>
      ) : (
        <div className="mp-channel-grid">
          {on.map((c) => <ChannelCardView key={c.platform} projectId={id} card={c} busy={busy} onPatch={(b) => void patch(c.platform, b)} onCreds={(f) => void saveCreds(c.platform, f)} />)}
        </div>
      )}

      {off.length > 0 && (
        <Card>
          <h2>Weitere Plattformen</h2>
          <p className="mp-small mp-muted">Ausgeschaltet: Serien lassen sie aus, nichts entsteht für sie. Einschalten stellt auf „Vorbereiten“.</p>
          <ul className="mp-channel-offlist">
            {off.map((c) => (
              <li key={c.platform}>
                <div className="mp-today-main">
                  <span className="mp-today-title">{c.label}</span>
                  <span className="mp-small mp-muted">{c.maxStage === "prepare" ? `Nur von Hand: ${c.maxReason}` : c.posting.mode === "api" ? "Kann bis „Vollautomatisch“." : "Kann bis „Vollautomatisch“, sobald der Zugang eingerichtet ist."}</span>
                </div>
                <Button disabled={busy !== null} onClick={() => void patch(c.platform, { stage: "prepare" })}>{busy === c.platform ? "…" : "Einschalten"}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
        <div className="mp-card-head"><h2>Zeitplan</h2>
          {view.scheduled.some((x) => x.status === "queued") && <Button disabled={busy !== null || !view.workerAlive} onClick={() => void run("now", () => api(`/projects/${id}/publish/run`, { method: "POST" }))}>{busy === "now" ? "…" : "Fällige jetzt posten"}</Button>}
        </div>
        {view.scheduled.length === 0 ? (
          <p className="mp-muted mp-small">Nichts eingeplant. Auf Kanälen ab „Freigeben“ legt die <Link to={`/projects/${id}/review`}>Freigabe</Link> jeden Beitrag in den nächsten Slot.</p>
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

      <BioCard projectId={id} view={view} busy={busy} run={run} />
    </>
  );
}

/** Die vier Stufen in einer Zeile — einmal lesen, dann versteht man jede Karte. */
function StageLegend() {
  return (
    <div className="mp-stage-legend">
      {STAGE_ORDER.map((s, i) => (
        <div key={s} className={`mp-stage-legend-item mp-stage-legend-item--${s}`}>
          <div className="mp-label">{i === 0 ? "—" : `Stufe ${i}`}</div>
          <div className="mp-stage-legend-title">{STAGES[s].label}</div>
          <p className="mp-small mp-muted">{STAGES[s].summary}</p>
          {s !== "off" && <div className="mp-small mp-stage-who">erstellt: <b>{STAGES[s].who.create}</b> · freigibt: <b>{STAGES[s].who.approve}</b> · postet: <b>{STAGES[s].who.post}</b></div>}
        </div>
      ))}
    </div>
  );
}

function ChannelCardView({ projectId, card: c, busy, onPatch, onCreds }: { projectId: string; card: ChannelCard; busy: string | null; onPatch: (b: ChannelPatch) => void; onCreds: (f: Record<string, string>) => void }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [url, setUrl] = useState(c.url);
  const [cap, setCap] = useState(c.autoWeeklyCap);
  const [creds, setCreds] = useState<Record<string, string>>({});
  useEffect(() => { setUrl(c.url); setCap(c.autoWeeklyCap); }, [c.url, c.autoWeeklyCap]);
  const mine = busy === c.platform || busy === `creds-${c.platform}`;

  const blockers = c.requirements.filter((r) => !r.ok && r.blocking);
  const hints = c.requirements.filter((r) => !r.ok && !r.blocking);
  const status: { kind: PillKind; label: string } = c.ready
    ? { kind: "done", label: hints.length ? "läuft · Hinweise" : "läuft" }
    : { kind: "review", label: blockers.length === 1 ? `${blockers[0]!.label.toLowerCase()} fehlt` : `${blockers.length} Punkte fehlen` };
  const nextStage = STAGE_ORDER[stageRank(c.stage) + 1];
  const toggleSlot = (day: Weekday, hour: number) => {
    const has = c.slots.some((sl) => sl.day === day && sl.hour === hour);
    onPatch({ slots: has ? c.slots.filter((sl) => !(sl.day === day && sl.hour === hour)) : [...c.slots, { day, hour }] });
  };
  const open = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const actionFor = (r: ChannelCard["requirements"][number]): ReactNode => {
    if (!r.action) return null;
    if (r.action === "credentials" || r.action === "slots" || r.action === "url" || r.action === "cap") return <button type="button" className="mp-linkbtn mp-small" onClick={() => open(r.action as Panel)}>eintragen</button>;
    if (r.action === "series") return <Link className="mp-small" to={`/projects/${projectId}/series`}>Serie anlegen</Link>;
    return <Link className="mp-small" to={`/projects/${projectId}/${r.action}`}>öffnen</Link>;
  };

  return (
    <Card className={`mp-channel-card${c.ready ? "" : " mp-channel-card--blocked"}`}>
      <div className="mp-card-head">
        <div>
          <h2>{c.label}{c.url && <a className="mp-small mp-muted mp-channel-url" href={c.url} target="_blank" rel="noreferrer">{c.url.replace(/^https?:\/\/(www\.)?/, "")} ↗</a>}</h2>
        </div>
        <div className="mp-inline">
          <Pill kind={status.kind}>{status.label}</Pill>
        </div>
      </div>

      {/* Die Stufen-Leiter */}
      <div className="mp-stage-ladder" role="radiogroup" aria-label={`Stufe für ${c.label}`}>
        {STAGE_ORDER.map((s) => {
          const reachable = stageAtLeast(c.maxStage, s);
          const active = c.stage === s;
          return (
            <button key={s} type="button" role="radio" aria-checked={active} disabled={mine || !reachable}
              className={`mp-stage-step${active ? " is-active" : ""}${!reachable ? " is-locked" : ""}`}
              title={reachable ? STAGES[s].summary : `Nicht möglich: ${c.maxReason}`}
              onClick={() => !active && onPatch({ stage: s })}>
              {STAGES[s].label}
            </button>
          );
        })}
      </div>
      <p className="mp-small mp-stage-summary-text">{STAGES[c.stage].summary}{c.appOnly && stageAtLeast(c.stage, "prepare") && c.stage === "prepare" ? " Upload nur per App — Text kopieren, Dateien aufs Handy, Link in Bio." : ""}</p>
      {c.maxStage === "prepare" && <p className="mp-small mp-muted">Höher geht es hier nicht: {c.maxReason}</p>}

      {/* Was fehlt */}
      {c.requirements.length > 0 && (
        <ul className="mp-req-list">
          {c.requirements.map((r) => (
            <li key={r.id} className={`mp-req${r.ok ? " is-ok" : r.blocking ? " is-blocking" : " is-hint"}`}>
              <span className="mp-req-mark" aria-hidden="true">{r.ok ? "✓" : r.blocking ? "!" : "○"}</span>
              <div className="mp-today-main">
                <span>{r.label}{!r.ok && !r.blocking && <span className="mp-muted"> · optional</span>}</span>
                {!r.ok && <span className="mp-small mp-muted">{r.hint} {actionFor(r)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Aufklappbare Eingaben */}
      {panel === "url" && (
        <div className="mp-sub">
          <label className="mp-field"><span>Deine Seite auf {c.label}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
          <div className="mp-form-actions"><Button onClick={() => setPanel(null)}>Abbrechen</Button><Button variant="primary" disabled={mine} onClick={() => { onPatch({ url }); setPanel(null); }}>Speichern</Button></div>
        </div>
      )}
      {panel === "credentials" && c.posting.fields.length > 0 && (
        <div className="mp-sub">
          <div className="mp-small mp-muted">{c.posting.reason}</div>
          {c.posting.fields.map((f) => (
            <label key={f.key} className="mp-field mp-small"><span>{f.label}</span>
              <input type={f.secret ? "password" : "text"} autoComplete="off" placeholder={c.posting.configured ? "•••• (gespeichert — leer lassen = behalten)" : ""} value={creds[f.key] ?? ""} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
            </label>
          ))}
          <div className="mp-form-actions"><Button onClick={() => setPanel(null)}>Abbrechen</Button><Button variant="primary" disabled={mine || Object.values(creds).every((v) => !v.trim())} onClick={() => { onCreds(creds); setCreds({}); setPanel(null); }}>Zugang speichern</Button></div>
        </div>
      )}
      {panel === "slots" && (
        <div className="mp-sub">
          <div className="mp-small mp-muted">Wochentag und Stunde (Europe/Berlin), zu denen auf {c.label} gepostet wird. Jeder Klick speichert sofort.</div>
          <div className="mp-slot-grid">
            {DAYS.map((d) => HOURS.map((h) => {
              const onSlot = c.slots.some((sl) => sl.day === d.id && sl.hour === h);
              return <button key={`${d.id}${h}`} type="button" disabled={mine} className={`mp-btn${onSlot ? " mp-btn--primary" : ""}`} onClick={() => toggleSlot(d.id, h)}>{d.label} {h}</button>;
            }))}
          </div>
          <div className="mp-form-actions"><Button onClick={() => setPanel(null)}>Fertig</Button></div>
        </div>
      )}
      {panel === "cap" && (
        <div className="mp-sub">
          <label className="mp-field mp-field--short"><span>Höchstens Beiträge je Woche</span><input type="number" min={1} max={50} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></label>
          <div className="mp-form-actions"><Button onClick={() => setPanel(null)}>Abbrechen</Button><Button variant="primary" disabled={mine} onClick={() => { onPatch({ autoWeeklyCap: cap }); setPanel(null); }}>Speichern</Button></div>
        </div>
      )}

      {/* Zahlen und Einstellungen */}
      <div className="mp-channel-foot">
        <span className="mp-small mp-muted">
          {c.stats.waitingReview > 0 && <><Link to={`/projects/${projectId}/review`}>{c.stats.waitingReview} in Freigabe</Link> · </>}
          {c.stats.approvedUnposted > 0 && <>{c.stats.approvedUnposted} zu posten · </>}
          {c.stats.queued > 0 && <>{c.stats.queued} eingeplant · </>}
          {c.stats.posted7d} gepostet (7 T){c.stats.series > 0 && <> · {c.stats.series} Serie{c.stats.series > 1 ? "n" : ""}</>}
        </span>
        <span className="mp-inline mp-small">
          <button type="button" className="mp-linkbtn mp-small" onClick={() => open("url")}>Adresse</button>
          {stageAtLeast(c.maxStage, "approve") && c.posting.fields.length > 0 && <button type="button" className="mp-linkbtn mp-small" onClick={() => open("credentials")}>Zugang{c.posting.configured ? " ✓" : ""}</button>}
          {stageAtLeast(c.stage, "approve") && <button type="button" className="mp-linkbtn mp-small" onClick={() => open("slots")}>Slots ({c.slots.length})</button>}
          {c.stage === "auto" && <button type="button" className="mp-linkbtn mp-small" onClick={() => open("cap")}>Deckel {c.autoWeeklyCap}/Woche</button>}
        </span>
      </div>
      {nextStage && c.nextMissing.length > 0 && stageAtLeast(c.maxStage, nextStage) && (
        <div className="mp-small mp-muted mp-channel-next">Für „{STAGES[nextStage].label}“ fehlt noch: {c.nextMissing.join(", ")}.</div>
      )}
    </Card>
  );
}

function BioCard({ projectId, view, busy, run }: { projectId: string; view: PublishView; busy: string | null; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [bio, setBio] = useState(view.bio);
  useEffect(() => setBio(view.bio), [view.bio]);
  return (
    <details className="mp-details">
      <summary className="mp-label">Link in Bio (Instagram, TikTok){view.bioUrl && <> · {view.bioUrl}</>}</summary>
      <Card>
        <p className="mp-small mp-muted">Eine Adresse fürs Profil. Sie zeigt immer auf das Aktuelle; jeder Klick zählt auf das jeweilige Stück.</p>
        <div className="mp-form mp-form--row">
          <label className="mp-field mp-field--short"><span>Aktiv</span><select value={bio.enabled ? "1" : "0"} onChange={(e) => setBio({ ...bio, enabled: e.target.value === "1" })}><option value="0">aus</option><option value="1">an</option></select></label>
          <label className="mp-field"><span>Überschrift</span><input value={bio.headline} onChange={(e) => setBio({ ...bio, headline: e.target.value })} placeholder="Binderplan" /></label>
          <label className="mp-field mp-field--short"><span>Zuletzt veröffentlicht</span><select value={bio.latest} onChange={(e) => setBio({ ...bio, latest: Number(e.target.value) })}>{[0, 3, 5, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
        <label className="mp-field"><span>Einleitung (optional)</span><input value={bio.intro} onChange={(e) => setBio({ ...bio, intro: e.target.value })} /></label>
        <div className="mp-form-actions">
          {view.bioUrl && <a className="mp-small" href={view.bioUrl} target="_blank" rel="noreferrer"><code className="mp-code">{view.bioUrl}</code></a>}
          <Button variant="primary" disabled={busy !== null} onClick={() => void run("bio", () => api(`/projects/${projectId}/publish/bio`, { method: "PUT", json: bio }))}>{busy === "bio" ? "…" : "Speichern"}</Button>
        </div>
      </Card>
    </details>
  );
}
