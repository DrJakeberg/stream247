export const dynamic = "force-dynamic";

import Link from "next/link";
import { OverlaySettingsForm } from "@/components/overlay-settings-form";
import { Panel } from "@/components/panel";
import { getCurrentScheduleItem, getNextScheduleItem, listOverlayScenePresetRecords, readAppState, readOverlayStudioState } from "@/lib/server/state";

export default async function OverlayStudioPage() {
  const state = await readAppState();
  const studioState = await readOverlayStudioState();
  const scenePresets = await listOverlayScenePresetRecords();
  const currentItem = getCurrentScheduleItem(state);
  const nextItem = getNextScheduleItem(state);
  const previewQueueTitles = state.playout.queueItems.slice(1, 5).map((item) => item.title).filter(Boolean);

  return (
    <div className="grid two">
      <Panel title="Overlay settings" eyebrow="Overlay">
        <p className="subtle">
          Use <code>{`${process.env.APP_URL || "http://localhost:3000"}/overlay`}</code> as a browser source in OBS
          or another scene tool. Draft changes stay inside the studio until you publish them, and the same live scene
          settings also drive the on-air replay text overlay inside the FFmpeg playout path. Positioned embeds remain
          conservative: third-party CSP and iframe policies still decide whether a website or widget can actually render.
        </p>
        <OverlaySettingsForm
          basedOnUpdatedAt={studioState.basedOnUpdatedAt}
          draftOverlay={studioState.draftOverlay}
          hasUnpublishedChanges={studioState.hasUnpublishedChanges}
          liveOverlay={studioState.liveOverlay}
          scenePresets={scenePresets}
          preview={{
            timeZone: process.env.CHANNEL_TIMEZONE || "UTC",
            currentTitle: currentItem?.title || state.playout.currentTitle || "Morning Replay",
            currentCategory: currentItem?.categoryName || "Always on air",
            currentSourceName: currentItem?.sourceName || "Archive Pool",
            nextTitle: nextItem?.title || state.playout.nextTitle || "Next replay block",
            nextTimeLabel: nextItem ? `${nextItem.startTime} to ${nextItem.endTime}` : "No next block configured",
            queueTitles:
              previewQueueTitles.length > 0
                ? previewQueueTitles
                : [nextItem?.title || "Next replay block", "Prime time replay", "Late night standby"].filter(Boolean)
          }}
        />
      </Panel>

      <Panel title="Current overlay payload" eyebrow="Preview">
        <div className="list">
          <div className="item">
            <strong>Live scene preset</strong>
            <div className="subtle">
              {studioState.liveOverlay.scenePreset} · {studioState.liveOverlay.surfaceStyle} surface · {studioState.liveOverlay.panelAnchor} anchor · {studioState.liveOverlay.titleScale} title scale
            </div>
            <div className="subtle">
              Typography {studioState.liveOverlay.typographyPreset} · {studioState.liveOverlay.customLayers.length} positioned layer
              {studioState.liveOverlay.customLayers.length === 1 ? "" : "s"}
            </div>
            <div className="subtle">
              Current category {studioState.liveOverlay.showCurrentCategory ? "shown" : "hidden"} · source label{" "}
              {studioState.liveOverlay.showSourceLabel ? "shown" : "hidden"}
            </div>
            <div className="subtle">
              Queue preview {studioState.liveOverlay.showQueuePreview ? `shown (${studioState.liveOverlay.queuePreviewCount})` : "hidden"}
            </div>
            <div className="subtle">Published {studioState.liveOverlay.updatedAt || "never"}</div>
          </div>
          <div className="item">
            <strong>Draft status</strong>
            <div className="subtle">
              {studioState.hasUnpublishedChanges ? "Draft differs from live scene." : "Draft matches the live scene."}
            </div>
            <div className="subtle">Draft saved {studioState.draftOverlay.updatedAt || "not yet saved"}</div>
            <div className="subtle">Based on live scene {studioState.basedOnUpdatedAt || "unknown"}</div>
            <div className="subtle">
              Draft preset {studioState.draftOverlay.scenePreset} · {studioState.draftOverlay.surfaceStyle} surface ·{" "}
              {studioState.draftOverlay.panelAnchor} anchor
            </div>
            <div className="subtle">
              Typography {studioState.draftOverlay.typographyPreset} · {studioState.draftOverlay.customLayers.length} positioned layer
              {studioState.draftOverlay.customLayers.length === 1 ? "" : "s"}
            </div>
            <div className="subtle">{scenePresets.length} saved scene preset{scenePresets.length === 1 ? "" : "s"} in the library.</div>
          </div>
          <div className="item">
            <strong>Current block</strong>
            <div className="subtle">
              {currentItem ? `${currentItem.title} · ${currentItem.startTime} to ${currentItem.endTime}` : "No active block"}
            </div>
          </div>
          <div className="item">
            <strong>Next block</strong>
            <div className="subtle">
              {nextItem ? `${nextItem.title} · ${nextItem.startTime} to ${nextItem.endTime}` : "No next block"}
            </div>
          </div>
          <div className="item">
            <strong>Public browser source</strong>
            <div className="subtle">
              <Link href="/overlay">Open overlay page</Link>
            </div>
          </div>
          <div className="item">
            <strong>Emergency banner</strong>
            <div className="subtle">{studioState.liveOverlay.emergencyBanner || "No emergency banner is active."}</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
