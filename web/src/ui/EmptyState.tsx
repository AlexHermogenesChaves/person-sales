import type { ReactNode } from "react";

export interface EmptyStateProps {
  variant?: "empty" | "error";
  /** Frase do domínio, não "no data found". */
  title: string;
  description?: ReactNode;
  /** A saída: o que a pessoa faz agora. */
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({
  variant = "empty",
  title,
  description,
  action,
  icon,
}: EmptyStateProps) {
  return (
    <div className={variant === "error" ? "nh-state nh-state--error" : "nh-state"} role={variant === "error" ? "alert" : undefined}>
      <span className="nh-state__icon" aria-hidden="true">
        {icon ?? (variant === "error" ? <IconAlert /> : <IconInbox />)}
      </span>
      <span className="nh-state__title">{title}</span>
      {description && <span className="nh-state__desc">{description}</span>}
      {action && <div className="nh-state__actions">{action}</div>}
    </div>
  );
}

export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
}

export function Skeleton({ width = "100%", height = "12px", radius }: SkeletonProps) {
  return <span className="nh-skeleton" style={{ display: "block", width, height, borderRadius: radius }} />;
}

/** Placeholder de lista/tabela carregando: mantém a altura, não pisca layout. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="nh-skeleton-rows" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height="14px" width={i % 3 === 0 ? "72%" : "100%"} />
      ))}
    </div>
  );
}

/* Ícones inline: 2 SVGs de 16px em vez de uma dependência de ícones. */

function IconInbox() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 17h.01" />
    </svg>
  );
}
