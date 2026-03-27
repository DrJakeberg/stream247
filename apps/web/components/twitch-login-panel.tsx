"use client";

export function TwitchLoginPanel({ authorizeUrl }: { authorizeUrl: string | null }) {
  return (
    <div className="item">
      <strong>Sign in with Twitch</strong>
      <div className="subtle">
        Team members sign in with Twitch and are admitted only if the streamer has granted access to their Twitch
        login in the admin UI.
      </div>
      {authorizeUrl ? (
        <a className="button" href={authorizeUrl}>
          Continue with Twitch
        </a>
      ) : (
        <div className="subtle">
          Configure <code>APP_URL</code>, <code>TWITCH_CLIENT_ID</code>, and <code>TWITCH_CLIENT_SECRET</code> first.
        </div>
      )}
    </div>
  );
}

