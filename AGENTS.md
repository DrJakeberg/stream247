# Agent Rules

- Read `AGENTS.md`, `PLANS.md`, `IMPLEMENT.md`, and `docs/full-product-reset-audit.md` before any non-trivial change.
- All non-trivial work must begin with plan review and milestone selection from `PLANS.md`.
- Changed behavior requires tests or a written justification in the summary.
- Docs must stay in sync with behavior.
- No new dependency may be added without a short reason in the summary.
- Do not stop after a partial implementation if the next safe step is obvious.
- Stop only for a hard blocker, or when `PLANS.md` has no incomplete milestone remaining.

## Hard Blocker

A hard blocker is only one of the following:

- missing secret or credential not available in repo
- missing external service or permission
- destructive migration with unclear safe path
- unresolved legal or licensing issue
- ambiguous product decision that cannot be inferred from upstream behavior or existing repo conventions

## Definition Of Done

- code complete
- tests updated
- `pnpm validate` passes
- any needed smoke checks are run
- docs updated
- summary written with changed files, risks, and follow-up items

## Workflow

- After completing a milestone, automatically continue with the next incomplete milestone when one exists in `PLANS.md`.
- Do not pause merely to summarize progress.
- Commit exactly one commit per completed milestone.
- Push the current branch after each successful milestone commit.
- Stop when `PLANS.md` has no incomplete milestone remaining, or when a hard blocker occurs.
- Release operations and DUT validation are not new milestone work unless `PLANS.md` says so explicitly.

## DUT Workflow

For DUT validation, never run the 24-hour soak locally.

Always use the DUT host over SSH.

Important:

- DUT deployment path and DUT repo path may differ.
- Deployment path contains the active `docker-compose.yml` and `stack.env`.
- Repo path contains `scripts/`, `docs/`, and tracked source files.
- Never assume the compose working directory contains the release scripts.

Current DUT paths:

- active deployment working directory: `/root/stream247/recovery-stack`
- active compose file: `/root/stream247/recovery-stack/docker-compose.yml`
- active runtime env file: `/root/stream247/recovery-stack/stack.env`
- persistent DUT data directories: `/root/stream247/{media,postgres,redis,logs}`

Rules:

- use the images already pinned in the active DUT `stack.env`
- do not overwrite DUT secrets or production values unless explicitly asked
- if `APP_URL` is externally routed and not locally reachable from the DUT host, use:
  `CHECK_BASE_URL=http://127.0.0.1:3000`
- start the soak in `tmux` on the DUT so it survives disconnects
- write soak output to a log file on the DUT
- after starting the soak, report:
  - tmux session name
  - log file path
  - exact command used
  - commands to reattach and inspect progress

Required DUT discovery order:

1. confirm the active deployment path exists
2. discover the DUT repo path that contains:
   - `scripts/upgrade-rehearsal.sh`
   - `scripts/soak-monitor.sh`
3. run scripts from the DUT repo path
4. target the active deployment path explicitly

Standard DUT checks:

- inspect active deployment:
  - `cd /root/stream247/recovery-stack && docker compose ps`
  - `cd /root/stream247/recovery-stack && docker compose logs --tail=200 web worker playout`
  - `cd /root/stream247/recovery-stack && grep -E '^(STREAM247_WEB_IMAGE|STREAM247_WORKER_IMAGE|STREAM247_PLAYOUT_IMAGE|APP_URL|TRAEFIK_HOST)=' stack.env`
- discover DUT repo path:
  - `find /root -maxdepth 5 -type f \( -name upgrade-rehearsal.sh -o -name soak-monitor.sh \) 2>/dev/null`

Rehearsal and soak:

- run `upgrade-rehearsal.sh` from the DUT repo path
- run `soak-monitor.sh` from the DUT repo path
- both must target the active deployment under `/root/stream247/recovery-stack`

Done means:

- soak is started successfully on DUT in `tmux`
- log file is being written
- latest readiness output is green
- operator gets exact follow-up commands
