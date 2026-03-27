export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { ModerationSettingsForm } from "@/components/moderation-settings-form";
import { PresenceCheckInForm } from "@/components/presence-checkin-form";
import { getActivePresenceWindows, getPresenceStatus, readAppState } from "@/lib/server/state";

export default async function ModerationPage() {
  const state = await readAppState();
  const status = getPresenceStatus(state);
  const activeWindows = getActivePresenceWindows(state);
  const latestCheckIn = activeWindows[0];
  const { moderation: config } = state;

  return (
    <Panel title="Moderator presence policy" eyebrow="Moderation">
      <p className="subtle">
        This policy allows a moderator to check in with a command such as{" "}
        <code>
          {config.requirePrefix ? "!" : ""}
          {config.command} 30
        </code>{" "}
        to keep chat out of emote-only mode for a limited window.
      </p>
      <div className="list">
        <div className="item">
          <strong>Feature state</strong>
          <div className="subtle">{config.enabled ? "Enabled" : "Disabled"}</div>
        </div>
        <div className="item">
          <strong>Current chat mode</strong>
          <div className="subtle">{status.chatMode}</div>
          <div className="subtle">{status.summary}</div>
        </div>
        <div className="item">
          <strong>Latest check-in</strong>
          <div className="subtle">
            {latestCheckIn
              ? `${latestCheckIn.actor} until ${latestCheckIn.expiresAt}`
              : "No active moderator window"}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <PresenceCheckInForm />
      </div>
      <div style={{ marginTop: 20 }}>
        <ModerationSettingsForm config={config} />
      </div>
    </Panel>
  );
}
