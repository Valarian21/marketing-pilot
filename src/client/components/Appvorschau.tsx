/**
 * „So sieht es in der App aus" — der Beitrag im Format der Plattform.
 *
 * Bis zum 14.09.2026 stand in der Pipeline neben einem fertigen Reel nur
 * „⬇ Video", neben einem Carousel „⬇ Bild 1 ⬇ Bild 2 ⬇ Bild 3". Wer wissen
 * wollte, was da gleich rausgeht, musste jede Datei einzeln herunterladen.
 * Hier läuft das Reel im Hochformat, das Carousel lässt sich durchblättern wie
 * im Feed, und der Text steht darunter mit dem Schnitt, an dem die App „mehr"
 * setzt.
 *
 * Bewusst **kein** Nachbau der Oberfläche: kein Herz, kein Kommentarfeld, kein
 * fremdes Logo. Was zählt, ist Bildausschnitt, Reihenfolge und die Frage, wie
 * viel Text ohne Antippen zu lesen ist — der Rest wäre Dekoration, die altert,
 * sobald eine App ihr Layout ändert.
 */
import { useCallback, useEffect, useState } from "react";
import type { PublishPackage } from "../../shared/schemas.js";
import { PLATTFORM_ALIAS, plattformName, sichtbareZeichen } from "../../shared/channels.js";
import { formatName } from "../../shared/labels.js";

type Asset = PublishPackage["assets"][number];

/** Vorschaubilder gehören nicht in die Bühne — sie sind das Standbild des Videos. */
const istThumb = (a: Asset) => /-thumb\.(png|jpe?g)$/i.test(a.filename);
const istVideo = (a: Asset) => a.kind === "video" || /\.mp4$/i.test(a.filename);
/** Der Landscape-Schnitt ist für YouTube-Langvideo, nicht für den Feed. */
const istQuer = (a: Asset) => /^landscape/i.test(a.filename);

/**
 * Die Slides, die wirklich rausgehen.
 *
 * Ein Carousel-Stück trägt oft **zwei** Größen desselben Beitrags (1080×1080
 * und 1080×1350) — nebeneinander gezeigt sähe es nach doppelt so vielen Slides
 * aus. Gewählt wird die Gruppe mit den meisten Slides, bei Gleichstand die
 * höhere: im Instagram-Feed nimmt 4:5 mehr Platz ein als 1:1, und genau darum
 * gibt es beide Zuschnitte.
 */
function slidesVon(assets: Asset[]): Asset[] {
  const bilder = assets.filter((a) => !istVideo(a) && !istThumb(a) && a.kind !== "recording");
  if (bilder.length < 2) return bilder;
  const gruppen = new Map<string, Asset[]>();
  for (const a of bilder) {
    const k = a.width && a.height ? `${a.width}x${a.height}` : "?";
    gruppen.set(k, [...(gruppen.get(k) ?? []), a]);
  }
  if (gruppen.size < 2) return bilder;
  return [...gruppen.values()].sort((x, y) =>
    y.length - x.length
    || (y[0]!.height ?? 0) / (y[0]!.width || 1) - (x[0]!.height ?? 0) / (x[0]!.width || 1))[0]!;
}

export function Appvorschau({ paket, automatisch }: { paket: PublishPackage; automatisch: boolean }) {
  const platform = paket.platform || paket.piece.channel;
  const app = PLATTFORM_ALIAS[platform] ?? platform;
  const videos = paket.assets.filter((a) => istVideo(a) && !istQuer(a));
  const slides = videos.length ? [] : slidesVon(paket.assets);
  const thumb = paket.assets.find(istThumb)?.url;
  const [i, setI] = useState(0);
  const [gross, setGross] = useState(false);
  const [ganzerText, setGanzerText] = useState(false);
  useEffect(() => { setI(0); setGross(false); setGanzerText(false); }, [paket.piece.id]);

  const blaettern = useCallback((d: number) => setI((c) => (c + d + slides.length) % Math.max(1, slides.length)), [slides.length]);
  useEffect(() => {
    if (!gross) return;
    const taste = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGross(false);
      if (e.key === "ArrowRight") blaettern(1);
      if (e.key === "ArrowLeft") blaettern(-1);
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [gross, blaettern]);

  /**
   * Gezeigt wird, was wirklich im Feed steht.
   *
   * Der Pilot sendet den Textkörper des Stücks (`runScheduledPost`), das
   * Publish-Paket hängt für Handkanäle zusätzlich den Kurzlink an — das ist
   * der Text zum Kopieren, nicht der Beitrag. Beides zu verwechseln hieße,
   * unter einem Threads-Beitrag eine Adresse zu zeigen, die dort nie steht.
   */
  const text = automatisch ? paket.piece.body : paket.text;
  const sicht = sichtbareZeichen(platform);
  const gekuerzt = !ganzerText && text.length > sicht + 30;
  // Nicht mitten im Wort abschneiden — die App tut das auch nicht.
  const anriss = gekuerzt ? `${text.slice(0, text.lastIndexOf(" ", sicht) > sicht - 20 ? text.lastIndexOf(" ", sicht) : sicht).trimEnd()}…` : text;
  const aktuell = slides[i];
  const seite = aktuell?.width && aktuell.height ? `${aktuell.width} / ${aktuell.height}` : "4 / 5";

  return (
    <div className="mp-app">
      <div className="mp-app-kopf">
        <span className="mp-app-avatar" aria-hidden="true" />
        <div className="mp-app-wer">
          <strong>binderplan.app</strong>
          <span className="mp-small mp-muted">{plattformName(app)} · {formatName(paket.piece.format)}</span>
        </div>
      </div>

      {videos.length > 0 && (
        <div className="mp-app-buehne mp-app-buehne--hoch">
          {/* Hochformat 9:16 — so groß, wie die Lade hergibt, mit Standbild statt schwarzer Fläche. */}
          <video key={videos[0]!.id} controls playsInline preload={thumb ? "none" : "metadata"}
                 poster={thumb} src={thumb ? videos[0]!.url : `${videos[0]!.url}#t=1`} />
        </div>
      )}

      {slides.length > 0 && (
        <div className="mp-app-buehne" style={{ aspectRatio: seite }}>
          <button type="button" className="mp-app-bild" onClick={() => setGross(true)} title="Groß ansehen">
            <img src={aktuell!.url} alt={`Slide ${i + 1}`} />
          </button>
          {slides.length > 1 && (
            <>
              <button type="button" className="mp-app-pfeil mp-app-pfeil--links" aria-label="Zurück" onClick={() => blaettern(-1)}>‹</button>
              <button type="button" className="mp-app-pfeil mp-app-pfeil--rechts" aria-label="Weiter" onClick={() => blaettern(1)}>›</button>
              <span className="mp-app-zaehler">{i + 1}/{slides.length}</span>
            </>
          )}
        </div>
      )}

      {slides.length > 1 && (
        <div className="mp-app-punkte" role="tablist" aria-label="Slides">
          {slides.map((s, n) => (
            <button key={s.id} type="button" role="tab" aria-selected={n === i} aria-label={`Slide ${n + 1}`}
                    className={n === i ? "is-hier" : ""} onClick={() => setI(n)} />
          ))}
        </div>
      )}

      <div className="mp-app-text">
        <p><strong>binderplan.app</strong> {anriss}</p>
        {gekuerzt && <button type="button" className="mp-linkbtn mp-small" onClick={() => setGanzerText(true)}>… mehr</button>}
        <p className="mp-small mp-muted">
          {[
            videos.length === 0 && slides.length === 0 ? "Beitrag ohne Bild" : null,
            text.length > sicht ? `ohne Antippen sind rund ${sicht} von ${text.length} Zeichen zu sehen` : `${text.length} Zeichen, alles sofort sichtbar`,
            paket.appOnly ? "ein Link im Text wäre hier nicht klickbar" : null,
          ].filter(Boolean).join(" · ")}.
        </p>
      </div>

      {gross && aktuell && (
        <div className="mp-lightbox" role="dialog" aria-modal="true" onClick={() => setGross(false)}>
          {slides.length > 1 && <button type="button" className="mp-lightbox-nav mp-lightbox-prev" aria-label="Zurück" onClick={(e) => { e.stopPropagation(); blaettern(-1); }}>‹</button>}
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={aktuell.url} alt={`Slide ${i + 1}`} />
            <figcaption>{aktuell.width && aktuell.height ? `${aktuell.width} × ${aktuell.height}` : aktuell.filename} <span className="mp-muted">{i + 1} / {slides.length}</span></figcaption>
          </figure>
          {slides.length > 1 && <button type="button" className="mp-lightbox-nav mp-lightbox-next" aria-label="Weiter" onClick={(e) => { e.stopPropagation(); blaettern(1); }}>›</button>}
          <button type="button" className="mp-lightbox-close" aria-label="Schließen" onClick={() => setGross(false)}>×</button>
        </div>
      )}
    </div>
  );
}
