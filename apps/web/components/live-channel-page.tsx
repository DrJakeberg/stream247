"use client";

import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import { buildPublicChannelView } from "@/lib/public-channel-view";

export function LiveChannelPage(props: { initialSnapshot: PublicChannelSnapshot }) {
  const { snapshot, connected } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/channel/live",
    streamUrl: "/api/channel/live/stream"
  });
  // Every word on this page is the channel language's (M80); the view builds them from the snapshot,
  // which carries the language, so a change in Settings reaches an open page with the next update.
  const view = buildPublicChannelView(snapshot, connected);

  return (
    <div className="stack-form" lang={view.lang}>
      <div className="stats-row">
        <span className="badge">{view.statusLabel}</span>
        {view.updateNotice ? <span className="subtle">{view.updateNotice}</span> : null}
        <span className="subtle">{view.timeZoneLabel}</span>
      </div>
      {/*
        The one thing this page is for. It listed what was on air and what came next and offered no
        way to reach any of it — measured, zero links and zero buttons on the only surface the
        audience sees. Absent when no usable broadcaster login is configured, because a watch link
        that goes nowhere is worse than none.
      */}
      {snapshot.watchUrl ? (
        <a className="button" href={snapshot.watchUrl} rel="noreferrer" target="_blank">
          {view.watchLabel}
        </a>
      ) : null}
      <div className="list">
        <div className="item">
          <strong>{view.onAirHeading}</strong>
          <div className="subtle">{view.onAirTitle}</div>
          <div className="subtle">{view.onAirDetail}</div>
        </div>
        <div className="item">
          <strong>{view.nextHeading}</strong>
          <div className="subtle">{view.nextTitle}</div>
          <div className="subtle">{view.nextDetail}</div>
        </div>
        <div className="item">
          <strong>{view.afterHeading}</strong>
          <div className="subtle">{view.afterText}</div>
        </div>
      </div>
    </div>
  );
}
