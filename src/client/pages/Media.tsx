/** Media library: everything the tool created, across projects - filter by type, project, status, time; open the piece where it lives. */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { api } from "../api.js";
import { BEWEGTE_FORMATE, FORMAT_NAMEN, STATUS_NAMEN, formatName, statusName } from "../../shared/labels.js";
import { Blaettern, Button, Card, EmptyState, Notice, PageHeader, Pill, fmtDateTime, useSeiten } from "../components/ui.js";
import { plattformName } from "../../shared/channels.js";
import { fmtUsd } from "../components/Revise.js";
import { fmtBytes } from "./Storage.js";
import { ChannelTag } from "../components/ChannelLink.js";
import { Themen, type ThemenStueck } from "../components/Themen.js";

interface MediaItem { id: string; projectId: string; projectName: string; title: string; format: string; status: string; channel: string; platform: string; createdAt: string; updatedAt: string; renderedAt: string | null; costUsd: number; thumbUrl: string | null; previewUrl: string | null; videoUrl: string | null; assetCount: number; bytes: number; humanEdited: boolean; body: string; gruppe: string }
interface Facetten { projects: { id: string; name: string }[]; platforms: string[]; formats: string[] }

const RANGES: { key: string; label: string; ms: number | null }[] = [{ key: "all", label: "Gesamter Zeitraum", ms: null }, { key: "day", label: "Heute", ms: 864e5 }, { key: "week", label: "Letzte 7 Tage", ms: 7 * 864e5 }, { key: "month", label: "Letzte 30 Tage", ms: 30 * 864e5 }];

/** Ein Wert, der erst nach einer kurzen Tipp-Pause weitergereicht wird. */
function useVerzoegert<T>(wert: T, ms = 300): T {
  const [v, setV] = useState(wert);
  useEffect(() => { const t = setTimeout(() => setV(wert), ms); return () => clearTimeout(t); }, [wert, ms]);
  return v;
}

export function MediaPage() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [platform, setPlatform] = useState("");
  const [nurBewegt, setNurBewegt] = useState(false);
  const [range, setRange] = useState("all");
  const [q, setQ] = useState("");
  // Die Suche fragte bei jedem Tastendruck den Server — „Onboarding" waren zehn Anfragen.
  const qRuhig = useVerzoegert(q.trim());
  const [sort, setSort] = useState<"created" | "updated" | "cost" | "bytes">("created");
  /**
   * Zwei Ansichten: „Themen" fasst die App-Fassungen eines Beitrags zusammen und
   * zeigt den fertigen Text daneben — das ist der Blick, mit dem man etwas
   * hochlädt. „Kacheln" bleibt für alles, was kein Beitrag mit Text ist.
   */
  const [ansicht, setAnsicht] = useState<"themen" | "kacheln">("themen");
  /**
   * Die Auswahllisten kommen vom Server und hängen nicht am Ergebnis: Vorher
   * schrumpften Projekt- und Kanalliste mit jedem Filter, und wer eine Kombination
   * wählte, die nichts fand, sah seine eigene Auswahl nicht mehr im Feld.
   */
  const [facetten, setFacetten] = useState<Facetten>({ projects: [], platforms: [], formats: [] });
  useEffect(() => { api<Facetten>("/media/facets").then(setFacetten).catch(() => undefined); }, []);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (format) p.set("format", format); if (status) p.set("status", status); if (project) p.set("projectId", project); if (platform) p.set("platform", platform);
      const r = RANGES.find((x) => x.key === range); if (r?.ms) p.set("since", new Date(Date.now() - r.ms).toISOString());
      if (qRuhig) p.set("q", qRuhig);
      // Wer nach Bewegtbild oder Kosten sortiert, braucht mehr als die jüngsten 200.
      p.set("limit", nurBewegt || sort === "cost" || sort === "bytes" ? "500" : "200");
      setItems(await api<MediaItem[]>(`/media?${p.toString()}`)); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [format, status, project, platform, range, qRuhig, nurBewegt, sort]);
  useEffect(() => { void load(); }, [load]);
  /**
   * Freigeben direkt aus der Mediathek: Wer hier ein fertiges Reel sieht, will
   * es nicht erst auf einer zweiten Seite suchen. Betroffen sind nur Stücke,
   * die noch auf Freigabe warten — alles andere bekommt keinen Knopf.
   */
  const [busy, setBusy] = useState(false);
  const freigeben = async (stuecke: { id: string }[]) => {
    setBusy(true);
    try {
      for (const st of stuecke) await api(`/content/${st.id}`, { method: "PATCH", json: { status: "approved" } });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  };
  const bewegt = new Set<string>(BEWEGTE_FORMATE);
  const sorted = [...(items ?? [])].filter((i) => !nurBewegt || bewegt.has(i.format)).sort((a, b) => sort === "cost" ? b.costUsd - a.costUsd : sort === "bytes" ? b.bytes - a.bytes : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : b.createdAt.localeCompare(a.createdAt));
  const total = sorted.reduce((n, i) => n + i.costUsd, 0), bytes = sorted.reduce((n, i) => n + i.bytes, 0);
  // 24 Kacheln je Seite: ein Bildschirm voll, statt 200 Bilder auf 99.407 px.
  const seiten = useSeiten(sorted, 24);
  const linkFor = (i: ThemenStueck) => i.format === "video" ? `/projects/${i.projectId}/studio/video?piece=${i.id}` : i.status === "approved" || i.status === "published" ? `/projects/${i.projectId}/publish/${i.id}` : `/projects/${i.projectId}/review?piece=${i.id}`;
  const aktiv = Boolean(format || platform || status || project || nurBewegt || range !== "all" || q);
  const zuruecksetzen = () => { setFormat(""); setPlatform(""); setStatus(""); setProject(""); setNurBewegt(false); setRange("all"); setQ(""); };
  // Nur Formate anbieten, die es wirklich gibt — die Liste kannte 15, der Bestand hat 9.
  const formate = Object.entries(FORMAT_NAMEN).filter(([k]) => facetten.formats.length === 0 || facetten.formats.includes(k));
  return (
    <>
      <PageHeader label="Inhalte" title="Medien" actions={
        <div className="mp-inline">
          <span className="mp-label">{sorted.length} Stücke · {fmtUsd(total)} · {fmtBytes(bytes)}</span>
          <Button onClick={() => setAnsicht((v) => v === "themen" ? "kacheln" : "themen")}>
            {ansicht === "themen" ? "Als Kacheln" : "Als Themen"}
          </Button>
        </div>} />
      {error && <Notice kind="bad">{error}</Notice>}
      <Card className="mp-form-card"><div className="mp-filters">
        <label className="mp-field"><span>Art</span><select value={nurBewegt ? "__bewegt" : format} onChange={(e) => { const v = e.target.value; setNurBewegt(v === "__bewegt"); setFormat(v === "__bewegt" ? "" : v); }}>
          <option value="">Alle</option>
          <option value="__bewegt">Nur Bewegtbild (Reels, Videos, Stories)</option>
          {formate.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        <label className="mp-field"><span>Kanal</span><select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">Alle</option>{facetten.platforms.map((k) => <option key={k} value={k}>{plattformName(k)}</option>)}</select></label>
        <label className="mp-field"><span>Projekt</span><select value={project} onChange={(e) => setProject(e.target.value)}><option value="">Alle</option>{facetten.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="mp-field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Alle mit Dateien</option>{Object.entries(STATUS_NAMEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="mp-field"><span>Erstellt</span><select value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        <label className="mp-field"><span>Sortierung</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="created">Neueste zuerst</option><option value="updated">Zuletzt bearbeitet</option><option value="cost">Teuerste zuerst</option><option value="bytes">Größte zuerst</option></select></label>
        <label className="mp-field mp-field--grow"><span>Suche im Titel</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="z. B. Glurak" /></label>
      </div>
      {aktiv && (
        <div className="mp-inline" style={{ marginTop: 10 }}>
          <Button onClick={zuruecksetzen}>Filter zurücksetzen</Button>
          {!status && <span className="mp-small mp-muted">Ohne Status-Filter bleiben Stücke ohne Dateien (z. B. abgelehnte nach 7 Tagen) verborgen.</span>}
        </div>
      )}</Card>
      {items && sorted.length === 0 && <EmptyState title="Nichts gefunden" text={status ? "Mit diesen Filtern gibt es keine Stücke." : "Mit diesen Filtern gibt es keine Stücke mit Dateien — abgelehnte verlieren ihre Dateien nach sieben Tagen. Mit Status „abgelehnt“ erscheinen sie trotzdem."} />}
      {ansicht === "themen" ? (
        <Themen items={seiten.aktuell} linkFor={linkFor}
                aufFreigabe={(stuecke) => void freigeben(stuecke)}
                aufSammelFreigabe={(stuecke) => void freigeben(stuecke)} busy={busy} />
      ) : (
      <div className="mp-media-grid">
        {seiten.aktuell.map((i) => (
          <Card key={i.id} className="mp-media-card">
            <Link to={linkFor(i)} className="mp-media-thumb" aria-label={i.title}>
              {i.thumbUrl ? <img src={i.thumbUrl} alt="" loading="lazy" /> : <span className="mp-media-thumb-fallback">{formatName(i.format)}</span>}
            </Link>
            <div className="mp-media-body">
              <div className="mp-inline"><Pill kind="kind">{formatName(i.format)}</Pill><span className="mp-small mp-muted">{statusName(i.status)}{i.humanEdited ? " · bearbeitet" : ""}</span></div>
              <Link to={linkFor(i)} className="mp-media-title">{i.title || "(ohne Titel)"}</Link>
              <div className="mp-small mp-muted">{i.projectName} · {i.platform ? <ChannelTag name={i.platform} projectId={i.projectId} className="" /> : "–"}</div>
              <div className="mp-small mp-muted">Erstellt {fmtDateTime(i.createdAt)}<br />Bearbeitet {fmtDateTime(i.updatedAt)}{i.renderedAt && <><br />Gerendert {fmtDateTime(i.renderedAt)}</>}</div>
              <div className="mp-small">{fmtUsd(i.costUsd)}{i.bytes > 0 && ` · ${fmtBytes(i.bytes)}`}{i.assetCount > 0 && ` · ${i.assetCount} Dateien`}</div>
              {/* Fuer TikTok und jeden anderen Weg von Hand: die Datei direkt mitnehmen. */}
              {i.videoUrl && <a className="mp-button" href={i.videoUrl} download={`${(i.title || "reel").replace(/[^\w\d]+/g, "-").toLowerCase()}.mp4`}>Video herunterladen</a>}
            </div>
          </Card>
        ))}
      </div>
      )}
      <Blaettern {...seiten} einheit="Stücke" />
    </>
  );
}
