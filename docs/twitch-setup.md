# Twitch Setup

## OAuth Configuration

- `APP_URL` must match the URL that Twitch redirects back to.
- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` must be configured in the environment.
- The Twitch application redirect URL should point to `/api/integrations/twitch/callback`.

## Planned API Usage

- Channel metadata updates
- Stream schedule sync
- Chat settings updates for emote-only mode

## Moderator Presence

If enabled, moderators can check in with `here 30` or a configured variant.
The system treats this as an explicit presence window and can disable emote-only mode until the window expires.
