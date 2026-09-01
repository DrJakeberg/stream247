"use client";

import { useEffect, useRef, useState } from "react";
import type { OverlayScenePayloadView } from "@stream247/core";

/**
 * The scene as the broadcast renderer draws it.
 *
 * Inlined into the page rather than pointed at with an <img>. Inside an <img> an SVG is an isolated
 * document with no access to the page's fonts, so the server would have to embed the glyph outlines
 * in every frame — several times the size of everything else in the picture, resent on every
 * keystroke. Inline, the frame reaches the page's @font-face rules, which load the same file the
 * renderer read.
 *
 * The markup is server-rendered SVG from our own renderer, not operator input: satori escapes the
 * text it lays out, and the route hands back nothing else.
 */
export function OverlayRenderPreview(props: { payload: OverlayScenePayloadView }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  // Serialised so a slow render cannot overwrite a newer one that already came back.
  const requestSeq = useRef(0);
  const signature = JSON.stringify(props.payload);

  useEffect(() => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const controller = new AbortController();
    setPending(true);

    // The editor changes on every keystroke; the renderer is shared with the channel encoder. A
    // short settle beat turns a typed sentence into one render instead of thirty.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/scenes/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: JSON.parse(signature) as OverlayScenePayloadView }),
          signal: controller.signal
        });

        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(detail.message || `The renderer answered ${response.status}.`);
        }

        const markup = await response.text();
        if (requestSeq.current !== seq) {
          return;
        }

        setSvg(markup);
        setError("");
      } catch (cause) {
        if (controller.signal.aborted || requestSeq.current !== seq) {
          return;
        }

        setError(cause instanceof Error ? cause.message : "The renderer did not answer.");
      } finally {
        if (requestSeq.current === seq) {
          setPending(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [signature]);

  if (error) {
    return (
      <div className="scene-render-preview scene-render-preview-empty">
        <p className="subtle">The on-air renderer could not draw this scene: {error}</p>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="scene-render-preview scene-render-preview-empty">
        <p className="subtle">Drawing this scene with the on-air renderer…</p>
      </div>
    );
  }

  return (
    <div
      aria-label="Scene as the on-air renderer draws it"
      className="scene-render-preview"
      data-pending={pending ? "true" : "false"}
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
    />
  );
}
