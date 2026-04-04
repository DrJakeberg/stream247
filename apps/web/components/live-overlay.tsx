"use client";

import { resolveOverlayHeadlineForQueueKind } from "@stream247/core";
import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
import { OverlaySceneCanvas } from "@/components/overlay-scene-canvas";
import { useLiveSnapshot } from "@/components/use-live-snapshot";

export function LiveOverlay(props: { initialSnapshot: PublicChannelSnapshot }) {
  const { snapshot } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/channel/live",
    streamUrl: "/api/channel/live/stream"
  });

  const currentItem = snapshot.currentScheduleItem;
  const nextItem = snapshot.nextScheduleItem;
  const queueHead = snapshot.queueItems[0] ?? null;
  const queuePreviewStart = queueHead ? 1 : 0;
  const queuePreview = snapshot.queueItems.slice(queuePreviewStart, queuePreviewStart + snapshot.overlay.queuePreviewCount);
  const sceneMode = queueHead?.kind ?? "asset";

  return (
    <main className="overlay-page">
      <OverlaySceneCanvas
        currentCategory={currentItem?.categoryName || snapshot.currentAsset?.categoryName || "Always on air"}
        currentSourceName={currentItem?.sourceName || snapshot.currentAsset?.sourceName || "Source to be announced"}
        currentTitle={
          sceneMode === "asset"
            ? currentItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Stream247"
            : queueHead?.title || snapshot.playout.currentTitle || snapshot.overlay.headline || "Replay stream"
        }
        modeSubtitle={
          resolveOverlayHeadlineForQueueKind(snapshot.overlay.headline, sceneMode, {
            insertHeadline: snapshot.overlay.insertHeadline,
            standbyHeadline: snapshot.overlay.standbyHeadline,
            reconnectHeadline: snapshot.overlay.reconnectHeadline
          })
        }
        nextTimeLabel={nextItem ? `${nextItem.startTime} to ${nextItem.endTime}` : "No next block configured"}
        nextTitle={nextItem?.title ?? snapshot.nextAsset?.title ?? "Schedule not available"}
        overlay={snapshot.overlay}
        queueTitles={queuePreview.map((item) => item.title)}
        sceneMode={sceneMode}
        timeZone={snapshot.timeZone}
      />
    </main>
  );
}
