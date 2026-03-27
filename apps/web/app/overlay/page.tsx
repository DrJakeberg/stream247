export const dynamic = "force-dynamic";

import type { CSSProperties } from "react";
import { getCurrentScheduleItem, getNextScheduleItem, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export default async function OverlayPage() {
  const state = await readAppState();
  const currentItem = getCurrentScheduleItem(state);
  const nextItem = getNextScheduleItem(state);
  const timeZone = getWorkspaceTimeZone();

  return (
    <main
      className="overlay-page"
      style={
        {
          "--overlay-accent": state.overlay.accentColor
        } as CSSProperties
      }
    >
      <section className="overlay-frame">
        <div className="overlay-chip">{state.overlay.channelName}</div>
        <div className="overlay-card overlay-card-large">
          <div className="label">Now Playing</div>
          <h1>{currentItem?.title || state.playout.currentTitle || "Stream247"}</h1>
          <p>{state.overlay.headline}</p>
        </div>
        {state.overlay.showNextItem ? (
          <div className="overlay-card">
            <div className="label">Next</div>
            <strong>{nextItem?.title ?? "Schedule not available"}</strong>
            <div className="subtle">
              {nextItem ? `${nextItem.startTime} to ${nextItem.endTime}` : "No next block configured"}
            </div>
          </div>
        ) : null}
        {state.overlay.showScheduleTeaser ? (
          <div className="overlay-card">
            <div className="label">Schedule</div>
            <strong>{currentItem?.categoryName ?? "Always on air"}</strong>
            <div className="subtle">{currentItem?.sourceName ?? "Source to be announced"}</div>
          </div>
        ) : null}
        {state.overlay.showClock ? (
          <div className="overlay-clock">
            {new Intl.DateTimeFormat("en-GB", {
              timeZone,
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23"
            }).format(new Date())}{" "}
            {timeZone}
          </div>
        ) : null}
        {state.overlay.emergencyBanner ? <div className="overlay-banner">{state.overlay.emergencyBanner}</div> : null}
      </section>
    </main>
  );
}
