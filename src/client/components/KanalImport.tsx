/**
 * Analytics-Export einspielen — für Kanäle, die der Pilot nicht lesen kann.
 *
 * TikTok gibt seine Zahlen nur als Datei heraus (Analytics → Daten
 * herunterladen, XLSX oder CSV). Der Ablauf hier ist zweistufig, weil ein
 * Export keine Fehler verzeiht: erst zeigt der Pilot, welche Spalten er erkannt
 * hat und welche Tage entstünden, dann speichert ein zweiter Klick. Wer die
 * falsche Datei wählt, sieht das an der Vorschau, nicht an kaputten Zahlen.
 */
import { useRef, useState } from "react";
import type { KanalImportErgebnis } from "../../shared/schemas.js";
import { ApiError, readToken } from "../api.js";
import { Button, Notice } from "./ui.js";
import { tagKurz, zahl } from "./charts.js";

/** Kanäle ohne Lese-API, für die ein Export Sinn ergibt. */
const EXPORT_KANAELE: { id: string; label: string; hilfe: string }[] = [
  { id: "tiktok", label: "TikTok", hilfe: `TikTok Studio → Analytics → „Daten herunterladen" → Übersicht (XLSX oder CSV).` },
  { id: "pinterest", label: "Pinterest", hilfe: "Pinterest Analytics → Übersicht → Exportieren (CSV)." },
  { id: "youtube", label: "YouTube", hilfe: "YouTube Studio → Analytics → Erweiterter Modus → Exportieren (CSV)." },
];

const FELD_LABEL: Record<string, string> = {
  tag: "Datum", aufrufe: "Aufrufe", profilaufrufe: "Profilaufrufe", reichweite: "Reichweite", interaktionen: "Interaktionen",
  likes: "Likes", kommentare: "Kommentare", geteilt: "Geteilt", follower: "Follower (Bestand)", neueFollower: "Neue Follower",
};
const SPALTEN = ["aufrufe", "profilaufrufe", "likes", "kommentare", "geteilt", "interaktionen", "follower", "neueFollower"] as const;

async function hochladen(projectId: string, platform: string, datei: File, speichern: boolean): Promise<KanalImportErgebnis> {
  const typ = /\.xlsx$/i.test(datei.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
  const headers: Record<string, string> = { "Content-Type": typ, Accept: "application/json" };
  const token = readToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const q = new URLSearchParams({ platform, name: datei.name, speichern: String(speichern) });
  const res = await fetch(`/api/mp/projects/${projectId}/kanal-stats/import?${q.toString()}`, { method: "POST", headers, body: datei, credentials: "same-origin" });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { detail?: string } | null)?.detail ?? `Fehler ${res.status}`);
  return data as KanalImportErgebnis;
}

export function KanalImport({ projectId, vorhanden, onGespeichert }: { projectId: string; vorhanden: string[]; onGespeichert: () => void }) {
  const [offen, setOffen] = useState(false);
  const [platform, setPlatform] = useState("tiktok");
  const [datei, setDatei] = useState<File | null>(null);
  const [vorschau, setVorschau] = useState<KanalImportErgebnis | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fertig, setFertig] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const kanal = EXPORT_KANAELE.find((k) => k.id === platform) ?? EXPORT_KANAELE[0]!;
  const zuruecksetzen = () => { setDatei(null); setVorschau(null); setFehler(null); if (fileInput.current) fileInput.current.value = ""; };

  const dateiGewaehlt = async (f: File | null) => {
    setDatei(f); setVorschau(null); setFehler(null); setFertig(null);
    if (!f) return;
    setBusy(true);
    try { setVorschau(await hochladen(projectId, platform, f, false)); }
    catch (e) { setFehler(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };

  const speichern = async () => {
    if (!datei) return;
    setBusy(true); setFehler(null);
    try {
      const r = await hochladen(projectId, platform, datei, true);
      setFertig(`${r.gespeichert} Tage für ${kanal.label} gespeichert${r.tage.length ? ` (${tagKurz(r.tage[0]!.tag)} bis ${tagKurz(r.tage.at(-1)!.tag)})` : ""}.`);
      zuruecksetzen();
      onGespeichert();
    } catch (e) { setFehler(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };

  // Nur Spalten zeigen, die der Export auch gefüllt hat — leere Spalten wären Rauschen.
  const gefuellt = SPALTEN.filter((sp) => vorschau?.tage.some((t) => typeof t.werte[sp] === "number"));

  return (
    <div className="mp-kanal-import">
      <div className="mp-kanal-import-kopf">
        <span className="mp-small mp-muted">
          {vorhanden.length ? `Aus Exporten: ${vorhanden.map((p) => EXPORT_KANAELE.find((k) => k.id === p)?.label ?? p).join(", ")}. ` : "TikTok, Pinterest und YouTube haben keine Lese-API — "}
          {vorhanden.length ? "Neuen Export einspielen, sobald es weitere Tage gibt." : "ihre Zahlen kommen aus dem Analytics-Export."}
        </span>
        <button type="button" className="mp-linkbtn mp-small" onClick={() => { setOffen(!offen); setFertig(null); }}>{offen ? "Schließen" : "Export einspielen"}</button>
      </div>
      {fertig && !offen && <Notice kind="info">{fertig}</Notice>}
      {offen && (
        <div className="mp-kanal-import-form">
          <div className="mp-form-row">
            <label className="mp-field"><span>Kanal</span>
              <select className="mp-input" value={platform} onChange={(e) => { setPlatform(e.target.value); zuruecksetzen(); }}>
                {EXPORT_KANAELE.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select></label>
            <label className="mp-field"><span>Export-Datei (XLSX oder CSV)</span>
              <input ref={fileInput} type="file" accept=".xlsx,.csv,text/csv" disabled={busy} onChange={(e) => void dateiGewaehlt(e.target.files?.[0] ?? null)} /></label>
          </div>
          <p className="mp-small mp-muted">{kanal.hilfe} Das Jahr fehlt in TikToks Datum — der Pilot nimmt das jüngste, in dem der Tag nicht in der Zukunft liegt.</p>
          {busy && !vorschau && <p className="mp-muted">Lese Datei…</p>}
          {fehler && <Notice kind="bad">{fehler}</Notice>}
          {fertig && <Notice kind="info">{fertig}</Notice>}
          {vorschau && (
            <>
              <p className="mp-small">
                Erkannt: {Object.entries(vorschau.erkannt).map(([spalte, feld]) => `${spalte} → ${FELD_LABEL[feld] ?? feld}`).join(" · ")}
                {vorschau.unbekannt.length > 0 && <span className="mp-muted"> · nicht zugeordnet: {vorschau.unbekannt.join(", ")}</span>}
              </p>
              {vorschau.hinweise.length > 0 && <ul className="mp-plain-list mp-small">{vorschau.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>}
              {vorschau.tage.length > 0 && (
                <div className="mp-table-wrap">
                  <table className="mp-table mp-table--zahlen">
                    <thead><tr><th>Tag</th>{gefuellt.map((sp) => <th key={sp} className="mp-num">{FELD_LABEL[sp]}</th>)}</tr></thead>
                    <tbody>
                      {vorschau.tage.map((t) => (
                        <tr key={t.tag}><td>{tagKurz(t.tag)}</td>{gefuellt.map((sp) => <td key={sp} className="mp-num">{zahl(t.werte[sp] ?? null)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mp-actions">
                <Button variant="primary" disabled={busy || !vorschau.tage.length} onClick={() => void speichern()}>{busy ? "Speichere…" : `${vorschau.tage.length} Tage für ${kanal.label} übernehmen`}</Button>
                <Button disabled={busy} onClick={zuruecksetzen}>Verwerfen</Button>
              </div>
              <p className="mp-small mp-muted">Ein Tag, der schon Zahlen hat, wird überschrieben — ein neuer Export darf sich mit dem alten überlappen.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
