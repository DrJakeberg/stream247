# Twitch Setup

## What Twitch Is Used For

Stream247 currently uses Twitch for:

- broadcaster OAuth connection
- team SSO sign-in
- title sync from the active schedule block, the current video, or the video's current chapter
- category sync from the active schedule block, the current video, or the video's current chapter
  (chapters switch category and title at offsets inside one video, throttled to one channel write
  per 30 seconds)
- upcoming Twitch schedule segment sync
- moderation automation such as emote-only fallback windows
- RTMP output when streaming to Twitch

## Required Redirect URLs

Both redirect URLs must be registered on the same Twitch application:

- `<APP_URL>/api/integrations/twitch/callback`
- `<APP_URL>/api/auth/twitch/callback`

`<APP_URL>` here means the public base URL of your deployment — either the `APP_URL` env variable
or, since M52, the public URL saved in the `/setup` wizard (env wins when both are set). It must
exactly match the externally reachable base URL; the wizard's Twitch-credentials step displays the
two exact URLs to register.

## How To Get Client ID And Secret

1. Sign in to the Twitch developer console.
2. Create a new application or edit the application you want Stream247 to use.
3. Add both redirect URLs:
   - `<APP_URL>/api/integrations/twitch/callback`
   - `<APP_URL>/api/auth/twitch/callback`
4. Copy the Client ID into `TWITCH_CLIENT_ID`.
5. Generate, reveal, or regenerate the Client Secret and store it in `TWITCH_CLIENT_SECRET`.
6. Choose one of these storage paths:
   - put both values in `.env`
   - enter them during `/setup`
   - save them later in `/settings`
7. Restart the stack only if you changed `.env`.
8. Open `Live → Status` in the admin UI and complete:
   - `Connect Twitch` for the broadcaster connection
   - `Sign in with Twitch` for team members

## Where These Credentials Live

- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are application credentials, not per-user preferences.
- Stream247 can now store them encrypted at rest in PostgreSQL through the admin UI.
- `.env` still works as a bootstrap/fallback source for self-hosted deployments.
- Runtime state such as moderation policy, schedule blocks, incidents, and overlay settings is stored in PostgreSQL instead.

Current behavior:

- setup can optionally capture Twitch client id and secret
- `/settings` can rotate them later
- blank secret fields keep the stored value instead of wiping it
- `.env` values are used only when no managed value exists

## Broadcast Channel

The channel the stream key sends video to does not have to be the connected account's own channel —
a common arrangement is a moderator account connected while the video goes to the broadcaster's
channel. The broadcast channel login lives in `Settings → Managed credentials` (or
`TWITCH_BROADCAST_CHANNEL_LOGIN` as env fallback). Empty means "same as the connected account",
which is the previous behaviour and the rollback path.

With a broadcast channel configured:

- chat joins the broadcast channel, authenticated as the connected account
- emote-only automation targets the broadcast channel as a moderator action
- live status, viewer count and the public watch link follow the broadcast channel
- title, category and schedule sync **wait** — they need the broadcaster account's own connection
  (scopes `channel:manage:broadcast` and `channel:manage:schedule`) and report
  "waiting for broadcast channel connection" as an info incident and on the dashboard until then;
  no metadata write ever targets the connected account's channel while waiting

The dashboard's waiting entry doubles as the connect affordance: `Connect broadcast channel`
starts a dedicated OAuth flow (`/api/integrations/twitch/connect-broadcaster`) that requests only
`channel:manage:broadcast` and `channel:manage:schedule`. The click must happen while signed in
to Twitch as the broadcast channel's own account — the callback verifies the authorised login
against the configured broadcast channel (case-insensitive) and rejects anything else, most
importantly the identity account, without storing a token. On success metadata sync flips on
within the next worker cycle, no restart needed; `Disconnect broadcast channel` clears the slot
and returns the sync to its visible waiting state.

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

If enabled, moderators can check in with commands such as `!here 30`.

That creates an explicit moderation presence window. While such a window is active, Stream247 can keep chat out of emote-only mode. When the window expires, Stream247 can return to the configured fallback moderation mode.

## Current Limitations

- Twitch integration is Twitch-first, not multi-destination
- overlay is not yet a native Twitch-scene/plans system; it remains Stream247's own on-air overlay, drawn by the playout renderer
