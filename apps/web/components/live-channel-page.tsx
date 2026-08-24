"use client";

import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import { getChannelStatusLabel, getChannelUpdateNotice } from "@/lib/channel-status";

export function LiveChannelPage(props: { initialSnapshot: PublicChannelSnapshot }) {
  const { snapshot, connected } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/channel/live",
    streamUrl: "/api/channel/live/stream"
  });

  return (
    <div className="stack-form">
      <div className="stats-row">
        <span className="badge">{getChannelStatusLabel(snapshot.playout.status)}</span>
        {getChannelUpdateNotice(connected) ? (
          <span className="subtle">{getChannelUpdateNotice(connected)}</span>
        ) : null}
        <span className="subtle">{snapshot.timeZone}</span>
      </div>
      {/*
        The one thing this page is for. It listed what was on air and what came next and offered no
        way to reach any of it — measured, zero links and zero buttons on the only surface the
        audience sees. Absent when no usable broadcaster login is configured, because a watch link
        that goes nowhere is worse than none.
      */}
      {snapshot.watchUrl ? (
        <a className="button" href={snapshot.watchUrl} rel="noreferrer" target="_blank">
          Watch the stream
        </a>
      ) : null}
      <div className="list">
        <div className="item">
          <strong>On air now</strong>
          <div className="subtle">
            {snapshot.currentScheduleItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Standby"}
          </div>
          <div className="subtle">
            {snapshot.currentScheduleItem
              ? `${snapshot.currentScheduleItem.startTime} to ${snapshot.currentScheduleItem.endTime} · ${snapshot.currentScheduleItem.categoryName}`
              : snapshot.playout.message}
          </div>
        </div>
        <div className="item">
          <strong>Up next</strong>
          <div className="subtle">
            {snapshot.nextScheduleItem?.title || snapshot.nextAsset?.title || "No next item published yet"}
          </div>
          <div className="subtle">
            {snapshot.nextScheduleItem
              ? `${snapshot.nextScheduleItem.startTime} to ${snapshot.nextScheduleItem.endTime} · ${snapshot.nextScheduleItem.categoryName}`
              : "The next queue item will appear here as soon as the runtime confirms it."}
          </div>
        </div>
        <div className="item">
          <strong>Queue preview</strong>
          <div className="subtle">
            {snapshot.queueItems.length > 0
              ? snapshot.queueItems.slice(0, 4).map((item) => item.title).join(" → ")
              : "Queue preview is currently empty."}
          </div>
        </div>
      </div>
    </div>
  );
}
