# Twitch Setup

## What Twitch Is Used For

Stream247 currently uses Twitch for:

- broadcaster OAuth connection
- team SSO sign-in
- title sync from the active schedule block
- category sync from the active schedule block
- upcoming Twitch schedule segment sync
- moderation automation such as emote-only fallback windows
- RTMP output when streaming to Twitch

## Required Redirect URLs

Both redirect URLs must be registered on the same Twitch application:

- `<APP_URL>/api/integrations/twitch/callback`
- `<APP_URL>/api/auth/twitch/callback`

`APP_URL` must exactly match the externally reachable base URL of your Stream247 deployment.

## How To Get Client ID And Secret

1. Sign in to the Twitch developer console.
2. Create a new application or edit the application you want Stream247 to use.
3. Add both redirect URLs:
   - `<APP_URL>/api/integrations/twitch/callback`
   - `<APP_URL>/api/auth/twitch/callback`
4. Copy the Client ID into `TWITCH_CLIENT_ID`.
5. Generate, reveal, or regenerate the Client Secret and store it in `TWITCH_CLIENT_SECRET`.
6. Restart the stack after updating `.env`.
7. Open the Stream247 dashboard and complete:
   - `Connect Twitch` for the broadcaster connection
   - `Sign in with Twitch` for team members

## Why These Stay In `.env`

- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are application credentials, not per-user preferences.
- Stream247 currently stores deployment-time secrets in `.env`.
- Runtime state such as moderation policy, schedule blocks, incidents, and overlay settings is stored in PostgreSQL instead.
- Encrypted secret management from the admin UI is still planned, not implemented.

## Broadcaster Connect

The broadcaster connection is used for:

- title sync
- category sync
- Twitch schedule segment sync
- moderation/chat settings automation

If broadcaster connect is missing or invalid:

- the app still boots
- scheduling still works internally
- Twitch sync creates incidents instead of silently failing

## Team Access And Twitch SSO

- the owner or an admin grants access by Twitch login in the admin UI
- team members then sign in with Twitch SSO
- supported roles are:
  - `owner`
  - `admin`
  - `operator`
  - `moderator`
  - `viewer`

The broadcaster account can effectively act as workspace owner when it matches the connected broadcaster identity and the workspace owner role.

## RTMP Output

For Twitch RTMP output, configure:

- `TWITCH_STREAM_KEY`
- optionally `TWITCH_RTMP_URL`

Default Twitch RTMP URL:

- `rtmp://live.twitch.tv/app`

Generic output overrides also work:

- `STREAM_OUTPUT_URL`
- `STREAM_OUTPUT_KEY`

## Moderator Presence

If enabled, moderators can check in with commands such as `here 30`.

That creates an explicit moderator presence window. While such a window is active, Stream247 can keep chat out of emote-only mode. When the window expires, Stream247 can return to the configured fallback moderation mode.

## Current Limitations

- client credentials are not yet entered and encrypted through the setup wizard
- Twitch integration is Twitch-first, not multi-destination
- overlay is not yet a native Twitch-scene/plans system; it is a browser-source overlay page
