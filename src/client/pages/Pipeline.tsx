import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { PipelineRow, PipelineSlot, PipelineView, PublishPackage, SlotAnalyse, SlotAnalyseKanal } from "../../shared/schemas.js";
import { api } from "../api.js";
import { formatName } from "../../shared/labels.js";
import { Button, Card, CopyButton, Notice, PageHeader } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { ChannelTag, loadProfiles } from "../components/ChannelLink.js";
import { STAGES, plattformName, stageAtLeast, type ChannelStage } from "../../shared/channels.js";
import { POST_ARTEN, POST_ART_REIHE, WOCHENRHYTHMUS, wochentagOf, type PostArt } from "../../shared/postarten.js";

/**
 * Die Pipeline: je Kanal die Slots der nächsten Tage, und jeder Slot ist ein
 * Arbeitsplatz.
 *
 * Anklicken öffnet rechts die Lade mit allem, was der Beitrag braucht — Text,
 * Titel, Schlagworte, Dateien zum Laden, Link zur Plattform — und mit den
 * Knöpfen, die den Zustand weiterschieben: freigeben, „auf der Plattform
 * geplant", „gepostet". Die Farbe des Chips ist der Zustand:
 *
 *   rot     nichts da (oder: Sorte fehlt)      gelb    wartet auf Freigabe
 *   orange  freigegeben, noch kein Termin       grün    der Pilot postet
 *   blau    von dir auf der Plattform geplant   petrol  veröffentlicht
 *   dunkelrot  fehlgeschlagen
 *
 * Grün, Blau und Petrol stammen aus der Wahrheit (`mp_scheduled_posts`); Gelb
 * und Orange sind Projektion — wer in anderer Reihenfolge freigibt, verschiebt
 * sie. Die Kalender-Ansicht (alle Kanäle je Tag, nach Sorte) bleibt als zweite
 * Sicht erreichbar.
 */
type Kind = "rot" | "gelb" | "frei" | "gruen" | "blau" | "fertig" | "fehler";
const KIND_LABEL: Record<Kind, string> = { rot: "offen", gelb: "wartet auf Freigabe", frei: "freigegeben, ohne Termin", gruen: "der Pilot postet", blau: "auf der Plattform geplant", fertig: "veröffentlicht", fehler: "fehlgeschlagen" };
const kindOf = (s: PipelineSlot): Kind =>
  s.state === "empty" ? "rot" : s.state === "review" ? "gelb" : s.state === "approved" ? "frei"
    : s.state === "queued" ? (s.extern ? "blau" : "gruen") : s.state === "published" ? "fertig" : "fehler";

/** Kürzel je Kanal für die Kalender-Chips — „IG 09:00" statt „Instagram, 09:00 Uhr". */
const KURZ: Record<string, string> = { instagram: "IG", tiktok: "TT", youtube: "YT", threads: "TH", facebook: "FB", pinterest: "PIN", x: "X", bluesky: "BS", linkedin: "LI", reddit: "RD" };
const kurz = (p: string) => KURZ[p] ?? plattformName(p).slice(0, 2).toUpperCase();
const TAG_KURZ: Record<string, string> = { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" };

const tagLabel = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const uhr = (s: PipelineSlot): string => new Date(s.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const artDef = (a: string) => POST_ARTEN[a as PostArt] ?? POST_ARTEN.X;

interface Eintrag { slot: PipelineSlot; row: PipelineRow }

export function PipelinePage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const ansicht = params.get("ansicht") === "kalender" ? "kalender" : "kanaele";
  const [view, setView] = useState<PipelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [sel, setSel] = useState<Eintrag | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api<PipelineView>(`/projects/${id}/pipeline?days=${days}`);
      setView(v); setError(null);
      // Die Lade zeigt den Slot, den sie zeigte — mit seinem neuen Zustand.
      setSel((cur) => {
        if (!cur) return null;
        const row = v.rows.find((r) => r.platform === cur.row.platform);
        const slot = row?.slots.find((s) => s.at === cur.slot.at && (s.pieceId === cur.slot.pieceId || !cur.slot.pieceId || !s.pieceId));
        return row && slot ? { row, slot } : null;
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [id, days]);
  useEffect(() => { void load(); }, [load]);

  const tage = useMemo(() => !view ? [] : Array.from({ length: view.days }, (_, i) => {
    const d = new Date(`${view.from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  }), [view]);

  /** Alle belegten Slots aller Kanäle, je Tag nach Uhrzeit — für den Kalender. */
  const proTag = useMemo(() => {
    const m = new Map<string, Eintrag[]>();
    for (const row of view?.rows ?? []) for (const slot of row.slots) {
      if (slot.state === "empty") continue;
      m.set(slot.date, [...(m.get(slot.date) ?? []), { slot, row }]);
    }
    for (const list of m.values()) list.sort((a, b) => a.slot.at.localeCompare(b.slot.at) || a.row.platform.localeCompare(b.row.platform));
    return m;
  }, [view]);

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;

  const zaehl: Record<Kind, number> = { rot: 0, gelb: 0, frei: 0, gruen: 0, blau: 0, fertig: 0, fehler: 0 };
  for (const r of view.rows) for (const s of r.slots) if (!s.missed || s.state !== "empty") zaehl[kindOf(s)]++;
  const backlog = view.rows.reduce((n, r) => n + r.backlog, 0);
  const setAnsicht = (a: "kalender" | "kanaele") => setParams(a === "kanaele" ? {} : { ansicht: a });

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Content Pilot" title="Pipeline" actions={
        <span className="mp-inline">
          <span className="mp-schalter" role="tablist">
            <button type="button" role="tab" aria-selected={ansicht === "kanaele"} className={`mp-btn${ansicht === "kanaele" ? " mp-btn--primary" : ""}`} onClick={() => setAnsicht("kanaele")}>Kanäle</button>
            <button type="button" role="tab" aria-selected={ansicht === "kalender"} className={`mp-btn${ansicht === "kalender" ? " mp-btn--primary" : ""}`} onClick={() => setAnsicht("kalender")}>Kalender</button>
          </span>
          {[7, 14, 21].map((n) => <button key={n} type="button" className={`mp-btn${days === n ? " mp-btn--primary" : ""}`} onClick={() => setDays(n)}>{n} Tage</button>)}
          <Button onClick={() => void load()}>Neu laden</Button>
        </span>
      } />
      {error && <Notice kind="bad">{error}</Notice>}

      <div className="mp-ampel-legende">
        {(["fertig", "gruen", "blau", "frei", "gelb", "rot", "fehler"] as Kind[]).filter((k) => k !== "fehler" || zaehl.fehler > 0).map((k) => (
          <span key={k} className="mp-ampel-eintrag"><span className={`mp-ampel mp-ampel--${k}`} /> {zaehl[k]} {KIND_LABEL[k]}</span>
        ))}
        {backlog > 0 && <span className="mp-muted"> · {backlog} warten ohne Slot</span>}
      </div>

      {view.rows.length === 0 && <Notice kind="info">Kein Kanal mit Slots oder wartenden Stücken. Unten in der Slot-Analyse einen Vorschlag übernehmen.</Notice>}

      <div className="mp-timeline-layout">
        <div>
          {ansicht === "kanaele" && (
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
                        {!row.ohneSlots && row.backlog > 0 && <span className="mp-small mp-muted">+{row.backlog} hinter dem Fenster</span>}
                      </div>
                      {tage.map((d) => {
                        const slots = row.slots.filter((s) => s.date === d);
                        return (
                          <div key={d} className={`mp-tl-cell mp-pipe-cell${d === view.today ? " is-today" : ""}`}>
                            {slots.length === 0 && <span className="mp-pipe-leer">–</span>}
                            {slots.map((s) => {
                              const k = kindOf(s);
                              return (
                                <button key={`${s.at}-${s.pieceId ?? ""}`} type="button"
                                  title={`${uhr(s)} · ${KIND_LABEL[k]}${s.title ? ` · ${s.title}` : ""}${s.slotArt && !s.pieceId ? ` · Sorte ${s.slotArt} vorgesehen` : ""}`}
                                  className={`mp-chip mp-chip--${k}${s.missed && s.state === "empty" ? " is-verpasst" : ""}${sel?.slot === s ? " is-gewaehlt" : ""}`}
                                  onClick={() => setSel({ slot: s, row })}>
                                  <span className="mp-chip-zeit">{String(s.hour).padStart(2, "0")}</span>
                                  {(s.postArt || s.slotArt) && <span className={`mp-art mp-art--${artDef(s.postArt || s.slotArt).farbe} mp-art--mini${!s.postArt ? " is-soll" : ""}`}>{s.postArt || s.slotArt}</span>}
                                  <span className="mp-chip-text">{s.pieceId ? (s.title || formatName(s.format)) : (s.missed ? "verpasst" : s.slotArt ? `${artDef(s.slotArt).name} fehlt` : "offen")}</span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <p className="mp-small mp-muted" style={{ padding: "10px 14px 4px 0" }}>
                Ein Slot mit Sorten-Kürzel will genau diese Sorte; steht keine bereit, bleibt er offen und sagt, was fehlt.
                Gelb und Orange sind Projektion — gibst du in anderer Reihenfolge frei, rückt es um.
              </p>
            </Card>
          )}

          {ansicht === "kalender" && (
            <Card className="mp-timeline-card">
              <div className="mp-timeline-scroll">
                <div className="mp-kalender" style={{ ["--tage" as string]: view.days }}>
                  {tage.map((d) => {
                    const soll = WOCHENRHYTHMUS[wochentagOf(d)];
                    const eintraege = proTag.get(d) ?? [];
                    const steht = (a: PostArt) => eintraege.some((e) => e.slot.postArt === a && (e.slot.state === "queued" || e.slot.state === "published"));
                    const wartet = (a: PostArt) => eintraege.some((e) => e.slot.postArt === a && (e.slot.state === "review" || e.slot.state === "approved"));
                    const vorbei = d < view.today;
                    return (
                      <div key={d} className={`mp-kal-tag${d === view.today ? " is-today" : ""}${vorbei ? " is-vorbei" : ""}`}>
                        <div className="mp-kal-kopf"><span className="mp-label">{tagLabel(d)}</span></div>
                        <div className="mp-kal-soll" title="Soll aus dem Wochenrhythmus des Playbooks">
                          {[...soll.pflicht, ...soll.dazu].map((a, i) => (
                            <span key={`${a}${i}`} className={`mp-art mp-art--${POST_ARTEN[a].farbe}${steht(a) ? " is-da" : wartet(a) ? " is-wartet" : vorbei ? " is-verpasst" : ""}`}
                                  title={`${POST_ARTEN[a].name} · ${i < soll.pflicht.length ? "Pflicht" : "dazu"} · ${steht(a) ? "steht" : wartet(a) ? "wartet" : "fehlt"}`}>
                              {a}{steht(a) ? " ✓" : wartet(a) ? " ○" : ""}
                            </span>
                          ))}
                        </div>
                        <div className="mp-kal-liste">
                          {eintraege.length === 0 && <span className="mp-pipe-leer">–</span>}
                          {eintraege.map((e) => {
                            const art = artDef(e.slot.postArt || "X");
                            const k = kindOf(e.slot);
                            return (
                              <button key={`${e.row.platform}-${e.slot.at}-${e.slot.pieceId}`} type="button"
                                className={`mp-kal-chip mp-art--${art.farbe} is-${k}${sel?.slot === e.slot ? " is-gewaehlt" : ""}`}
                                title={`${plattformName(e.row.platform)} · ${uhr(e.slot)} · ${KIND_LABEL[k]} · ${art.name}\n${e.slot.title}`}
                                onClick={() => setSel(e)}>
                                <span className="mp-kal-chip-kopf"><b>{e.slot.postArt || "?"}</b> {uhr(e.slot)} · {kurz(e.row.platform)}{k === "fertig" ? " ✓" : k === "fehler" ? " !" : k === "gelb" || k === "frei" ? " ○" : ""}</span>
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
              <p className="mp-small mp-muted" style={{ padding: "10px 14px 4px 0" }}>Oben je Tag das Soll aus dem Wochenrhythmus: ✓ steht im Zeitplan, ○ wartet, ohne Zeichen fehlt es.</p>
            </Card>
          )}

          <SlotAnalyseKarte projectId={id} onChanged={() => void load()} />
        </div>
        {sel && <Lade sel={sel} projectId={id} onClose={() => setSel(null)} onChanged={() => void load()} onError={setError} />}
      </div>
    </>
  );
}

/** Die erste Zeile eines Textes als Titel — für YouTube und TikTok ist das der Haken, gekappt auf 100 Zeichen. */
function titelAus(text: string, fallback: string): string {
  const zeile = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? fallback;
  // Eine Caption ohne Zeilenumbruch ist ein Absatz — dann trägt der erste Satz den Titel.
  const satz = /^(.{12,}?[.!?])(\s|$)/.exec(zeile)?.[1] ?? zeile;
  const t = satz.length <= 100 ? satz : zeile;
  return t.length > 100 ? `${t.slice(0, 97)}…` : t;
}
/** Schlagworte am Textende getrennt vom Rumpf — zum getrennten Kopieren. */
function teileText(text: string): { rumpf: string; tags: string } {
  const zeilen = text.trimEnd().split("\n");
  const letzte = zeilen[zeilen.length - 1] ?? "";
  return /^\s*#\S/.test(letzte) ? { rumpf: zeilen.slice(0, -1).join("\n").trimEnd(), tags: letzte.trim() } : { rumpf: text, tags: "" };
}

/**
 * Die Lade zum angeklickten Slot: Zustand, Paket und die Knöpfe, die den
 * Zustand weiterschieben. Dieselbe in beiden Ansichten.
 */
function Lade({ sel, projectId, onClose, onChanged, onError }: { sel: Eintrag; projectId: string; onClose: () => void; onChanged: () => void; onError: (e: string | null) => void }) {
  const { slot, row } = sel;
  const [paket, setPaket] = useState<PublishPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const k = kindOf(slot);
  const vonHand = !row.automatic;
  const art = slot.postArt ? artDef(slot.postArt) : null;
  const platform = row.platform;

  useEffect(() => {
    setPaket(null);
    if (!slot.pieceId) return;
    api<PublishPackage>(`/content/${slot.pieceId}/package`).then(setPaket).catch(() => setPaket(null));
  }, [slot.pieceId]);

  const tu = async (fn: () => Promise<unknown>) => {
    setBusy(true); onError(null);
    try { await fn(); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  };
  const freigeben = () => tu(() => api(`/content/${slot.pieceId}`, { method: "PATCH", json: { status: "approved" } }));
  const ablehnen = () => {
    const reason = window.prompt("Grund der Ablehnung (wird protokolliert):");
    if (!reason) return;
    void tu(() => api(`/content/${slot.pieceId}`, { method: "PATCH", json: { status: "rejected", reason } }));
  };
  const einplanen = () => tu(() => api(`/content/${slot.pieceId}/publish/schedule`, { method: "POST", json: { platforms: [platform], scheduledAt: slot.at } }));
  const externGeplant = () => tu(() => api(`/projects/${projectId}/publish/extern`, { method: "POST", json: { pieceId: slot.pieceId, platform, scheduledAt: slot.at, externalUrl: "", posted: false } }));
  const externGepostet = () => {
    const url = window.prompt("Link zum Beitrag (optional — dann zählt die Übersicht ihn mit):") ?? "";
    void tu(() => api(`/projects/${projectId}/publish/extern`, { method: "POST", json: { pieceId: slot.pieceId, platform, scheduledAt: slot.at, externalUrl: url.trim(), posted: true } }));
  };
  const absagen = () => tu(() => api(`/scheduled/${slot.scheduledId}`, { method: "DELETE" }));

  const text = paket?.text ?? "";
  const { rumpf, tags } = teileText(text);
  const titel = titelAus(text, slot.title);
  const videos = paket?.assets.filter((a) => a.kind === "video" || /\.mp4$/i.test(a.filename)) ?? [];
  const bilder = paket?.assets.filter((a) => !videos.includes(a)) ?? [];

  return (
    <aside className="mp-drawer">
      <Card>
        <div className="mp-card-head">
          <h2><span className={`mp-ampel mp-ampel--${k}`} /> {KIND_LABEL[k]}</h2>
          <button type="button" className="mp-btn" onClick={onClose}>Schließen</button>
        </div>
        <dl className="mp-dl">
          <dt>Kanal</dt><dd><ChannelTag name={platform} projectId={projectId} className="" /> <span className="mp-small mp-muted">{vonHand ? "von Hand" : "der Pilot postet"}</span></dd>
          <dt>Termin</dt><dd>{tagLabel(slot.date)}, {uhr(slot)} Uhr</dd>
          {art && <><dt>Sorte</dt><dd><span className={`mp-art mp-art--${art.farbe}`}>{slot.postArt}</span> {art.name}{slot.drehbuch && <span className="mp-muted"> · „{slot.drehbuch}“</span>}</dd></>}
          {!slot.pieceId && slot.slotArt && <><dt>Vorgesehen</dt><dd><span className={`mp-art mp-art--${artDef(slot.slotArt).farbe}`}>{slot.slotArt}</span> {artDef(slot.slotArt).name} — nichts dieser Sorte bereit</dd></>}
          {slot.title && <><dt>Stück</dt><dd>{slot.title}</dd></>}
          {slot.format && <><dt>Format</dt><dd>{formatName(slot.format)}</dd></>}
          {slot.error && <><dt>Fehler</dt><dd className="mp-bad">{slot.error}</dd></>}
          {slot.externalUrl && <><dt>Beitrag</dt><dd><a href={slot.externalUrl} target="_blank" rel="noreferrer">ansehen ↗</a></dd></>}
        </dl>

        {/* --- Die Knöpfe, die den Zustand weiterschieben --------------------- */}
        <div className="mp-form-actions mp-lade-aktionen">
          {k === "rot" && <Link className="mp-btn mp-btn--primary" to={`/projects/${projectId}/review`}>Zur Freigabe</Link>}
          {k === "gelb" && <>
            <Button variant="primary" disabled={busy} onClick={() => void freigeben()} title={vonHand ? "Freigeben — danach hier „geplant“ oder „gepostet“ setzen" : "Freigeben — der Pilot legt es in diesen Slot"}>Freigeben</Button>
            <Button variant="danger" disabled={busy} onClick={ablehnen}>Ablehnen</Button>
            <Link className="mp-btn" to={`/projects/${projectId}/review?piece=${slot.pieceId}`}>Text bearbeiten</Link>
          </>}
          {k === "frei" && (vonHand ? <>
            <Button variant="primary" disabled={busy} onClick={() => void externGeplant()} title="Du hast den Beitrag in der App für diesen Termin eingestellt">Auf {plattformName(platform)} geplant</Button>
            <Button disabled={busy} onClick={externGepostet}>Schon gepostet ✓</Button>
          </> : <>
            <Button variant="primary" disabled={busy} onClick={() => void einplanen()}>In diesen Slot einplanen</Button>
            <Button disabled={busy} onClick={externGepostet}>Von Hand gepostet ✓</Button>
          </>)}
          {k === "blau" && <>
            <Button variant="primary" disabled={busy} onClick={externGepostet}>Gepostet ✓</Button>
            <Button disabled={busy} onClick={() => void absagen()}>Termin lösen</Button>
          </>}
          {k === "gruen" && <>
            <span className="mp-small mp-muted">Der Pilot postet {tagLabel(slot.date)} um {uhr(slot)} Uhr.</span>
            <Button variant="danger" disabled={busy} onClick={() => void absagen()}>Absagen</Button>
          </>}
          {k === "fehler" && <>
            <Button variant="primary" disabled={busy} onClick={() => void einplanen()}>Erneut einplanen</Button>
            <Button disabled={busy} onClick={externGepostet}>Von Hand gepostet ✓</Button>
          </>}
          {slot.pieceId && <Link className="mp-btn" to={`/projects/${projectId}/publish/${slot.pieceId}`}>Paket</Link>}
        </div>
        {k === "gelb" && !vonHand && <p className="mp-small mp-muted">Projektion: nach der Freigabe legt der Pilot das Stück auf den nächsten freien Slot — diesen, wenn vorher nichts anderes freigegeben wird.</p>}
      </Card>

      {/* --- Das Paket: für Handkanäle die Arbeitsfläche, sonst zum Nachsehen -- */}
      {paket && (
        <Card className="mp-lade-paket">
          <div className="mp-card-head"><h2>{vonHand ? "Zum Hochladen" : "Paket"}</h2>
            {paket.deepLink && <a className="mp-btn" href={paket.deepLink} target="_blank" rel="noreferrer">{paket.deepLinkLabel ?? "Plattform öffnen"} ↗</a>}
          </div>
          {(platform === "youtube" || platform === "tiktok" || platform === "pinterest") && (
            <div className="mp-lade-feld">
              <div className="mp-lade-feldkopf"><span className="mp-label">Titel</span><CopyButton text={titel} label="Kopieren" /></div>
              <div className="mp-lade-wert">{titel}</div>
            </div>
          )}
          <div className="mp-lade-feld">
            <div className="mp-lade-feldkopf"><span className="mp-label">{platform === "youtube" ? "Beschreibung" : "Text"}</span><CopyButton text={tags ? `${rumpf}\n\n${tags}` : rumpf} label="Alles kopieren" variant="primary" /></div>
            <pre className="mp-thema-body mp-lade-wert">{rumpf || "(kein Text)"}</pre>
          </div>
          {tags && (
            <div className="mp-lade-feld">
              <div className="mp-lade-feldkopf"><span className="mp-label">Schlagworte</span><CopyButton text={tags} label="Kopieren" /></div>
              <div className="mp-thema-tags">{tags}</div>
            </div>
          )}
          {(videos.length > 0 || bilder.length > 0) && (
            <div className="mp-lade-feld">
              <span className="mp-label">Dateien</span>
              <div className="mp-inline" style={{ flexWrap: "wrap", gap: 6 }}>
                {videos.map((a) => <a key={a.id} className="mp-btn mp-btn--primary" href={a.url} download={a.filename}>⬇ Video</a>)}
                {bilder.slice(0, 12).map((a, i) => <a key={a.id} className="mp-btn" href={a.url} download={a.filename}>⬇ {bilder.length === 1 ? "Bild" : `Bild ${i + 1}`}</a>)}
                {bilder.length > 12 && <span className="mp-small mp-muted">+{bilder.length - 12} weitere im Paket</span>}
              </div>
            </div>
          )}
          {paket.shortLink && (
            <div className="mp-lade-feld">
              <div className="mp-lade-feldkopf"><span className="mp-label">Link {paket.appOnly ? "für die Bio" : ""}</span><CopyButton text={paket.shortLink} label="Kopieren" /></div>
              <div className="mp-small mp-code">{paket.shortLink}</div>
            </div>
          )}
          {paket.notes.length > 0 && <details className="mp-details mp-small"><summary className="mp-label">Hinweise</summary><ul className="mp-plain-list">{paket.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
        </Card>
      )}
    </aside>
  );
}

/**
 * Slot-Analyse je Kanal: was eingestellt ist, was empfohlen wird, was der
 * Vorrat hergibt und was die eigenen Zahlen sagen. „Vorschlag übernehmen"
 * schreibt den Wochenplan samt Sorten in die Kanal-Slots — danach füllt die
 * Pipeline die Slots nach Sorte.
 */
function SlotAnalyseKarte({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [daten, setDaten] = useState<SlotAnalyse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const laden = useCallback(() => api<SlotAnalyse>(`/projects/${projectId}/pipeline/slotanalyse`).then(setDaten).catch(() => setDaten(null)), [projectId]);
  useEffect(() => { void laden(); }, [laden]);
  const setzeSlots = async (k: SlotAnalyseKanal, slots: SlotAnalyseKanal["vorschlag"]) => {
    setBusy(k.platform);
    try {
      await api(`/projects/${projectId}/publish/channel/${k.platform}`, { method: "PATCH", json: { slots } });
      await laden(); void loadProfiles(projectId, true); onChanged();
    } finally { setBusy(null); }
  };
  if (!daten) return null;
  return (
    <Card>
      <div className="mp-card-head"><h2>Slot-Analyse je Kanal</h2><span className="mp-small mp-muted">Empfehlung = Branchendaten 09/2026 + deine Vorgabe · Gemessen = eigene Beiträge</span></div>
      <div className="mp-slotanalyse">
        {daten.kanaele.map((k) => {
          const e = k.empfehlung;
          const proWoche = e.proTag * 7;
          const besteStunden = k.gemessen.stunden.filter((s) => s.n >= 2).slice(0, 3);
          const besteSorten = k.gemessen.sorten.filter((s) => s.n >= 2).slice(0, 3);
          const auf = offen === k.platform;
          return (
            <div key={k.platform} className="mp-slot-kanal">
              <div className="mp-slot-kopf">
                <ChannelTag name={k.platform} projectId={projectId} className="mp-tl-channel" />
                <span className="mp-small mp-muted">{STAGES[k.stage as ChannelStage]?.label ?? k.stage}{k.automatic ? " · postet selbst" : " · von Hand"}</span>
                <span className={`mp-small ${k.slotsJetzt === 0 ? "mp-warn-text" : "mp-muted"}`}>Slots: {k.slotsJetzt}/Woche{k.slotsMitArt > 0 && ` (${k.slotsMitArt} mit Sorte)`}</span>
                <span className="mp-small">Empfehlung: <b>{e.proTag}/Tag</b> um {e.stunden.map((h) => `${h}`).join(", ")} Uhr · <span className={`mp-art mp-art--${artDef(e.pflicht).farbe} mp-art--mini`}>{e.pflicht}</span> um {e.stunden[0]} Uhr</span>
                <span className="mp-inline mp-slot-knoepfe">
                  {k.slotsJetzt !== proWoche || k.slotsMitArt !== proWoche
                    ? <Button variant="primary" disabled={busy !== null} onClick={() => void setzeSlots(k, k.vorschlag)}>{busy === k.platform ? "…" : `Vorschlag übernehmen (${proWoche} Slots)`}</Button>
                    : <span className="mp-small mp-muted">Vorschlag ist gesetzt ✓</span>}
                  <button type="button" className="mp-linkbtn mp-small" onClick={() => setOffen(auf ? null : k.platform)}>{auf ? "weniger" : "Details"}</button>
                </span>
              </div>
              <div className="mp-slot-zeile mp-small">
                <span><b>Vorrat</b> {k.vorratGesamt} {k.vorratGesamt === 1 ? "Stück" : "Stücke"}{k.reichtTage !== null && ` · reicht ${k.reichtTage} ${k.reichtTage === 1 ? "Tag" : "Tage"} bei ${e.proTag}/Tag`}
                  {k.vorrat.length > 0 && <> · {k.vorrat.map((v) => <span key={v.art} className={`mp-art mp-art--${artDef(v.art).farbe} mp-art--mini`} title={artDef(v.art).name}>{v.art} {v.n}</span>)}</>}
                  {k.vorrat.length > 0 && !k.vorrat.some((v) => v.art === e.pflicht) && <span className="mp-warn-text"> · keine {artDef(e.pflicht).name} bereit</span>}
                </span>
                <span><b>Gemessen</b> {k.gemessen.beitraege === 0 ? "noch keine Beiträge mit Zahlen" : <>
                  {k.gemessen.beitraege} Beiträge ·
                  {besteStunden.length > 0 ? <> beste Stunden {besteStunden.map((s) => `${s.stunde} Uhr (Ø ${s.aufrufe.toLocaleString("de-DE")}, n=${s.n})`).join(", ")}</> : " je Stunde noch unter 2 Beiträgen"}
                  {besteSorten.length > 0 && <> · beste Sorten {besteSorten.map((s) => `${s.art} (Ø ${s.aufrufe.toLocaleString("de-DE")}, n=${s.n})`).join(", ")}</>}
                </>}</span>
              </div>
              {auf && (
                <div className="mp-slot-details mp-small">
                  <p className="mp-muted">{e.hinweis}</p>
                  {e.hebel.length > 0 && <><b>Reichweite auf {k.label}:</b><ul className="mp-plain-list">{e.hebel.map((h, i) => <li key={i}>{h}</li>)}</ul></>}
                  <b>Wochenplan im Vorschlag:</b>
                  <div className="mp-slot-plan">
                    {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d) => (
                      <div key={d}><span className="mp-label">{TAG_KURZ[d]}</span> {k.vorschlag.filter((s) => s.day === d).map((s) => <span key={`${s.day}${s.hour}`} className={`mp-art mp-art--${artDef(s.art).farbe} mp-art--mini`} title={artDef(s.art).name}>{String(s.hour).padStart(2, "0")} {s.art}</span>)}</div>
                    ))}
                  </div>
                  {k.slotsJetzt > 0 && <Button disabled={busy !== null} onClick={() => void setzeSlots(k, [])}>Slots leeren</Button>}
                  {k.gemessen.sorten.length > 0 && (
                    <div className="mp-inline" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {POST_ART_REIHE.filter((a) => k.gemessen.sorten.some((s) => s.art === a)).map((a) => { const s = k.gemessen.sorten.find((x) => x.art === a)!; return <span key={a} className={`mp-art mp-art--${artDef(a).farbe}`} title={artDef(a).name}>{a} Ø {s.aufrufe.toLocaleString("de-DE")} · n={s.n}</span>; })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
