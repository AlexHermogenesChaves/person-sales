import { useId } from "react";
import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  /** Mensagem de erro. Presente = campo inválido. */
  error?: string;
}

export function Input({
  label,
  hint,
  error,
  required,
  id,
  className,
  ...rest
}: InputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={["nh-field", error ? "nh-field--invalid" : "", className ?? ""].filter(Boolean).join(" ")}>
      <label className="nh-field__label" htmlFor={inputId}>
        {label}
        {required && <span className="nh-field__req" aria-hidden="true"> *</span>}
      </label>
      <input
        id={inputId}
        className="nh-field__control"
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <span className="nh-field__error" id={`${inputId}-err`} role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span className="nh-field__hint" id={`${inputId}-hint`}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
