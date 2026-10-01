"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TWITCH_METADATA_WAITING_MESSAGE } from "@stream247/core";

export type BroadcastChannelConnectionSummary = {
  mode: "identity" | "waiting-for-broadcaster" | "broadcaster";
  broadcastChannelLogin: string;
};

/**
 * What the broadcast-channel entry in the connection panel says.
 *
 * Null without a split: the connected account already owns the broadcast channel, and an entry
 * about a second connection would only raise the question of why it is missing. In the waiting
 * state the text still carries the whole story — which account must do the connecting and with
 * which scopes — because the connect button below it only helps someone who is signed in to
 * Twitch as that account; everyone else needs to know why their click will be rejected.
 */
export function getBroadcastChannelConnectionNotice(
  summary: BroadcastChannelConnectionSummary
): { title: string; detail: string } | null {
  if (summary.mode === "identity") {
    return null;
  }

  if (summary.mode === "broadcaster") {
    return {
      title: "Channel owner connected",
      detail: `Title, category and schedule sync to the broadcast channel ${summary.broadcastChannelLogin} through its own connection.`
    };
  }

  return {
    title: "Channel owner connection",
    detail:
      `${TWITCH_METADATA_WAITING_MESSAGE} Title, category and schedule of the broadcast channel ${summary.broadcastChannelLogin} stay untouched until ${summary.broadcastChannelLogin} itself connects (scopes channel:manage:broadcast and channel:manage:schedule, plus the read scopes for sub, cheer and channel-points alerts). Chat, moderation and emote-only already work through the bot account.`
  };
}

export function TwitchConnectPanel({
  authorizeUrl,
  broadcastChannel
}: {
  authorizeUrl: string | null;
  broadcastChannel?: BroadcastChannelConnectionSummary;
}) {
  const broadcastNotice = broadcastChannel ? getBroadcastChannelConnectionNotice(broadcastChannel) : null;

  if (!authorizeUrl) {
    return (
      <div className="item">
        <strong>Twitch OAuth not configured</strong>
        <div className="subtle">
          Save the public URL (setup step 2) and the Twitch app credentials (setup step 3) in <code>/setup</code>, or
          under Admin → Settings, to enable the browser-based Twitch connection.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="item">
        <strong>Twitch accounts</strong>
        <div className="subtle">
          Stream247 separates the broadcast channel (where the video goes and viewers watch) from the bot
          account it signs in as for chat and moderation; both are set under Admin → Settings → Twitch
          accounts. The button connects the bot account. For actual output the broadcast channel also needs its
          stream key: on the primary destination under Live → Status → Output destinations, or as
          <code> TWITCH_STREAM_KEY </code>
          (or the generic
          <code> STREAM_OUTPUT_URL </code>
          and
          <code> STREAM_OUTPUT_KEY </code>) in the environment.
        </div>
        <a className="button" href={authorizeUrl}>
          Connect bot account
        </a>
      </div>
      {broadcastNotice ? (
        <div className="item">
          <strong>{broadcastNotice.title}</strong>
          <div className="subtle">{broadcastNotice.detail}</div>
          {broadcastChannel?.mode === "waiting-for-broadcaster" ? (
            // A plain link, mirroring the identity connect above: the route mints the state
            // cookie on click. The link exists only in the waiting state, which is exactly "a
            // broadcast channel is configured and differs from the identity".
            <a className="button" href="/api/integrations/twitch/connect-broadcaster">
              Connect channel owner ({broadcastChannel.broadcastChannelLogin})
            </a>
          ) : null}
          {broadcastChannel?.mode === "broadcaster" ? <BroadcasterDisconnectButton /> : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Clears the broadcaster slot. Small and local to the panel: disconnecting flips metadata sync
 * back to its visible waiting state, so the refreshed panel immediately shows the connect button
 * again instead of leaving a stale "connected" entry.
 */
function BroadcasterDisconnectButton() {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div style={{ marginTop: 8 }}>
      <button
        className="button button-secondary"
        disabled={isPending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const response = await fetch("/api/integrations/twitch/disconnect-broadcaster", { method: "POST" });

            if (!response.ok) {
              const payload = (await response.json().catch(() => ({}))) as { message?: string };
              setError(payload.message ?? "Could not disconnect the channel owner.");
              return;
            }

            router.refresh();
          });
        }}
        type="button"
      >
        Disconnect channel owner
      </button>
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
