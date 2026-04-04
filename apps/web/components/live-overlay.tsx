"use client";

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
  const queuePreview = snapshot.queueItems.slice(1, 1 + snapshot.overlay.queuePreviewCount);
  const frameClassName =
    snapshot.overlay.scenePreset === "standby-board"
      ? "overlay-frame overlay-frame-standby"
      : snapshot.overlay.scenePreset === "split-now-next"
        ? "overlay-frame overlay-frame-split"
        : snapshot.overlay.scenePreset === "minimal-chip"
          ? "overlay-frame overlay-frame-minimal"
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
          {snapshot.overlay.replayLabel} · {snapshot.overlay.channelName}
        </div>
        <div className="overlay-card overlay-card-large">
          <div className="label">Now Playing</div>
          <h1>{currentItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Stream247"}</h1>
          <p>{snapshot.overlay.headline}</p>
          {snapshot.overlay.showCurrentCategory ? (
            <div className="subtle">
              {currentItem?.categoryName || snapshot.currentAsset?.categoryName || "Always on air"}
              {snapshot.overlay.showSourceLabel
                ? ` · ${currentItem?.sourceName || snapshot.currentAsset?.sourceName || "Source to be announced"}`
                : ""}
            </div>
          ) : snapshot.overlay.showSourceLabel ? (
            <div className="subtle">{currentItem?.sourceName || snapshot.currentAsset?.sourceName || "Source to be announced"}</div>
          ) : null}
        </div>
        {snapshot.overlay.showNextItem ? (
          <div className="overlay-card">
            <div className="label">Next</div>
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
            <strong>{snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Stand by"}</strong>
            <div className="subtle">{currentItem?.categoryName || snapshot.currentAsset?.categoryName || "Always on air"}</div>
            <div className="subtle">{currentItem?.sourceName || snapshot.currentAsset?.sourceName || "Source to be announced"}</div>
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
