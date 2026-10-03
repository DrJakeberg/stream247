"use client";

/** What keeps team sign-in with Twitch off, in the order the setup wizard asks for it. */
export type TwitchLoginBlocker = "credentials" | "app-url" | null;

export function TwitchLoginPanel({ authorizeUrl, blocker = null }: { authorizeUrl: string | null; blocker?: TwitchLoginBlocker }) {
  // Read to the end (M91, I8): these sentences are instructions, and the two-line clamp of `.item .subtle`
  // cut them mid-sentence. `.login-hints` lifts it.
  return (
    <div className="item login-hints">
      <strong>Sign in with Twitch</strong>
      <div className="subtle">
        Team members sign in with Twitch and are admitted only if the streamer has granted access to their Twitch
        login in the admin UI.
      </div>
      {authorizeUrl ? (
        <a className="button" href={authorizeUrl}>
          Continue with Twitch
        </a>
      ) : blocker === "app-url" ? (
        <div className="subtle">
          Not available yet: the public app URL is not set. The owner sets it in{" "}
          <a href="/setup?step=instance">setup step 2, Instance basics</a>.
        </div>
      ) : (
        <div className="subtle">
          Not available yet: the Twitch app credentials are not saved. The owner saves them in{" "}
          <a href="/setup?step=twitch-app">setup step 3, Twitch app credentials</a>.
        </div>
      )}
    </div>
  );
}
