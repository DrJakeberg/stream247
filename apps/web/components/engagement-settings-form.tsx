"use client";

import type { EngagementChatDisplayMode, EngagementOverlayPosition, EngagementOverlayStyle } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EngagementSettingsRecord } from "@/lib/server/state";

const chatModes: EngagementChatDisplayMode[] = ["quiet", "active", "flood"];
const positions: EngagementOverlayPosition[] = ["bottom-left", "bottom-right", "top-left", "top-right"];
const styles: EngagementOverlayStyle[] = ["compact", "card"];

export function EngagementSettingsForm({ engagement }: { engagement: EngagementSettingsRecord }) {
  const [chatEnabled, setChatEnabled] = useState(engagement.chatEnabled);
  const [alertsEnabled, setAlertsEnabled] = useState(engagement.alertsEnabled);
  const [chatMode, setChatMode] = useState(engagement.chatMode);
  const [chatPosition, setChatPosition] = useState(engagement.chatPosition);
  const [alertPosition, setAlertPosition] = useState(engagement.alertPosition);
  const [style, setStyle] = useState(engagement.style);
  const [maxMessages, setMaxMessages] = useState(String(engagement.maxMessages));
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(String(engagement.rateLimitPerMinute));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function save() {
    const response = await fetch("/api/overlay/engagement", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatEnabled,
        alertsEnabled,
        chatMode,
        chatPosition,
        alertPosition,
        style,
        maxMessages,
        rateLimitPerMinute
      })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update engagement overlay settings.");
      return;
    }

    setMessage(payload.message ?? "Engagement overlay settings updated.");
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");
        startTransition(() => void save());
      }}
    >
      <label className="checkbox-row">
        <input checked={chatEnabled} onChange={(event) => setChatEnabled(event.target.checked)} type="checkbox" />
        <span>Enable chat overlay</span>
      </label>
      <label className="checkbox-row">
        <input checked={alertsEnabled} onChange={(event) => setAlertsEnabled(event.target.checked)} type="checkbox" />
        <span>Enable follow and subscription alerts</span>
      </label>

      <div className="form-grid">
        <label>
          <span className="label">Chat mode</span>
          <select onChange={(event) => setChatMode(event.target.value as EngagementChatDisplayMode)} value={chatMode}>
            {chatModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Chat position</span>
          <select onChange={(event) => setChatPosition(event.target.value as EngagementOverlayPosition)} value={chatPosition}>
            {positions.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Alert position</span>
          <select onChange={(event) => setAlertPosition(event.target.value as EngagementOverlayPosition)} value={alertPosition}>
            {positions.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Style</span>
          <select onChange={(event) => setStyle(event.target.value as EngagementOverlayStyle)} value={style}>
            {styles.map((nextStyle) => (
              <option key={nextStyle} value={nextStyle}>
                {nextStyle}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Max chat messages</span>
          <input max={12} min={1} onChange={(event) => setMaxMessages(event.target.value)} type="number" value={maxMessages} />
        </label>
        <label>
          <span className="label">Rate limit per minute</span>
          <input
            max={120}
            min={1}
            onChange={(event) => setRateLimitPerMinute(event.target.value)}
            type="number"
            value={rateLimitPerMinute}
          />
        </label>
      </div>

      <p className="subtle">
        These switches are still gated by deployment flags. Set `STREAM_CHAT_OVERLAY_ENABLED=1` and
        `STREAM_ALERTS_ENABLED=1` before enabling them on a live channel.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save engagement settings"}
      </button>
    </form>
  );
}
