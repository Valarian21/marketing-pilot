/** Publish package as three numbered steps: copy the text, open the platform, paste the post URL - done.
 *  Directory entries show their fields to copy instead of one text. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { PublishPackage } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ChannelTag } from "../components/ChannelLink.js";

function CopyButton({ text, label = "Kopieren", variant = "secondary" as "secondary" | "primary", onCopied }: { text: string; label?: string; variant?: "secondary" | "primary"; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return <Button variant={variant} onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); onCopied?.(); setTimeout(() => setDone(false), 1800); }); }}>{done ? "Kopiert ✓" : label}</Button>;
}

export function PublishPage() {
  const { id = "", pieceId = "" } = useParams();
  const [pkg, setPkg] = useState<PublishPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);

  const load = useCallback(async () => { try { const p = await api<PublishPackage>(`/content/${pieceId}/package`); setPkg(p); setUrl(p.piece.externalUrl ?? ""); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [pieceId]);
  useEffect(() => { void load(); }, [load]);

  const markPublished = async () => {
    setBusy(true); setError(null);
    try { await api(`/content/${pieceId}`, { method: "PATCH", json: { status: "published", externalUrl: url } }); await load(); setStep(4); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  const schedule = async () => {
    setBusy(true); setError(null);
    try { await api(`/content/${pieceId}/schedule`, { method: "POST", json: { date: new Date(date).toISOString() } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  const openPlatform = async () => {
    // copy first, then open - the composer opens with the text already in the clipboard
    if (!pkg) return;
    if (!isDirectory) await navigator.clipboard.writeText(pkg.text).catch(() => undefined);
    const target = pkg.deepLink ?? pkg.profileLink;
    if (target) window.open(target, "_blank", "noopener");
    setStep((s) => Math.max(s, 3));
  };

  if (!pkg) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  const p = pkg.piece;
  const fields = (p.meta["fields"] ?? null) as Record<string, string | string[]> | null;
  const isDirectory = p.format === "directory_entry" && fields;
  const published = p.status === "published";
  const ready = p.status === "approved" || published;
  const videos = pkg.assets.filter((a) => a.kind === "render");
  const images = pkg.assets.filter((a) => a.kind !== "render");
  const stepCls = (n: number) => `mp-pubstep${published || step > n ? " is-done" : step === n ? " is-current" : ""}`;

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label={isDirectory ? "Einreichen" : "Posten"} title={p.title || p.format} actions={<span className="mp-inline"><ChannelTag name={p.channel || pkg.platform} projectId={id} /><Pill kind={published ? "done" : ready ? "done" : "review"}>{published ? "veröffentlicht" : ready ? "freigegeben" : p.status}</Pill></span>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {!ready && <Notice kind="warn">Dieses Stück ist noch nicht freigegeben – <Link to={`/projects/${id}/review?piece=${p.id}`}>zur Freigabe</Link>. Posten geht erst danach.</Notice>}
      {pkg.notes.map((n, i) => <Notice key={i} kind="info">{n}</Notice>)}

      <div className="mp-two-col mp-publish">
        <div>
          <Card className={stepCls(1)}>
            <div className="mp-card-head"><h2><span className="mp-today-no">1</span> {isDirectory ? "Felder kopieren" : "Text kopieren"}</h2>{!isDirectory && <CopyButton text={pkg.text} label="Text kopieren" variant="primary" onCopied={() => setStep((s) => Math.max(s, 2))} />}</div>
            {isDirectory ? (
              Object.entries(fields).map(([k, v]) => {
                const val = Array.isArray(v) ? v.join(", ") : String(v);
                return (<div key={k} className="mp-field-copy"><div className="mp-card-head"><span className="mp-label">{k} <span className="mp-muted">({val.length} Zeichen)</span></span><CopyButton text={val} /></div><pre className="mp-pre">{val}</pre></div>);
              })
            ) : (
              <>
                <pre className="mp-pre mp-pre--post">{pkg.text}</pre>
                {p.format === "article" && <a className="mp-btn" href={`/api/mp/content/${p.id}/export.html`}>HTML-Export (mit JSON-LD)</a>}
              </>
            )}
            {(videos.length > 0 || images.length > 0) && (
              <>
                <h3 className="mp-label" style={{ marginTop: 12 }}>Dateien zum Hochladen{pkg.appOnly ? " – aufs Handy laden" : ""}</h3>
                {videos.length > 0 && <ul className="mp-plain-list">{videos.map((a) => <li key={a.id}><a href={a.url} download={a.filename}>{a.filename}</a>{a.aiGenerated && <> <Pill kind="kind">KI-Kennzeichnung</Pill></>}</li>)}</ul>}
                {images.length > 0 && <ul className="mp-assets">{images.map((a) => (
                  <li key={a.id}><a href={a.url} download={a.filename}><img src={a.url} alt="" loading="lazy" /></a><div className="mp-small"><a href={a.url} download={a.filename}>{a.filename}</a>{a.width && <span className="mp-muted"> · {a.width}×{a.height}</span>}</div></li>
                ))}</ul>}
              </>
            )}
          </Card>
        </div>
        <div>
          <Card className={stepCls(2)}>
            <div className="mp-card-head"><h2><span className="mp-today-no">2</span> {isDirectory ? "Formular öffnen" : "Plattform öffnen"}</h2></div>
            <div className="mp-inline">
              {(pkg.deepLink || pkg.profileLink) && <Button variant="primary" disabled={!ready} onClick={() => void openPlatform()}>{isDirectory ? pkg.deepLinkLabel ?? "Formular öffnen" : `Text kopieren & ${pkg.deepLinkLabel ?? pkg.profileLabel ?? "öffnen"}`} ↗</Button>}
              {pkg.profileLink && pkg.deepLink && <a className="mp-btn" href={pkg.profileLink} target="_blank" rel="noreferrer">{pkg.profileLabel ?? "Profil öffnen"} ↗</a>}
            </div>
            {pkg.appOnly && <p className="mp-small mp-muted" style={{ marginTop: 8 }}>Hochladen geht nur in der App: Datei aufs Handy, Text aus der Zwischenablage einfügen, Link in die Bio.</p>}
            {pkg.shortLink && (
              <dl className="mp-dl" style={{ marginTop: 12 }}>
                <dt>Kurzlink</dt><dd className="mp-inline"><code className="mp-code">{pkg.shortLink}</code><CopyButton text={pkg.shortLink} />{pkg.clicks > 0 && <span className="mp-small mp-muted">{pkg.clicks} Klick{pkg.clicks === 1 ? "" : "s"}</span>}</dd>
                <dt className="mp-muted">Ziel</dt><dd><code className="mp-code mp-break mp-small">{pkg.utmLink}</code></dd>
              </dl>
            )}
            {pkg.postizAvailable && p.status === "approved" && (
              <div className="mp-form mp-form--row" style={{ marginTop: 10 }}>
                <label className="mp-field mp-field--short"><span>Stattdessen planen (Postiz)</span><input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                <div className="mp-form-actions"><Button disabled={busy || !date} onClick={() => void schedule()}>Planen</Button></div>
              </div>
            )}
          </Card>
          <Card className={stepCls(3)}>
            <div className="mp-card-head"><h2><span className="mp-today-no">3</span> Fertig melden</h2>{published && <span className="mp-label">seit {new Date(p.publishedAt ?? p.updatedAt).toLocaleString("de-DE")}</span>}</div>
            <div className="mp-form">
              <label className="mp-field"><span>{isDirectory ? "URL des Eintrags (optional)" : "Link zum Beitrag (optional)"}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={published} /></label>
              <div className="mp-form-actions">
                <Button variant="primary" disabled={busy || published || !ready} onClick={() => void markPublished()}>{isDirectory ? "Als eingereicht abhaken" : "Als veröffentlicht markieren"}</Button>
                {published && p.externalUrl && <a className="mp-btn" href={p.externalUrl} target="_blank" rel="noreferrer">Beitrag öffnen ↗</a>}
                {published && <Link className="mp-btn" to={`/projects/${id}`}>Zurück zu Heute</Link>}
              </div>
              <p className="mp-small mp-muted">Setzt das Stück auf „veröffentlicht“, hakt die zugehörige Aufgabe ab und schaltet die Messung (Klicks, Signups) für dieses Stück frei.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
