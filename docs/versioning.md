# Versioning

## Channels

- `latest`: development and evaluation
- `v*` tags: production releases

## Production Recommendation

Pin exact versions in Compose.

Do not auto-track `latest` for a 24/7 production channel.

## Update Strategy

- use staged stable releases
- back up before upgrading
- verify readiness and ops state after every upgrade
- keep rollback instructions and the previous image tags available
