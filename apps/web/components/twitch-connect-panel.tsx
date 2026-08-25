"use client";

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
 * state the text has to carry the whole story, because the connect flow itself cannot run until
 * the broadcaster account is accessible again — the entry is the explanation of what is waiting,
 * on which account, and with which scopes, not a working button.
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
        </div>
      ) : null}
    </>
  );
}
