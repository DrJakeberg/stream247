"use client";

import { useId } from "react";

/**
 * A small (i) beside a label that explains the field, panel or page it sits next to.
 *
 * Hover or focus reveals the text; it is also wired through aria-describedby so a screen reader
 * announces it with the control. Pure CSS for the reveal — no portal, no positioning library —
 * because the bubble is short prose, not a menu, and the admin surfaces are desktop-first with
 * enough room around a label for it to open in place.
 *
 * The button is a real <button> and not a <span> with a title: `title` tooltips do not open on
 * keyboard focus or on touch, and they cannot be styled. Type is "button" so a tip inside a form
 * never submits it.
 */
export function InfoTip(props: { text: string; label?: string }) {
  const id = useId();
  const text = props.text.trim();
  if (!text) {
    return null;
  }

  return (
    <span className="info-tip">
      <button aria-describedby={id} aria-label={props.label ?? "What this means"} className="info-tip-button" type="button">
        i
      </button>
      <span className="info-tip-bubble" id={id} role="tooltip">
        {text}
      </span>
    </span>
  );
}
