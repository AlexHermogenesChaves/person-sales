import { useId } from "react";
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* Peças de formulário do kit. Mesma anatomia do Input: rótulo em cima, dica
   embaixo, erro no lugar da dica. */

interface Base {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
}

function Wrap({
  label,
  hint,
  error,
  required,
  id,
  className,
  children,
}: Base & { required?: boolean; id: string; children: ReactNode }) {
  return (
    <div className={["nh-field", error ? "nh-field--invalid" : "", className ?? ""].filter(Boolean).join(" ")}>
      <label className="nh-field__label" htmlFor={id}>
        {label}
        {required && <span className="nh-field__req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <span className="nh-field__error" role="alert">{error}</span>
      ) : (
        hint && <span className="nh-field__hint">{hint}</span>
      )}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, Base {
  options: { value: string; label: string }[];
}

export function Select({ label, hint, error, options, className, id, ...rest }: SelectProps) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <Wrap label={label} hint={hint} error={error} id={selectId} className={className} required={rest.required}>
      <select id={selectId} className="nh-field__control" {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrap>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, Base {}

export function Textarea({ label, hint, error, className, id, rows = 4, ...rest }: TextareaProps) {
  const generated = useId();
  const areaId = id ?? generated;
  return (
    <Wrap label={label} hint={hint} error={error} id={areaId} className={className} required={rest.required}>
      <textarea id={areaId} className="nh-field__control nh-field__control--area" rows={rows} {...rest} />
    </Wrap>
  );
}

export interface SwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, hint, checked, onChange, disabled }: SwitchProps) {
  return (
    <label className={`nh-switch${disabled ? " nh-switch--off" : ""}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="nh-switch__track" aria-hidden="true">
        <span className="nh-switch__thumb" />
      </span>
      <span className="nh-switch__texto">
        <span className="nh-switch__label">{label}</span>
        {hint && <span className="nh-field__hint">{hint}</span>}
      </span>
    </label>
  );
}

export interface ProgressProps {
  /** 0 a 100. Acima de 100 a barra satura e muda de cor: estourou a quota. */
  value: number;
  label?: string;
  right?: ReactNode;
  tone?: "brand" | "ok" | "warn" | "danger";
}

export function Progress({ value, label, right, tone }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  const cor = tone ?? (value >= 100 ? "danger" : value >= 80 ? "warn" : "brand");
  return (
    <div className="nh-progress">
      {(label || right) && (
        <div className="nh-progress__head">
          <span>{label}</span>
          <span className="nh-num">{right}</span>
        </div>
      )}
      <div className={`nh-progress__track nh-progress__track--${cor}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface BarChartProps {
  /** Série curta: 14 a 30 pontos. Acima disso, é tabela, não gráfico. */
  data: { label: string; value: number }[];
  height?: number;
  format?: (v: number) => string;
}

/**
 * Gráfico de barras em SVG puro — 40 linhas contra ~100 KB de biblioteca.
 * Enquanto for série simples sem interação, é aqui que ela fica.
 */
export function BarChart({ data, height = 120, format = (v) => String(v) }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 3;
  const w = 100 / data.length;

  return (
    <div className="nh-chart">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" height={height} role="img" aria-label="Série diária">
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 16);
          return (
            <rect
              key={d.label}
              x={i * w + gap / 2}
              y={height - h}
              width={w - gap}
              height={h}
              rx="1.5"
              className={i === data.length - 1 ? "nh-chart__bar nh-chart__bar--hoje" : "nh-chart__bar"}
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="nh-chart__eixo">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
