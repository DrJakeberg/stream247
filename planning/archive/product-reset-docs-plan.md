# Stream247 Product Reset — Documentation Plan

Updated: 2026-04-22

This is the plan for the `docs/` directory after Phase 5 completes. It says which files stay, which files are absorbed and deleted, what each final file is responsible for, and how documentation stays clean after the reset.

Companions: `docs/product-reset-audit.md` (why), `docs/product-reset-target-state.md` (product model), `docs/product-reset-kill-list.md` (what leaves), `docs/product-reset-ui-spec.md` (design contract). Implementation milestones in `PLANS.md` Phase 5 — in particular M42 (quarantine Phase-4 planning artifacts) and M49 (final docs collapse).

---

## Final doc set after Phase 5

Six product docs and three planning files. Nothing else lives permanently in `docs/`.

| File | Audience | Kept current by | Notes |
|---|---|---|---|
| `docs/architecture.md` | Engineers reading the code | Engineers touching the pipeline | Service topology, data model, SSE/IPC contracts. |
| `docs/deployment.md` | Operators deploying the product | Release rehearsal steps | Compose + GHCR + Portainer/DT + `.env` setup + DUT validation flow. |
| `docs/operations.md` | Operators running the product | Incident response owners | Runbook, incident flow, backup, upgrade playbook. |
| `docs/moderation-policies.md` | Channel operators + moderators | The person editing `!here` policy | Presence windows, chat-mode rules, clamp behavior. |
| `docs/twitch-setup.md` | First-time operator onboarding | Twitch integration owner | OAuth, EventSub, IRC bridge, live-status polling. |
| `docs/ui.md` | Contributors building UI | UI contributors | Canonical primitives + workspace model + consistency rules, absorbs `product-reset-ui-spec.md`. |

Plus three planning files at the repo root or in a dedicated planning location (not in `docs/`):

- `PLANS.md` — milestone ledger (append-only, progress record).
- `README.md` — top-level product description + doc links.
- `AGENTS.md` — guidance for automation agents working in the repo.

That is the complete permanent documentation surface. Every other file in `docs/` at the start of Phase 5 either merges into one of the six above or is deleted.

---

## Which docs stay (audited and load-bearing)

These five docs exist today, describe real current behavior, and carry forward unchanged except for whatever content Phase 5 milestones add.

- `docs/architecture.md` — describes the monorepo layout, `apps/web` / `apps/worker` / `packages/*` boundaries, the playout pipeline (program feed → FFmpeg → MediaMTX relay → destination uplinks), the SSE and IPC contracts between web and worker, and the data model. Phase 5 adds the text-sanitation pipeline description (M36) and the four-workspace nav model (M43), but the file's shape does not change.
- `docs/deployment.md` — compose files, GHCR image tags pinned in `.env.production.example`, Portainer-managed stack on DT, DUT validation via `upgrade-rehearsal.sh` and `soak-monitor.sh`, release preflight. M50 bakes the full "repo → GHCR → Portainer on DT → DUT soak → production promote" flow into this file as the canonical deployment rhythm.
- `docs/operations.md` — runbook, incident response, backup procedure, upgrade procedure, readiness semantics. Absorbs any load-bearing operational content from the Phase-4 artifacts that gets deleted.
- `docs/moderation-policies.md` — `!here` command rules, presence min/max/default configuration, chat-mode automation, clamp rule description. M38 adds the IRC response format + clamp feedback subsection.
- `docs/twitch-setup.md` — OAuth flow, EventSub subscription list, IRC bridge configuration, live-status polling. M48 adds the nav-visible live-status chip and confirms the polling source at `apps/worker/src/twitch-live-status.ts`.

---

## Which docs are created, then collapsed

Phase 5 creates five new docs that are not permanent:

- `docs/product-reset-audit.md` (this reset) — executive verdict + requirement-by-requirement audit. Absorbed into the Phase 5 milestone history in `PLANS.md` after M49. Deleted at end of Phase 5.
- `docs/product-reset-target-state.md` — product-shape model. The permanent parts (overlay-is-internal statement, non-goals list, four-workspace model) migrate into `architecture.md` and `README.md`. The rest is historical context. Deleted at end of Phase 5.
- `docs/product-reset-kill-list.md` — removal decisions + terminology migration table. The terminology table migrates into `ui.md` as a "canonical terms" section. The kill decisions live on via their execution in M36–M48. Deleted at end of Phase 5.
- `docs/product-reset-ui-spec.md` — this is the design contract. It becomes `docs/ui.md` during M49, not a separate file. The old `docs/ui-redesign-spec.md` is deleted when `ui.md` ships.
- `docs/product-reset-docs-plan.md` — the file you are reading. The final six-doc set it defines is what remains; the plan itself is then redundant. Deleted at end of Phase 5.

---

## Which docs are deleted

These Phase-4 planning artifacts are deleted during Phase 5. M42 (quarantine) and M49 (final delete) do the work.

- `docs/full-product-reset-audit.md` — superseded by `docs/product-reset-audit.md`. Its Phase-4 verdicts are retained in git history. Delete at end of M49.
- `docs/full-product-reset-plan.md` — superseded by `docs/product-reset-target-state.md` + `docs/product-reset-kill-list.md`. The Phase-4 plan locked in a four-section / eleven-link IA as the target; Phase 5 reopens that and lands on the four-workspace model. The superseded plan has no forward value. Delete at end of M49.
- `docs/legacy-removal-list.md` — its "external stream overlay" language at `docs/legacy-removal-list.md:111` is the anti-example that `docs/product-reset-target-state.md` corrects. Once M39 removes external-overlay language from the product surface and M42 migrates any remaining load-bearing items into operational docs, this file is deleted.
- `docs/docs-reset-plan.md` — Phase-4 docs plan, superseded by this file. Delete at end of M49.
- `docs/ui-redesign-spec.md` — Phase-4 UI redesign spec. Superseded by `docs/product-reset-ui-spec.md`, which becomes `docs/ui.md` in M49. Delete when `ui.md` ships.

None of these deletions happen until the load-bearing content is merged into one of the six permanent docs. The sequence is merge → verify → delete, not delete-then-rewrite.

---

## What each final doc is responsible for (strict non-overlap)

The six permanent docs must not duplicate each other. The following rules define each doc's scope so that when a fact changes, there is exactly one file to edit.

### `architecture.md`

Describes what the system *is*: the shape of the code, the data model, and the internal contracts between components. Includes:

- Monorepo layout and package boundaries (`apps/web`, `apps/worker`, `packages/core`, `packages/db`).
- Data model (pools, schedule blocks, shows, assets, destinations, scenes, incidents, presence windows).
- Runtime pipeline (program feed → overlay compositor via Chromium capture → FFmpeg → MediaMTX relay → destination uplinks).
- SSE and IPC contracts between `apps/web` and `apps/worker`.
- Text-sanitation pipeline layers (M36).

Does not describe: how to deploy, how to configure Twitch, how to handle incidents, how the UI is built.

### `deployment.md`

Describes how the product is shipped and run in production. Includes:

- Docker Compose file structure.
- Image build and push via CI to `ghcr.io/drjakeberg/stream247-*`.
- How to pin a tag in `.env.production.example`.
- Portainer stack on DT as the deployment control plane.
- DUT validation flow (`upgrade-rehearsal.sh`, `soak-monitor.sh`).
- Release preflight (`release-preflight.sh`).
- Rollback procedure (revert tag in Portainer and redeploy previous stack).

Does not describe: the code architecture, operational incident handling, Twitch configuration, UI behavior.

### `operations.md`

Describes how to run the live product day-to-day. Includes:

- Incident severity and response.
- Backup procedure.
- Upgrade playbook (point at `deployment.md` for mechanics; describe the decision flow here).
- Readiness checks and what each one means.
- Drift check procedure.
- Known recovery patterns.

Does not describe: deployment internals, code architecture, Twitch setup, UI.

### `moderation-policies.md`

Describes channel moderation behavior. Includes:

- The `!here` command (syntax, allowed values, min/max/default configuration, clamp rule).
- IRC response format when the clamp applies (M38 addition).
- Chat-mode rules (when the bot switches mode based on presence).
- Moderator role configuration.

Does not describe: Twitch OAuth or EventSub (those are in `twitch-setup.md`), the operator UI for moderation (that is part of `ui.md`).

### `twitch-setup.md`

Describes integration with Twitch. Includes:

- OAuth app creation and credential configuration.
- EventSub subscription list (follow, subscribe, cheer, channel-points).
- IRC bridge configuration for chat ingestion.
- Live-status polling (`apps/worker/src/twitch-live-status.ts`).
- YouTube mirror (when configured).

Does not describe: what to do with moderator commands in chat (that is in `moderation-policies.md`), how the overlay renders chat (that is in `ui.md`), how to deploy (that is in `deployment.md`).

### `ui.md`

Describes how the UI is built. Absorbs `product-reset-ui-spec.md` at M49 and becomes the canonical design contract. Includes:

- Four-workspace navigation model (Live / Program / Studio / Admin) with tabs inside each.
- Canonical primitives (`Button`, `Badge`, `StatusChip`, `Card`, `Input`, `Select`, `PageHeader`, `Tabs`, `EmptyState`, `Toast`, `Textarea`).
- Form, table, and card rules.
- Long-title behavior.
- Consistency rules Codex can enforce.
- The terminology canon (from the kill list's migration table).
- The one-sentence overlay purpose statement: *The overlay is internal output for Stream247's own 24/7 broadcast. It is not an external overlay product and is not intended for third-party stream embedding.*

Does not describe: API contracts, data model, deployment, or operational runbooks.

---

## How to keep product docs clean

These are the rules that make this plan hold up after Phase 5. Codex should treat them as enforceable on every future PR that touches `docs/`.

1. **Product docs in `docs/`, planning docs in `PLANS.md`.** If a doc describes a plan for something that does not exist yet, it does not live in `docs/`. Use `PLANS.md` milestones or a dated entry there.
2. **Naming is by topic, not by phase.** Files in `docs/` are named `<topic>.md` (e.g., `architecture.md`), not `<phase>-<thing>.md` (e.g., `phase-5-ui-spec.md`). A topic file is rewritten when the topic changes; a phase file decays.
3. **One topic, one file.** Every topic has exactly one home in the six-doc set. If a fact could live in two places, pick the one and link from the other.
4. **Every doc describes what exists.** If a feature is planned but not shipped, it does not appear in `docs/` except as a clearly marked "Deferred / not yet implemented" subsection with a milestone reference. The default is to omit unshipped features entirely.
5. **Check doc freshness as part of any milestone that touches the documented surface.** A PR that changes the playout pipeline must update `architecture.md` in the same PR. A PR that changes the deployment rhythm must update `deployment.md`.
6. **No duplicate copies of the same fact across files.** The IA model lives in `architecture.md` and is referenced from `ui.md`, not copied. The deployment flow lives in `deployment.md` and is referenced from `operations.md`, not copied.
7. **Dated entries go in `PLANS.md`, not in `docs/`.** Milestone completions, soak validation results, release notes belong in the milestone ledger. `docs/` captures the product state, not the history.
8. **Delete before renaming.** When a doc is superseded, delete it after its load-bearing content is merged. Do not leave a stub or a "see X" redirect.
9. **Keep `README.md` at the repo root as the entry point.** It contains the product description (including the overlay-is-internal statement) and links to the six-doc set.

---

## Verification at the end of Phase 5

After M49 completes, the `docs/` directory should match this listing exactly:

```
docs/
  architecture.md
  deployment.md
  moderation-policies.md
  operations.md
  twitch-setup.md
  ui.md
```

Any other `.md` file in `docs/` is a bug. The verification step is a `ls docs/*.md` check during M49 that asserts exactly six files.
