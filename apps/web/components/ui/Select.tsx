import type { SelectHTMLAttributes } from "react";

export type SelectProps = {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  fullWidth?: boolean;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children">;

export function Select({
  label,
  hint,
  error,
  value,
  onChange,
  options,
  fullWidth = true,
  className = "",
  id,
  ...selectProps
}: SelectProps) {
  const fieldId = id || label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const describedBy = [`${fieldId}-hint`, `${fieldId}-error`].filter((entry) => (entry.endsWith("-hint") ? hint : error)).join(" ") || undefined;

  return (
    <label className={["field-stack", fullWidth ? "field-stack-full" : "", className].filter(Boolean).join(" ")} htmlFor={fieldId}>
      <span className="label">{label}</span>
      <select
        {...selectProps}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        id={fieldId}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <span className="field-meta">
          <span className="field-hint" id={`${fieldId}-hint`}>
            {hint}
          </span>
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
