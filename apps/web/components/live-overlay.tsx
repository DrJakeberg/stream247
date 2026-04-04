"use client";

import { resolveOverlayScenePresetForQueueKind } from "@stream247/core";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
import { useLiveSnapshot } from "@/components/use-live-snapshot";

export function LiveOverlay(props: { initialSnapshot: PublicChannelSnapshot }) {
  const { snapshot } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/channel/live",
    streamUrl: "/api/channel/live/stream"
  });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentItem = snapshot.currentScheduleItem;
  const nextItem = snapshot.nextScheduleItem;
  const queueHead = snapshot.queueItems[0] ?? null;
  const queuePreviewStart = queueHead ? 1 : 0;
  const queuePreview = snapshot.queueItems.slice(queuePreviewStart, queuePreviewStart + snapshot.overlay.queuePreviewCount);
  const sceneMode = queueHead?.kind ?? "asset";
  const effectiveScenePreset =
    queueHead?.scenePreset || resolveOverlayScenePresetForQueueKind(snapshot.overlay.scenePreset, sceneMode);
  const heroLabel =
    sceneMode === "insert"
      ? "Insert On Air"
      : sceneMode === "reconnect"
        ? "Reconnect Window"
        : sceneMode === "standby"
          ? "Standby"
          : "Now Playing";
  const heroTitle =
    sceneMode === "asset"
      ? currentItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Stream247"
      : queueHead?.title || snapshot.playout.currentTitle || snapshot.overlay.headline || "Replay stream";
  const heroBody =
    sceneMode === "insert"
      ? queueHead?.subtitle || "A bumper or manual insert is on air."
      : sceneMode === "reconnect"
        ? queueHead?.subtitle || "A planned reconnect is in progress."
        : sceneMode === "standby"
          ? queueHead?.subtitle || snapshot.overlay.headline || "Programming will resume shortly."
          : snapshot.overlay.headline;
  const nextLabel = sceneMode === "insert" ? "After Insert" : sceneMode === "reconnect" ? "Returning With" : "Next";
  const frameClassName =
    effectiveScenePreset === "standby-board"
      ? "overlay-frame overlay-frame-standby"
      : effectiveScenePreset === "split-now-next"
        ? "overlay-frame overlay-frame-split"
        : effectiveScenePreset === "minimal-chip"
          ? "overlay-frame overlay-frame-minimal"
          : effectiveScenePreset === "bumper-board"
            ? "overlay-frame overlay-frame-bumper"
            : effectiveScenePreset === "reconnect-board"
              ? "overlay-frame overlay-frame-reconnect"
              : "overlay-frame";

  return (
    <main
      className="overlay-page"
      style={
        {
          "--overlay-accent": snapshot.overlay.accentColor
        } as CSSProperties
      }
    >
      <section className={frameClassName}>
        <div className="overlay-chip">
          {snapshot.overlay.replayLabel} · {snapshot.overlay.channelName} · {heroLabel}
        </div>
        <div className="overlay-card overlay-card-large">
          <div className="label">{heroLabel}</div>
          <h1>{heroTitle}</h1>
          <p>{heroBody}</p>
          {sceneMode === "asset" && snapshot.overlay.showCurrentCategory ? (
            <div className="subtle">
              {currentItem?.categoryName || snapshot.currentAsset?.categoryName || "Always on air"}
              {snapshot.overlay.showSourceLabel
                ? ` · ${currentItem?.sourceName || snapshot.currentAsset?.sourceName || "Source to be announced"}`
                : ""}
            </div>
          ) : sceneMode === "asset" && snapshot.overlay.showSourceLabel ? (
            <div className="subtle">{currentItem?.sourceName || snapshot.currentAsset?.sourceName || "Source to be announced"}</div>
          ) : null}
        </div>
        {snapshot.overlay.showNextItem ? (
          <div className="overlay-card">
            <div className="label">{nextLabel}</div>
            <strong>{nextItem?.title ?? snapshot.nextAsset?.title ?? "Schedule not available"}</strong>
            <div className="subtle">
              {nextItem ? `${nextItem.startTime} to ${nextItem.endTime}` : "No next block configured"}
            </div>
          </div>
        ) : null}
        {snapshot.overlay.showQueuePreview ? (
          <div className="overlay-card">
            <div className="label">Later</div>
            <strong>
              {queuePreview.length > 0
                ? queuePreview.map((item) => item.title).join(" → ")
                : "Queue preview will appear here once playout confirms it."}
            </strong>
          </div>
        ) : null}
        {snapshot.overlay.showScheduleTeaser ? (
          <div className="overlay-card">
            <div className="label">Schedule</div>
            <strong>{sceneMode === "asset" ? snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Stand by" : heroTitle}</strong>
            <div className="subtle">
              {sceneMode === "asset"
                ? currentItem?.categoryName || snapshot.currentAsset?.categoryName || "Always on air"
                : heroBody}
            </div>
            <div className="subtle">
              {sceneMode === "asset"
                ? currentItem?.sourceName || snapshot.currentAsset?.sourceName || "Source to be announced"
                : nextItem?.title || snapshot.nextAsset?.title || "Programming will resume shortly"}
            </div>
          </div>
        ) : null}
        {snapshot.overlay.showClock ? (
          <div className="overlay-clock">
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: snapshot.timeZone,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hourCycle: "h23"
            }).format(now)}{" "}
            {snapshot.timeZone}
          </div>
        ) : null}
        {snapshot.overlay.emergencyBanner ? <div className="overlay-banner">{snapshot.overlay.emergencyBanner}</div> : null}
      </section>
    </main>
  );
}
