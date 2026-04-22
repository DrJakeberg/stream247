"use client";

import type { EngagementChatDisplayMode, EngagementOverlayPosition, EngagementOverlayStyle } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import type { EngagementSettingsRecord } from "@/lib/server/state";

const chatModes: EngagementChatDisplayMode[] = ["quiet", "active", "flood"];
const positions: EngagementOverlayPosition[] = ["bottom-left", "bottom-right", "top-left", "top-right"];
const styles: EngagementOverlayStyle[] = ["compact", "card"];

export function EngagementSettingsForm({ engagement }: { engagement: EngagementSettingsRecord }) {
  const [chatEnabled, setChatEnabled] = useState(engagement.chatEnabled);
  const [alertsEnabled, setAlertsEnabled] = useState(engagement.alertsEnabled);
  const [donationsEnabled, setDonationsEnabled] = useState(engagement.donationsEnabled);
  const [channelPointsEnabled, setChannelPointsEnabled] = useState(engagement.channelPointsEnabled);
  const [chatMode, setChatMode] = useState(engagement.chatMode);
  const [chatPosition, setChatPosition] = useState(engagement.chatPosition);
  const [alertPosition, setAlertPosition] = useState(engagement.alertPosition);
  const [style, setStyle] = useState(engagement.style);
  const [maxMessages, setMaxMessages] = useState(String(engagement.maxMessages));
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(String(engagement.rateLimitPerMinute));
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();

  async function save() {
    const response = await fetch("/api/overlay/engagement", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatEnabled,
        alertsEnabled,
        donationsEnabled,
        channelPointsEnabled,
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
      const nextError = payload.message ?? "Could not update engagement overlay settings.";
      setError(nextError);
      pushToast({
        title: "Could not save engagement settings",
        description: nextError,
        tone: "error"
      });
      return;
    }

    pushToast({
      title: "Engagement settings saved",
      description: payload.message ?? "Chat and alert settings are updated.",
      tone: "success"
    });
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(() => void save());
      }}
    >
      <div className="list">
        <div className="item">
          <span className="label">Chat overlay</span>
          <div className="subtle">Configure the on-stream Twitch chat rail that renders inside the captured overlay.</div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="checkbox-row">
              <input checked={chatEnabled} onChange={(event) => setChatEnabled(event.target.checked)} type="checkbox" />
              <span>Enable chat overlay</span>
            </label>
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
        </div>

        <div className="item">
          <span className="label">Alert types</span>
          <div className="subtle">Follow, subscription, cheer, and channel-point alerts all render through the same internal overlay path.</div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="checkbox-row">
              <input checked={alertsEnabled} onChange={(event) => setAlertsEnabled(event.target.checked)} type="checkbox" />
              <span>Enable follow and subscription alerts</span>
            </label>
            <label className="checkbox-row">
              <input checked={donationsEnabled} onChange={(event) => setDonationsEnabled(event.target.checked)} type="checkbox" />
              <span>Enable bits / cheer alerts</span>
            </label>
            <label className="checkbox-row">
              <input
                checked={channelPointsEnabled}
                onChange={(event) => setChannelPointsEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>Enable channel point redemption alerts</span>
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
          </div>
          <p className="subtle">
            These switches are still gated by deployment flags. Set `STREAM_CHAT_OVERLAY_ENABLED=1` and
            `STREAM_ALERTS_ENABLED=1` before enabling them on a live channel.
          </p>
          <p className="subtle">
            Bits and channel point alerts also require one Twitch reconnect after M32 so the broadcaster token includes the new scopes.
          </p>
        </div>

        <div className="item">
          <span className="label">Chatter-participation game</span>
          <div className="subtle">
            Mode automation ships in M47. This section locks the intended Studio surface now so operators stop hunting for a second engagement page later.
          </div>
          <fieldset className="form-grid" disabled style={{ marginTop: 12 }}>
            <label>
              <span className="label">Automatic mode</span>
              <select defaultValue="solo">
                <option value="solo">Solo mode</option>
                <option value="small-group">Small-group mode</option>
                <option value="crowd">Crowd mode</option>
              </select>
            </label>
            <label>
              <span className="label">Active chatter window (minutes)</span>
              <input defaultValue="5" min={1} type="number" />
            </label>
            <label>
              <span className="label">Small-group threshold</span>
              <input defaultValue="2" min={1} type="number" />
            </label>
            <label>
              <span className="label">Crowd threshold</span>
              <input defaultValue="10" min={2} type="number" />
            </label>
          </fieldset>
          <div className="subtle">Solo mode, Small-group mode, and Crowd mode become live once M47 adds runtime state and overlay widgets.</div>
        </div>
      </div>

      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} title="Save the current engagement settings." type="submit">
        {isPending ? "Saving..." : "Save engagement settings"}
      </button>
    </form>
  );
}
