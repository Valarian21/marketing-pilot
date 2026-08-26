/** Publish package: text to copy, assets, UTM link, deep link, "mark as published" - and the directory submit view. */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { PublishPackage } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";

function CopyButton({ text, label = "Kopieren" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <Button onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>{done ? "Kopiert" : label}</Button>;
}

export function PublishPage() {
  const { id = "", pieceId = "" } = useParams();
  const [pkg, setPkg] = useState<PublishPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { const p = await api<PublishPackage>(`/content/${pieceId}/package`); setPkg(p); setUrl(p.piece.externalUrl ?? ""); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [pieceId]);
  useEffect(() => { void load(); }, [load]);

  const markPublished = async () => {
    setBusy(true); setError(null);
    try { await api(`/content/${pieceId}`, { method: "PATCH", json: { status: "published", externalUrl: url } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  const schedule = async () => {
    setBusy(true); setError(null);
    try { await api(`/content/${pieceId}/schedule`, { method: "POST", json: { date: new Date(date).toISOString() } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };

  if (!pkg) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  const p = pkg.piece;
  const fields = (p.meta["fields"] ?? null) as Record<string, string | string[]> | null;
  const isDirectory = p.format === "directory_entry" && fields;

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label={isDirectory ? "Einreichen" : "Publish-Paket"} title={p.title || p.format} actions={<Pill kind={p.status === "published" ? "done" : "review"}>{p.status === "published" ? "veröffentlicht" : p.status === "approved" ? "freigegeben" : p.status}</Pill>} />
      {error && <Notice kind="bad">{error}</Notice>}
      {p.status !== "approved" && p.status !== "published" && <Notice kind="warn">Dieses Stück ist noch nicht freigegeben – <Link to={`/projects/${id}/review?piece=${p.id}`}>zur Freigabe</Link>.</Notice>}
      {pkg.notes.map((n, i) => <Notice key={i} kind="info">{n}</Notice>)}

      <div className="mp-two-col">
        <Card>
          {isDirectory ? (
            <>
              <h2>Felder zum Kopieren</h2>
              {Object.entries(fields).map(([k, v]) => {
                const val = Array.isArray(v) ? v.join(", ") : String(v);
                return (<div key={k} className="mp-field-copy"><div className="mp-card-head"><span className="mp-label">{k} <span className="mp-muted">({val.length} Zeichen)</span></span><CopyButton text={val} /></div><pre className="mp-pre">{val}</pre></div>);
              })}
            </>
          ) : (
            <>
              <div className="mp-card-head"><h2>Text</h2><CopyButton text={pkg.text} label="Text kopieren" /></div>
              <pre className="mp-pre mp-pre--post">{pkg.text}</pre>
              {p.format === "article" && <a className="mp-btn" href={`/api/mp/content/${p.id}/export.html`}>HTML-Export (mit JSON-LD)</a>}
            </>
          )}
        </Card>
        <div>
          <Card>
            <h2>Veröffentlichen</h2>
            <dl className="mp-dl">
              <dt>Plattform</dt><dd>{pkg.platform}</dd>
              {pkg.utmLink && <><dt>UTM-Link</dt><dd className="mp-inline"><code className="mp-code mp-break">{pkg.utmLink}</code><CopyButton text={pkg.utmLink} /></dd></>}
              {pkg.deepLink && <><dt>Upload</dt><dd><a className="mp-btn mp-btn--primary" href={pkg.deepLink} target="_blank" rel="noreferrer">{pkg.deepLinkLabel ?? "Öffnen"}</a></dd></>}
            </dl>
            <div className="mp-form">
              <label className="mp-field"><span>{isDirectory ? "URL des Eintrags (nach Einreichen)" : "Externe URL des Posts"}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={p.status === "published"} /></label>
              <div className="mp-form-actions">
                <Button variant="primary" disabled={busy || p.status === "published" || p.status !== "approved"} onClick={() => void markPublished()}>{isDirectory ? "Als eingereicht abhaken" : "Als veröffentlicht markieren"}</Button>
                {p.status === "published" && <span className="mp-label">seit {new Date(p.publishedAt ?? p.updatedAt).toLocaleString("de-DE")}</span>}
              </div>
              {pkg.postizAvailable && p.status === "approved" && (
                <div className="mp-form mp-form--row">
                  <label className="mp-field mp-field--short"><span>Jetzt planen (Postiz)</span><input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                  <div className="mp-form-actions"><Button disabled={busy || !date} onClick={() => void schedule()}>Planen</Button></div>
                </div>
              )}
            </div>
          </Card>
          {pkg.assets.length > 0 && (
            <Card>
              <h2>Assets</h2>
              <ul className="mp-assets">{pkg.assets.map((a) => (
                <li key={a.id}><a href={a.url} download={a.filename}><img src={a.url} alt="" loading="lazy" /></a><div className="mp-small"><a href={a.url} download={a.filename}>{a.filename}</a>{a.width && <span className="mp-muted"> · {a.width}×{a.height}</span>}{a.aiGenerated && <Pill kind="kind">KI-Kennzeichnung</Pill>}</div></li>
              ))}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
