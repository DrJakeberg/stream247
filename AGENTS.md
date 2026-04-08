# Agent Rules

- Read `AGENTS.md`, `PLANS.md`, `IMPLEMENT.md`, and `docs/upstream-gap-analysis.md` before any non-trivial change.
- All non-trivial work must begin with plan review and milestone selection from `PLANS.md`.
- Changed behavior requires tests or a written justification in the summary.
- Docs must stay in sync with behavior.
- No new dependency may be added without a short reason in the summary.
- Do not stop after a partial implementation if the next safe step is obvious.
- Stop only for a hard blocker.

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
After completing a milestone, automatically continue with the next incomplete milestone.
Do not pause merely to summarize progress.
Commit exactly one commit per completed milestone.
Push the current branch after each successful milestone commit.
Stop only for a hard blocker.
