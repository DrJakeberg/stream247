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
      title: "Broadcast channel connected",
      detail: `Title, category and schedule sync to ${summary.broadcastChannelLogin} through the broadcaster account's own connection.`
    };
  }

  return {
    title: "Connect broadcast channel",
    detail:
      `${TWITCH_METADATA_WAITING_MESSAGE} Title, category and schedule for ${summary.broadcastChannelLogin} stay untouched until the broadcaster account itself is connected with the channel:manage:broadcast and channel:manage:schedule scopes. Chat, moderation and emote-only already work through the connected account.`
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
          Set <code>APP_URL</code> and provide Twitch client credentials in <code>.env</code> or the admin settings
          page to enable browser-based Twitch connection.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="item">
        <strong>Connect Twitch</strong>
        <div className="subtle">
          Launch the Twitch OAuth flow from the browser-based setup. For actual output, also set
          <code> TWITCH_RTMP_URL </code>
          and
          <code> TWITCH_STREAM_KEY </code>
          or the generic
          <code> STREAM_OUTPUT_URL </code>
          and
          <code> STREAM_OUTPUT_KEY </code>.
        </div>
        <a className="button" href={authorizeUrl}>
          Connect Twitch
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
              Connect broadcast channel
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
              setError(payload.message ?? "Could not disconnect the broadcast channel.");
              return;
            }

            router.refresh();
          });
        }}
        type="button"
      >
        Disconnect broadcast channel
      </button>
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
