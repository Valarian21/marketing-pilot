/** Musikbett: Tracks für die Reels hochladen, pausieren, löschen — mit Herkunftsnachweis je Datei. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MusicTrack, MusicUploadResult, MusicView } from "../../shared/schemas.js";
import { api, readToken } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill } from "../components/ui.js";

const LIZENZEN = ["Pixabay Content License", "CC0", "Public Domain"] as const;
const MIN_SEKUNDEN = 30;

const fmtDauer = (s: number | null) => (s === null ? "–" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const fmtBytes = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`);

export function MusicPage() {
  const [view, setView] = useState<MusicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hinweise, setHinweise] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [datei, setDatei] = useState<File | null>(null);
  const [form, setForm] = useState({ titel: "", urheber: "", quelle: "", lizenz: LIZENZEN[0] as string });
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => { try { setView(await api<MusicView>("/music")); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); } };

  const hochladen = () => run(async () => {
    if (!datei) throw new Error("Erst eine Datei wählen.");
    if (!form.titel.trim()) throw new Error("Der Titel fehlt — er wird der Dateiname.");
    const q = new URLSearchParams({ name: datei.name, titel: form.titel.trim(), urheber: form.urheber.trim(), quelle: form.quelle.trim(), lizenz: form.lizenz });
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream", Accept: "application/json" };
    const token = readToken(); if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/mp/music?${q.toString()}`, { method: "POST", headers, body: datei, credentials: "same-origin" });
    const data = (await res.json().catch(() => null)) as (MusicUploadResult & { detail?: string }) | null;
    if (!res.ok) throw new Error(data?.detail ?? `Fehler ${res.status}`);
    setHinweise(data?.warnings ?? []);
    setDatei(null); setForm({ titel: "", urheber: "", quelle: "", lizenz: form.lizenz });
    if (fileInput.current) fileInput.current.value = "";
  });

  const dateiGewaehlt = (f: File | null) => {
    setDatei(f);
    // Der Dateiname ist meist schon der Titel — vorbelegen, nicht erzwingen.
    if (f && !form.titel) setForm({ ...form, titel: f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() });
  };

  const aktive = view?.tracks.filter((t) => t.aktiv).length ?? 0;

  return (
    <>
      <PageHeader label="Inhalte" title="Musikbett" />
      {error && <Notice kind="bad">{error}</Notice>}
      {view && aktive === 0 && <Notice kind="warn">Kein aktiver Track — Reels werden stumm gerendert.</Notice>}
      {view && aktive > 0 && aktive < 6 && <Notice kind="info">{aktive} {aktive === 1 ? "aktiver Track" : "aktive Tracks"}. Ab sechs hört man die Wiederholung nicht mehr.</Notice>}

      <div className="mp-two-col">
        <Card className="mp-form-card">
          <h2>Track hochladen</h2>
          <label className="mp-field"><span>Datei (MP3, WAV, M4A, OGG · max. 40 MB)</span>
            <input ref={fileInput} type="file" accept=".mp3,.wav,.m4a,.ogg,audio/*" onChange={(e) => dateiGewaehlt(e.target.files?.[0] ?? null)} /></label>
          <label className="mp-field"><span>Titel</span><input className="mp-input" value={form.titel} onChange={(e) => setForm({ ...form, titel: e.target.value })} placeholder="z. B. Summer Run" /></label>
          <label className="mp-field"><span>Urheber</span><input className="mp-input" value={form.urheber} onChange={(e) => setForm({ ...form, urheber: e.target.value })} placeholder="Name auf der Quellseite" /></label>
          <label className="mp-field"><span>Quelle (Link zur Trackseite)</span><input className="mp-input" value={form.quelle} onChange={(e) => setForm({ ...form, quelle: e.target.value })} placeholder="https://pixabay.com/music/…" /></label>
          <label className="mp-field"><span>Lizenz</span>
            <select value={form.lizenz} onChange={(e) => setForm({ ...form, lizenz: e.target.value })}>{LIZENZEN.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
          <div className="mp-form-actions"><Button variant="primary" disabled={busy || !datei} onClick={() => void hochladen()}>{busy ? "…" : "Hochladen"}</Button></div>
          {hinweise.length > 0 && <Notice kind="warn">{hinweise.map((h) => <div key={h}>{h}</div>)}</Notice>}
          <p className="mp-small mp-muted">Nur Musik ohne Namensnennungspflicht: Pixabay Content License, CC0 oder Public Domain. CC-BY geht nicht — die Nennung müsste in jede Bildunterschrift. Passend für Reels: ohne Gesang, gleichmäßig ohne Drop in den ersten 20 s, 100–125 BPM, mindestens {MIN_SEKUNDEN} s.</p>
        </Card>

        <Card>
          <h2>Tracks im Bett</h2>
          {view && view.tracks.length === 0 && <p className="mp-muted">Noch keine Tracks.</p>}
          {view && view.tracks.length > 0 && (
            <div className="mp-table-wrap"><table className="mp-table">
              <thead><tr><th>Titel</th><th>Länge</th><th>Lizenz</th><th>Status</th><th></th></tr></thead>
              <tbody>{view.tracks.map((t) => <TrackZeile key={t.file} t={t} busy={busy} run={run} />)}</tbody>
            </table></div>
          )}
          <p className="mp-small mp-muted">Die Video-Fabrik wählt je Reel zufällig einen aktiven Track, mischt ihn leise unter die Stimme und blendet die letzten 2,5 s aus. Pausierte Tracks bleiben liegen, werden aber nicht benutzt.</p>
        </Card>
      </div>
    </>
  );
}

function TrackZeile({ t, busy, run }: { t: MusicTrack; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const kurz = t.seconds !== null && t.seconds < MIN_SEKUNDEN;
  return (
    <tr>
      <td><strong>{t.titel ?? t.name}</strong><br /><span className="mp-small mp-muted">{t.urheber ?? "Urheber unbekannt"} · {fmtBytes(t.bytes)}{t.geladen ? ` · ${t.geladen}` : ""}</span></td>
      <td>{fmtDauer(t.seconds)}{kurz && <><br /><span className="mp-small mp-muted">zu kurz</span></>}</td>
      <td>{t.lizenz ?? <span className="mp-muted">ohne Nachweis</span>}{t.quelle && t.quelle !== "—" && <><br /><a className="mp-small" href={t.quelle} target="_blank" rel="noreferrer">Quelle</a></>}</td>
      <td><Pill kind={t.aktiv ? "done" : "todo"}>{t.aktiv ? "aktiv" : "pausiert"}</Pill></td>
      <td className="mp-actions">
        <button type="button" className="mp-linkbtn mp-small" disabled={busy} onClick={() => void run(() => api(`/music/${encodeURIComponent(t.file)}/toggle`, { method: "POST" }))}>{t.aktiv ? "Pausieren" : "Aktivieren"}</button>
        {" · "}
        <button type="button" className="mp-linkbtn mp-small" disabled={busy} onClick={() => { if (window.confirm(`„${t.titel ?? t.name}" samt Nachweis löschen?`)) void run(() => api(`/music/${encodeURIComponent(t.file)}`, { method: "DELETE" })); }}>Löschen</button>
      </td>
    </tr>
  );
}
