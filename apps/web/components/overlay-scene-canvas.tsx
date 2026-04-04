"use client";

import {
  buildOverlayBrandLine,
  buildOverlaySceneDefinition,
  type OverlayQueueKind,
  type OverlaySceneLayerKind
} from "@stream247/core";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { LiveOverlaySummary } from "@/lib/live-broadcast";

type OverlaySceneCanvasProps = {
  overlay: LiveOverlaySummary;
  timeZone: string;
  sceneMode: OverlayQueueKind;
  currentTitle: string;
  currentCategory?: string;
  currentSourceName?: string;
  nextTitle: string;
  nextTimeLabel?: string;
  queueTitles?: string[];
  modeSubtitle?: string;
};

export function OverlaySceneCanvas(props: OverlaySceneCanvasProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const queuePreview = (props.queueTitles || []).filter(Boolean).slice(0, props.overlay.queuePreviewCount);
  const sceneDefinition = buildOverlaySceneDefinition({
    overlay: {
      scenePreset: props.overlay.scenePreset,
      insertScenePreset: props.overlay.insertScenePreset,
      standbyScenePreset: props.overlay.standbyScenePreset,
      reconnectScenePreset: props.overlay.reconnectScenePreset,
      surfaceStyle: props.overlay.surfaceStyle,
      panelAnchor: props.overlay.panelAnchor,
      titleScale: props.overlay.titleScale,
      showClock: props.overlay.showClock,
      showNextItem: props.overlay.showNextItem,
      showScheduleTeaser: props.overlay.showScheduleTeaser,
      showQueuePreview: props.overlay.showQueuePreview,
      emergencyBanner: props.overlay.emergencyBanner,
      tickerText: props.overlay.tickerText,
      layerOrder: props.overlay.layerOrder,
      disabledLayers: props.overlay.disabledLayers
    },
    queueKind: props.sceneMode
  });
  const effectiveScenePreset = sceneDefinition.resolvedPresetId;
  const heroLabel =
    props.sceneMode === "insert"
      ? "Insert On Air"
      : props.sceneMode === "reconnect"
        ? "Reconnect Window"
        : props.sceneMode === "standby"
          ? "Standby"
          : "Now Playing";
  const heroBody =
    props.sceneMode === "insert"
      ? props.modeSubtitle || "A bumper or manual insert is on air."
      : props.sceneMode === "reconnect"
        ? props.modeSubtitle || "A planned reconnect is in progress."
        : props.sceneMode === "standby"
          ? props.modeSubtitle || props.overlay.headline || "Programming will resume shortly."
          : props.modeSubtitle || props.overlay.headline;
  const nextLabel =
    props.sceneMode === "insert" ? "After Insert" : props.sceneMode === "reconnect" ? "Returning With" : "Next";
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
    `overlay-anchor-${props.overlay.panelAnchor}`,
    `overlay-surface-${props.overlay.surfaceStyle}`,
    `overlay-title-${props.overlay.titleScale}`
  ]
    .filter(Boolean)
    .join(" ");

  function renderLayer(kind: OverlaySceneLayerKind) {
    if (kind === "chip") {
      return (
        <div className="overlay-chip" key={kind}>
          {buildOverlayBrandLine(props.overlay.replayLabel, props.overlay.brandBadge)} · {props.overlay.channelName} · {heroLabel}
        </div>
      );
    }

    if (kind === "hero") {
      return (
        <div className="overlay-card overlay-card-large" key={kind}>
          <div className="label">{heroLabel}</div>
          <h1>{props.currentTitle || "Stream247"}</h1>
          <p>{heroBody}</p>
          {props.sceneMode === "asset" && props.overlay.showCurrentCategory ? (
            <div className="subtle">
              {props.currentCategory || "Always on air"}
              {props.overlay.showSourceLabel ? ` · ${props.currentSourceName || "Source to be announced"}` : ""}
            </div>
          ) : props.sceneMode === "asset" && props.overlay.showSourceLabel ? (
            <div className="subtle">{props.currentSourceName || "Source to be announced"}</div>
          ) : null}
        </div>
      );
    }

    if (kind === "next") {
      return (
        <div className="overlay-card" key={kind}>
          <div className="label">{nextLabel}</div>
          <strong>{props.nextTitle || "Schedule not available"}</strong>
          <div className="subtle">{props.nextTimeLabel || "No next block configured"}</div>
        </div>
      );
    }

    if (kind === "queue") {
      return (
        <div className="overlay-card" key={kind}>
          <div className="label">Later</div>
          <strong>{queuePreview.length > 0 ? queuePreview.join(" → ") : "Queue preview will appear here once playout confirms it."}</strong>
        </div>
      );
    }

    if (kind === "schedule") {
      return (
        <div className="overlay-card" key={kind}>
          <div className="label">Scene</div>
          <strong>{props.currentTitle || "Stand by"}</strong>
          <div className="subtle">{props.sceneMode === "asset" ? props.currentCategory || "Always on air" : heroBody}</div>
          <div className="subtle">
            {props.sceneMode === "asset"
              ? props.currentSourceName || "Source to be announced"
              : props.nextTitle || "Programming will resume shortly"}
          </div>
        </div>
      );
    }

    if (kind === "clock") {
      return (
        <div className="overlay-clock" key={kind}>
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: props.timeZone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
          }).format(now)}{" "}
          {props.timeZone}
        </div>
      );
    }

    if (kind === "banner") {
      return <div className="overlay-banner" key={kind}>{props.overlay.emergencyBanner}</div>;
    }

    if (kind === "ticker") {
      return <div className="overlay-ticker" key={kind}>{props.overlay.tickerText}</div>;
    }

    return null;
  }

  return (
    <section
      className={frameClassName}
      style={
        {
          "--overlay-accent": props.overlay.accentColor
        } as CSSProperties
      }
    >
      {sceneDefinition.layers.filter((layer) => layer.enabled).map((layer) => renderLayer(layer.kind))}
    </section>
  );
}
