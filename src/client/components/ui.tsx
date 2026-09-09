/** Small token-driven building blocks. No colours here - only classes from app.css. */
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/** "26.08.2026, 19:42" */
export const fmtDateTime = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–");

export function PageHeader({ label, title, actions }: { label?: ReactNode; title: string; actions?: ReactNode }) {
  return (
    <header className="mp-page-header">
      <div>
        {label && <div className="mp-label">{label}</div>}
        <h1 className="mp-h1">{title}</h1>
      </div>
      {actions && <div className="mp-page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = "", highlight = false }: { children: ReactNode; className?: string; highlight?: boolean }) {
  return <section className={`mp-card${highlight ? " mp-card--hi" : ""} ${className}`}>{children}</section>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };
export function Button({ variant = "secondary", className = "", ...rest }: ButtonProps) {
  return <button className={`mp-btn mp-btn--${variant} ${className}`} {...rest} />;
}

export type PillKind = "done" | "review" | "todo" | "progress" | "kind";
export function Pill({ kind, children }: { kind: PillKind; children: ReactNode }) {
  return <span className={`mp-pill mp-pill--${kind}`}>{children}</span>;
}

export function EmptyState({ title, text, shot }: { title: string; text?: string; shot?: number }) {
  return (
    <Card className="mp-empty">
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {shot !== undefined && <div className="mp-label">Geplant für Shot {shot}</div>}
    </Card>
  );
}

export function Notice({ kind, children }: { kind: "warn" | "bad" | "info"; children: ReactNode }) {
  return <div className={`mp-notice mp-notice--${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;
}

export function Stat({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`mp-stat${highlight ? " mp-stat--hi" : ""}`}>
      <div className="mp-label">{label}</div>
      <div className="mp-num mp-stat-value">{value}</div>
    </div>
  );
}

/**
 * Blättern statt alles auf einmal.
 *
 * Die Medien-Galerie war auf dem Handy 99.407 px lang (200 Einträge), das
 * Speicher-Protokoll 25.039 px mit 423 Knöpfen. Wer 200 Zeilen zeigt, zeigt
 * nichts: niemand scrollt hundert Bildschirme. Eine Seite ist so groß, dass
 * man sie überblickt, und der Rest ist einen Klick entfernt.
 */
export function useSeiten<T>(alle: readonly T[], proSeite = 25): { aktuell: T[]; seite: number; seiten: number; setSeite: (n: number) => void; von: number; bis: number; gesamt: number } {
  const [seite, setSeite] = useState(0);
  const seiten = Math.max(1, Math.ceil(alle.length / proSeite));
  // Schrumpft die Liste (Filter), darf die Seitenzahl nicht ins Leere zeigen.
  const sicher = Math.min(seite, seiten - 1);
  useEffect(() => { if (sicher !== seite) setSeite(sicher); }, [sicher, seite]);
  return {
    aktuell: alle.slice(sicher * proSeite, (sicher + 1) * proSeite) as T[],
    seite: sicher, seiten, setSeite,
    von: alle.length === 0 ? 0 : sicher * proSeite + 1,
    bis: Math.min(alle.length, (sicher + 1) * proSeite),
    gesamt: alle.length,
  };
}

export function Blaettern({ von, bis, gesamt, seite, seiten, setSeite, einheit = "Einträge" }: { von: number; bis: number; gesamt: number; seite: number; seiten: number; setSeite: (n: number) => void; einheit?: string }) {
  if (gesamt === 0) return null;
  return (
    <div className="mp-blaettern">
      <span className="mp-small mp-muted"><span className="mp-num-cell">{von}–{bis}</span> von <span className="mp-num-cell">{gesamt}</span> {einheit}</span>
      {seiten > 1 && (
        <div className="mp-inline">
          <Button disabled={seite === 0} onClick={() => setSeite(seite - 1)} aria-label="Vorherige Seite">←</Button>
          <span className="mp-small mp-muted">Seite {seite + 1} / {seiten}</span>
          <Button disabled={seite >= seiten - 1} onClick={() => setSeite(seite + 1)} aria-label="Nächste Seite">→</Button>
        </div>
      )}
    </div>
  );
}
