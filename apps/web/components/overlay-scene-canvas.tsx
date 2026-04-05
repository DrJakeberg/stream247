"use client";

import type { OverlaySceneLayerKind, OverlayScenePayload } from "@stream247/core";
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
    `overlay-title-${props.payload.scene.titleScale}`
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
    </section>
  );
}
