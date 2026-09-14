/**
 * TikTok-Studio im Piloten: anmelden und planen lassen.
 *
 * Der Knopf „Anmelden“ fährt auf dem Server einen echten Chrome hoch und zeigt
 * ihn hier im Rahmen. Wer sich anmeldet, tippt sein Passwort in diesen Browser
 * — der Pilot speichert es nicht und sieht es nicht. Danach trägt der
 * Planungslauf die freigegebenen Beiträge selbst im Studio ein.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TiktokView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, Pill } from "./ui.js";

/** „Di, 16.09. · 18:00" — Berliner Zeit, ohne Bibliothek. */
function termin(iso: string | null): string {
  if (!iso) return "ohne Termin";
  const d = new Date(new Date(iso).getTime() + 2 * 3600_000).toISOString();
  const wt = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(iso).getUTCDay()];
  return `${wt}, ${d.slice(8, 10)}.${d.slice(5, 7)}. · ${d.slice(11, 16)}`;
}

export function TiktokStudio({ projectId }: { projectId: string }) {
  const [view, setView] = useState<TiktokView | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vermerkt = useRef(false);

  const laden = useCallback(async () => {
    try { setView(await api<TiktokView>(`/projects/${projectId}/tiktok`)); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Konnte den Stand nicht laden."); }
  }, [projectId]);

  useEffect(() => { void laden(); }, [laden]);

  // Solange der Browser läuft oder ein Lauf unterwegs ist, alle drei Sekunden
  // nachsehen — die Anmeldung passiert ja im Rahmen, ohne Zutun des Piloten.
  useEffect(() => {
    if (!view?.laeuft) return;
    const t = setInterval(() => void laden(), 3000);
    return () => clearInterval(t);
  }, [view?.laeuft, laden]);

  // Ein echter Lauf, der durch ist: einmal vermerken, was jetzt im Studio liegt.
  useEffect(() => {
    const lauf = view?.lauf;
    if (!lauf || lauf.laeuft || lauf.probe || vermerkt.current) return;
    vermerkt.current = true;
    void api(`/projects/${projectId}/tiktok/vermerken`, { method: "POST" }).then(() => laden());
  }, [view?.lauf, projectId, laden]);

  async function ruf<T>(pfad: string, init?: RequestInit & { json?: unknown }) {
    setBusy(true); setFehler(null);
    try { setView(await api<T>(pfad, init) as TiktokView); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Hat nicht geklappt."); }
    finally { setBusy(false); }
  }

  const lauf = view?.lauf ?? null;
  const wartend = view?.wartend ?? [];
  // noVNC bekommt das Passwort gleich mit — sonst müsste man es abtippen.
  const rahmenUrl = view?.passwort
    ? `/api/mp/tiktok/vnc/vnc.html?autoconnect=1&resize=remote&password=${encodeURIComponent(view.passwort)}`
    : null;

  return (
    <Card>
      <div className="mp-card-head">
        <h2>Im TikTok-Studio planen</h2>
        <span className="mp-inline">
          {view?.angemeldet && <Pill kind="done">angemeldet</Pill>}
          {view?.laeuft && !view.angemeldet && <Pill kind="progress">Browser läuft</Pill>}
          <Pill kind={wartend.length ? "todo" : "done"}>{wartend.length} wartend</Pill>
        </span>
      </div>
      {fehler && <Notice kind="bad">{fehler}</Notice>}

      <p className="mp-small mp-muted">
        TikTok hat keine Posting-API. Der Pilot fährt stattdessen einen echten Browser auf dem Server hoch,
        du meldest dich darin <strong>selbst</strong> an — dein Passwort wird nirgends gespeichert — und
        danach trägt er die freigegebenen Beiträge im Studio ein.
        {" "}TikTok plant höchstens <strong>10 Tage</strong> voraus; was weiter weg liegt, holt der nächste Lauf.
      </p>

      <div className="mp-inline" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {!view?.laeuft && (
          <Button variant="primary" disabled={busy}
            onClick={() => void ruf(`/projects/${projectId}/tiktok/sitzung`, { method: "POST" })}>
            Browser öffnen & anmelden
          </Button>
        )}
        {view?.angemeldet && !lauf?.laeuft && (
          <>
            <Button variant="primary" disabled={busy || !wartend.length}
              onClick={() => void ruf(`/projects/${projectId}/tiktok/planen`, { method: "POST", json: { probe: false } })}>
              {wartend.length} Beiträge einplanen
            </Button>
            <Button disabled={busy || !wartend.length}
              onClick={() => void ruf(`/projects/${projectId}/tiktok/planen`, { method: "POST", json: { probe: true } })}>
              Probelauf (füllt aus, schickt nicht ab)
            </Button>
          </>
        )}
        {view?.laeuft && !lauf?.laeuft && (
          <Button disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await api(`/projects/${projectId}/tiktok/sitzung`, { method: "DELETE" }); await laden(); }
              catch (e) { setFehler(e instanceof Error ? e.message : "Konnte nicht beenden."); }
              finally { setBusy(false); }
            }}>
            Browser schließen
          </Button>
        )}
      </div>

      {view?.laeuft && !view.angemeldet && rahmenUrl && (
        <>
          <p className="mp-small" style={{ marginTop: 12 }}>
            Melde dich unten an — am bequemsten über <strong>„QR-Code nutzen“</strong> mit der TikTok-App,
            dann tippst du gar kein Passwort. Sobald dein Profil da ist, springt die Anzeige oben auf „angemeldet“.
          </p>
          <iframe title="TikTok-Anmeldung" src={rahmenUrl}
            style={{ width: "100%", height: 620, border: "1px solid var(--line, #ddd)", borderRadius: 8, marginTop: 8, background: "#000" }} />
        </>
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
