# Moderation Policies

## Moderation Presence

Admins can enable a policy that keeps chat in emote-only mode when no moderation presence is considered active.

Supported controls:

- enable or disable the feature
- set the command keyword
- require a prefix such as `!`
- set minimum, default, and maximum minutes
- decide whether expiry re-enables emote-only mode
- allow only broadcaster or moderator check-ins

When the feature is enabled, moderation presence is treated as a timed check-in window. Active and recent entries are visible on the Moderation page, and the Live header shows a presence chip while a window is active.

## Default Example

- command: `here`
- input: `!here 30`
- result: moderation presence valid for 30 minutes

## Clamp Rules

- `!here` with no minutes uses the configured default
- `!here N` below the minimum clamps up to the minimum
- `!here N` above the maximum clamps down to the maximum
- the applied value, not the raw requested value, is the active moderation presence window

## Chat Reply Examples

The bot answers in the channel language (`docs/operations.md`, *What Viewers Read: The Channel
Language*). These are the English replies; on a channel set to German the first one reads
`Anwesenheitsfenster auf 30 Min. gesetzt`.

- accepted: `presence window set to 30 min`
- defaulted: `received !here, default is 30; window set to 30 min`
- minimum clamp: `received !here 5, minimum is 10; window set to 10 min`
- maximum clamp: `received !here 9999, maximum is 60; window set to 60 min`
