# Documentation Reset Plan

Updated: 2026-04-21

This document defines the final documentation structure for Stream247 after Phase 4 cleanup. It is the reference for M34 (Docs Cleanup). After M34 ships, the files listed under "Delete" will be gone and the files listed under "Final Set" will be the complete doc surface.

---

## Principles

- Product docs describe what exists. Planning artifacts describe what was planned. These must not be mixed.
- Competitive analysis is internal material and does not belong in a public repository's docs folder.
- The final doc set should be navigable by a new operator in under 10 minutes.
- Fewer docs with accurate content beats more docs with stale content.

---

## Actions Required (M34)

### Delete immediately (no merge needed)

| File | Reason |
|---|---|
| `docs/stream247-upstream-gyre-gap-analysis.md` | Two-paragraph stub. Zero content. |
| `docs/redesign-and-product-plan.md` | Phase 3 planning artifact. Replaced by `docs/full-product-reset-plan.md`. |
| `docs/video-planning-and-metadata-model.md` | Implementation notes for completed M21/M22/M23. |
| `docs/in-stream-overlay-and-output-strategy.md` | Implementation notes for completed M21/M24/M25. |
| `docs/upstream-gap-analysis.md` | Internal competitive analysis. Not product documentation. |
| `docs/upstream-roadmap.md` | Internal competitive roadmap. Superseded by PLANS.md. |

### Merge into existing files (then delete source)

| Source | Target | What to add |
|---|---|---|
| `docs/backup-and-restore.md` | `docs/operations.md` | Add "Backup and Restore" section near the end of the operations runbook |
| `docs/upgrading.md` | `docs/deployment.md` | Add "Upgrading" section after the initial deployment steps |
| `docs/versioning.md` | `docs/deployment.md` | Add "Release Channels and Tags" section in the deployment reference |

After merging, delete the source files.

### Keep without changes

| File | Reason |
|---|---|
| `README.md` | Accurate product intro and quick start |
| `docs/architecture.md` | Accurate service topology and runtime model |
| `docs/operations.md` | Active operator runbook (absorbs backup-and-restore) |
| `docs/deployment.md` | Active deployment guide (absorbs upgrading + versioning) |
| `docs/twitch-setup.md` | Active Twitch integration setup guide |
| `docs/moderation-policies.md` | Active reference for `!here` command and presence windows |
| `PLANS.md` | Active milestone plan |
| `AGENTS.md` | Agent execution rules |
| `IMPLEMENT.md` | Implementation runbook |

### Keep as Phase 4 planning artifacts (review after Phase 4 ships)

| File | Notes |
|---|---|
| `docs/full-product-reset-audit.md` | Revisit after Phase 4 complete; may become redundant |
| `docs/full-product-reset-plan.md` | Active target-state reference through Phase 4 |
| `docs/legacy-removal-list.md` | Active cleanup decision record through Phase 4 |
| `docs/ui-redesign-spec.md` | Active implementation spec through M29/M30 |
| `docs/docs-reset-plan.md` | This file; archive after M34 completes |

---

## Final Doc Set (post-M34)

**Core operational docs (always relevant):**

| File | Responsibility |
|---|---|
| `README.md` | What Stream247 is, what it does, quick start, key links |
| `docs/architecture.md` | Service topology, data flow, persistence model, runtime design |
| `docs/deployment.md` | Docker Compose setup, env vars, HTTPS/Traefik, release channels, upgrading, rollback |
| `docs/operations.md` | Readiness checks, incident response, drift monitoring, backup, soak monitor |
| `docs/twitch-setup.md` | Twitch OAuth, EventSub, IRC, scope requirements, broadcaster reconnect flows |
| `docs/moderation-policies.md` | `!here` command, presence window policy, emote-only automation |

**Planning artifacts (live through Phase 4):**

| File | Responsibility |
|---|---|
| `PLANS.md` | All milestones M0–current, rollback notes, validation commands, progress notes |
| `AGENTS.md` | Agent execution rules and conventions |
| `IMPLEMENT.md` | Implementation runbook for contributors |

**Phase 4 planning docs (archive or delete after Phase 4):**

| File | Responsibility |
|---|---|
| `docs/full-product-reset-audit.md` | Phase 4 entry-state audit |
| `docs/full-product-reset-plan.md` | Phase 4 target product state |
| `docs/legacy-removal-list.md` | Phase 4 remove/keep/replace decisions |
| `docs/ui-redesign-spec.md` | Phase 4 component and navigation spec |
| `docs/docs-reset-plan.md` | This file |

**Total after M34: 6 core docs + 3 planning files + 5 phase-4 artifacts = 14 files.** Down from 20+ today.

---

## What Each Final Doc Is Responsible For

### `README.md`
- One-paragraph product description
- Feature summary (what the product does)
- What it does NOT do (external overlay product, cloud delivery, multi-workspace)
- Quick start commands
- Links to all docs in `/docs`
- License note
- Max length: 250 lines

### `docs/architecture.md`
- Service topology diagram (web, worker, playout, postgres, redis, mediamtx relay)
- Data flow: source ingestion → pool → schedule → playout → FFmpeg → RTMP
- Overlay data flow: Scene Studio → Chromium → FFmpeg composite
- Persistence model: what lives in Postgres vs Redis
- Worker module map: which file is responsible for what
- Key design decisions (why program feed + relay split exists, why Chromium capture, etc.)

### `docs/deployment.md`
- Docker Compose production setup
- Complete env var reference (every variable in `stack.env.example` documented)
- HTTPS/Traefik profile
- Release channels (latest, v* tags, main-sha snapshots)
- Upgrading procedure (step by step)
- Rollback procedure
- First-run bootstrap flow

### `docs/operations.md`
- Primary operator surfaces (Dashboard, Broadcast page, /api/system/readiness)
- Readiness check interpretation guide
- Incident response: how to diagnose, how to resolve
- Drift check procedure
- Container restart monitoring (soak monitor)
- Backup procedure (from backup-and-restore.md)
- Restore procedure
- Long-run memory and FD baseline reference

### `docs/twitch-setup.md`
- Required Twitch app credentials
- OAuth scopes required
- Broadcaster OAuth vs app access token distinction
- EventSub setup (auto-registered when conditions are met)
- IRC chat connection (chat overlay prerequisite)
- Moderator:read:followers scope requirement for follow alerts
- When to reconnect (scope migration)

### `docs/moderation-policies.md`
- `!here` command behavior and syntax
- Presence window duration rules
- Emote-only automation trigger
- Which roles can trigger presence
- Settings reference

---

## What "No Redundant Planning Artifacts" Means

After M34, no file in `/docs` should:
- Describe a feature that is planned but not yet shipped (that belongs in PLANS.md)
- Compare Stream247 to another product
- Describe implementation decisions for already-completed milestones
- Exist only to redirect to another file

If a doc serves none of the six final doc purposes above, it does not belong in `/docs`.
