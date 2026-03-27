"use client";

export function TwitchConnectPanel({ authorizeUrl }: { authorizeUrl: string | null }) {
  if (!authorizeUrl) {
    return (
      <div className="item">
        <strong>Twitch OAuth not configured</strong>
        <div className="subtle">
          Set <code>APP_URL</code>, <code>TWITCH_CLIENT_ID</code>, and <code>TWITCH_CLIENT_SECRET</code> to enable
          browser-based Twitch connection.
        </div>
      </div>
    );
  }

  return (
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
  );
}
