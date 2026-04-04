"use client";

import { buildOverlayBrandLine, resolveOverlayScenePresetForQueueKind, type OverlayQueueKind } from "@stream247/core";
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
  const effectiveScenePreset = resolveOverlayScenePresetForQueueKind(props.overlay.scenePreset, props.sceneMode);
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

  return (
    <section
      className={frameClassName}
      style={
        {
          "--overlay-accent": props.overlay.accentColor
        } as CSSProperties
      }
    >
      <div className="overlay-chip">
        {buildOverlayBrandLine(props.overlay.replayLabel, props.overlay.brandBadge)} · {props.overlay.channelName} · {heroLabel}
      </div>
      <div className="overlay-card overlay-card-large">
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
      {props.overlay.showNextItem ? (
        <div className="overlay-card">
          <div className="label">{nextLabel}</div>
          <strong>{props.nextTitle || "Schedule not available"}</strong>
          <div className="subtle">{props.nextTimeLabel || "No next block configured"}</div>
        </div>
      ) : null}
      {props.overlay.showQueuePreview ? (
        <div className="overlay-card">
          <div className="label">Later</div>
          <strong>
            {queuePreview.length > 0 ? queuePreview.join(" → ") : "Queue preview will appear here once playout confirms it."}
          </strong>
        </div>
      ) : null}
      {props.overlay.showScheduleTeaser ? (
        <div className="overlay-card">
          <div className="label">Scene</div>
          <strong>{props.currentTitle || "Stand by"}</strong>
          <div className="subtle">{props.sceneMode === "asset" ? props.currentCategory || "Always on air" : heroBody}</div>
          <div className="subtle">
            {props.sceneMode === "asset"
              ? props.currentSourceName || "Source to be announced"
              : props.nextTitle || "Programming will resume shortly"}
          </div>
        </div>
      ) : null}
      {props.overlay.showClock ? (
        <div className="overlay-clock">
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: props.timeZone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
          }).format(now)}{" "}
          {props.timeZone}
        </div>
      ) : null}
      {props.overlay.emergencyBanner ? <div className="overlay-banner">{props.overlay.emergencyBanner}</div> : null}
      {props.overlay.tickerText ? <div className="overlay-ticker">{props.overlay.tickerText}</div> : null}
    </section>
  );
}
