"use client";

import {
  buildOverlaySceneMetadataWidgetContent,
  describeOverlaySceneFrameSupport,
  resolveOverlaySceneCustomTextFontStack,
  type OverlaySceneCustomLayer,
  type OverlaySceneLayerKind,
  type OverlayScenePayload
} from "@stream247/core";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

type OverlaySceneCanvasProps = {
  payload: OverlayScenePayload;
};

export function OverlaySceneCanvas(props: OverlaySceneCanvasProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const effectiveScenePreset = props.payload.scene.resolvedPresetId;
  const frameClassName = [
    "overlay-frame",
    effectiveScenePreset === "standby-board"
      ? "overlay-frame-standby"
      : effectiveScenePreset === "split-now-next"
        ? "overlay-frame-split"
        : effectiveScenePreset === "minimal-chip"
          ? "overlay-frame-minimal"
          : effectiveScenePreset === "bumper-board"
            ? "overlay-frame-bumper"
            : effectiveScenePreset === "reconnect-board"
              ? "overlay-frame-reconnect"
              : "",
    `overlay-anchor-${props.payload.scene.panelAnchor}`,
    `overlay-surface-${props.payload.scene.surfaceStyle}`,
    `overlay-title-${props.payload.scene.titleScale}`,
    `overlay-typography-${props.payload.scene.typographyPreset}`
  ]
    .filter(Boolean)
    .join(" ");

  function renderLayer(kind: OverlaySceneLayerKind) {
    if (kind === "chip") {
      return (
        <div className="overlay-chip" key={kind}>
          {props.payload.brandLine} · {props.payload.channelName} · {props.payload.heroLabel}
        </div>
      );
    }

    if (kind === "hero") {
      return (
        <div className="overlay-card overlay-card-large" key={kind}>
          <div className="label">{props.payload.heroLabel}</div>
          <h1>{props.payload.heroTitle || "Stream247"}</h1>
          <p>{props.payload.heroBody}</p>
          {props.payload.metaLine ? <div className="subtle">{props.payload.metaLine}</div> : null}
        </div>
      );
    }

    if (kind === "next") {
      return (
        <div className="overlay-card" key={kind}>
          <div className="label">{props.payload.nextLabel}</div>
          <strong>{props.payload.nextTitle || "Schedule not available"}</strong>
          <div className="subtle">{props.payload.nextTimeLabel || "No next block configured"}</div>
        </div>
      );
    }

    if (kind === "queue") {
      return (
        <div className="overlay-card" key={kind}>
          <div className="label">Later</div>
          <strong>
            {props.payload.queueTitles.length > 0
              ? props.payload.queueTitles.join(" → ")
              : "Queue preview will appear here once playout confirms it."}
          </strong>
        </div>
      );
    }

    if (kind === "schedule") {
      return (
        <div className="overlay-card" key={kind}>
          <div className="label">{props.payload.scheduleLabel}</div>
          <strong>{props.payload.scheduleTitle || "Stand by"}</strong>
          <div className="subtle">{props.payload.scheduleBody}</div>
          {props.payload.scheduleAux ? <div className="subtle">{props.payload.scheduleAux}</div> : null}
        </div>
      );
    }

    if (kind === "clock") {
      return (
        <div className="overlay-clock" key={kind}>
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: props.payload.timeZone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
          }).format(now)}{" "}
          {props.payload.timeZone}
        </div>
      );
    }

    if (kind === "banner") {
      return <div className="overlay-banner" key={kind}>{props.payload.emergencyBanner}</div>;
    }

    if (kind === "ticker") {
      return <div className="overlay-ticker" key={kind}>{props.payload.tickerText}</div>;
    }

    return null;
  }

  function renderCustomLayer(layer: OverlaySceneCustomLayer) {
    if (!layer.enabled) {
      return null;
    }

    const style = {
      left: `${layer.xPercent}%`,
      top: `${layer.yPercent}%`,
      width: `${layer.widthPercent}%`,
      height: `${layer.heightPercent}%`,
      opacity: layer.opacityPercent / 100
    } satisfies CSSProperties;

    if (layer.kind === "text") {
      const fontFamily = resolveOverlaySceneCustomTextFontStack({
        fontMode: layer.fontMode,
        customFontFamily: layer.customFontFamily,
        typographyPreset: props.payload.scene.typographyPreset
      });
      return (
        <div
          className={`overlay-custom-layer overlay-custom-layer-text overlay-custom-layer-text-${layer.textTone} overlay-custom-layer-align-${layer.textAlign}${
            layer.useAccent ? " overlay-custom-layer-accent" : ""
          }`}
          key={layer.id}
          style={
            {
              ...style,
              ...(fontFamily ? { fontFamily } : {})
            } satisfies CSSProperties
          }
        >
          <div className="overlay-custom-layer-text-primary">{layer.text || layer.name}</div>
          {layer.secondaryText ? <div className="overlay-custom-layer-text-secondary">{layer.secondaryText}</div> : null}
        </div>
      );
    }

    if (layer.kind === "logo" || layer.kind === "image") {
      return (
        <div className="overlay-custom-layer overlay-custom-layer-media" key={layer.id} style={style}>
          {layer.url ? (
            // The published overlay must accept already-resolved local or remote asset URLs at runtime.
            // `next/image` is not a good fit for arbitrary operator-managed scene assets here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={layer.altText || layer.name}
              className={`overlay-custom-layer-image overlay-custom-layer-image-${layer.fit}`}
              src={layer.url}
            />
          ) : (
            <div className="overlay-custom-layer-placeholder">
              <strong>{layer.name}</strong>
              <span>{layer.kind === "logo" ? "Logo URL required" : "Image URL required"}</span>
            </div>
          )}
        </div>
      );
    }

    if (layer.kind === "widget" && layer.widgetMode === "metadata") {
      const widget = buildOverlaySceneMetadataWidgetContent({
        payload: props.payload,
        widgetDataKey: layer.widgetDataKey,
        labelOverride: layer.title
      });

      return (
        <div className="overlay-custom-layer overlay-custom-layer-widget-data" key={layer.id} style={style}>
          <div className="overlay-custom-layer-embed-badge">Scene Widget</div>
          <div className="overlay-custom-layer-widget-label">{widget.label}</div>
          <div className="overlay-custom-layer-widget-title">{widget.title}</div>
          <div className="overlay-custom-layer-widget-body">{widget.body}</div>
          {widget.secondary ? <div className="overlay-custom-layer-widget-secondary">{widget.secondary}</div> : null}
        </div>
      );
    }

    if (layer.kind === "embed" || layer.kind === "widget") {
      const support = describeOverlaySceneFrameSupport(layer.url);
      return (
        <div className="overlay-custom-layer overlay-custom-layer-embed" key={layer.id} style={style}>
          <div className="overlay-custom-layer-embed-badge">{layer.kind === "widget" ? "Widget" : "Embed"}</div>
          <div className={`overlay-custom-layer-support-badge overlay-custom-layer-support-${support.status}`}>{support.badgeLabel}</div>
          {layer.url ? (
            support.status === "unsupported" ? (
              <div className="overlay-custom-layer-placeholder">
                <strong>{support.providerLabel}</strong>
                <span>{support.guidance}</span>
              </div>
            ) : (
            <iframe
              className="overlay-custom-layer-iframe"
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-same-origin allow-scripts"
              src={layer.url}
              title={layer.title}
            />
            )
          ) : (
            <div className="overlay-custom-layer-placeholder">
              <strong>{layer.name}</strong>
              <span>Embed URL required</span>
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  return (
    <section
      className={frameClassName}
      style={
        {
          "--overlay-accent": props.payload.accentColor
        } as CSSProperties
      }
    >
      {props.payload.scene.layers.filter((layer) => layer.enabled).map((layer) => renderLayer(layer.kind))}
      {props.payload.scene.customLayers.map(renderCustomLayer)}
    </section>
  );
}
