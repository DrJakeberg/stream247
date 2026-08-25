export const dynamic = "force-dynamic";

import {
  isEngagementAlertsRuntimeEnabled,
  isEngagementChannelPointsRuntimeEnabled,
  isEngagementChatRuntimeEnabled,
  isEngagementDonationAlertsRuntimeEnabled
} from "@stream247/core";
import { AdminPageHeader } from "@/components/admin-page-header";
import { ChatGameSettingsForm } from "@/components/chat-game-settings-form";
import { EngagementSettingsForm } from "@/components/engagement-settings-form";
import { ViewerControlForm } from "@/components/viewer-control-form";
import { Panel } from "@/components/panel";
import {
  readChatGameRuntimeRecord,
  readChatGameSettingsRecord,
  readChatInteractionSettingsRecord,
  readChatVoteSessionRecord
} from "@stream247/db";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";

export default async function OverlaysPage() {
  const state = await readAppState();
  const engagement = getBroadcastSnapshot(state).engagement;
  const [viewerControl, activeVote, chatGame, chatGameRuntime] = await Promise.all([
    readChatInteractionSettingsRecord(),
    readChatVoteSessionRecord(),
    readChatGameSettingsRecord(),
    readChatGameRuntimeRecord()
  ]);
  const gameLayerEnabled = state.overlay.customLayers.some((layer) => layer.kind === "game" && layer.enabled);
  const chatRuntimeEnabled = isEngagementChatRuntimeEnabled(state.engagement, process.env, state.managedConfig);
  const alertsRuntimeEnabled = isEngagementAlertsRuntimeEnabled(state.engagement, process.env, state.managedConfig);
  const donationsRuntimeEnabled = isEngagementDonationAlertsRuntimeEnabled(state.engagement, process.env, state.managedConfig);
  const channelPointsRuntimeEnabled = isEngagementChannelPointsRuntimeEnabled(state.engagement, process.env, state.managedConfig);

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Control the live chat rail, Twitch alert types, and the chatter-participation game that all render through the same captured overlay."
        eyebrow="Engagement"
        title="Manage in-stream engagement from one tab."
      />

      <div className="grid two">
        <Panel title="Engagement controls" eyebrow="Chat and alerts">
          <EngagementSettingsForm engagement={state.engagement} />
        </Panel>

        <Panel title="Runtime state" eyebrow="Live status">
          <div className="list">
            <div className="item">
              <strong>Chat overlay</strong>
              <div className="subtle">
                {chatRuntimeEnabled ? `Runtime enabled, IRC ${engagement.chatStatus}.` : "Disabled by settings or by the chat feature switch in the admin settings."}
              </div>
            </div>
            <div className="item">
              <strong>Follow/sub alerts</strong>
              <div className="subtle">
                {alertsRuntimeEnabled ? "Runtime enabled. EventSub notifications will render as timed alerts." : "Disabled by settings or by the alerts feature switch in the admin settings."}
              </div>
            </div>
            <div className="item">
              <strong>Bits / cheer alerts</strong>
              <div className="subtle">
                {donationsRuntimeEnabled
                  ? "Runtime enabled. Cheer EventSub notifications will render as timed alerts."
                  : "Disabled by settings, by the alerts feature switch, or missing the post-M32 Twitch reconnect."}
              </div>
            </div>
            <div className="item">
              <strong>Channel point alerts</strong>
              <div className="subtle">
                {channelPointsRuntimeEnabled
                  ? "Runtime enabled. Redemption EventSub notifications will render as timed alerts when a custom reward exists."
                  : "Disabled by settings, by the alerts feature switch, or missing the post-M32 Twitch reconnect."}
              </div>
            </div>
            <div className="item">
              <strong>Recent engagement events</strong>
              <div className="subtle">
                {engagement.recentEvents.length > 0
                  ? engagement.recentEvents
                      .slice(0, 6)
                      .map((event) => `${event.kind}: ${event.actor || "Viewer"} ${event.message ? `- ${event.message}` : ""}`)
                      .join(" · ")
                  : "No recent chat or alert events."}
              </div>
            </div>
            <div className="item">
              <strong>Game mode</strong>
              <div className="subtle">
                {engagement.game.runtimeEnabled && engagement.game.mode
                  ? `${engagement.game.title} is live with ${engagement.game.activeChatterCount} active chatters in the last ${engagement.game.windowMinutes} minutes.`
                  : "Disabled by settings, disabled chat runtime, or no active chatters in the current window."}
              </div>
            </div>
            <div className="item">
              <strong>Twitch reconnect note</strong>
              <div className="subtle">
                Broadcasters connected before M32 must reconnect Twitch once so bits and channel point alert scopes are granted.
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Viewer control" eyebrow="Chat steers the programme">
        <div className="subtle" style={{ marginBottom: 12 }}>
          {viewerControl.enabled
            ? activeVote.status === "open"
              ? `A poll is live with ${String(activeVote.options.reduce((sum, option) => sum + option.votes, 0))} votes from ${String(Object.keys(activeVote.ballots).length)} viewers.`
              : "Enabled. A poll opens once per programme item."
            : "Disabled. Chat cannot influence the running order."}
        </div>
        <ViewerControlForm settings={viewerControl} />
      </Panel>

      <Panel title="Chat game" eyebrow="Chat plays on air">
        <div className="subtle" style={{ marginBottom: 12 }}>
          {gameLayerEnabled
            ? chatGameRuntime.gameId
              ? "A round is running. The board renders in every scene whose Chat Game layer is enabled."
              : "The Chat Game layer is enabled; the worker starts a round on its next cycle."
            : "No scene has an enabled Chat Game layer. Add one in Scene Studio to put the game on air."}
        </div>
        {!chatRuntimeEnabled ? (
          <div className="subtle" style={{ marginBottom: 12 }}>
            The game reads its emotes through the same Twitch IRC runtime as the chat rail, which is currently
            disabled. Enable chat in the engagement controls and turn on the chat feature switch in the admin
            settings so inputs can arrive; the on-screen chat rail itself can stay hidden.
          </div>
        ) : null}
        <ChatGameSettingsForm chatGame={chatGame} />
      </Panel>
    </div>
  );
}
