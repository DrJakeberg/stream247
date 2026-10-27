---
name: release
description: Prepare a stream247 release or release candidate (vX.Y.Z or vX.Y.Z-rc.N) - the release commit, the tag command for the owner and the archive move after shipping. Use when the owner asks for a release, an rc, or to archive a shipped release.
---

# Release

The rules are in `AGENTS.md`, *Releases*; the deploy flow is in `docs/deployment.md`
(*Canonical Release And Rollout Flow*, *Safe Upgrade Flow*). Nothing here runs on the DUT or DT:
the owner runs those commands.

## Before the release commit

- A final release needs the owner's soak result first. Read it as given: any outage or failure is
  "passed with failure"; report the outages, the longest outage and the uplink restarts.
- Every milestone of the release is Complete in `PLANS.md` and merged to `main`; the DUT checks in
  `planning/dut-checks.md` for this release have results or are named as open.
- `git fetch origin` and start from a fresh `origin/main`; another thread may have merged.

## The release commit

Exactly one commit titled `release: vX.Y.Z` on its own branch. It changes only:

1. `package.json` `version`.
2. The image defaults in `docker-compose.yml`.
3. `.env.production.example` image tags.
4. `docs/deployment.md`: the pinned version and the *Upgrading To X.Y* section (schema changes,
   downgrade notes, what to do before a reverse repin).
5. `CHANGELOG.md`: the section for the version (`scripts/release-notes.mjs` builds the GitHub
   release text from it).

Then `pnpm validate` and the preflight the way CI runs it (a plain `pnpm release:preflight` reads `.env`):
`RELEASE_PREFLIGHT_ENV_FILE="$(./scripts/prepare-release-preflight-env.sh)" RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight`.
Then push, pull request, green CI, merge on the owner's word.

## The tag

- Only on a `main` commit whose push CI run is green; the release workflow
  (`.github/workflows/release.yml`) retags that commit's `main-<sha>` images and creates the GitHub
  release.
- A cloud session cannot push tags. Give the owner the exact commands, for example:
  `git fetch origin && git tag vX.Y.Z <sha> && git push origin vX.Y.Z`
- Afterwards check that the release exists: `gh api repos/DrJakeberg/stream247/releases/tags/vX.Y.Z`.

## Deploy (owner)

Give the owner the commands from `AGENTS.md` in this order: PostgreSQL backup before a schema
change, `ssh dt '~/repin.sh <tag> --dry-run'`, the repin without `--dry-run`, the soak start (step 10
of *Safe Upgrade Flow*). Wait for each output.

## After it ships

- The milestone rows move from "Open" to "Shipped" in `PLANS.md` (one Shipped row per release).
- Their sections in `planning/milestone-notes.md` and the release's DUT checks move to a new file
  `planning/archive/plans-<first>-<last>.md`, text unchanged; `PLANS.md` names that file.
- `pnpm validate` (the doc reference test catches a dangling path), then one docs commit.
