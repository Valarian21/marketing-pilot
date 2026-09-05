import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { PipelineSlot, PipelineView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ChannelTag } from "../components/ChannelLink.js";
import { STAGES, type ChannelStage } from "../../shared/channels.js";

/**
 * Die Pipeline: je Kanal die Slots der nächsten Tage, als Ampel.
 *
 * Rot ist ein Slot, für den nichts da ist. Gelb wartet in der Freigabe und
 * würde bei Freigabe genau hier landen. Grün ist eingeplant oder freigegeben.
 * Alles Grüne stammt aus der Wahrheit (`mp_scheduled_posts`), alles Gelbe
 * ist Projektion — wer in anderer Reihenfolge freigibt, verschiebt es.
 */
const STATE: Record<PipelineSlot["state"], { label: string; kind: string }> = {
  empty: { label: "nichts geplant", kind: "rot" },
  review: { label: "wartet auf Freigabe", kind: "gelb" },
  approved: { label: "freigegeben", kind: "gruen" },
  queued: { label: "eingeplant", kind: "gruen" },
  published: { label: "veröffentlicht", kind: "fertig" },
  failed: { label: "fehlgeschlagen", kind: "fehler" },
};

const FORMAT: Record<string, string> = {
  data_carousel: "Carousel", data_reel: "Reel", carousel: "Carousel", story: "Story",
  showcase_carousel: "Showcase", text: "Text", pin: "Pin", video: "Video",
};

const tagLabel = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

export function PipelinePage() {
  const { id = "" } = useParams();
  const [view, setView] = useState<PipelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(10);
  const [sel, setSel] = useState<{ slot: PipelineSlot; platform: string } | null>(null);

  const load = useCallback(async () => {
    try { setView(await api<PipelineView>(`/projects/${id}/pipeline?days=${days}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id, days]);
  useEffect(() => { void load(); }, [load]);

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;

  const tage = Array.from({ length: view.days }, (_, i) => {
    const d = new Date(`${view.from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const zaehl = { rot: 0, gelb: 0, gruen: 0, fertig: 0, fehler: 0 };
  for (const r of view.rows) for (const s of r.slots) if (!s.missed || s.state !== "empty") zaehl[STATE[s.state].kind as keyof typeof zaehl]++;
  const backlog = view.rows.reduce((n, r) => n + r.backlog, 0);

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Content Pilot" title="Pipeline" actions={
        <span className="mp-inline">
          {[7, 10, 14, 21].map((n) => <button key={n} type="button" className={`mp-btn${days === n ? " mp-btn--primary" : ""}`} onClick={() => setDays(n)}>{n} Tage</button>)}
          <Button onClick={() => void load()}>Neu laden</Button>
        </span>
      } />
      {error && <Notice kind="bad">{error}</Notice>}

      <div className="mp-ampel-legende">
        <span className="mp-ampel mp-ampel--rot" /> {zaehl.rot} offen
        <span className="mp-ampel mp-ampel--gelb" /> {zaehl.gelb} in Freigabe
        <span className="mp-ampel mp-ampel--gruen" /> {zaehl.gruen} eingeplant
        <span className="mp-ampel mp-ampel--fertig" /> {zaehl.fertig} veröffentlicht
        {zaehl.fehler > 0 && <><span className="mp-ampel mp-ampel--fehler" /> {zaehl.fehler} fehlgeschlagen</>}
        {backlog > 0 && <span className="mp-muted"> · {backlog} weitere warten hinter dem Fenster</span>}
      </div>

      {zaehl.rot > 0 && zaehl.gelb === 0 && backlog === 0 && (
        <Notice kind="warn">{zaehl.rot} Slots ohne Stück — im <Link to={`/projects/${id}/studio`}>Studio</Link> Beiträge erzeugen oder eine <Link to={`/projects/${id}/series`}>Serie</Link> anlegen.</Notice>
      )}
      {view.rows.length === 0 && <Notice kind="info">Kein Kanal mit Slots. Auf der <Link to={`/projects/${id}/channels`}>Kanäle-Seite</Link> Stufe und Slots setzen.</Notice>}
      {view.withoutSlots.length > 0 && <p className="mp-small mp-muted">Ohne Slots und deshalb nicht in der Ansicht: {view.withoutSlots.join(", ")} — dort postest du von Hand, wann du willst.</p>}

      <div className="mp-timeline-layout">
        <Card className="mp-timeline-card">
          <div className="mp-timeline-scroll">
            <div className="mp-pipeline" style={{ ["--tage" as string]: view.days }}>
              <div className="mp-tl-head mp-tl-label">Kanal</div>
              {tage.map((d) => <div key={d} className={`mp-tl-head${d === view.today ? " is-today" : ""}`}><span className="mp-label">{tagLabel(d)}</span></div>)}
              {view.rows.map((row) => (
                <div key={row.platform} className="mp-tl-row">
                  <div className="mp-tl-label mp-pipe-label" title={STAGES[row.stage as ChannelStage]?.summary ?? ""}>
                    <ChannelTag name={row.platform} projectId={id} className="mp-tl-channel" />
                    <span className="mp-small mp-muted">{STAGES[row.stage as ChannelStage]?.label ?? row.stage}{row.automatic ? " · postet selbst" : " · von Hand"}</span>
                  </div>
                  {tage.map((d) => {
                    const slots = row.slots.filter((s) => s.date === d);
                    return (
                      <div key={d} className={`mp-tl-cell mp-pipe-cell${d === view.today ? " is-today" : ""}`}>
                        {slots.length === 0 && <span className="mp-pipe-leer">–</span>}
                        {slots.map((s) => (
                          <button key={s.at} type="button" title={`${String(s.hour).padStart(2, "0")}:00 · ${STATE[s.state].label}${s.title ? ` · ${s.title}` : ""}`}
                            className={`mp-chip mp-chip--${STATE[s.state].kind}${s.missed && s.state === "empty" ? " is-verpasst" : ""}`}
                            onClick={() => setSel({ slot: s, platform: row.platform })}>
                            <span className="mp-chip-zeit">{String(s.hour).padStart(2, "0")}</span>
                            <span className="mp-chip-text">{s.pieceId ? (FORMAT[s.format] ?? s.format) : (s.missed ? "verpasst" : "offen")}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="mp-small mp-muted" style={{ padding: "10px 14px 4px 0" }}>
            Grün und Blau stehen wirklich im Zeitplan. Gelb ist eine Projektion: gibst du in dieser Reihenfolge frei, landet es hier —
            gibst du anders frei, rückt es um. Rot heißt, für diesen Slot gibt es noch nichts.
          </p>
        </Card>
        {sel && (
          <aside className="mp-drawer">
            <Card>
              <div className="mp-card-head"><h2>{STATE[sel.slot.state].label}</h2><button type="button" className="mp-btn" onClick={() => setSel(null)}>Schließen</button></div>
              <dl className="mp-dl">
                <dt>Kanal</dt><dd><ChannelTag name={sel.platform} projectId={id} className="" /></dd>
                <dt>Slot</dt><dd>{tagLabel(sel.slot.date)}, {String(sel.slot.hour).padStart(2, "0")}:00 Uhr</dd>
                {sel.slot.title && <><dt>Stück</dt><dd>{sel.slot.title}</dd></>}
                {sel.slot.format && <><dt>Format</dt><dd>{FORMAT[sel.slot.format] ?? sel.slot.format}</dd></>}
                {sel.slot.error && <><dt>Fehler</dt><dd className="mp-bad">{sel.slot.error}</dd></>}
              </dl>
              <div className="mp-form-actions">
                {sel.slot.pieceId && sel.slot.state === "review" && <Link className="mp-btn mp-btn--primary" to={`/projects/${id}/review?piece=${sel.slot.pieceId}`}>Zur Freigabe</Link>}
                {sel.slot.pieceId && sel.slot.state !== "review" && <Link className="mp-btn" to={`/projects/${id}/publish/${sel.slot.pieceId}`}>Publish-Paket</Link>}
                {!sel.slot.pieceId && <Link className="mp-btn mp-btn--primary" to={`/projects/${id}/studio`}>Im Studio erzeugen</Link>}
              </div>
              {sel.slot.state === "review" && <p className="mp-small mp-muted">Projektion: Nach der Freigabe legt der Pilot das Stück auf den nächsten freien Slot — das ist dieser, wenn vorher nichts anderes freigegeben wird.</p>}
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}
