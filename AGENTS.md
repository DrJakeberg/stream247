# Agent Rules

The only rule file for every session, local or cloud. `PLANS.md` says what to build; history up to M83
is in `planning/archive/`. If a brief, a plan or another file disagrees with this file, this file wins
unless the owner says otherwise in the brief; name the conflict in the report.

## Start of a session

- Read this file and `PLANS.md`, both in full. Read an archive file only where a milestone points to it.
- Work on exactly the milestone your brief names (or, without a brief, one row of "Open" in `PLANS.md`).
  Restate its acceptance before changing code.
- A session implements its own milestone and stops there. It never continues with the next open
  milestone, however obvious the next step looks; the owner starts the next one.
- Never start a milestone under "Owner-gated and deferred" in `PLANS.md`: M66 (Live Bridge rehearsal) and
  the soak part of M57 never without the owner; M77 and M81 only on the owner's word.

## Communication with the owner

- Reports are in German, short, result first, then the evidence: the command and the decisive line of
  its output, or `path:line`. At the end: what is done, what is open, what you need from the owner.
- Never guess a result you could not measure; say what was not checked and why. Product decisions
  belong to the owner: ask, with your recommendation for each question.
- Repository content (code, docs, `PLANS.md`, commit messages) is in English (`CONTRIBUTING.md`).

## Scope and quality

- Keep the diff to the milestone. Extend working code before rewriting it; schema changes additive first, with
  a downgrade note in `docs/deployment.md`: what an older image does with the new rows, what to do before a reverse repin.
- Changed behaviour needs tests, or a written justification in the report.
- No test is deleted or weakened to get green. If a test contradicts the code, find out which is right.
- Docs stay in sync with behaviour, in the same commit.
- No new dependency without a one-line reason in the report.
- UI text changes need the design and wording baselines re-recorded on a fresh stack through
  `scripts/design-baseline.sh` (snapshots are not portable). Without Docker, say so; CI checks them.
- What you notice outside the milestone goes into the report as a list, not into the diff.

## Validation

- `pnpm validate` (lint, CSS token lint, typecheck, unit and integration tests, build) before every
  commit. Quote its decisive output line in the report.
- The integration tests need Docker (they start `postgres:16-alpine`). In a cloud container start the
  daemon first (`dockerd`) if `docker info` fails; without Docker run lint, typecheck, unit tests and
  build one by one and say that CI covers the rest.
- Three tests fail only in cloud containers and pass in CI: the process-group test in `tests/unit/process-utils.test.ts`
  and the two ICU "GMT" zone-name tests in `tests/unit/ops-state.test.ts` and `tests/unit/viewer-messages.test.ts`.
  Locally the bar is no failure beyond these three; the pull request's CI run decides.
- Targeted checks where needed: `pnpm test:fresh-db`, `pnpm test:fresh-compose`, `docker/smoke-test.sh`.

## Commits, branches, merges

- Work on a feature branch. One commit per milestone, plus merge commits.
- Never force-push. Never push, merge or tag `main` unless the brief says so explicitly.
- A milestone is done when its acceptance is shown with command and output, a fresh reviewer without
  prior context (a subagent) has checked the diff against the acceptance, and the pull request's CI is
  green. Merge only on the owner's word (a brief that says "merge" is that word), with a merge commit
  titled `Merge: …`.
- Checks that only the DUT can run do not hold the merge: add them to "DUT checks for the next release
  candidate" in `PLANS.md`.
- On a conflict, merge `main` into your branch (no rebase of a pushed branch). Never resolve a conflict
  in `PLANS.md` or `CHANGELOG.md` by deduplicating identical lines, and never drop another thread's
  entries.
- Commit and push work in progress before waiting on anything; a cloud container can be lost.
- At milestone end set its row in `PLANS.md` to Complete and add a section under "Milestone notes" when
  the row is not enough (decisions, measurements, follow-ups).

## GitHub from a cloud session

- `gh pr view` and `gh pr checks` fail there (GraphQL, HTTP 403). Use the REST API:
  `gh api repos/DrJakeberg/stream247/pulls/<nr>` and `gh api repos/DrJakeberg/stream247/commits/<sha>/check-runs`.
  Never ask the owner to check such things locally.
- Tag pushes from the cloud are refused: give the owner the exact tag command.

## Releases

- No release before the owner hands over the soak result. A soak with any outage or failure is
  "passed with failure", never "clean"; report outages, the longest outage and the uplink restarts.
- The release commit is exactly one `release: vX.Y.Z` commit. It changes `package.json`, the image
  defaults in `docker-compose.yml`, `.env.production.example`, `docs/deployment.md` and the
  `CHANGELOG.md` section.
- Tags go only on a `main` commit whose push CI run is green. The release workflow retags that commit's
  `main-<sha>` images and creates the GitHub release.
- When a release ships, its milestone rows move to "Shipped" and its sections to `planning/archive/`.

## Production host (DUT) and Portainer host (DT)

- Both are on the owner's home network behind a short-lived SSH certificate. No cloud session reaches
  them. The owner runs every command there: give the exact command and wait for the output.
- The deployed stack is the Portainer stack on DT (`docs/deployment.md`). The owner's commands:
  - soak result: `ssh dut 'grep -E "outage|complete" ~/logs/soak-<stamp>.log'`; passed means
    `soak-monitor-complete` in the log
  - repin: `ssh dt '~/repin.sh <tag> --dry-run'`, then without `--dry-run`
  - PostgreSQL backup before a schema change:
    `ssh dut 'umask 077; docker exec stream247-postgres-1 pg_dump -U stream247 -d stream247 -Fc > ~/backups/stream247-pre-<tag>.dump'`
  - soak start: the command of step 10 of *Safe Upgrade Flow* in `docs/deployment.md` (a release checkout, `CHECK_BASE_URL=http://127.0.0.1:3000`)
  - live check: `ssh dut 'docker exec stream247-playout-1 yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/jimpanse247'`
- A 24-hour soak runs only on the DUT. Never change DUT secrets or production values.

## Never

- Print or commit a secret, token or stream key.
- Change the relay pin `bluenviron/mediamtx:1.15.4`.
- Mix up the Twitch accounts: the broadcast channel is `jimpanse247`, the bot is `3JakeC`. Check live
  status only on the broadcast channel.
- Copy from other products: take ideas, never their texts, names, interfaces or code.

## Known traps

- CI runs one at a time per ref (`concurrency` in `.github/workflows/ci.yml`); a new push queues.
- Compose merges lists: `ports`, `env_file` and `volumes` need `!override` in an override file.

## Hard blockers (the only reasons to stop before the milestone is done)

- A secret or credential that is not in the repository.
- A missing external service or permission.
- A destructive migration without a clear safe path.
- An unresolved legal or licensing question.
- A product decision that neither the brief, the plan nor existing behaviour answers: ask the owner.
- The next step needs the owner (DUT, home network, a tag push).

Name the blocker in one sentence and stop; do not replace, rebuild or guess what is missing.
