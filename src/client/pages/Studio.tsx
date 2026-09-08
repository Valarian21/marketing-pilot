import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { BrandKit, ContentPiece, DirectoryStatus, HashtagPools, Job, ProductDataView, SocialKitTexts, SocialKitView, StudioView, VideoView } from "../../shared/schemas.js";
import { api } from "../api.js";
import { Button, Card, Notice, PageHeader, Pill, fmtDateTime, type PillKind } from "../components/ui.js";
import { ProjectNav } from "../components/ProjectNav.js";
import { fmtUsd } from "../components/Revise.js";
import { ChannelTag, useProfiles } from "../components/ChannelLink.js";
import { STAGES } from "../../shared/channels.js";

const TABS = [{ id: "erstellen", label: "Erstellen" }, { id: "brand", label: "Brand-Kit & Stimme" }, { id: "hashtags", label: "Hashtags" }, { id: "verzeichnisse", label: "Verzeichnisse" }, { id: "geo", label: "GEO-Artikel" }] as const;
type Tab = (typeof TABS)[number]["id"];
const FORMAT_LABEL: Record<string, string> = { text: "Text-Post", carousel: "Carousel", pin: "Pinterest-Pin", image: "Bild (KI)", ad_creative: "Ad-Hintergrund (KI)", article: "GEO-Artikel", directory_entry: "Directory-Eintrag", video: "Video", community_reply: "Community-Antwort", data_carousel: "Daten-Carousel", data_reel: "Daten-Reel", showcase_carousel: "Binderseiten", artwork_carousel: "Kunstseite", story: "Story (24 h)" };
/** Plattformen, die ein Daten-Bündel bedienen kann - Reihenfolge = Vorschlag im Formular. */
const BUNDLE_PLATFORMS = ["instagram", "tiktok", "pinterest", "facebook", "bluesky", "x"] as const;
const STATUS: Record<ContentPiece["status"], { label: string; kind: PillKind }> = { draft: { label: "Entwurf", kind: "todo" }, review: { label: "in Freigabe", kind: "review" }, approved: { label: "freigegeben", kind: "done" }, published: { label: "veröffentlicht", kind: "done" }, rejected: { label: "abgelehnt", kind: "kind" } };

export function StudioPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "erstellen") as Tab;
  const [view, setView] = useState<StudioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => { try { setView(await api<StudioView>(`/projects/${id}/studio`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(null); }
  };

  if (!view) return <><ProjectNav id={id} />{error && <Notice kind="bad">{error}</Notice>}</>;
  const noVoice = !view.brandKit.voiceProfile;

  return (
    <>
      <ProjectNav id={id} />
      <PageHeader label="Inhalte" title="Content Studio" />
      {error && <Notice kind="bad">{error}</Notice>}
      {!view.hasBrief && <Notice kind="warn">Ohne Brief kein Content – <Link to={`/projects/${id}/analysis`}>Analyse ausführen</Link>.</Notice>}
      {noVoice && view.hasBrief && <Notice kind="warn">Kein Voice-Profil: Texte klingen dann generisch. Lade unter „Brand-Kit &amp; Stimme“ 5–20 eigene Texte hoch und leite das Profil ab.</Notice>}
      <nav className="mp-subnav" aria-label="Studio-Bereiche">
        {TABS.map((t) => <button key={t.id} type="button" className={`mp-subnav-item mp-linkbtn${tab === t.id ? " is-active" : ""}`} onClick={() => setParams({ tab: t.id })}>{t.label}</button>)}
        <Link className="mp-subnav-item mp-subnav-item--link" to={`/projects/${id}/studio/video`}>Video-Fabrik →</Link>
      </nav>

      {tab === "erstellen" && <CreateTab id={id} view={view} busy={busy} run={run} />}
      {tab === "brand" && <><BrandTab id={id} kit={view.brandKit} busy={busy} run={run} /><SocialKitCard id={id} busy={busy} run={run} /></>}
      {tab === "hashtags" && <HashtagTab id={id} busy={busy} run={run} />}
      {tab === "verzeichnisse" && <DirectoriesTab id={id} dirs={view.directories} busy={busy} run={run} />}
      {tab === "geo" && <GeoTab id={id} view={view} busy={busy} run={run} />}
    </>
  );
}

type Run = (label: string, fn: () => Promise<unknown>) => Promise<void>;

function CreateTab({ id, view, busy, run }: { id: string; view: StudioView; busy: string | null; run: Run }) {
  // tasks link here with format/platform/topic pre-filled ("Im Studio erstellen")
  const [params] = useSearchParams();
  const [format, setFormat] = useState(params.get("format") ?? "text");
  const [platform, setPlatform] = useState(params.get("platform") ?? "linkedin");
  const [template, setTemplate] = useState("clean");
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [hint, setHint] = useState(params.get("hint") ?? "");
  const profiles = useProfiles(id);
  const stageOf = (p: string) => profiles.find((x) => x.platform === p)?.stage ?? "off";
  const opt = (p: string) => <option key={p} value={p}>{p} · {STAGES[stageOf(p)].label}</option>;

  // Daten-Carousel: Bereich, Umfang und Bündel-Plattformen
  const [data, setData] = useState<ProductDataView | null>(null);
  const [scope, setScope] = useState("");
  const [n, setN] = useState(15);
  const [basis, setBasis] = useState("max");
  const [countdown, setCountdown] = useState(true);
  const [language, setLanguage] = useState("de");
  const [bundle, setBundle] = useState<string[]>(["instagram", "tiktok", "pinterest", "facebook"]);
  const [reel, setReel] = useState<{ voiceover: boolean; music: "none" | "bed"; secondsPerCard: number }>({ voiceover: false, music: "bed", secondsPerCard: 1.8 });
  // Kunstseiten: welche Seite der Vitrine, und wessen Seiten überhaupt.
  const [artwork, setArtwork] = useState({ artworkId: "", ownOnly: true, owner: "" });

  useEffect(() => { void (async () => { try { setData(await api<ProductDataView>(`/projects/${id}/data`)); } catch { setData(null); } })(); }, [id]);
  useEffect(() => {
    if (scope || !data?.sets.length) return;
    const first = data.sets.find((x) => x.region === "intl") ?? data.sets[0]!;
    setScope(`set:${first.id}`);
  }, [data, scope]);

  const hasData = Boolean(data?.status.available);
  const isData = format === "data_carousel" || format === "data_reel";
  const isArtwork = format === "artwork_carousel";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isArtwork) {
      void run("create", () => api(`/projects/${id}/content`, { method: "POST", json: {
        format, topic, hint, language, bundlePlatforms: bundle, platform: bundle[0] ?? "instagram",
        artwork: { ...artwork, styles: [] },
      } }));
      return;
    }
    if (isData) {
      const [art, wert] = scope.split(":");
      void run("create", () => api(`/projects/${id}/content`, { method: "POST", json: {
        format, topic, hint, language, bundlePlatforms: bundle,
        platform: bundle[0] ?? "instagram",
        dataQuery: { kind: "top", ...(art === "set" ? { set: wert } : { era: wert }), n, priceBasis: basis, countdown },
        ...(format === "data_reel" ? { reel } : {}),
      } }));
      return;
    }
    void run("create", () => api(`/projects/${id}/content`, { method: "POST", json: { format, platform: format === "pin" ? "pinterest" : platform, template, topic, hint } }));
  };
  const toggle = (p: string) => setBundle((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <>
      <Card className="mp-form-card">
        <form className="mp-form" onSubmit={submit}>
          <div className="mp-form mp-form--row">
            <label className="mp-field mp-field--short"><span>Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="text">Text-Post</option><option value="carousel">Carousel (PNG 1080²/1080×1350)</option>
                {hasData && <option value="data_carousel">Daten-Carousel (Rangliste)</option>}
                {hasData && <option value="data_reel">Daten-Reel (Video 1080×1920)</option>}
                {hasData && <option value="artwork_carousel">Kunstseite (Vitrine)</option>}
                <option value="pin">Pinterest-Pin (1000×1500)</option><option value="image">Bild / Thumbnail (KI)</option><option value="ad_creative">Ad-Hintergrund (KI)</option>
              </select></label>
            {format === "text" && <label className="mp-field mp-field--short"><span>Plattform</span><select value={platform} onChange={(e) => setPlatform(e.target.value)}>{["linkedin", "x", "threads", "bluesky", "facebook", "instagram"].map(opt)}</select></label>}
            {format === "carousel" && <><label className="mp-field mp-field--short"><span>Plattform</span><select value={platform} onChange={(e) => setPlatform(e.target.value)}>{["instagram", "linkedin"].map(opt)}</select></label>
              <label className="mp-field mp-field--short"><span>Layout</span><select value={template} onChange={(e) => setTemplate(e.target.value)}>{["clean", "bold", "screenshot", "list", "story"].map((t) => <option key={t} value={t}>{t}</option>)}</select></label></>}
            {!isData && !isArtwork && format !== "pin" && stageOf(platform) === "off" && <Notice kind="info">{platform} ist auf der <Link to={`/projects/${id}/channels`}>Kanäle-Seite</Link> ausgeschaltet. Erstellen geht trotzdem — nur Serien lassen den Kanal aus.</Notice>}
            {!isData && !isArtwork && <label className="mp-field"><span>Thema / Blickwinkel</span><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="z. B. „Sonntagabend-Vorbereitung in 10 Minuten“" /></label>}
          </div>

          {isArtwork && (
            <div className="mp-form mp-form--row">
              <label className="mp-field mp-field--short"><span>Dein Name in der Vitrine</span><input value={artwork.owner} onChange={(e) => setArtwork({ ...artwork, owner: e.target.value })} placeholder="z. B. Valarian" /></label>
              <label className="mp-field mp-field--short"><span>Welche Seiten</span>
                <select value={artwork.ownOnly ? "eigene" : "alle"} onChange={(e) => setArtwork({ ...artwork, ownOnly: e.target.value === "eigene" })}>
                  <option value="eigene">nur eigene</option><option value="alle">alle veröffentlichten</option>
                </select></label>
              <label className="mp-field mp-field--short"><span>Bestimmte Seite (optional)</span><input value={artwork.artworkId} onChange={(e) => setArtwork({ ...artwork, artworkId: e.target.value })} placeholder="leer = neueste passende" /></label>
              <label className="mp-field mp-field--short"><span>Sprache</span><select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="de">Deutsch</option><option value="en">Englisch</option><option value="both">beide (zwei Bündel)</option></select></label>
            </div>
          )}
          {isArtwork && !artwork.ownOnly && <Notice kind="warn">Fremde Kunstseiten gehören ihren Erstellern. „In der Vitrine veröffentlicht“ ist keine Zustimmung, die Seite auf Instagram zu stellen — vor dem Freigeben nachfragen.</Notice>}
          {isArtwork && (
            <fieldset className="mp-field">
              <span>Plattformen im Bündel <span className="mp-muted mp-small">gleiche Slides, eigene Caption, eigene Hashtags</span></span>
              <div className="mp-inline">{BUNDLE_PLATFORMS.map((p) => (
                <label key={p} className={`mp-inline mp-small${stageOf(p) === "off" ? " mp-muted" : ""}`} title={STAGES[stageOf(p)].summary}><input type="checkbox" checked={bundle.includes(p)} onChange={() => toggle(p)} /> {p} <span className="mp-muted">· {STAGES[stageOf(p)].label}</span></label>
              ))}</div>
            </fieldset>
          )}
          {isData && data && (
            <>
              <div className="mp-form mp-form--row">
                <label className="mp-field"><span>Bereich</span>
                  <select value={scope} onChange={(e) => setScope(e.target.value)}>
                    <optgroup label="Ären">{data.eras.map((x) => <option key={x.id} value={`era:${x.id}`}>{x.name} ({x.setCount} Sets)</option>)}</optgroup>
                    <optgroup label="Sets (international)">{data.sets.filter((x) => x.region === "intl").map((x) => <option key={x.id} value={`set:${x.id}`}>{x.name} · {x.releaseDate.slice(0, 4)}</option>)}</optgroup>
                    <optgroup label="Sets (Japan)">{data.sets.filter((x) => x.region === "jp").map((x) => <option key={x.id} value={`set:${x.id}`}>{x.name} · {x.releaseDate.slice(0, 4)}</option>)}</optgroup>
                  </select></label>
                <label className="mp-field mp-field--short"><span>Umfang</span><select value={n} onChange={(e) => setN(Number(e.target.value))}>{[10, 15, 20].map((v) => <option key={v} value={v}>Top {v}</option>)}</select></label>
                <label className="mp-field mp-field--short"><span>Preisbasis</span><select value={basis} onChange={(e) => setBasis(e.target.value)}><option value="max">teuerste Variante</option><option value="normal">normal</option><option value="holo">holo</option></select></label>
                <label className="mp-field mp-field--short"><span>Reihenfolge</span><select value={countdown ? "1" : "0"} onChange={(e) => setCountdown(e.target.value === "1")}><option value="1">Countdown ({n} → 1)</option><option value="0">Platz 1 zuerst</option></select></label>
                <label className="mp-field mp-field--short"><span>Sprache</span><select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="de">Deutsch</option><option value="en">Englisch</option><option value="both">beide (zwei Bündel)</option></select></label>
              </div>
              {format === "data_reel" && (
                <div className="mp-form mp-form--row">
                  <label className="mp-field mp-field--short"><span>Standzeit je Karte</span>
                    <select value={reel.secondsPerCard} onChange={(e) => setReel({ ...reel, secondsPerCard: Number(e.target.value) })}>
                      {[1.4, 1.6, 1.8, 2.0, 2.2, 2.5].map((v) => <option key={v} value={v}>{v.toFixed(1)} s</option>)}
                    </select></label>
                  <label className="mp-field mp-field--short"><span>Ton</span>
                    <select value={reel.voiceover ? "voice" : "mute"} onChange={(e) => setReel({ ...reel, voiceover: e.target.value === "voice" })}>
                      <option value="mute">stumm (Sound von der Plattform)</option><option value="voice">Voiceover</option>
                    </select></label>
                  <label className="mp-field mp-field--short" title="Über die API lässt sich kein Plattform-Sound anhängen — ohne Bett geht das Reel stumm raus. Auf TikTok stellst du beim Hochladen die Originallautstärke auf 0 und legst einen Trending-Sound darüber."><span>Musik</span>
                    <select value={reel.music} onChange={(e) => setReel({ ...reel, music: e.target.value as "none" | "bed" })}>
                      <option value="bed">Musikbett (nötig beim Posten über die API)</option>
                      <option value="none">keine — Sound erst auf der Plattform</option>
                    </select></label>
                  {reel.music === "bed" && view.musicTracks === 0 && (
                    <p className="mp-small mp-note">Kein Track in <code className="mp-code">marketing-pilot/assets/music/</code> — das Reel würde stumm rendern. 6–8 CC0-Stücke dort ablegen (Vorgaben stehen in der <code className="mp-code">README.md</code> des Ordners).</p>
                  )}
                </div>
              )}
              <fieldset className="mp-field">
                <span>Plattformen im Bündel <span className="mp-muted mp-small">{format === "data_reel" ? "eine MP4 für alle, eigene Caption je Kanal" : "gleiche Slides, eigene Caption, eigene Hashtags"}</span></span>
                <div className="mp-inline">{BUNDLE_PLATFORMS.map((p) => (
                  <label key={p} className={`mp-inline mp-small${stageOf(p) === "off" ? " mp-muted" : ""}`} title={STAGES[stageOf(p)].summary}><input type="checkbox" checked={bundle.includes(p)} onChange={() => toggle(p)} /> {p} <span className="mp-muted">· {STAGES[stageOf(p)].label}</span></label>
                ))}</div>
              </fieldset>
            </>
          )}

          <div className="mp-form mp-form--row">
            {isData && <label className="mp-field"><span>Thema / Blickwinkel (optional)</span><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="z. B. „für Wiedereinsteiger“" /></label>}
            <label className="mp-field"><span>Hinweis (optional)</span><input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Ton, Zahlen, was rein soll, was nicht" /></label>
            <div className="mp-form-actions"><Button type="submit" variant="primary" disabled={busy !== null || !view.hasBrief || (isData && (!scope || bundle.length === 0)) || (isArtwork && (bundle.length === 0 || (artwork.ownOnly && !artwork.owner.trim())))}>{busy === "create" ? "Agent arbeitet …" : isData || isArtwork ? "Bündel erzeugen" : "Entwurf erzeugen"}</Button></div>
          </div>
          <p className="mp-small mp-muted">
            {isData
              ? format === "data_reel"
                ? "Aus denselben Slides baut der Worker ein vertikales Countdown-Reel — ohne Aufnahme. Es bleibt unter 60 Sekunden; passt es nicht, sinkt zuerst die Standzeit, dann fallen die hintersten Plätze weg."
                : "Rang, Name, Set und Preis kommen unverändert aus den Produktdaten — das Modell schreibt nur Titel, Caption und Hashtags. Jede Slide trägt die Preisquelle mit Stand-Datum."
              : `Jeder Entwurf durchläuft den AI-Tell-Prüfer (Score 0–10, unter 7 wird automatisch überarbeitet) und landet in der Freigabe. ${view.screenshots.length} Produkt-Screenshots stehen für Carousel und Pin bereit.`}
          </p>
        </form>
      </Card>
      <ReelJobs id={id} />
      <PieceList id={id} pieces={view.recent} />
    </>
  );
}

/**
 * Reel-Renders laufen im Worker. Solange einer läuft, zeigt das Studio seinen
 * Fortschritt — sonst verschwände das Stück bis zur Freigabe aus dem Blick.
 */
function ReelJobs({ id }: { id: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const load = useCallback(async () => {
    try { const v = await api<VideoView>(`/projects/${id}/video`); setJobs(v.jobs.filter((j) => j.kind === "video.slideshow").slice(0, 3)); }
    catch { setJobs([]); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [active, load]);
  if (!jobs.length) return null;
  const STEP: Record<string, string> = { voice: "Stimme", overlays: "Overlays", video: "Video bauen", assets: "Speichern" };
  return (
    <Card>
      <h2>Reel-Renders</h2>
      <ul className="mp-plain-list">{jobs.map((j) => (
        <li key={j.id} className="mp-small">
          <Pill kind={j.status === "done" ? "done" : j.status === "failed" ? "review" : j.status === "running" ? "progress" : "todo"}>{j.status}</Pill>{" "}
          {j.steps.map((st) => `${STEP[st.name] ?? st.name}: ${st.status}`).join(" · ")}
          {j.error && <span className="mp-over"> — {j.error}</span>}
        </li>
      ))}</ul>
    </Card>
  );
}

/** Die ID des Bündels, zu dem ein Stück gehört — oder null für Einzelstücke. */
export const bundleIdOf = (p: ContentPiece): string | null => (typeof p.meta["bundleId"] === "string" ? p.meta["bundleId"] : null);

export function PieceList({ id, pieces: all }: { id: string; pieces: ContentPiece[] }) {
  // Ein Bündel ist eine Zeile: das Leit-Stück, die Geschwister nur als Zahl.
  const members = new Map<string, number>();
  for (const p of all) { const b = bundleIdOf(p); if (b) members.set(b, (members.get(b) ?? 0) + 1); }
  const pieces = all.filter((p) => { const b = bundleIdOf(p); return !b || b === p.id; });
  if (!pieces.length) return <Card className="mp-empty"><h2>Noch keine Stücke</h2><p>Erzeuge oben einen Entwurf oder führe eine Agent-Aufgabe aus.</p></Card>;
  return (
    <Card>
      <h2>Zuletzt erzeugt</h2>
      <div className="mp-table-wrap"><table className="mp-table">
        <thead><tr><th>Stück</th><th>Format</th><th>Kanal</th><th>Erstellt</th><th>AI-Tell</th><th>Kosten</th><th>Status</th><th></th></tr></thead>
        <tbody>{pieces.map((p) => { const st = STATUS[p.status]; return (
          <tr key={p.id}>
            <td>{p.title || "(ohne Titel)"}</td>
            <td><Pill kind="kind">{FORMAT_LABEL[p.format] ?? p.format}</Pill></td>
            <td className="mp-small"><ChannelTag name={p.channel} projectId={id} className="" />{(members.get(p.id) ?? 0) > 1 && <span className="mp-muted"> +{members.get(p.id)! - 1}</span>}</td>
            <td className="mp-small" title={`Zuletzt bearbeitet ${fmtDateTime(p.updatedAt)}`}>{fmtDateTime(p.createdAt)}</td>
            <td className="mp-num-cell">{p.aiTellScore === null ? "–" : `${p.aiTellScore}/10`}</td>
            <td className="mp-num-cell">{fmtUsd(p.costUsd)}</td>
            <td><Pill kind={st.kind}>{st.label}</Pill></td>
            <td><Link className="mp-btn" to={p.status === "approved" || p.status === "published" ? `/projects/${id}/publish/${p.id}` : `/projects/${id}/review?piece=${p.id}`}>{p.status === "approved" || p.status === "published" ? "Paket" : "Prüfen"}</Link></td>
          </tr>); })}</tbody>
      </table></div>
    </Card>
  );
}

function BrandTab({ id, kit, busy, run }: { id: string; kit: BrandKit; busy: string | null; run: Run }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [primary, setPrimary] = useState(kit.primary ?? "");
  useEffect(() => setPrimary(kit.primary ?? ""), [kit.primary]);
  const addSample = (e: FormEvent) => { e.preventDefault(); void run("sample", async () => { await api(`/projects/${id}/voice/samples`, { method: "POST", json: { text, source } }); setText(""); setSource(""); }); };
  return (
    <div className="mp-two-col">
      <Card>
        <div className="mp-card-head"><h2>Brand-Kit</h2><Button onClick={() => void run("brand", () => api(`/projects/${id}/brandkit/extract`, { method: "POST" }))} disabled={busy !== null}>{busy === "brand" ? "liest Website …" : kit.extractedAt ? "Neu aus Website lesen" : "Aus Website extrahieren"}</Button></div>
        {kit.extractedAt ? (
          <>
            <div className="mp-swatches">{kit.colors.map((c) => <button key={c} type="button" className={`mp-swatch${c === kit.primary ? " is-primary" : ""}`} style={{ background: c }} title={c} onClick={() => void run("primary", () => api(`/projects/${id}/brandkit`, { method: "PATCH", json: { primary: c } }))}><span>{c}</span></button>)}</div>
            <form className="mp-form mp-form--row" onSubmit={(e) => { e.preventDefault(); void run("primary", () => api(`/projects/${id}/brandkit`, { method: "PATCH", json: { primary } })); }}>
              <label className="mp-field mp-field--short"><span>Primärfarbe</span><input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="#3D7A4E" /></label>
              <div className="mp-form-actions"><Button type="submit">Speichern</Button></div>
            </form>
            <dl className="mp-dl">
              <dt>Text / Fläche</dt><dd>{kit.ink ?? "–"} / {kit.background ?? "–"}</dd>
              <dt>Schriften</dt><dd>{kit.fonts.join(", ") || "–"}</dd>
              <dt>Logo</dt><dd>{kit.logoAssetId ? <img className="mp-logo" src={`/api/mp/assets/${kit.logoAssetId}/file`} alt="Logo" /> : kit.logoUrl ?? "–"}</dd>
            </dl>
            <p className="mp-small mp-muted">Farben und Schriften fließen in Carousel-, Pin- und Directory-Vorlagen. Primärfarbe per Klick auf ein Feld wählen.</p>
          </>
        ) : <p className="mp-muted">Noch nicht extrahiert. Der Agent liest Farben, Logo und Schriften direkt von der Website.</p>}
      </Card>
      <Card>
        <div className="mp-card-head"><h2>Voice-Profil</h2><Button variant="primary" disabled={busy !== null || kit.voiceSamples.length < 3} onClick={() => void run("voice", () => api(`/projects/${id}/voice/derive`, { method: "POST" }))}>{busy === "voice" ? "leitet ab …" : kit.voiceProfile ? "Profil neu ableiten" : "Profil ableiten"}</Button></div>
        {kit.voiceProfile ? (
          <div className="mp-sub">
            <p>{kit.voiceProfile.summary}</p>
            <dl className="mp-dl mp-small">
              <dt>Anrede</dt><dd>{kit.voiceProfile.address}</dd>
              <dt>Satzlänge</dt><dd>{kit.voiceProfile.sentenceLength}</dd>
              <dt>Lieblingswörter</dt><dd>{kit.voiceProfile.favoriteWords.join(", ")}</dd>
              <dt>Humor</dt><dd>{kit.voiceProfile.humor}</dd>
              <dt>Einstiege</dt><dd>{kit.voiceProfile.typicalOpeners.join(" · ")}</dd>
              <dt>No-Gos</dt><dd>{kit.voiceProfile.noGos.join(", ")}</dd>
            </dl>
            <details className="mp-details"><summary className="mp-label">Prompt-Baustein</summary><pre className="mp-pre">{kit.voiceProfile.promptBlock}</pre></details>
            <span className="mp-label">aus {kit.voiceProfile.sampleCount} Texten · {new Date(kit.voiceProfile.derivedAt).toLocaleDateString("de-DE")}</span>
          </div>
        ) : <Notice kind="warn">Noch kein Profil. Mindestens 3, besser 5–20 eigene Texte (Posts, Mails, README-Abschnitte) einfügen.</Notice>}
        <form className="mp-form" onSubmit={addSample}>
          <label className="mp-field"><span>Eigener Text ({kit.voiceSamples.length}/30)</span><textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Einen eigenen Text einfügen (mind. 40 Zeichen)" /></label>
          <div className="mp-form mp-form--row">
            <label className="mp-field mp-field--short"><span>Quelle</span><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="LinkedIn-Post, Mail, README …" /></label>
            <div className="mp-form-actions"><Button type="submit" disabled={busy !== null || text.trim().length < 40}>Text hinzufügen</Button></div>
          </div>
        </form>
        {kit.voiceSamples.length > 0 && (
          <ul className="mp-samples">{kit.voiceSamples.map((sm) => <li key={sm.id}><span className="mp-small">{sm.source && <strong>{sm.source}: </strong>}{sm.text.slice(0, 140)}{sm.text.length > 140 ? " …" : ""}</span><Button variant="danger" aria-label="Entfernen" onClick={() => void run("del", () => api(`/projects/${id}/voice/samples/${sm.id}`, { method: "DELETE" }))}>×</Button></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

function DirectoriesTab({ id, dirs, busy, run }: { id: string; dirs: DirectoryStatus[]; busy: string | null; run: Run }) {
  return (
    <Card>
      <h2>Verzeichnis-Einträge <span className="mp-muted mp-small">alle Felder vorbereitet, Einreichen bleibt bei dir</span></h2>
      <div className="mp-table-wrap"><table className="mp-table">
        <thead><tr><th>Verzeichnis</th><th>Hinweis</th><th>Status</th><th></th></tr></thead>
        <tbody>{dirs.map((d) => (
          <tr key={d.slug}>
            <td><strong>{d.name}</strong><div className="mp-small"><a href={d.submitUrl} target="_blank" rel="noreferrer">{d.submitUrl.replace(/^https?:\/\//, "")}</a></div></td>
            <td className="mp-small mp-muted">{d.notes}</td>
            <td>{d.submittedAt ? <Pill kind="done">eingereicht</Pill> : d.pieceStatus ? <Pill kind={STATUS[d.pieceStatus].kind}>{STATUS[d.pieceStatus].label}</Pill> : <Pill kind="todo">offen</Pill>}</td>
            <td className="mp-inline">
              {d.pieceId ? <Link className="mp-btn mp-btn--primary" to={`/projects/${id}/publish/${d.pieceId}`}>Einreichen-Seite</Link> : null}
              <Button disabled={busy !== null} onClick={() => void run(d.slug, () => api(`/projects/${id}/directories/${d.slug}/prepare`, { method: "POST" }))}>{busy === d.slug ? "bereitet vor …" : d.pieceId ? "Neu vorbereiten" : "Vorbereiten"}</Button>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="mp-small mp-muted">Liste anpassen: <code className="mp-code">PUT /api/mp/projects/{id}/directories</code> (Standard: Product Hunt, AlternativeTo, G2, There's An AI For That, SaaSHub).</p>
    </Card>
  );
}

function GeoTab({ id, view, busy, run }: { id: string; view: StudioView; busy: string | null; run: Run }) {
  const [kind, setKind] = useState("comparison");
  const [competitor, setCompetitor] = useState(view.competitors[0] ?? "");
  const [topic, setTopic] = useState("");
  const articles = view.recent.filter((p) => p.format === "article");
  return (
    <>
      <Card className="mp-form-card">
        <form className="mp-form mp-form--row" onSubmit={(e) => { e.preventDefault(); void run("article", () => api(`/projects/${id}/content`, { method: "POST", json: { format: "article", articleKind: kind, competitor: kind === "comparison" ? competitor : undefined, topic, hint: "" } })); }}>
          <label className="mp-field mp-field--short"><span>Art</span><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="comparison">Vergleich „X vs Y“</option><option value="best_tools">„Beste Tools für …“</option><option value="faq">FAQ-Seite</option></select></label>
          {kind === "comparison" && <label className="mp-field mp-field--short"><span>Wettbewerber</span><select value={competitor} onChange={(e) => setCompetitor(e.target.value)}>{view.competitors.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>}
          <label className="mp-field"><span>Thema (für „Beste Tools“) / Fokus</span><input value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
          <div className="mp-form-actions"><Button type="submit" variant="primary" disabled={busy !== null || !view.hasBrief}>{busy === "article" ? "schreibt …" : "Artikel erzeugen"}</Button></div>
        </form>
        <p className="mp-small mp-muted">Markdown + HTML-Export mit JSON-LD (FAQPage, SoftwareApplication) für deine eigene Website.</p>
      </Card>
      <PieceList id={id} pieces={articles} />
    </>
  );
}

/**
 * Hashtag-Vorräte: einmal per Modell vorschlagen lassen, danach von Hand
 * pflegen. Wie viele Tags ein Stück bekommt, steht hier bewusst nicht —
 * das entscheidet die Plattform (Instagram 6–10, LinkedIn höchstens 2).
 */
function HashtagTab({ id, busy, run }: { id: string; busy: string | null; run: Run }) {
  const [pools, setPools] = useState<HashtagPools | null>(null);
  const load = useCallback(async () => { setPools(await api<HashtagPools>(`/projects/${id}/hashtags`)); }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!pools) return <Card><p className="mp-muted">lädt …</p></Card>;

  const asText = (list: string[]) => list.join(" ");
  const toList = (v: string) => v.split(/[\s,]+/).filter(Boolean);
  const set = (patch: Partial<HashtagPools>) => setPools({ ...pools, ...patch });
  const setTopic = (key: string, value: string) => set({ topics: { ...pools.topics, [key]: toList(value) } });

  return (
    <Card>
      <div className="mp-card-head">
        <h2>Hashtag-Vorräte</h2>
        <div className="mp-inline">
          <Button disabled={busy !== null} onClick={() => void run("tags-suggest", async () => { setPools(await api<HashtagPools>(`/projects/${id}/hashtags/suggest`, { method: "POST" })); })}>{busy === "tags-suggest" ? "schlägt vor …" : pools.suggestedAt ? "Neu vorschlagen" : "Vorschlagen lassen"}</Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => void run("tags-save", async () => { setPools(await api<HashtagPools>(`/projects/${id}/hashtags`, { method: "PUT", json: pools })); })}>Speichern</Button>
        </div>
      </div>
      <p className="mp-small mp-muted">Ohne „#“, durch Leerzeichen getrennt. Wie viele davon in einem Beitrag landen, entscheidet die Plattform: Instagram 6–10, TikTok 3–6, Facebook 0–2, LinkedIn/X höchstens 2, Pinterest keine.</p>
      <label className="mp-field"><span>Marke</span><input value={asText(pools.brand)} onChange={(e) => set({ brand: toList(e.target.value) })} placeholder="binderplan pokemonbinder" /></label>
      <div className="mp-form mp-form--row">
        <label className="mp-field"><span>Deutsch</span><input value={asText(pools.byLanguage.de)} onChange={(e) => set({ byLanguage: { ...pools.byLanguage, de: toList(e.target.value) } })} /></label>
        <label className="mp-field"><span>Englisch</span><input value={asText(pools.byLanguage.en)} onChange={(e) => set({ byLanguage: { ...pools.byLanguage, en: toList(e.target.value) } })} /></label>
      </div>
      {Object.entries(pools.topics).map(([key, list]) => (
        <label key={key} className="mp-field"><span>Thema „{key}“</span><input value={asText(list)} onChange={(e) => setTopic(key, e.target.value)} /></label>
      ))}
      <p className="mp-small mp-muted">{pools.suggestedAt ? `Vorschlag vom ${new Date(pools.suggestedAt).toLocaleDateString("de-DE")} — seitdem deine Liste.` : "Noch kein Vorschlag erzeugt."}</p>
    </Card>
  );
}

/** Ein Feld zum Abschreiben: Wert, Zeichenzahl, ein Klick zum Kopieren. */
function CopyField({ label, value, limit, hint }: { label: string; value: string; limit?: number; hint?: string }) {
  const [done, setDone] = useState(false);
  const zuLang = limit !== undefined && value.length > limit;
  return (
    <div className="mp-field">
      <span>
        {label}
        {limit !== undefined && <span className={zuLang ? "mp-bad mp-small" : "mp-muted mp-small"}> · {value.length}/{limit} Zeichen</span>}
      </span>
      <div className="mp-inline mp-inline--top">
        <p className="mp-profiltext">{value}</p>
        <Button onClick={() => { void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }); }}>
          {done ? "Kopiert ✓" : "Kopieren"}
        </Button>
      </div>
      {hint && <p className="mp-small mp-muted">{hint}</p>}
    </div>
  );
}

/**
 * Die Profiltexte des Social-Kits.
 *
 * Beim Anlegen eines Kontos fragt jede Plattform nach Name, Nutzername und Bio
 * — und zählt die Zeichen anders. Deshalb steht die Grenze an jedem Feld, und
 * jedes Feld lässt sich einzeln kopieren: man füllt ein Formular aus, man liest
 * keinen Text.
 */
function ProfileTexts({ texts }: { texts: SocialKitTexts }) {
  const [offen, setOffen] = useState<string | null>(texts.profiles[0]?.platform ?? null);
  return (
    <div className="mp-profiltexte">
      <div className="mp-form mp-form--row">
        <CopyField label="Nutzername (überall gleich)" value={texts.handle} />
        {texts.category && <CopyField label="Kategorie" value={texts.category} />}
        {texts.link && <CopyField label="Link für die Bio" value={texts.link} />}
      </div>
      <div className="mp-inline">
        {texts.profiles.map((p) => (
          <button key={p.platform} type="button" className={`mp-btn${offen === p.platform ? " mp-btn--primary" : ""}`}
            onClick={() => setOffen(offen === p.platform ? null : p.platform)}>{p.label}</button>
        ))}
      </div>
      {texts.profiles.filter((p) => p.platform === offen).map((p) => (
        <div key={p.platform} className="mp-form">
          <CopyField label={`Name auf ${p.label}`} value={p.displayName} />
          <CopyField label={`Bio auf ${p.label}`} value={p.bio} limit={p.limit} hint={p.note} />
        </div>
      ))}
      {texts.generatedAt && (
        <p className="mp-small mp-muted">
          Geschrieben am {new Date(texts.generatedAt).toLocaleDateString("de-DE")} von {texts.model}. Ändern kannst du
          alles direkt auf der Plattform — der Pilot schreibt nichts nach.
        </p>
      )}
    </div>
  );
}

/**
 * Social-Kit: Profilbilder und Banner für jeden Kanal, aus dem Brand-Kit.
 *
 * Ein neues Konto braucht als Erstes ein Bild — und jede Plattform will einen
 * anderen Zuschnitt. Der Download als ZIP ist der eigentliche Punkt: beim
 * Einrichten will man nicht sechsmal einzeln klicken.
 */
function SocialKitCard({ id, busy, run }: { id: string; busy: string | null; run: Run }) {
  const [view, setView] = useState<SocialKitView | null>(null);
  const load = useCallback(async () => {
    try { setView(await api<SocialKitView>(`/projects/${id}/socialkit`)); }
    catch { setView(null); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const items = view?.assets ?? null;
  const texts = view?.texts ?? null;
  return (
    <Card>
      <div className="mp-card-head">
        <h2>Social-Kit <span className="mp-muted mp-small">Bilder &amp; Profiltexte</span></h2>
        <div className="mp-inline">
          {items && items.length > 0 && <a className="mp-btn mp-btn--primary" href={`/api/mp/projects/${id}/socialkit.zip`}>Alle als ZIP</a>}
          {texts && texts.profiles.length > 0 && (
            <Button disabled={busy !== null} onClick={() => void run("kittexte", async () => {
              const next = await api<SocialKitTexts>(`/projects/${id}/socialkit/texts`, { method: "POST" });
              setView((cur) => (cur ? { ...cur, texts: next } : cur));
            })}>{busy === "kittexte" ? "schreibt …" : "Nur Texte neu"}</Button>
          )}
          <Button disabled={busy !== null} onClick={() => void run("kit", async () => { setView(await api<SocialKitView>(`/projects/${id}/socialkit`, { method: "POST" })); })}>
            {busy === "kit" ? "rendert …" : items && items.length ? "Neu erzeugen" : "Erzeugen"}
          </Button>
        </div>
      </div>
      <p className="mp-small mp-muted">
        Farben, Logo und Einzeiler kommen aus dem Brand-Kit und dem Brief. Ohne Logo entsteht ein Monogramm.
        Liegt ein runder Zuschnitt im Brand-Kit, tragen ihn die Profilbilder. Änderst du die Primärfarbe,
        erzeuge das Kit neu.
      </p>
      {texts && texts.profiles.length > 0 && <ProfileTexts texts={texts} />}
      {!items || items.length === 0 ? (
        <p className="mp-muted">Noch keine Bilder erzeugt.</p>
      ) : (
        <>
          <div className="mp-shots mp-shots--slides">
            {items.map((it) => (
              <figure key={it.format} className="mp-shot">
                <a href={it.url} download={it.filename} title={`${it.size} · ${it.note}`}><img src={it.url} alt={it.label} loading="lazy" /></a>
                <figcaption className="mp-small">
                  <strong>{it.label}</strong> <span className="mp-muted">{it.size}</span>
                  <div className="mp-muted">{it.usedFor}</div>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mp-small mp-muted">
            Runde Zuschnitte beschneiden mittig — deshalb steht im Profilbild nichts am Rand. Im YouTube-Banner
            liegt der Text in der Zone, die auf allen Geräten sichtbar ist (1546 × 423).
          </p>
        </>
      )}
    </Card>
  );
}
