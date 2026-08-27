/** Media library: everything the tool created, across projects - filter by type, project, status, time; open the piece where it lives. */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { api } from "../api.js";
import { Card, EmptyState, Notice, PageHeader, Pill, fmtDateTime } from "../components/ui.js";
import { fmtUsd } from "../components/Revise.js";
import { fmtBytes } from "./Storage.js";
import { ChannelTag } from "../components/ChannelLink.js";

interface MediaItem { id: string; projectId: string; projectName: string; title: string; format: string; status: string; channel: string; createdAt: string; updatedAt: string; renderedAt: string | null; costUsd: number; thumbUrl: string | null; previewUrl: string | null; assetCount: number; bytes: number; humanEdited: boolean }

const FORMAT_LABEL: Record<string, string> = { text: "Text", carousel: "Carousel", pin: "Pin", image: "Bild", directory_entry: "Verzeichnis", article: "Artikel", video: "Video" };
const STATUS_LABEL: Record<string, string> = { draft: "Entwurf", review: "In Prüfung", approved: "Freigegeben", published: "Veröffentlicht", rejected: "Abgelehnt" };
const RANGES: { key: string; label: string; ms: number | null }[] = [{ key: "all", label: "Gesamter Zeitraum", ms: null }, { key: "day", label: "Heute", ms: 864e5 }, { key: "week", label: "Letzte 7 Tage", ms: 7 * 864e5 }, { key: "month", label: "Letzte 30 Tage", ms: 30 * 864e5 }];

export function MediaPage() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [range, setRange] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"created" | "updated" | "cost" | "bytes">("created");
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (format) p.set("format", format); if (status) p.set("status", status); if (project) p.set("projectId", project);
      const r = RANGES.find((x) => x.key === range); if (r?.ms) p.set("since", new Date(Date.now() - r.ms).toISOString());
      if (q.trim()) p.set("q", q.trim());
      setItems(await api<MediaItem[]>(`/media?${p.toString()}`)); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
  }, [format, status, project, range, q]);
  useEffect(() => { void load(); }, [load]);
  const projects = Array.from(new Map((items ?? []).map((i) => [i.projectId, i.projectName])).entries());
  const sorted = [...(items ?? [])].sort((a, b) => sort === "cost" ? b.costUsd - a.costUsd : sort === "bytes" ? b.bytes - a.bytes : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : b.createdAt.localeCompare(a.createdAt));
  const total = sorted.reduce((n, i) => n + i.costUsd, 0), bytes = sorted.reduce((n, i) => n + i.bytes, 0);
  const linkFor = (i: MediaItem) => i.format === "video" ? `/projects/${i.projectId}/studio/video?piece=${i.id}` : i.status === "approved" || i.status === "published" ? `/projects/${i.projectId}/publish/${i.id}` : `/projects/${i.projectId}/review?piece=${i.id}`;
  return (
    <>
      <PageHeader label="Inhalte" title="Medien" actions={<span className="mp-label">{sorted.length} Stücke · {fmtUsd(total)} · {fmtBytes(bytes)}</span>} />
      {error && <Notice kind="bad">{error}</Notice>}
      <Card className="mp-form-card"><div className="mp-filters">
        <label className="mp-field"><span>Art</span><select value={format} onChange={(e) => setFormat(e.target.value)}><option value="">Alle</option>{Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="mp-field"><span>Projekt</span><select value={project} onChange={(e) => setProject(e.target.value)}><option value="">Alle</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="mp-field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Alle</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="mp-field"><span>Erstellt</span><select value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        <label className="mp-field"><span>Sortierung</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="created">Neueste zuerst</option><option value="updated">Zuletzt bearbeitet</option><option value="cost">Teuerste zuerst</option><option value="bytes">Größte zuerst</option></select></label>
        <label className="mp-field mp-field--grow"><span>Suche im Titel</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="z. B. Onboarding" /></label>
      </div></Card>
      {items && sorted.length === 0 && <EmptyState title="Nichts gefunden" text="Mit diesen Filtern gibt es keine Stücke." />}
      <div className="mp-media-grid">
        {sorted.map((i) => (
          <Card key={i.id} className="mp-media-card">
            <Link to={linkFor(i)} className="mp-media-thumb" aria-label={i.title}>
              {i.thumbUrl ? <img src={i.thumbUrl} alt="" loading="lazy" /> : <span className="mp-media-thumb-fallback">{FORMAT_LABEL[i.format] ?? i.format}</span>}
            </Link>
            <div className="mp-media-body">
              <div className="mp-inline"><Pill kind="kind">{FORMAT_LABEL[i.format] ?? i.format}</Pill><span className="mp-small mp-muted">{STATUS_LABEL[i.status] ?? i.status}{i.humanEdited ? " · bearbeitet" : ""}</span></div>
              <Link to={linkFor(i)} className="mp-media-title">{i.title || "(ohne Titel)"}</Link>
              <div className="mp-small mp-muted">{i.projectName} · {i.channel ? <ChannelTag name={i.channel} projectId={i.projectId} className="" /> : "–"}</div>
              <div className="mp-small mp-muted">Erstellt {fmtDateTime(i.createdAt)}<br />Bearbeitet {fmtDateTime(i.updatedAt)}{i.renderedAt && <><br />Gerendert {fmtDateTime(i.renderedAt)}</>}</div>
              <div className="mp-small">{fmtUsd(i.costUsd)}{i.bytes > 0 && ` · ${fmtBytes(i.bytes)}`}{i.assetCount > 0 && ` · ${i.assetCount} Dateien`}</div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
