/**
 * Slide-Galerie mit Vollbild.
 *
 * Die alte Darstellung schnitt jedes Bild auf 16:10 zurecht — bei einem
 * 1080×1350-Carousel sah man damit nur den oberen Streifen und konnte den
 * Preis, um den es geht, gar nicht lesen. Hier bleibt das Seitenverhältnis
 * erhalten, und ein Klick zeigt die Slide in voller Größe.
 */
import { useCallback, useEffect, useState } from "react";

export interface Shot { id: string; url: string; label?: string }

export function ShotGallery({ shots, caption }: { shots: Shot[]; caption?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const step = useCallback((d: number) => setOpen((cur) => (cur === null ? cur : (cur + d + shots.length) % shots.length)), [shots.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (!shots.length) return null;
  return (
    <>
      <div className="mp-shots mp-shots--slides">
        {shots.map((s, i) => (
          <figure key={s.id} className="mp-shot">
            <button type="button" className="mp-shot-btn" onClick={() => setOpen(i)} title="Groß ansehen">
              <img src={s.url} alt={s.label ?? ""} loading="lazy" />
            </button>
            {s.label && <figcaption className="mp-small mp-muted">{s.label}</figcaption>}
          </figure>
        ))}
      </div>
      {caption && <p className="mp-small mp-muted">{caption}</p>}
      {open !== null && shots[open] && (
        <div className="mp-lightbox" role="dialog" aria-modal="true" onClick={close}>
          <button type="button" className="mp-lightbox-nav mp-lightbox-prev" aria-label="Zurück" onClick={(e) => { e.stopPropagation(); step(-1); }}>‹</button>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={shots[open].url} alt={shots[open].label ?? ""} />
            <figcaption>
              {shots[open].label ?? ""} <span className="mp-muted">{open + 1} / {shots.length}</span>
              {" · "}<a href={shots[open].url} target="_blank" rel="noreferrer">Datei öffnen</a>
            </figcaption>
          </figure>
          <button type="button" className="mp-lightbox-nav mp-lightbox-next" aria-label="Weiter" onClick={(e) => { e.stopPropagation(); step(1); }}>›</button>
          <button type="button" className="mp-lightbox-close" aria-label="Schließen" onClick={close}>×</button>
        </div>
      )}
    </>
  );
}
