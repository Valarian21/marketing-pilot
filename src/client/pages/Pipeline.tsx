import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { PipelineSlot, PipelineView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { formatName } from "../../shared/labels.js";
import { Button, Card, Notice, PageHeader } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ChannelTag } from "../components/ChannelLink.js";
import { STAGES, plattformName, stageAtLeast, type ChannelStage } from "../../shared/channels.js";
import { POST_ARTEN, POST_ART_REIHE, WOCHENRHYTHMUS, wochentagOf, type PostArt } from "../../shared/postarten.js";

/**
 * Die Pipeline in zwei Ansichten.
 *
 * **Kalender** (Standard): je Tag alle Beiträge aller Kanäle, eingefärbt nach
 * Post-Art aus dem Playbook — darüber das Soll des Wochenrhythmus mit Haken.
 * Das beantwortet die Frage „welche Sorte geht wann raus, und fehlt eine?".
 *
 * **Kanäle**: je Kanal die Slots der nächsten Tage, als Ampel. Rot ist ein
 * Slot, für den nichts da ist. Gelb wartet in der Freigabe und würde bei
 * Freigabe genau hier landen. Grün ist eingeplant oder freigegeben. Alles
 * Grüne stammt aus der Wahrheit (`mp_scheduled_posts`), alles Gelbe ist
 * Projektion — wer in anderer Reihenfolge freigibt, verschiebt es.
 */
const STATE: Record<PipelineSlot["state"], { label: string; kind: string }> = {
  empty: { label: "nichts geplant", kind: "rot" },
  review: { label: "wartet auf Freigabe", kind: "gelb" },
  approved: { label: "freigegeben", kind: "gruen" },
  queued: { label: "eingeplant", kind: "gruen" },
  published: { label: "veröffentlicht", kind: "fertig" },
  failed: { label: "fehlgeschlagen", kind: "fehler" },
};

/** Kürzel je Kanal für die Kalender-Chips — „IG 09:00" statt „Instagram, 09:00 Uhr". */
const KURZ: Record<string, string> = { instagram: "IG", tiktok: "TT", youtube: "YT", threads: "TH", facebook: "FB", pinterest: "PIN", x: "X", bluesky: "BS", linkedin: "LI", reddit: "RD" };
const kurz = (p: string) => KURZ[p] ?? plattformName(p).slice(0, 2).toUpperCase();

const tagLabel = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const uhr = (s: PipelineSlot): string => {
  // Termine von Hand tragen Minuten; Slots sind volle Stunden.
  const d = new Date(s.at);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

interface Eintrag { slot: PipelineSlot; platform: string }

export function PipelinePage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const ansicht = params.get("ansicht") === "kanaele" ? "kanaele" : "kalender";
  const [view, setView] = useState<PipelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [sel, setSel] = useState<Eintrag | null>(null);

  const load = useCallback(async () => {
    try { setView(await api<PipelineView>(`/projects/${id}/pipeline?days=${days}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id, days]);
  useEffect(() => { void load(); }, [load]);

  const tage = useMemo(() => !view ? [] : Array.from({ length: view.days }, (_, i) => {
    const d = new Date(`${view.from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  }), [view]);

  /** Alle belegten Slots aller Kanäle, je Tag nach Uhrzeit. */
  const proTag = useMemo(() => {
    const m = new Map<string, Eintrag[]>();
    for (const r of view?.rows ?? []) for (const s of r.slots) {
      if (s.state === "empty") continue;
      m.set(s.date, [...(m.get(s.date) ?? []), { slot: s, platform: r.platform }]);
    }
    for (const list of m.values()) list.sort((a, b) => a.slot.at.localeCompare(b.slot.at) || a.platform.localeCompare(b.platform));
    return m;
  }, [view]);

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;

  const zaehl = { rot: 0, gelb: 0, gruen: 0, fertig: 0, fehler: 0 };
  for (const r of view.rows) for (const s of r.slots) if (!s.missed || s.state !== "empty") zaehl[STATE[s.state].kind as keyof typeof zaehl]++;
  const backlog = view.rows.reduce((n, r) => n + r.backlog, 0);
  // Je Post-Art: wie viele Beiträge im Fenster wirklich stehen (eingeplant oder raus) und wie viele nur warten.
  const jeArt = new Map<PostArt, { fest: number; wartet: number }>();
  for (const r of view.rows) for (const s of r.slots) {
    if (!s.postArt) continue;
    const a = s.postArt as PostArt;
    const z = jeArt.get(a) ?? { fest: 0, wartet: 0 };
    if (s.state === "queued" || s.state === "published") z.fest++; else if (s.state === "review" || s.state === "approved") z.wartet++;
    jeArt.set(a, z);
  }
  const setAnsicht = (a: "kalender" | "kanaele") => setParams(a === "kalender" ? {} : { ansicht: a });
  const ohneTermin = view.rows.filter((r) => r.backlog > 0);

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Content Pilot" title="Pipeline" actions={
        <span className="mp-inline">
          <span className="mp-schalter" role="tablist">
            <button type="button" role="tab" aria-selected={ansicht === "kalender"} className={`mp-btn${ansicht === "kalender" ? " mp-btn--primary" : ""}`} onClick={() => setAnsicht("kalender")}>Kalender</button>
            <button type="button" role="tab" aria-selected={ansicht === "kanaele"} className={`mp-btn${ansicht === "kanaele" ? " mp-btn--primary" : ""}`} onClick={() => setAnsicht("kanaele")}>Kanäle</button>
          </span>
          {[7, 14, 21].map((n) => <button key={n} type="button" className={`mp-btn${days === n ? " mp-btn--primary" : ""}`} onClick={() => setDays(n)}>{n} Tage</button>)}
          <Button onClick={() => void load()}>Neu laden</Button>
        </span>
      } />
      {error && <Notice kind="bad">{error}</Notice>}

      <div className="mp-ampel-legende">
        <span className="mp-ampel mp-ampel--fertig" /> {zaehl.fertig} veröffentlicht
        <span className="mp-ampel mp-ampel--gruen" /> {zaehl.gruen} eingeplant
        <span className="mp-ampel mp-ampel--gelb" /> {zaehl.gelb} in Freigabe
        <span className="mp-ampel mp-ampel--rot" /> {zaehl.rot} Slots offen
        {zaehl.fehler > 0 && <><span className="mp-ampel mp-ampel--fehler" /> {zaehl.fehler} fehlgeschlagen</>}
        {backlog > 0 && <span className="mp-muted"> · {backlog} warten ohne Termin</span>}
      </div>

      {view.rows.length === 0 && <Notice kind="info">Kein Kanal mit Slots oder wartenden Stücken. Auf der <Link to={`/projects/${id}/channels`}>Kanäle-Seite</Link> Stufe und Slots setzen.</Notice>}

      {ansicht === "kalender" && (
        <div className="mp-timeline-layout">
          <div>
            <Card className="mp-timeline-card">
              <div className="mp-timeline-scroll">
                <div className="mp-kalender" style={{ ["--tage" as string]: view.days }}>
                  {tage.map((d) => {
                    const wt = wochentagOf(d);
                    const soll = WOCHENRHYTHMUS[wt];
                    const eintraege = proTag.get(d) ?? [];
                    // Ein Haken, sobald die Sorte an diesem Tag wirklich steht — Projektionen zählen nicht.
                    const steht = (a: PostArt) => eintraege.some((e) => e.slot.postArt === a && (e.slot.state === "queued" || e.slot.state === "published"));
                    const wartet = (a: PostArt) => eintraege.some((e) => e.slot.postArt === a && (e.slot.state === "review" || e.slot.state === "approved"));
                    const vorbei = d < view.today;
                    return (
                      <div key={d} className={`mp-kal-tag${d === view.today ? " is-today" : ""}${vorbei ? " is-vorbei" : ""}`}>
                        <div className="mp-kal-kopf"><span className="mp-label">{tagLabel(d)}</span></div>
                        <div className="mp-kal-soll" title="Soll aus dem Wochenrhythmus des Playbooks">
                          {[...soll.pflicht, ...soll.dazu].map((a, i) => (
                            <span key={`${a}${i}`} className={`mp-art mp-art--${POST_ARTEN[a].farbe}${steht(a) ? " is-da" : wartet(a) ? " is-wartet" : vorbei ? " is-verpasst" : ""}`}
                                  title={`${POST_ARTEN[a].name} · ${i < soll.pflicht.length ? "Pflicht" : "dazu"} · ${steht(a) ? "steht" : wartet(a) ? "wartet in der Freigabe" : "fehlt"}`}>
                              {a}{steht(a) ? " ✓" : wartet(a) ? " ○" : ""}
                            </span>
                          ))}
                        </div>
                        <div className="mp-kal-liste">
                          {eintraege.length === 0 && <span className="mp-pipe-leer">–</span>}
                          {eintraege.map((e) => {
                            const art = POST_ARTEN[(e.slot.postArt || "X") as PostArt] ?? POST_ARTEN.X;
                            return (
                              <button key={`${e.platform}-${e.slot.at}-${e.slot.pieceId}`} type="button"
                                className={`mp-kal-chip mp-art--${art.farbe} is-${STATE[e.slot.state].kind}${sel?.slot === e.slot ? " is-gewaehlt" : ""}`}
                                title={`${plattformName(e.platform)} · ${uhr(e.slot)} · ${STATE[e.slot.state].label} · ${art.name}${e.slot.drehbuch ? ` (${e.slot.drehbuch})` : ""}\n${e.slot.title}`}
                                onClick={() => setSel(e)}>
                                <span className="mp-kal-chip-kopf"><b>{e.slot.postArt || "?"}</b> {uhr(e.slot)} · {kurz(e.platform)}{e.slot.state === "published" ? " ✓" : e.slot.state === "failed" ? " !" : e.slot.state === "review" || e.slot.state === "approved" ? " ○" : ""}</span>
                                <span className="mp-kal-chip-text">{e.slot.title || formatName(e.slot.format)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mp-small mp-muted" style={{ padding: "10px 14px 4px 0" }}>
                Oben je Tag das Soll aus dem Wochenrhythmus (erste Marke = Pflicht): ✓ steht im Zeitplan, ○ wartet in der Freigabe, ohne Zeichen fehlt es.
                Chips mit ○ sind Projektion — sie landen dort, wenn du in dieser Reihenfolge freigibst.
              </p>
            </Card>

            <Card>
              <div className="mp-card-head"><h2>Post-Arten im Fenster</h2><Link className="mp-small" to={`/projects/${id}/review`}>Zur Freigabe</Link></div>
              <ul className="mp-art-legende">
                {POST_ART_REIHE.filter((a) => a !== "X" || jeArt.has("X")).map((a) => {
                  const z = jeArt.get(a) ?? { fest: 0, wartet: 0 };
                  return (
                    <li key={a}>
                      <span className={`mp-art mp-art--${POST_ARTEN[a].farbe}`}>{a}</span>
                      <span className="mp-art-name">{POST_ARTEN[a].name} <span className="mp-muted">· {POST_ARTEN[a].takt}</span></span>
                      <span className="mp-art-zahl mp-num-cell">{z.fest}{z.wartet > 0 && <span className="mp-muted"> + {z.wartet} wartend</span>}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>

            {ohneTermin.length > 0 && (
              <Card>
                <div className="mp-card-head"><h2>Wartet ohne Termin</h2></div>
                <ul className="mp-plain-list">
                  {ohneTermin.map((r) => (
                    <li key={r.platform} className="mp-inline" style={{ flexWrap: "wrap", gap: 8 }}>
                      <ChannelTag name={r.platform} projectId={id} className="" />
                      <span className="mp-small mp-muted">{r.backlog} {r.backlog === 1 ? "Stück" : "Stücke"} {r.ohneSlots ? "— Kanal ohne Slots" : "— mehr als das Fenster fasst"} · {STAGES[r.stage as ChannelStage]?.label ?? r.stage}</span>
                      {stageAtLeast(r.stage as ChannelStage, "approve")
                        ? <Link className="mp-btn" to={`/projects/${id}/channels`}>Slots setzen</Link>
                        : <Link className="mp-btn" to={`/projects/${id}/handarbeit?platform=${r.platform}`}>Termine vergeben</Link>}
                      <Link className="mp-btn" to={`/projects/${id}/review`}>Freigeben</Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
          {sel && <Auswahl sel={sel} projectId={id} onClose={() => setSel(null)} />}
        </div>
      )}

      {ansicht === "kanaele" && (
        <>
          {zaehl.rot > 0 && zaehl.gelb === 0 && backlog === 0 && (
            <Notice kind="warn">{zaehl.rot} Slots ohne Stück — im <Link to={`/projects/${id}/studio`}>Studio</Link> Beiträge erzeugen oder eine <Link to={`/projects/${id}/series`}>Serie</Link> anlegen.</Notice>
          )}
          {view.withoutSlots.length > 0 && <p className="mp-small mp-muted">Eingeschaltet, aber ohne Slots und ohne Wartendes: {view.withoutSlots.map(plattformName).join(", ")}.</p>}
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
                        {row.ohneSlots && <span className="mp-small mp-warn-text">ohne Slots{row.backlog > 0 && ` · ${row.backlog} warten`}</span>}
                      </div>
                      {tage.map((d) => {
                        const slots = row.slots.filter((s) => s.date === d);
                        return (
                          <div key={d} className={`mp-tl-cell mp-pipe-cell${d === view.today ? " is-today" : ""}`}>
                            {slots.length === 0 && <span className="mp-pipe-leer">–</span>}
                            {slots.map((s) => (
                              <button key={s.at} type="button" title={`${uhr(s)} · ${STATE[s.state].label}${s.title ? ` · ${s.title}` : ""}`}
                                className={`mp-chip mp-chip--${STATE[s.state].kind}${s.missed && s.state === "empty" ? " is-verpasst" : ""}`}
                                onClick={() => setSel({ slot: s, platform: row.platform })}>
                                <span className="mp-chip-zeit">{String(s.hour).padStart(2, "0")}</span>
                                {s.postArt && <span className={`mp-art mp-art--${(POST_ARTEN[s.postArt as PostArt] ?? POST_ARTEN.X).farbe} mp-art--mini`}>{s.postArt}</span>}
                                <span className="mp-chip-text">{s.pieceId ? (s.title || formatName(s.format)) : (s.missed ? "verpasst" : "offen")}</span>
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
            {sel && <Auswahl sel={sel} projectId={id} onClose={() => setSel(null)} />}
          </div>
        </>
      )}
    </>
  );
}

/** Die Seitenlade zum angeklickten Eintrag — dieselbe in beiden Ansichten. */
function Auswahl({ sel, projectId, onClose }: { sel: Eintrag; projectId: string; onClose: () => void }) {
  const art = sel.slot.postArt ? POST_ARTEN[sel.slot.postArt as PostArt] : null;
  return (
    <aside className="mp-drawer">
      <Card>
        <div className="mp-card-head"><h2>{STATE[sel.slot.state].label}</h2><button type="button" className="mp-btn" onClick={onClose}>Schließen</button></div>
        <dl className="mp-dl">
          <dt>Kanal</dt><dd><ChannelTag name={sel.platform} projectId={projectId} className="" /></dd>
          <dt>Termin</dt><dd>{tagLabel(sel.slot.date)}, {uhr(sel.slot)} Uhr{sel.slot.extern && <span className="mp-muted"> · von Hand</span>}</dd>
          {art && <><dt>Post-Art</dt><dd><span className={`mp-art mp-art--${art.farbe}`}>{sel.slot.postArt}</span> {art.name}{sel.slot.drehbuch && <span className="mp-muted"> · Drehbuch „{sel.slot.drehbuch}“</span>}</dd></>}
          {sel.slot.title && <><dt>Stück</dt><dd>{sel.slot.title}</dd></>}
          {sel.slot.format && <><dt>Format</dt><dd>{formatName(sel.slot.format)}</dd></>}
          {sel.slot.error && <><dt>Fehler</dt><dd className="mp-bad">{sel.slot.error}</dd></>}
        </dl>
        <div className="mp-form-actions">
          {sel.slot.pieceId && sel.slot.state === "review" && <Link className="mp-btn mp-btn--primary" to={`/projects/${projectId}/review?piece=${sel.slot.pieceId}`}>Zur Freigabe</Link>}
          {sel.slot.pieceId && sel.slot.state !== "review" && <Link className="mp-btn" to={`/projects/${projectId}/publish/${sel.slot.pieceId}`}>Publish-Paket</Link>}
          {sel.slot.pieceId && sel.slot.extern && <Link className="mp-btn" to={`/projects/${projectId}/handarbeit?platform=${sel.platform}`}>Handarbeit</Link>}
          {!sel.slot.pieceId && <Link className="mp-btn mp-btn--primary" to={`/projects/${projectId}/studio`}>Im Studio erzeugen</Link>}
        </div>
        {sel.slot.state === "review" && <p className="mp-small mp-muted">Projektion: Nach der Freigabe legt der Pilot das Stück auf den nächsten freien Slot — das ist dieser, wenn vorher nichts anderes freigegeben wird.</p>}
      </Card>
    </aside>
  );
}
