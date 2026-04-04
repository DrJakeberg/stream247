export const dynamic = "force-dynamic";

import Link from "next/link";
import { OverlaySettingsForm } from "@/components/overlay-settings-form";
import { Panel } from "@/components/panel";
import { getCurrentScheduleItem, getNextScheduleItem, readAppState } from "@/lib/server/state";

export default async function OverlayStudioPage() {
  const state = await readAppState();
  const currentItem = getCurrentScheduleItem(state);
  const nextItem = getNextScheduleItem(state);

  return (
    <div className="grid two">
      <Panel title="Overlay settings" eyebrow="Overlay">
        <p className="subtle">
          Use <code>{`${process.env.APP_URL || "http://localhost:3000"}/overlay`}</code> as a browser source in OBS
          or another scene tool. The same scene settings also drive the on-air replay text overlay inside the FFmpeg
          playout path, so this page is now the first step toward a unified scene system.
        </p>
        <OverlaySettingsForm overlay={state.overlay} />
      </Panel>

      <Panel title="Current overlay payload" eyebrow="Preview">
        <div className="list">
          <div className="item">
            <strong>Active scene preset</strong>
            <div className="subtle">
              {state.overlay.scenePreset} · current category {state.overlay.showCurrentCategory ? "shown" : "hidden"} · source label{" "}
              {state.overlay.showSourceLabel ? "shown" : "hidden"}
            </div>
            <div className="subtle">
              Queue preview {state.overlay.showQueuePreview ? `shown (${state.overlay.queuePreviewCount})` : "hidden"}
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
            <strong>Public browser source</strong>
            <div className="subtle">
              <Link href="/overlay">Open overlay page</Link>
            </div>
          </div>
          <div className="item">
            <strong>Emergency banner</strong>
            <div className="subtle">{state.overlay.emergencyBanner || "No emergency banner is active."}</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
