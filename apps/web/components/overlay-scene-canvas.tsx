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

function visibleOverlayText(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  return trimmed && trimmed !== "[]" ? trimmed : "";
}

function joinVisibleOverlayText(values: unknown[], separator: string): string {
  return values.map((value) => visibleOverlayText(value)).filter(Boolean).join(separator);
}

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
      const chipText = joinVisibleOverlayText([props.payload.brandLine, props.payload.channelName, props.payload.heroLabel], " · ");
      return chipText ? <div className="overlay-chip" key={kind}>{chipText}</div> : null;
    }

    if (kind === "hero") {
      const heroLabel = visibleOverlayText(props.payload.heroLabel);
      const heroTitle = visibleOverlayText(props.payload.heroTitle) || "Stream247";
      const heroBody = visibleOverlayText(props.payload.heroBody);
      const metaLine = visibleOverlayText(props.payload.metaLine);
      return (
        <div className="overlay-card overlay-card-large" key={kind}>
          {heroLabel ? <div className="label">{heroLabel}</div> : null}
          <h1>{heroTitle}</h1>
          {heroBody ? <p>{heroBody}</p> : null}
          {metaLine ? <div className="subtle">{metaLine}</div> : null}
        </div>
      );
    }

    if (kind === "next") {
      const nextLabel = visibleOverlayText(props.payload.nextLabel);
      const nextTitle = visibleOverlayText(props.payload.nextTitle) || "Schedule not available";
      const nextTimeLabel = visibleOverlayText(props.payload.nextTimeLabel);
      return (
        <div className="overlay-card" key={kind}>
          {nextLabel ? <div className="label">{nextLabel}</div> : null}
          <strong>{nextTitle}</strong>
          {nextTimeLabel ? <div className="subtle">{nextTimeLabel}</div> : null}
        </div>
      );
    }

    if (kind === "queue") {
      const queueTitles = props.payload.queueTitles.map((title) => visibleOverlayText(title)).filter(Boolean);
      return (
        <div className="overlay-card" key={kind}>
          <div className="label">Later</div>
          <strong>
            {queueTitles.length > 0
              ? queueTitles.join(" → ")
              : "Queue preview will appear here once playout confirms it."}
          </strong>
        </div>
      );
    }

    if (kind === "schedule") {
      const scheduleLabel = visibleOverlayText(props.payload.scheduleLabel);
      const scheduleTitle = visibleOverlayText(props.payload.scheduleTitle) || "Stand by";
      const scheduleBody = visibleOverlayText(props.payload.scheduleBody);
      const scheduleAux = visibleOverlayText(props.payload.scheduleAux);
      return (
        <div className="overlay-card" key={kind}>
          {scheduleLabel ? <div className="label">{scheduleLabel}</div> : null}
          <strong>{scheduleTitle}</strong>
          {scheduleBody ? <div className="subtle">{scheduleBody}</div> : null}
          {scheduleAux ? <div className="subtle">{scheduleAux}</div> : null}
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
      const emergencyBanner = visibleOverlayText(props.payload.emergencyBanner);
      return emergencyBanner ? <div className="overlay-banner" key={kind}>{emergencyBanner}</div> : null;
    }

    if (kind === "ticker") {
      const tickerText = visibleOverlayText(props.payload.tickerText);
      return tickerText ? <div className="overlay-ticker" key={kind}>{tickerText}</div> : null;
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
      const primaryText = visibleOverlayText(layer.text) || visibleOverlayText(layer.name);
      const secondaryText = visibleOverlayText(layer.secondaryText);
      if (!primaryText && !secondaryText) {
        return null;
      }
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
          {primaryText ? <div className="overlay-custom-layer-text-primary">{primaryText}</div> : null}
          {secondaryText ? <div className="overlay-custom-layer-text-secondary">{secondaryText}</div> : null}
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
      const widgetLabel = visibleOverlayText(widget.label);
      const widgetTitle = visibleOverlayText(widget.title);
      const widgetBody = visibleOverlayText(widget.body);
      const widgetSecondary = visibleOverlayText(widget.secondary);

      return (
        <div className="overlay-custom-layer overlay-custom-layer-widget-data" key={layer.id} style={style}>
          <div className="overlay-custom-layer-embed-badge">Scene Widget</div>
          {widgetLabel ? <div className="overlay-custom-layer-widget-label">{widgetLabel}</div> : null}
          {widgetTitle ? <div className="overlay-custom-layer-widget-title">{widgetTitle}</div> : null}
          {widgetBody ? <div className="overlay-custom-layer-widget-body">{widgetBody}</div> : null}
          {widgetSecondary ? <div className="overlay-custom-layer-widget-secondary">{widgetSecondary}</div> : null}
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
              title={layer.title || layer.name || (layer.kind === "widget" ? "Widget frame" : "Embed frame")}
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
