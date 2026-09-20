/**
 * Pinterest im Piloten: anmelden, Profil füllen, Pins setzen — Gegenstück zu
 * YoutubeStudio.tsx. Derselbe Anmelde-Browser, dasselbe Muster: der Mensch
 * meldet sich bei Pinterest selbst an, der Pilot füllt danach das Profil aus
 * dem Social-Kit und legt die freigegebenen Pinterest-Stücke als Pins an.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TiktokView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, Pill } from "./ui.js";

export function PinterestStudio({ projectId }: { projectId: string }) {
  const [view, setView] = useState<TiktokView | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vermerkt = useRef(false);

  const laden = useCallback(async () => {
    try { setView(await api<TiktokView>(`/projects/${projectId}/pinterest`)); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Konnte den Stand nicht laden."); }
  }, [projectId]);

  useEffect(() => { void laden(); }, [laden]);
  useEffect(() => {
    if (!view?.laeuft) return;
    const t = setInterval(() => void laden(), 3000);
    return () => clearInterval(t);
  }, [view?.laeuft, laden]);
  useEffect(() => {
    const lauf = view?.lauf;
    if (!lauf || lauf.laeuft || lauf.probe || vermerkt.current) return;
    vermerkt.current = true;
    void api(`/projects/${projectId}/pinterest/vermerken`, { method: "POST" }).then(() => laden());
  }, [view?.lauf, projectId, laden]);

  async function ruf<T>(pfad: string, init?: RequestInit & { json?: unknown }) {
    setBusy(true); setFehler(null); vermerkt.current = false;
    try { setView(await api<T>(pfad, init) as TiktokView); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Hat nicht geklappt."); }
    finally { setBusy(false); }
  }

  const lauf = view?.lauf ?? null;
  const wartend = view?.wartend ?? [];
  const rahmenUrl = view?.passwort
    ? "/api/mp/pinterest/vnc/vnc.html?autoconnect=1&resize=remote"
      + "&path=api%2Fmp%2Fpinterest%2Fvnc%2Fwebsockify"
      + `&password=${encodeURIComponent(view.passwort)}`
    : null;

  return (
    <Card>
      <div className="mp-card-head">
        <h2>Pinterest: Profil und Pins</h2>
        <span className="mp-inline">
          {view?.angemeldet && <Pill kind="done">angemeldet</Pill>}
          {view?.laeuft && !view.angemeldet && <Pill kind="progress">Browser läuft</Pill>}
          <Pill kind={wartend.length ? "todo" : "done"}>{wartend.length} Pins wartend</Pill>
        </span>
      </div>
      {fehler && <Notice kind="bad">{fehler}</Notice>}

      <p className="mp-small mp-muted">
        Die Pinterest-API bräuchte eine registrierte App mit Zugangsprüfung. Stattdessen fährt der Pilot einen
        echten Browser hoch, du meldest dich darin <strong>selbst</strong> bei Pinterest an — dein Passwort wird
        nirgends gespeichert. Danach füllt er das Profil (Name, Info, Website, Profilbild aus dem Social-Kit) und
        setzt die freigegebenen Pinterest-Stücke als Pins auf die Pinnwand „Binderseiten": Bild, Titel,
        Beschreibung ohne Hashtags, Link <code>binderplan.app/pin</code>. Pins gehen sofort raus, höchstens fünf je Lauf.
      </p>

      <div className="mp-inline" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {!view?.laeuft && (
          <Button variant="primary" disabled={busy}
            onClick={() => void ruf(`/projects/${projectId}/pinterest/sitzung`, { method: "POST" })}>
            Browser öffnen & anmelden
          </Button>
        )}
        {view?.angemeldet && !lauf?.laeuft && (
          <>
            <Button disabled={busy}
              onClick={() => void ruf(`/projects/${projectId}/pinterest/profil`, { method: "POST", json: { probe: true } })}>
              Profil ausfüllen (Probe)
            </Button>
            <Button variant="primary" disabled={busy}
              onClick={() => void ruf(`/projects/${projectId}/pinterest/profil`, { method: "POST", json: { probe: false } })}>
              Profil ausfüllen & speichern
            </Button>
            <Button disabled={busy || !wartend.length}
              onClick={() => void ruf(`/projects/${projectId}/pinterest/pinnen`, { method: "POST", json: { probe: true } })}>
              Probelauf: einen Pin ausfüllen
            </Button>
            <Button variant="primary" disabled={busy || !wartend.length}
              onClick={() => void ruf(`/projects/${projectId}/pinterest/pinnen`, { method: "POST", json: { probe: false, hoechstens: 5 } })}>
              Bis zu 5 Pins setzen
            </Button>
          </>
        )}
        {view?.laeuft && !lauf?.laeuft && (
          <Button disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await api(`/projects/${projectId}/pinterest/sitzung`, { method: "DELETE" }); await laden(); }
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
              ? "Angemeldet. Das Fenster bleibt sichtbar, damit du dem Lauf zusehen kannst."
              : "Melde dich unten mit dem Pinterest-Konto von Binderplan an. Sobald die Startseite geladen ist, springt die Anzeige oben auf „angemeldet“."}
          </p>
          <iframe title="Pinterest-Anmeldung" src={rahmenUrl}
            style={{ width: "100%", height: 620, border: "1px solid var(--line, #ddd)", borderRadius: 8, marginTop: 8, background: "#000" }} />
        </>
      )}

      {lauf && (
        <div style={{ marginTop: 12 }}>
          <p className="mp-small">
            {lauf.laeuft
              ? `Läuft … ${lauf.erledigt} von ${lauf.gesamt}${lauf.aktuell ? ` · gerade: ${lauf.aktuell}` : ""}`
              : `${lauf.probe ? "Probelauf" : "Lauf"} fertig — ${lauf.zeilen.filter((z) => z.status === "geplant").length} erledigt, ${lauf.zeilen.filter((z) => z.status === "fehler").length} Fehler.`}
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
          {wartend.map((w) => <li key={w.pieceId}>{w.titel}</li>)}
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
