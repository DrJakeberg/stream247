# Backup And Restore

## What To Back Up

- PostgreSQL database
- `.env`
- `data/media`

Redis is not a primary durability source and does not need to be treated as a release-critical backup target.

## Before Every Upgrade

Create a PostgreSQL dump and copy `.env`.

Minimum expectation:

- database backup exists
- current image tags are known
- media library is preserved

## Restore Flow

1. Stop the stack.
2. Restore `.env`.
3. Restore the PostgreSQL dump.
4. Restore `data/media` if needed.
5. Start the previously known-good image tags.
6. Confirm:
   - setup is not shown again
   - `/api/system/readiness` returns expected service states
   - `/dashboard` and `/ops` show the prior runtime state
