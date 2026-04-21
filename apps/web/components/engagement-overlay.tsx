"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveEngagementEventSummary, LiveEngagementSummary } from "@/lib/live-broadcast";

function isAlertEvent(event: LiveEngagementEventSummary): boolean {
  return event.kind === "follow" || event.kind === "subscribe" || event.kind === "cheer" || event.kind === "channel-point";
}

function classForPosition(base: string, position: string): string {
  return `${base} ${base}-${position}`;
}

function isRecentEvent(event: LiveEngagementEventSummary, now = Date.now()): boolean {
  const createdAt = Date.parse(event.createdAt);
  return Number.isFinite(createdAt) && now - createdAt <= 10_000;
}

export function EngagementOverlay({ initialEngagement }: { initialEngagement: LiveEngagementSummary }) {
  const [engagement, setEngagement] = useState(initialEngagement);
  const chatEvents = useMemo(
    () =>
      engagement.recentEvents
        .filter((event) => event.kind === "chat")
        .slice(0, engagement.settings.maxMessages)
        .reverse(),
    [engagement.recentEvents, engagement.settings.maxMessages]
  );
  const latestAlert = engagement.recentEvents.find((event) => isAlertEvent(event) && isRecentEvent(event)) ?? null;

  useEffect(() => {
    const eventSource = new EventSource("/api/overlay/events");
    eventSource.addEventListener("engagement", (event) => {
      try {
        setEngagement(JSON.parse((event as MessageEvent<string>).data) as LiveEngagementSummary);
      } catch {
        // Ignore malformed engagement updates and keep the last known overlay state.
      }
    });
    return () => eventSource.close();
  }, []);

  const alertLabel =
    latestAlert?.kind === "follow"
      ? "New follow"
      : latestAlert?.kind === "subscribe"
        ? "New subscription"
        : latestAlert?.kind === "cheer"
          ? "New cheer"
          : latestAlert?.kind === "channel-point"
            ? "Channel points redeemed"
            : "";

  return (
    <>
      {engagement.settings.chatRuntimeEnabled && chatEvents.length > 0 ? (
        <aside
          className={[
            classForPosition("engagement-chat", engagement.settings.chatPosition),
            `engagement-chat-${engagement.settings.chatMode}`,
            `engagement-chat-${engagement.settings.style}`
          ].join(" ")}
        >
          {chatEvents.map((event) => (
            <div className="engagement-chat-message" key={event.id}>
              <span>{event.actor}</span>
              <p>{event.message}</p>
            </div>
          ))}
        </aside>
      ) : null}

      {engagement.settings.alertsRuntimeEnabled && latestAlert ? (
        <aside
          className={[
            classForPosition("engagement-alert", engagement.settings.alertPosition),
            `engagement-alert-${engagement.settings.style}`
          ].join(" ")}
          key={latestAlert.id}
        >
          <span>{alertLabel}</span>
          <strong>{latestAlert.actor}</strong>
          <p>{latestAlert.message}</p>
        </aside>
      ) : null}
    </>
  );
}
