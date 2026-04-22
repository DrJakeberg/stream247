import type { TextareaHTMLAttributes } from "react";

export type TextareaProps = {
  label: string;
  hint?: string;
  error?: string;
  maxLength?: number;
  showCharCount?: boolean;
  fullWidth?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "defaultValue" | "onChange" | "value">;

export function Textarea({
  label,
  hint,
  error,
  maxLength,
  showCharCount = false,
  fullWidth = true,
  className = "",
  id,
  value,
  defaultValue,
  onChange,
  ...textareaProps
}: TextareaProps) {
  const fieldId = id || label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const describedBy = [`${fieldId}-hint`, `${fieldId}-error`].filter((entry) => (entry.endsWith("-hint") ? hint : error)).join(" ") || undefined;
  const currentLength = typeof value === "string" ? value.length : typeof defaultValue === "string" ? defaultValue.length : 0;

  return (
    <label className={["field-stack", fullWidth ? "field-stack-full" : "", className].filter(Boolean).join(" ")} htmlFor={fieldId}>
      <span className="label">{label}</span>
      <textarea
        {...textareaProps}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className="textarea"
        defaultValue={defaultValue}
        id={fieldId}
        maxLength={maxLength}
        onChange={(event) => onChange?.(event.target.value)}
        value={value}
      />
      {hint || (showCharCount && maxLength) || error ? (
        <span className="field-meta">
          <span className="field-hint" id={`${fieldId}-hint`}>
            {hint || ""}
          </span>
          {showCharCount && maxLength ? <span className="field-count">{currentLength}/{maxLength}</span> : null}
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
