/**
 * YouTube-Studio im Piloten: anmelden und planen lassen — Gegenstück zu
 * TiktokStudio.tsx. Derselbe Anmelde-Browser, dasselbe Muster: der Mensch
 * meldet sich bei Google selbst an, der Pilot trägt danach die freigegebenen
 * Beiträge mit Titel, Beschreibung, Schlagwörtern und Termin im Studio ein.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TiktokView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, Pill } from "./ui.js";

function termin(iso: string | null): string {
  if (!iso) return "ohne Termin";
  const d = new Date(new Date(iso).getTime() + 2 * 3600_000).toISOString();
  const wt = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(iso).getUTCDay()];
  return `${wt}, ${d.slice(8, 10)}.${d.slice(5, 7)}. · ${d.slice(11, 16)}`;
}

type StudioZahlen = {
  abgerufenAm: string; kanalId: string;
  kanal: { abonnenten: number | null; aufrufe28: number | null; wiedergabeStunden28: number | null };
  videos: { id: string; titel: string; datum: string; aufrufe: number | null; kommentare: number | null; likes: number | null }[];
  zugeordnet: number;
};

export function YoutubeStudio({ projectId }: { projectId: string }) {
  const [view, setView] = useState<TiktokView | null>(null);
  const [zahlen, setZahlen] = useState<StudioZahlen | null>(null);
  const [zahlenBusy, setZahlenBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vermerkt = useRef(false);

  const laden = useCallback(async () => {
    try { setView(await api<TiktokView>(`/projects/${projectId}/youtube`)); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Konnte den Stand nicht laden."); }
  }, [projectId]);

  useEffect(() => { void laden(); }, [laden]);
  useEffect(() => { void api<StudioZahlen | null>(`/projects/${projectId}/youtube/zahlen`).then(setZahlen).catch(() => {}); }, [projectId]);

  useEffect(() => {
    if (!view?.laeuft) return;
    const t = setInterval(() => void laden(), 3000);
    return () => clearInterval(t);
  }, [view?.laeuft, laden]);

  useEffect(() => {
    const lauf = view?.lauf;
    if (!lauf || lauf.laeuft || lauf.probe || vermerkt.current) return;
    vermerkt.current = true;
    void api(`/projects/${projectId}/youtube/vermerken`, { method: "POST" }).then(() => laden());
  }, [view?.lauf, projectId, laden]);

  async function ruf<T>(pfad: string, init?: RequestInit & { json?: unknown }) {
    setBusy(true); setFehler(null);
    try { setView(await api<T>(pfad, init) as TiktokView); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Hat nicht geklappt."); }
    finally { setBusy(false); }
  }

  const lauf = view?.lauf ?? null;
  const wartend = view?.wartend ?? [];
  // `path` ausgeschrieben — noVNC hängt ihn an die Wurzel (siehe TiktokStudio.tsx).
  const rahmenUrl = view?.passwort
    ? "/api/mp/youtube/vnc/vnc.html?autoconnect=1&resize=remote"
      + "&path=api%2Fmp%2Fyoutube%2Fvnc%2Fwebsockify"
      + `&password=${encodeURIComponent(view.passwort)}`
    : null;

  return (
    <Card>
      <div className="mp-card-head">
        <h2>Im YouTube-Studio planen</h2>
        <span className="mp-inline">
          {view?.angemeldet && <Pill kind="done">angemeldet</Pill>}
          {view?.laeuft && !view.angemeldet && <Pill kind="progress">Browser läuft</Pill>}
          <Pill kind={wartend.length ? "todo" : "done"}>{wartend.length} wartend</Pill>
        </span>
      </div>
      {fehler && <Notice kind="bad">{fehler}</Notice>}

      <p className="mp-small mp-muted">
        Ohne Google-Projekt gibt es keine Upload-API. Der Pilot fährt stattdessen einen echten Browser auf dem
        Server hoch, du meldest dich darin <strong>selbst</strong> bei Google an — dein Passwort wird nirgends
        gespeichert — und danach trägt er die freigegebenen Beiträge im Studio ein: Titel, Beschreibung mit
        Kurzlink, Schlagwörter, „nicht für Kinder", Termin. Shorts bekommen auf dem Desktop kein eigenes
        Vorschaubild; dafür legt der Pilot die Titelkarte über den Anfang des Videos.
      </p>

      <div className="mp-inline" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {!view?.laeuft && (
          <Button variant="primary" disabled={busy}
            onClick={() => void ruf(`/projects/${projectId}/youtube/sitzung`, { method: "POST" })}>
            Browser öffnen & anmelden
          </Button>
        )}
        {view?.angemeldet && !lauf?.laeuft && (
          <>
            <Button disabled={busy || zahlenBusy}
              onClick={async () => {
                setZahlenBusy(true); setFehler(null);
                try { setZahlen(await api<StudioZahlen>(`/projects/${projectId}/youtube/zahlen`, { method: "POST" })); }
                catch (e) { setFehler(e instanceof Error ? e.message : "Zahlen ließen sich nicht lesen."); }
                finally { setZahlenBusy(false); }
              }}>
              {zahlenBusy ? "Liest das Studio …" : "Zahlen aus dem Studio holen"}
            </Button>
            <Button variant="primary" disabled={busy || !wartend.length}
              onClick={() => void ruf(`/projects/${projectId}/youtube/planen`, { method: "POST", json: { probe: false } })}>
              {wartend.length} Beiträge einplanen
            </Button>
            <Button disabled={busy || !wartend.length}
              onClick={() => void ruf(`/projects/${projectId}/youtube/planen`, { method: "POST", json: { probe: true } })}>
              Probelauf (füllt aus, schickt nicht ab)
            </Button>
          </>
        )}
        {view?.laeuft && !lauf?.laeuft && (
          <Button disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await api(`/projects/${projectId}/youtube/sitzung`, { method: "DELETE" }); await laden(); }
              catch (e) { setFehler(e instanceof Error ? e.message : "Konnte nicht beenden."); }
              finally { setBusy(false); }
            }}>
            Browser schließen
          </Button>
        )}
      </div>

      {view?.laeuft && rahmenUrl && (
        <>
          <p className="mp-small" style={{ marginTop: 12 }}>
            {view.angemeldet
              ? "Angemeldet. Das Fenster bleibt sichtbar, damit du dem Planungslauf zusehen kannst."
              : "Melde dich unten mit dem Google-Konto des Kanals @binderplanapp an. Sobald das Studio geladen ist, springt die Anzeige oben auf „angemeldet“."}
          </p>
          <iframe title="YouTube-Anmeldung" src={rahmenUrl}
            style={{ width: "100%", height: 620, border: "1px solid var(--line, #ddd)", borderRadius: 8, marginTop: 8, background: "#000" }} />
        </>
      )}

      {zahlen && (
        <details style={{ marginTop: 12 }} open>
          <summary className="mp-small">
            Studio-Stand {new Date(zahlen.abgerufenAm).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: {zahlen.kanal.abonnenten ?? "–"} Abonnenten · {zahlen.kanal.aufrufe28 ?? "–"} Aufrufe und {zahlen.kanal.wiedergabeStunden28 ?? "–"} h Wiedergabezeit in 28 Tagen · {zahlen.videos.length} Videos, {zahlen.zugeordnet} davon Beiträgen des Piloten zugeordnet
          </summary>
          <table className="mp-table mp-small" style={{ marginTop: 6 }}>
            <thead><tr><th>Video</th><th>Datum</th><th style={{ textAlign: "right" }}>Aufrufe</th><th style={{ textAlign: "right" }}>Likes</th><th style={{ textAlign: "right" }}>Kommentare</th></tr></thead>
            <tbody>
              {[...zahlen.videos].sort((a, b) => (b.aufrufe ?? 0) - (a.aufrufe ?? 0)).map((v) => (
                <tr key={v.id}>
                  <td><a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer">{v.titel}</a></td>
                  <td>{v.datum}</td>
                  <td style={{ textAlign: "right" }}>{v.aufrufe ?? "–"}</td>
                  <td style={{ textAlign: "right" }}>{v.likes ?? "–"}</td>
                  <td style={{ textAlign: "right" }}>{v.kommentare ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {lauf && (
        <div style={{ marginTop: 12 }}>
          <p className="mp-small">
            {lauf.laeuft
              ? `Läuft … ${lauf.erledigt} von ${lauf.gesamt}${lauf.aktuell ? ` · gerade: ${lauf.aktuell}` : ""}`
              : `${lauf.probe ? "Probelauf" : "Lauf"} fertig — ${lauf.zeilen.filter((z) => z.status === "geplant").length} eingeplant, ${lauf.zeilen.filter((z) => z.status === "fehler").length} Fehler.`}
          </p>
          <ul className="mp-small mp-muted" style={{ marginTop: 6, paddingLeft: 18 }}>
            {lauf.zeilen.map((z, i) => (
              <li key={`${z.pieceId}-${i}`}>
                {z.status === "geplant" ? "✓" : z.status === "fehler" ? "✗" : "–"} {z.titel} · {z.meldung}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!lauf && wartend.length > 0 && (
        <ul className="mp-small mp-muted" style={{ marginTop: 10, paddingLeft: 18 }}>
          {wartend.map((w) => <li key={w.pieceId}>{termin(w.geplantAm)} · {w.titel}</li>)}
        </ul>
      )}
      {(view?.uebersprungen ?? []).length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="mp-small mp-muted">{view?.uebersprungen.length} bleiben liegen</summary>
          <ul className="mp-small mp-muted" style={{ marginTop: 6, paddingLeft: 18 }}>
            {view?.uebersprungen.map((z, i) => <li key={`${z.pieceId}-${i}`}>{z.titel} · {z.meldung}</li>)}
          </ul>
        </details>
      )}
    </Card>
  );
}
