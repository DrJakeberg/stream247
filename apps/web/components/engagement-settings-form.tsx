"use client";

import type { EngagementOverlayPosition } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import type { EngagementSettingsRecord } from "@/lib/server/state";
import { humanizeOptionValue } from "@/lib/option-labels";

const positions: EngagementOverlayPosition[] = ["bottom-left", "bottom-right", "top-left", "top-right"];

export function EngagementSettingsForm({ engagement }: { engagement: EngagementSettingsRecord }) {
  const [chatEnabled, setChatEnabled] = useState(engagement.chatEnabled);
  const [alertsEnabled, setAlertsEnabled] = useState(engagement.alertsEnabled);
  const [donationsEnabled, setDonationsEnabled] = useState(engagement.donationsEnabled);
  const [channelPointsEnabled, setChannelPointsEnabled] = useState(engagement.channelPointsEnabled);
  const [gameEnabled, setGameEnabled] = useState(engagement.gameEnabled);
  const [soloModeEnabled, setSoloModeEnabled] = useState(engagement.soloModeEnabled);
  const [smallGroupModeEnabled, setSmallGroupModeEnabled] = useState(engagement.smallGroupModeEnabled);
  const [crowdModeEnabled, setCrowdModeEnabled] = useState(engagement.crowdModeEnabled);
  const [gameWindowMinutes, setGameWindowMinutes] = useState(String(engagement.gameWindowMinutes));
  const [chatPosition, setChatPosition] = useState(engagement.chatPosition);
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
        gameEnabled,
        soloModeEnabled,
        smallGroupModeEnabled,
        crowdModeEnabled,
        gameWindowMinutes,
        chatPosition,
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
          <div className="subtle">Configure the on-stream Twitch chat rail that renders inside the on-air overlay. The chat connection itself stays up for moderator check-ins, votes and the chat game whether or not the rail is shown.</div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="toggle-row">
              <input checked={chatEnabled} onChange={(event) => setChatEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Enable chat overlay<InfoTip text="Draws the live Twitch chat rail on the on-air picture. Off, the rail leaves the air; the Twitch chat connection itself is kept only while something else still needs it — moderation, chat interaction (votes, skips, requests) or a chat-game scene layer (snake, minesweeper). Also needs the “Chat on the stream” switch in admin settings, and the chatter-participation game below cannot run without it." /></span>
            </label>
            <label>
              <span className="label label-with-info">Chat position<InfoTip text="Corner of the picture the chat rail sits in and grows from: top corners grow downward, bottom corners upward. Until you place the chat panel yourself, its default box follows this corner too." /></span>
              <select onChange={(event) => setChatPosition(event.target.value as EngagementOverlayPosition)} value={chatPosition}>
                {positions.map((position) => (
                  <option key={position} value={position}>
                    {humanizeOptionValue(position)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label label-with-info">Max chat messages<InfoTip text="How many of the newest chat lines the rail shows at once, from 1 to 12. The panel itself never draws more than eight or more than fit its box, and a line ages off air five minutes after it was sent." /></span>
              <input max={12} min={1} onChange={(event) => setMaxMessages(event.target.value)} type="number" value={maxMessages} />
            </label>
            <label>
              <span className="label label-with-info">Rate limit per minute<InfoTip text="Caps how many chat lines reach the on-air rail and the event log in any sixty-second window; lines over the cap are dropped from both, but commands and votes are handled before the cap, so it never costs anyone a ballot. A saved change applies at the next chat reconnect (dropped connection or worker restart), not immediately." /></span>
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
            <label className="toggle-row">
              <input checked={alertsEnabled} onChange={(event) => setAlertsEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Enable follow and subscription alerts<InfoTip text="Subscribes the channel to Twitch follow and subscription notifications; each one is listed under Recent engagement events on the Overlays page, and nothing is drawn on the picture. Off, no alert subscriptions are kept at all, which also silences bits and channel-point alerts; the “Viewer alerts on the stream” switch in admin settings must be on too." /></span>
            </label>
            <label className="toggle-row">
              <input checked={donationsEnabled} onChange={(event) => setDonationsEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Enable bits / cheer alerts<InfoTip text="Adds Twitch cheer notifications to the alert subscriptions and to the event log. Only takes effect while follow and subscription alerts are on." /></span>
            </label>
            <label className="toggle-row">
              <input
                checked={channelPointsEnabled}
                onChange={(event) => setChannelPointsEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="label-with-info">Enable channel point redemption alerts<InfoTip text="Adds custom-reward redemption notifications to the alert subscriptions and to the event log. Only takes effect while follow and subscription alerts are on." /></span>
            </label>
          </div>
          <p className="subtle">
            These switches are still gated by the chat and alert feature switches in the admin settings, which
            fall back to the deployment environment when left on their default.
          </p>
          <p className="subtle">
            Bits and channel point alerts also require one Twitch reconnect after M32 so the broadcaster token includes the new scopes.
          </p>
        </div>

        <div className="item">
          <span className="label">Chatter-participation game</span>
          <div className="subtle">
            The game shares the Twitch IRC runtime with the chat rail. Keep the chat feature switch on and chat enabled when you want the mode selector to stay live.
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="toggle-row">
              <input checked={gameEnabled} onChange={(event) => setGameEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Enable chatter-participation game<InfoTip text="Picks a game mode (Solo, Small-group or Crowd) from how many people are chatting and records it; the current mode and active-chatter count appear under Game mode on the Overlays page, and nothing is drawn on air for it. Also needs the chat overlay on (including its “Chat on the stream” admin switch) and at least one mode enabled below; otherwise the Overlays page reports it disabled." /></span>
            </label>
            <label>
              <span className="label label-with-info">Active chatter window (minutes)<InfoTip text="How long after their last message a viewer still counts as an active chatter, from 1 to 30 minutes. That count picks the game mode and is also the room size a skip vote is measured against." /></span>
              <input
                max={30}
                min={1}
                onChange={(event) => setGameWindowMinutes(event.target.value)}
                type="number"
                value={gameWindowMinutes}
              />
            </label>
            <label className="toggle-row">
              <input checked={soloModeEnabled} onChange={(event) => setSoloModeEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Solo mode<InfoTip text="Allows Solo mode to be selected when only one chatter is active. Off, one chatter alone falls through to Small-group, then Crowd; with all three off no mode is selected. The mode is a status on the Overlays page, not a prompt shown to the chatter." /></span>
            </label>
            <label className="toggle-row">
              <input
                checked={smallGroupModeEnabled}
                onChange={(event) => setSmallGroupModeEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="label-with-info">Small-group mode<InfoTip text="Allows Small-group mode when two to nine chatters are active, or more when Crowd is off. Off, that range falls through to Solo, or to Crowd if Solo is off as well. The mode is a status on the Overlays page; no vote is put on air." /></span>
            </label>
            <label className="toggle-row">
              <input checked={crowdModeEnabled} onChange={(event) => setCrowdModeEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Crowd mode<InfoTip text="Allows Crowd mode once ten or more chatters are active. Off, a room that size falls through to Small-group, or to Solo if that is off as well. The mode is a status on the Overlays page; no prediction board is put on air." /></span>
            </label>
            <label>
              <span className="label label-with-info">Mode automation<InfoTip text="Chooses the mode from the active chatter count on its own, re-checked every thirty seconds with the worker cycle. A switch waits until the count has kept pointing at the new mode for about thirty seconds (the count itself may keep moving), so it lands half a minute to a minute after the room changes; a mode coming on from none takes effect at the next check. The chosen mode is recorded and shown under Game mode on the Overlays page." /></span>
              <div className="subtle">Solo handles one chatter, Small-group handles 2-9, Crowd takes over at 10+. Switching lags slightly behind the numbers on purpose, so a mode does not flicker while people join and leave.</div>
            </label>
          </div>
          <div className="subtle">Disable any mode you do not want auto-selected. If chat goes quiet or every mode is disabled, the game widget stays off-air.</div>
        </div>
      </div>

      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} title="Save the current engagement settings." type="submit">
        {isPending ? "Saving..." : "Save engagement settings"}
      </button>
    </form>
  );
}
