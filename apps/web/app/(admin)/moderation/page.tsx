import { Panel } from "@/components/panel";
import { moderationState } from "@/lib/mock-data";

export default function ModerationPage() {
  const { config, latestCheckIn, status } = moderationState;

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
              ? `${latestCheckIn.actor} until ${latestCheckIn.expiresAt.toISOString()}`
              : "No active moderator window"}
          </div>
        </div>
      </div>
    </Panel>
  );
}

