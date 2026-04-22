export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { ModerationSettingsForm } from "@/components/moderation-settings-form";
import { PresenceCheckInForm } from "@/components/presence-checkin-form";
import { getActivePresenceWindows, getPresenceStatus, getRecentPresenceWindows, readAppState } from "@/lib/server/state";

function formatRequestedMinutes(value: number | null | undefined) {
  return value === null || value === undefined ? "default" : `${value} min`;
}

function formatClampReason(value: string | undefined) {
  if (value === "minimum") {
    return "Clamped to minimum";
  }
  if (value === "maximum") {
    return "Clamped to maximum";
  }
  if (value === "default") {
    return "Default applied";
  }
  return "Accepted as requested";
}

export default async function ModerationPage() {
  const state = await readAppState();
  const status = getPresenceStatus(state);
  const activeWindows = getActivePresenceWindows(state);
  const recentWindows = getRecentPresenceWindows(state, 12);
  const latestCheckIn = activeWindows[0];
  const { moderation: config } = state;

  return (
    <Panel title="Moderation presence policy" eyebrow="Moderation">
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
              : "No active moderation presence"}
          </div>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Actor</th>
              <th>Requested</th>
              <th>Applied</th>
              <th>Clamp reason</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {recentWindows.length > 0 ? (
              recentWindows.map((window) => (
                <tr key={window.expiresAt}>
                  <td>{window.actor}</td>
                  <td>{formatRequestedMinutes(window.requestedMinutes)}</td>
                  <td>{window.appliedMinutes ?? window.minutes} min</td>
                  <td>{formatClampReason(window.clampReason)}</td>
                  <td>{window.expiresAt}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="subtle" colSpan={5}>
                  No moderation presence entries have been recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
