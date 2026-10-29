---
name: milestone-pr
description: Take one stream247 milestone from its PLANS.md row to a reviewed pull request with green CI. Use when a brief names a milestone (Mxx) to implement, or asks to open or finish a milestone pull request.
---

# Milestone to pull request

The rules are in `AGENTS.md`; this is the order of work. Stop at any hard blocker named there.

1. **Restate.** Read `AGENTS.md` and `PLANS.md` in full. Quote the milestone's row (Goal, Acceptance)
   and restate the acceptance in your own words before changing code. A milestone under
   "Owner-gated and deferred" is never started.
2. **Branch.** `git fetch origin` and branch from `origin/main`: `claude/<mxx>-<short-slug>`.
3. **Implement.** Keep the diff to the milestone. Tests for changed behaviour; docs in the same commit;
   schema changes additive with a downgrade note in `docs/deployment.md`. UI text changes re-record
   the baselines with `scripts/design-baseline.sh` on a fresh stack.
4. **Validate.** `pnpm validate` and quote its decisive line. Run the CI steps outside `validate`
   that the diff touches (list in `AGENTS.md`, *Validation*). In a cloud container only the three
   known failures may be red.
5. **Plan file.** Set the row to Complete in `PLANS.md`; decisions, measurements and follow-ups go
   into a section of `planning/milestone-notes.md`; DUT-only checks into `planning/dut-checks.md`.
   `PLANS.md` stays under 300 lines.
6. **Commit and push.** One commit for the milestone (English message), then
   `git push -u origin <branch>`. Never force-push.
7. **Review.** Start a subagent without prior context. Give it the acceptance text and the
   command `git diff origin/main...HEAD`, not your conclusions. Fix what it confirms; say in the
   report what you did not fix and why.
8. **Pull request.** `gh pr create --base main` with the acceptance, the evidence (command and
   decisive output line) and what was not checked. In a cloud session read the PR and its checks
   through the REST API:
   `gh api repos/DrJakeberg/stream247/pulls/<nr>` and
   `gh api repos/DrJakeberg/stream247/commits/<sha>/check-runs`.
9. **CI.** Wait for the run; CI runs one at a time per ref. A failure at `public.ecr.aws` is the
   registry: rerun the failed jobs. Any other red check is yours to fix with a new commit.
10. **Report** in German: result first, then the evidence, then done / open / needed from the owner.
    Merge only on the owner's word, as a merge commit titled `Merge: …`. Then stop; the owner
    starts the next milestone.
