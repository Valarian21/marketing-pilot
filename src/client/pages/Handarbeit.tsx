/**
 * Handarbeit — die Warteschlange für TikTok, YouTube Shorts und Pinterest.
 *
 * Diese Kanäle haben keine Veröffentlichungs-API. Bisher führte der Weg über
 * die Publish-Seite, und die zeigt genau ein Stück: für eine Woche TikTok wären
 * das sieben Einzelaufrufe. Am 13.09.2026 lagen deshalb 24 freigegebene
 * TikTok-Stücke ungenutzt herum — auf dem Kanal, der mit 4.123 Aufrufen die
 * meiste Reichweite von allen hatte.
 *
 * Hier liegt alles nebeneinander: Termin, Video zum Laden, Text zum Kopieren,
 * Bio-Link, Haken. Und „Verteilen" gibt einem Stapel offener Stücke auf einen
 * Schlag Termine für die nächsten Wochen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type { HandarbeitView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { Button, Card, CopyButton, Notice, PageHeader, Pill } from "../components/ui.js";
import { TiktokStudio } from "../components/TiktokStudio.js";
import { YoutubeStudio } from "../components/YoutubeStudio.js";
import { PinterestStudio } from "../components/PinterestStudio.js";

const heuteIso = () => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);

/** „Di, 16.09. · 18:00" — Berliner Zeit, ohne Bibliothek. */
function termin(iso: string | null): string {
  if (!iso) return "ohne Termin";
  const d = new Date(new Date(iso).getTime() + 2 * 3600_000);
  const wt = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getUTCDay()];
  const s = d.toISOString();
  return `${wt}, ${s.slice(8, 10)}.${s.slice(5, 7)}. · ${s.slice(11, 16)}`;
}

export function HandarbeitPage() {
  const { id = "" } = useParams();
  const [suche, setSuche] = useSearchParams();
  const platform = suche.get("platform") ?? "tiktok";
  const [view, setView] = useState<HandarbeitView | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ab, setAb] = useState(heuteIso());
  const [stunde, setStunde] = useState(18);
  const [proTag, setProTag] = useState(1);
  const [anzahl, setAnzahl] = useState(14);

  const laden = useCallback(async () => {
    try { setView(await api<HandarbeitView>(`/projects/${id}/handarbeit`)); setFehler(null); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Konnte nicht laden."); }
  }, [id]);
  useEffect(() => { void laden(); }, [laden]);

  const meine = useMemo(() => (view?.eintraege ?? []).filter((e) => e.platform === platform), [view, platform]);
  const kanal = view?.kanaele.find((k) => k.platform === platform);

  async function verteilen() {
    setBusy(true);
    try {
      const r = await api<{ gesetzt: number }>(`/projects/${id}/handarbeit/verteilen`,
        { method: "POST", json: { platform, ab, stunde, proTag, anzahl } });
      setFehler(r.gesetzt ? null : "Nichts zu verteilen — alle Stücke haben schon einen Termin.");
      await laden();
    } catch (e) { setFehler(e instanceof Error ? e.message : "Verteilen fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function abhaken(pieceId: string, geplantAm: string | null) {
    setBusy(true);
    try {
      await api(`/projects/${id}/publish/extern`, { method: "POST", json: {
        pieceId, platform, scheduledAt: geplantAm ?? new Date().toISOString(), externalUrl: "", posted: true } });
      await laden();
    } catch (e) { setFehler(e instanceof Error ? e.message : "Konnte nicht abhaken."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Handarbeit" title="TikTok, YouTube & Pinterest vorbereiten"
        actions={kanal?.profilUrl ? <a className="mp-btn" href={kanal.profilUrl} target="_blank" rel="noreferrer">Profil öffnen ↗</a> : null} />
      {fehler && <Notice kind="bad">{fehler}</Notice>}

      <Card>
        <div className="mp-inline" style={{ flexWrap: "wrap", gap: 8 }}>
          {(view?.kanaele ?? []).map((k) => (
            <button key={k.platform} type="button"
              className={`mp-btn ${k.platform === platform ? "mp-btn--primary" : ""}`}
              onClick={() => setSuche({ platform: k.platform })}>
              {k.label} · {k.offen + k.geplant} offen
            </button>
          ))}
        </div>
        {kanal && (
          <p className="mp-small mp-muted" style={{ marginTop: 10 }}>
            {kanal.offen} ohne Termin · {kanal.geplant} eingeplant · {kanal.gepostet} gepostet.
            {" "}Auf {kanal.label} lädst du selbst hoch — der Pilot legt Video und Text bereit.
          </p>
        )}
      </Card>

      {platform === "tiktok" && <TiktokStudio projectId={id} />}
      {platform === "youtube" && <YoutubeStudio projectId={id} />}
      {platform === "pinterest" && <PinterestStudio projectId={id} />}

      <Card>
        <div className="mp-card-head"><h2>Termine vergeben</h2></div>
        <p className="mp-small mp-muted">Verteilt nur Stücke <strong>ohne</strong> Termin. Ein zweiter Lauf füllt auf, statt zu verschieben.</p>
        <div className="mp-form mp-form--row" style={{ marginTop: 10 }}>
          <label className="mp-field mp-field--short"><span>Ab</span>
            <input className="mp-input" type="date" value={ab} onChange={(e) => setAb(e.target.value)} /></label>
          <label className="mp-field mp-field--short"><span>Uhrzeit</span>
            <input className="mp-input" type="number" min={0} max={23} value={stunde} onChange={(e) => setStunde(Number(e.target.value))} /></label>
          <label className="mp-field mp-field--short"><span>Je Tag</span>
            <input className="mp-input" type="number" min={1} max={5} value={proTag} onChange={(e) => setProTag(Number(e.target.value))} /></label>
          <label className="mp-field mp-field--short"><span>Wie viele</span>
            <input className="mp-input" type="number" min={1} max={60} value={anzahl} onChange={(e) => setAnzahl(Number(e.target.value))} /></label>
          <Button variant="primary" disabled={busy || !kanal?.offen} onClick={() => void verteilen()}>
            {proTag === 1 ? `Auf ${anzahl} Tage verteilen` : `Verteilen (${proTag}/Tag)`}
          </Button>
        </div>
      </Card>

      {meine.length === 0 && <Notice kind="info">Für diesen Kanal liegt nichts Freigegebenes bereit. Stücke aus der Freigabe landen hier automatisch.</Notice>}

      {meine.map((e) => (
        <Card key={e.pieceId} className={e.gepostet ? "mp-handarbeit is-done" : "mp-handarbeit"}>
          <div className="mp-card-head">
            <h2 style={{ fontSize: "var(--t-l, 16px)" }}>{e.titel}</h2>
            <span className="mp-inline">
              <Pill kind={e.gepostet ? "done" : e.geplantAm ? "progress" : "todo"}>{e.gepostet ? "gepostet" : termin(e.geplantAm)}</Pill>
              {!e.gepostet && <Button disabled={busy} onClick={() => void abhaken(e.pieceId, e.geplantAm)}>Gepostet ✓</Button>}
            </span>
          </div>
          {e.hinweise.map((h, i) => <p key={i} className="mp-small mp-muted">{h}</p>)}
          <div className="mp-inline" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {e.dateien.map((d) => (
              <a key={d.id} className="mp-btn" href={d.url} download={d.filename}>⬇ {d.filename}</a>
            ))}
            <CopyButton text={e.text} label="Text kopieren" variant="primary" />
            {e.linkFuerBio && <CopyButton text={e.linkFuerBio} label="Bio-Link kopieren" />}
          </div>
          <pre className="mp-pre mp-pre--post" style={{ marginTop: 10 }}>{e.text}</pre>
        </Card>
      ))}
    </>
  );
}
