import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "ok" | "warn" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Ponto colorido antes do texto — para status de processo (online, em fila). */
  dot?: boolean;
  title?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot = false, title, children }: BadgeProps) {
  return (
    <span className={`nh-badge nh-badge--${tone}`} title={title}>
      {dot && <span className="nh-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
