"use client";

import { useState, type KeyboardEvent } from "react";
import { normalizeHashtagChip } from "@/lib/asset-metadata";

export function HashtagChipInput(props: {
  label: string;
  hint?: string;
  error?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  maxTags?: number;
}) {
  const [draft, setDraft] = useState("");
  const maxTags = props.maxTags ?? 12;
  const hasReachedLimit = props.values.length >= maxTags;

  function commit(rawValue: string) {
    const tag = normalizeHashtagChip(rawValue);
    if (!tag || props.values.includes(tag) || props.values.length >= maxTags) {
      setDraft("");
      return;
    }

    props.onChange([...props.values, tag]);
    setDraft("");
  }

  function remove(tag: string) {
    props.onChange(props.values.filter((entry) => entry !== tag));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }

    if (event.key === "Backspace" && !draft && props.values.length > 0) {
      event.preventDefault();
      remove(props.values[props.values.length - 1] || "");
    }
  }

  return (
    <label className="field-stack field-stack-full">
      <span className="label">{props.label}</span>
      <div className={`chip-input${props.error ? " chip-input-error" : ""}`}>
        <div className="chip-input-list">
          {props.values.map((tag) => (
            <button className="hashtag-chip" key={tag} onClick={() => remove(tag)} type="button">
              <span>#{tag}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <input
            className="chip-input-field"
            disabled={hasReachedLimit}
            onBlur={() => {
              if (draft) {
                commit(draft);
              }
            }}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasReachedLimit ? "Tag limit reached" : props.placeholder || "Type a hashtag and press Enter"}
            value={draft}
          />
        </div>
      </div>
      {props.hint || props.error ? (
        <span className="field-meta">
          <span className="field-hint">{props.hint || ""}</span>
        </span>
      ) : null}
      {props.error ? <span className="field-error">{props.error}</span> : null}
    </label>
  );
}
