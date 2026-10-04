"use client";

import { useSyncExternalStore } from "react";
import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import { buildPublicChannelView } from "@/lib/public-channel-view";

const subscribeToNothing = () => () => undefined;

function subscribeToSeconds(onChange: () => void) {
  const timer = window.setInterval(onChange, 1000);
  return () => window.clearInterval(timer);
}

// The same value within a second, as useSyncExternalStore requires of a snapshot.
function currentSecond(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function LiveChannelPage(props: { initialSnapshot: PublicChannelSnapshot }) {
  const { snapshot, connected } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/channel/live",
    streamUrl: "/api/channel/live/stream"
  });
  // The first render is the server's: its clock and the channel zone, so hydration finds the same text.
  // Then the browser's clock, every second for the progress bar, and the viewer's own zone (M100).
  const nowMs = useSyncExternalStore(subscribeToSeconds, currentSecond, () => undefined);
  const viewerTimeZone = useSyncExternalStore(subscribeToNothing, browserTimeZone, () => null);
  // Every word on this page is the channel language's (M80); the view builds them from the snapshot,
  // which carries the language, so a change in Settings reaches an open page with the next update.
  const view = buildPublicChannelView(snapshot, connected, { nowMs, viewerTimeZone });

  return (
    <div className="stack-form" lang={view.lang}>
      <div className="stats-row">
        <span className="badge">{view.statusLabel}</span>
        {view.updateNotice ? <span className="subtle">{view.updateNotice}</span> : null}
      </div>
      <p className="subtle">{view.timeZoneNote}</p>
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
      {/* Now: the item on air with how far it is, above the fold on a phone (M100). */}
      <div className="item channel-now">
        <strong>{view.now.heading}</strong>
        <div className="channel-now-title">{view.now.title}</div>
        <div className="subtle">{view.now.detail}</div>
        {view.now.channelTime ? <div className="subtle">{view.now.channelTime}</div> : null}
        {view.now.progressPercent !== null ? (
          <div className="channel-progress" aria-hidden={true}>
            <span className="channel-progress-bar" style={{ width: `${view.now.progressPercent}%` }} />
          </div>
        ) : null}
        {view.now.remaining ? <div className="subtle channel-now-remaining">{view.now.remaining}</div> : null}
      </div>
      <section className="channel-section">
        <h3>{view.nextHeading}</h3>
        {view.next.length === 0 ? (
          <div className="item">
            <div>{view.nextEmptyTitle}</div>
            <div className="subtle">{view.nextEmptyBody}</div>
          </div>
        ) : (
          <div className="list channel-next-list">
            {view.next.map((group) => (
              <div className="item channel-next-group" key={group.key}>
                <strong>
                  {group.timeRange}
                  {group.dated ? <span className="badge channel-dated">{group.dated}</span> : null}
                </strong>
                <div>{group.title}</div>
                {group.detail ? <div className="subtle">{group.detail}</div> : null}
                {group.channelTime ? <div className="subtle">{group.channelTime}</div> : null}
                {group.moreLabel ? (
                  <details className="channel-more">
                    <summary>{group.moreLabel}</summary>
                    <ul>
                      {group.more.map((item) => (
                        <li key={item.key}>
                          <span className="subtle">{item.time}</span> {item.title}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="channel-section">
        <h3>{view.weekHeading}</h3>
        {view.week.length === 0 ? (
          <div className="subtle">{view.weekEmpty}</div>
        ) : (
          <div className="channel-week-list">
            {view.week.map((day) => (
              <div className="channel-week-day" key={day.key}>
                <h4>{day.label}</h4>
                <ul>
                  {day.entries.map((entry) => (
                    <li key={entry.key}>
                      <span className="subtle">{entry.timeRange}</span> <strong>{entry.title}</strong>
                      {entry.detail ? <span className="subtle"> · {entry.detail}</span> : null}
                      {entry.dated ? <span className="badge channel-dated">{entry.dated}</span> : null}
                      {entry.channelTime ? <div className="subtle">{entry.channelTime}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {/*
          The calendar feed (/channel.ics): a calendar app subscribes to it, a browser hands the file
          over or downloads it. In a tab of its own, so the programme stays open behind it.
        */}
        <a className="subtle-link" href="/channel.ics" rel="noreferrer" target="_blank">
          {view.calendarLabel}
        </a>
      </section>
    </div>
  );
}
