export const dynamic = "force-dynamic";

import {
  isEngagementAlertsRuntimeEnabled,
  isEngagementChannelPointsRuntimeEnabled,
  isEngagementChatRuntimeEnabled,
  isEngagementDonationAlertsRuntimeEnabled
} from "@stream247/core";
import { AdminPageHeader } from "@/components/admin-page-header";
import { EngagementSettingsForm } from "@/components/engagement-settings-form";
import { Panel } from "@/components/panel";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";

export default async function OverlaysPage() {
  const state = await readAppState();
  const engagement = getBroadcastSnapshot(state).engagement;
  const chatRuntimeEnabled = isEngagementChatRuntimeEnabled(state.engagement, process.env);
  const alertsRuntimeEnabled = isEngagementAlertsRuntimeEnabled(state.engagement, process.env);
  const donationsRuntimeEnabled = isEngagementDonationAlertsRuntimeEnabled(state.engagement, process.env);
  const channelPointsRuntimeEnabled = isEngagementChannelPointsRuntimeEnabled(state.engagement, process.env);

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Control the live chat and Twitch alert layers that are composited into the stream overlay."
        eyebrow="Engagement"
        title="Manage in-stream engagement."
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
                {chatRuntimeEnabled ? `Runtime enabled, IRC ${engagement.chatStatus}.` : "Disabled by settings or STREAM_CHAT_OVERLAY_ENABLED."}
              </div>
            </div>
            <div className="item">
              <strong>Follow/sub alerts</strong>
              <div className="subtle">
                {alertsRuntimeEnabled ? "Runtime enabled. EventSub notifications will render as timed alerts." : "Disabled by settings or STREAM_ALERTS_ENABLED."}
              </div>
            </div>
            <div className="item">
              <strong>Bits / cheer alerts</strong>
              <div className="subtle">
                {donationsRuntimeEnabled
                  ? "Runtime enabled. Cheer EventSub notifications will render as timed alerts."
                  : "Disabled by settings, STREAM_ALERTS_ENABLED, or missing the post-M32 Twitch reconnect."}
              </div>
            </div>
            <div className="item">
              <strong>Channel point alerts</strong>
              <div className="subtle">
                {channelPointsRuntimeEnabled
                  ? "Runtime enabled. Redemption EventSub notifications will render as timed alerts when a custom reward exists."
                  : "Disabled by settings, STREAM_ALERTS_ENABLED, or missing the post-M32 Twitch reconnect."}
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
              <strong>Twitch reconnect note</strong>
              <div className="subtle">
                Broadcasters connected before M32 must reconnect Twitch once so bits and channel point alert scopes are granted.
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
