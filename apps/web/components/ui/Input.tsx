import type { InputHTMLAttributes } from "react";

export type InputProps = {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  showCharCount?: boolean;
  fullWidth?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

export function Input({
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
  showCharCount = false,
  fullWidth = true,
  className = "",
  id,
  ...inputProps
}: InputProps) {
  const fieldId = id || label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const describedBy = [`${fieldId}-hint`, `${fieldId}-error`].filter((entry) => (entry.endsWith("-hint") ? hint : error)).join(" ") || undefined;

  return (
    <label className={["field-stack", fullWidth ? "field-stack-full" : "", className].filter(Boolean).join(" ")} htmlFor={fieldId}>
      <span className="label">{label}</span>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        id={fieldId}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      {hint || (showCharCount && maxLength) || error ? (
        <span className="field-meta">
          <span className="field-hint" id={`${fieldId}-hint`}>
            {hint || ""}
          </span>
          {showCharCount && maxLength ? <span className="field-count">{value.length}/{maxLength}</span> : null}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={`${fieldId}-error`}>
          {error}
        </span>
      ) : null}
    </label>
  );
}
