import type { ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  /** Uma linha, no vocabulário da operação — não "gerencie seus dados". */
  description?: ReactNode;
  /** Ações do cabeçalho (filtro, exportar, atualizar). */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Sem padding no corpo — use quando o filho é tabela ou lista. */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Card({
  title,
  description,
  actions,
  footer,
  flush = false,
  className,
  children,
}: CardProps) {
  const hasHead = Boolean(title || description || actions);

  return (
    <section className={["nh-card", className ?? ""].filter(Boolean).join(" ")}>
      {hasHead && (
        <header className="nh-card__head">
          <div>
            {title && <h2 className="nh-card__title">{title}</h2>}
            {description && <p className="nh-card__desc">{description}</p>}
          </div>
          {actions && <div className="nh-acoes">{actions}</div>}
        </header>
      )}
      <div className={flush ? "nh-card__body nh-card__body--flush" : "nh-card__body"}>{children}</div>
      {footer && <footer className="nh-card__foot">{footer}</footer>}
    </section>
  );
}
