# Implementation Runbook

`PLANS.md` is the source of truth.

## Workflow

1. Read:
   - `AGENTS.md`
   - `PLANS.md`
   - `IMPLEMENT.md`
   - `docs/upstream-gap-analysis.md`
2. Select exactly one milestone from `PLANS.md`.
3. Restate the milestone acceptance before changing code.
4. Keep the diff scoped to that milestone.
5. Extend working code before considering rewrites.
6. Do not expand scope unless it is required to satisfy the milestone acceptance.
7. Update docs continuously as behavior changes.

## Execution Rules

- Work milestone by milestone.
- Reuse existing architecture and conventions.
- Prefer additive schema changes and targeted DB writers.
- Preserve safe compatibility paths where the milestone touches runtime-critical behavior.
- Treat `pnpm validate` as the required baseline after each milestone.
- Use targeted checks when the touched area requires them:
  - `pnpm test:fresh-db`
  - `pnpm test:fresh-compose`
  - `docker build -f docker/web.Dockerfile -t stream247-web:test .`
  - `docker build -f docker/worker.Dockerfile -t stream247-worker:test .`
  - `./docker/smoke-test.sh stream247-web:test`
  - `pnpm release:preflight`
  - `./scripts/upgrade-rehearsal.sh <target-version>`
  - `./scripts/soak-monitor.sh --hours 24`
- Fix validation failures immediately before continuing.

## Milestone Completion

At the end of every milestone:

1. Run:
   ```bash
   pnpm validate
   ```
2. Run the targeted checks required by the touched area.
3. Fix all failures immediately.
4. Update docs to match shipped behavior.
5. Append progress notes to `PLANS.md`.
6. Write a summary with:
   - changed files
   - risks
   - follow-up items
   - any dependency additions with a one-line reason

## Scope Control

- Do not widen the milestone unless the current acceptance cannot be met otherwise.
- Keep diffs reviewable and subsystem-focused.
- If a later milestone becomes necessary for correctness, stop and document the blocker instead of silently absorbing it.

## Hard Blockers

Stop only for:

- missing secret or credential not available in repo
- missing external service or permission
- destructive migration with unclear safe path
- unresolved legal or licensing issue
- ambiguous product decision that cannot be inferred from upstream behavior or existing repo conventions
