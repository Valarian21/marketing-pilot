/** Small token-driven building blocks. No colours here - only classes from app.css. */
import type { ButtonHTMLAttributes, ReactNode } from "react";

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
