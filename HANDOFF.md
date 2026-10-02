# Handoff — 2026-10-01

Written for a session that continues this work without access to the production host. Delete this file
when the two releases below are out.

## Goal

1. Ship **v2.1.0**: exactly the code that soaks as `v2.1.0-rc.2` (`main`, commit `0cf66a6` plus docs and
   the release-workflow change).
2. Then ship **v2.2.0** from pull request `DrJakeberg/stream247#3` (branch `m75-source-breaker`): candidate
   `v2.2.0-rc.1`, a 24-hour soak, then the final.

## What a session without the home network cannot do

The production host ("DUT", `ssh dut`) and the Portainer host (`ssh dt`) are on the owner's LAN behind a
short-lived SSH certificate. From anywhere else there is **no** way to read the soak log, repin the stack,
or run a DUT check. Ask the owner to run the command and paste the output; never guess a result.

| Needs the owner (or a local session) | Command |
|---|---|
| Soak result | `ssh dut 'grep -E "outage\|complete" ~/logs/soak-20261001-034108.log; grep -c " status=ok " ~/logs/soak-20261001-034108.log'` |
| Repin the DUT (dry run first) | `ssh dt '~/repin.sh v2.1.0 --dry-run'`, then without `--dry-run` |
| Database backup before a schema change | `ssh dut 'umask 077; docker exec stream247-postgres-1 pg_dump -U stream247 -d stream247 -Fc > ~/backups/stream247-pre-<tag>.dump'` |
| Start a soak | `ssh dut 'cd ~ && ~/scripts/start-soak.sh 24; tmux ls'` |
| Is the channel live | `ssh dut 'docker exec stream247-playout-1 yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/jimpanse247'` |

The broadcast channel is `jimpanse247`; the bot account is `3JakeC`. Check live status on the channel,
never on the bot.

## State on 2026-10-01

- **DUT**: `v2.1.0-rc.2` live since 03:35 UTC. Soak started 03:41:08 UTC, ends 2026-10-02 03:41 UTC
  (`tmux` session `soak`). At 21:40 UTC: 1075 of 1075 samples `status=ok`, no outage, no unplanned uplink
  restart. The nightly network blip (about 23:58 UTC) is still ahead; the soak tolerates one outage of up
  to 300 s and reports it as `outages=N`.
- **On air under rc.2, proven**: Play now of a YouTube video+audio pair (`299+140`, 264 s, no slate); the
  TwitchYoutube pool alternating by itself at 12:57 UTC (Twitch → YouTube → Twitch). See `PLANS.md`, M71.
- **Two read-only measurements run on the DUT tonight** and stop by themselves after 16 h (`tmux`
  sessions `probewatch`, `sigwatch`; logs `~/logs/probe-watch-*.log`, `~/logs/outage-signal-*.log`). They
  answer the M82 question: during the blip, do probes of the Twitch source fail, and does a DNS + TCP check
  of `live.twitch.tv:1935` from the playout container see the outage (`connect=timeout` or a DNS error
  other than ENOTFOUND)? Record the answer in the M82 section of `PLANS.md`.
- **GitHub releases**: backfilled for every tag with images (39 releases, `v2.0.0` is "Latest").
  `release.yml` now creates the release as its last step from the tag's `CHANGELOG.md` section. v2.1.0 is
  the first tag to use it: after tagging, check `gh release view v2.1.0`.
- **Pull request #3** (draft, branch head `ab42e11`): M75 source circuit breaker, M76 as-run log, M78 operator precedence, M79
  chat never skips an operator insert, M80 viewer language (de/en), M82 a network outage is not a source
  fault, the combination review, and M64 (the fresh-install smoke follows the getting-started guide). Each
  milestone was implemented, reviewed, fixed and gated; `pnpm validate`, the design and wording baselines
  (76/76) and the five docker smokes were green on images built from the branch. Its `CHANGELOG.md` already
  carries the `2.2.0-rc.1` section; set its date when the candidate is cut.

## Next steps, in order

1. **Soak result.** Passed means `soak-monitor-complete` in the log. Report `outages`, `outageSecondsMax`
   and the uplink restart delta with it; a pass with an outage is never called clean.
2. **Release v2.1.0** (only if the soak passed). One commit `release: v2.1.0` on `main` that changes:
   - `package.json`: `"version": "2.1.0"`;
   - `docker-compose.yml`: the four image defaults `v2.0.0` → `v2.1.0` (lines 39, 79, 118, 143);
   - `.env.production.example`: the three pins `v2.0.0` → `v2.1.0`;
   - `docs/deployment.md` line 171: "pins `v2.0.0`" → "pins `v2.1.0`";
   - `CHANGELOG.md`: a new top section `## 2.1.0 - <date>` (text below, fill in the soak numbers).
   Push, wait for CI on that commit (the `push` run publishes `main-<sha>` images), then
   `git tag v2.1.0 <sha> && git push origin v2.1.0`. The release workflow retags the images and creates
   the GitHub release. The owner then backs up PostgreSQL (not required for 2.1.0 over rc.2, the code is
   the same) and repins the DUT.
3. **Merge pull request #3** after the v2.1.0 tag, with a `Merge: …` commit as the repository does it.
   Expect small conflicts in `package.json`, `CHANGELOG.md` and `PLANS.md`; never deduplicate identical
   lines when resolving.
4. **Release v2.2.0-rc.1**: `release: v2.2.0-rc.1` commit (`package.json`, the date in the `2.2.0-rc.1`
   CHANGELOG heading), CI, tag. The owner backs up PostgreSQL (two new tables), repins, sets
   **Admin → Settings → Channel language** to German (the default is English: the poll and the skip bar
   turn English until then), and starts a 24-hour soak. DUT checks are listed per milestone at the end of
   `PLANS.md` (M75, M76, M78, M79, M80, M82).
5. **v2.2.0** after that soak, the same way as step 2.

### CHANGELOG text for 2.1.0

```markdown
## 2.1.0 - <date>

The release the two candidates were for. YouTube plays again (format candidates, a programme on air is
never re-resolved), the two Twitch accounts are named by their role, a pool with several sources
alternates between them in a stable chronological order, and Play now and Insert reach the air without
a standby slate. Upgrading from 2.0 adds one column (`pools.source_cursors`); back up PostgreSQL before
the repin. The rollback is the reverse repin; an older image ignores the column.

Measured before tagging: 24 h on the device under test, 2026-10-01 03:41 to 2026-10-02 03:41 UTC,
<samples> readiness samples, <outages and uplink restarts>. On air on rc.2: a YouTube video+audio pair
through Play now (`299+140`, candidate `split-h264-aac`, 264 s to its natural end, no slate); the Twitch
archives in VOD-id order; and at 12:57 UTC the TwitchYoutube pool alternating by itself - a Twitch archive
ended at its duration bound, the pool picked the oldest playable YouTube item with no fallback bridge,
and 264 s later it picked Twitch again at the position that source had kept.
```

## Owner-gated and deferred

- **M66 Live Bridge rehearsal** and the soak part of **M57 embedded video sources**: need a live source
  pushed by the owner and replace or overlay the programme on air. Never start them without the owner.
- **M77 resume an interrupted item** and **M81 admin interface language**: deferred by the owner; start
  only when asked.

## Known follow-ups (recorded in `PLANS.md`, not milestones)

- A Restart or Hard reload written while a playout cycle runs is swallowed by the cycle's end write.
- Two pools that share a source can repeat one archive at a block boundary.
- The soak's critical-incident check is skipped without a session cookie.
- `/api/channel/live` still carries the operator's status text; the public page no longer prints it.
- Ideas from the competitor comparison that are not planned: alerts on air, the 48-hour reconnect at an item
  boundary, loudness normalisation, a daily on-air percentage, `!next` / `!schedule`, a progress bar, a
  reaction when the creator goes live.

## Rules that are not in the code

- Read `AGENTS.md` and `PLANS.md` first; one commit per milestone; `pnpm validate` before every commit.
- UI text changes need the design and wording baselines re-recorded on a fresh stack; a session without
  docker relies on CI for that and must say so.
- Never move the relay pin (`bluenviron/mediamtx:1.15.4`), never print or commit a secret or a stream key.
