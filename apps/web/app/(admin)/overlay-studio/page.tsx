export const dynamic = "force-dynamic";

import { AdminPageHeader } from "@/components/admin-page-header";
import { overlayNextTimeLabel, resolveStreamOutputSettings } from "@stream247/core";
import { listOverlayVideoSourceRecords } from "@stream247/db";
import { OverlaySettingsForm } from "@/components/overlay-settings-form";
import { Panel } from "@/components/panel";
import { VideoSourceSettingsForm } from "@/components/video-source-settings-form";
import { getCurrentScheduleItem, getNextScheduleItem, getWorkspaceTimeZone, listOverlayScenePresetRecords, readAppState, readOverlayStudioState } from "@/lib/server/state";
import { describeScenePreset, describeTypographyPreset } from "@/lib/scene-preset-names";

export default async function OverlayStudioPage() {
  const state = await readAppState();
  const studioState = await readOverlayStudioState();
  const scenePresets = await listOverlayScenePresetRecords();
  const videoSources = await listOverlayVideoSourceRecords();
  // The size the channel actually encodes. The preview is drawn at it and the drag handles are
  // placed against it, because the picture at 1280x720 is not a scaled 1080p one: overlayScale
  // floors at 0.35 and every dimension is rounded to whole pixels.
  const outputSettings = resolveStreamOutputSettings({ settings: state.output, env: process.env });
  const currentItem = getCurrentScheduleItem(state);
  const nextItem = getNextScheduleItem(state);
  const previewQueueTitles = state.playout.queueItems.slice(1, 5).map((item) => item.title).filter(Boolean);
  const emergencyBannerActive = Boolean(
    studioState.liveOverlay.emergencyBanner.trim() || studioState.draftOverlay.emergencyBanner.trim()
  );

  return (
    <div className="stack-form">
      <AdminPageHeader
        className={emergencyBannerActive ? "scene-header-alert" : ""}
        description="Scene controls the published viewer-facing scene. Draft changes stay isolated until you review and publish them to the on-air renderer."
        eyebrow="Scene"
        info="The scene is everything the playout draws over the programme picture: titles, the current and next block, the clock, custom layers. You edit a draft here; nothing reaches the channel until you publish it."
        title="Publish the viewer-facing scene without leaving the control room."
      />

      <div className="grid two grid-aside">
        <Panel
          eyebrow="Scene"
          info="Everything in this panel changes the draft only. The preview is drawn by the same renderer the channel uses, at the size the channel encodes, so what you see here is what goes on air after you publish."
          title="Scene controls"
        >
          <p className="subtle">
            The picture is drawn by the playout; the studio preview is the same drawing. Draft changes stay inside the
            studio until you publish them, and the published scene settings also drive the on-air replay text overlay
            inside the FFmpeg playout path. Metadata widgets stay inside that canonical scene payload, and custom font
            stacks resolve only against fonts already installed on the worker image.
          </p>
          <OverlaySettingsForm
            basedOnUpdatedAt={studioState.basedOnUpdatedAt}
            chatPosition={state.engagement.chatPosition}
            draftOverlay={studioState.draftOverlay}
            hasUnpublishedChanges={studioState.hasUnpublishedChanges}
            liveOverlay={studioState.liveOverlay}
            outputSize={{ width: outputSettings.width, height: outputSettings.height }}
            scenePresets={scenePresets}
            videoSources={videoSources}
            preview={{
              timeZone: getWorkspaceTimeZone(state),
              currentTitle: currentItem?.title || state.playout.currentTitle || "Morning Replay",
              currentCategory: currentItem?.categoryName || "Always on air",
              currentSourceName: currentItem?.sourceName || "Archive Pool",
              nextTitle: nextItem?.title || state.playout.nextTitle || "Next replay block",
              nextTimeLabel: overlayNextTimeLabel(nextItem),
              queueTitles:
                previewQueueTitles.length > 0
                  ? previewQueueTitles
                  : [nextItem?.title || "Next replay block", "Prime time replay", "Late night standby"].filter(Boolean)
            }}
          />
          <VideoSourceSettingsForm videoSources={videoSources} />
        </Panel>

        <Panel
          eyebrow="Viewer scene"
          info="What viewers see right now. Compare it with your draft: when the draft differs, the publish button becomes the only way to move these values."
          title="Published scene state"
        >
          <div className="list">
            <div className="item">
              <strong>Live scene preset</strong>
              <div className="subtle">
                {describeScenePreset(studioState.liveOverlay.scenePreset)} · {studioState.liveOverlay.surfaceStyle} surface · {studioState.liveOverlay.panelAnchor} anchor · {studioState.liveOverlay.titleScale} title scale
              </div>
              <div className="subtle">
                Typography {describeTypographyPreset(studioState.liveOverlay.typographyPreset)} · {studioState.liveOverlay.customLayers.length} positioned layer
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
                Draft preset {describeScenePreset(studioState.draftOverlay.scenePreset)} · {studioState.draftOverlay.surfaceStyle} surface ·{" "}
                {studioState.draftOverlay.panelAnchor} anchor
              </div>
              <div className="subtle">
                Typography {describeTypographyPreset(studioState.draftOverlay.typographyPreset)} · {studioState.draftOverlay.customLayers.length} positioned layer
                {studioState.draftOverlay.customLayers.length === 1 ? "" : "s"}
              </div>
              <div className="subtle">
                {scenePresets.length} saved scene preset{scenePresets.length === 1 ? "" : "s"} in the library.
              </div>
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
              <strong>Emergency banner</strong>
              <div className="subtle">{studioState.liveOverlay.emergencyBanner || "No emergency banner is active."}</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
