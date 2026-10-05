# Handoff - 2026-10-05

State of the work for a session that continues it, local or cloud. Read `AGENTS.md` and `PLANS.md`
first. Delete this file when v2.3.0 is tagged, released and repinned (milestone M106).

## Where things stand

| What | State |
| --- | --- |
| v2.1.0 | Released 2026-10-02 (commit `799ff8b`), GitHub release published, on the DUT. Soak of rc.2: passed with one outage (220 s, the nightly network blip). |
| v2.2.0-rc.1 | Tagged as a prerelease on 2026-10-02 (commit `a0fb063`), never deployed or soaked. Its code ships in 2.3.0; M83 is superseded by M106 (owner decision 2026-10-05). |
| `e81b6f4` | `release: v2.2.0` on `main`, never tagged; no 2.2.0 images exist. **Never tag it**: its `CHANGELOG.md` still has a 2.2.0 section, so the release workflow would publish a 2.2.0 that the repository says does not exist (`docs/deployment.md`, *Upgrading To 2.3*). |
| M84-M104 | Merged to `main` 2026-10-02 to 2026-10-04 (pull requests #10 to #30). New migrations in M85, M89, M93, M96 and M104. |
| M105 | The fixes of the 2026-10-05 review of M84-M104 (`planning/review-2026-10-05.md`). Merged before M106 starts. |
| M106 | Release 2.3.0: next (row in `PLANS.md`). |

Until M106's release commit, `package.json` on `main` reads `2.2.0-rc.1` (the last version that exists),
and the image defaults in `docker-compose.yml` and `.env.production.example` pin `v2.1.0`. `CHANGELOG.md`
has no 2.2.0 section; the 2.3.0-rc.1 release commit writes one section for everything since 2.1.0 (the
2.2.0-rc.1 section's changes and M84-M105, from the milestone notes in `PLANS.md`).

## M106, the session's part

1. On `main` after M105, one commit `release: v2.3.0-rc.1`: `package.json` and the `CHANGELOG.md` section
   `## 2.3.0-rc.1`, as `release: v2.2.0-rc.1` (`a0fb063`) did. Wait for its push CI run to be green.
2. Hand the owner the tag command (tag pushes from the cloud are refused):
   `git fetch origin && git tag v2.3.0-rc.1 <sha of the release commit> && git push origin v2.3.0-rc.1`.
   Check the GitHub release with `gh api repos/DrJakeberg/stream247/releases/tags/v2.3.0-rc.1`
   (prerelease true).

## Owner steps, in order (only the owner reaches the DUT and the Portainer host)

The DUT (`ssh dut`) and the Portainer host (`ssh dt`) are on the owner's LAN. A session without that
network never guesses a result: it names the command and waits for the output.

1. Backup (mandatory: seven migrations, and the dump is one of the two ways back). Keep the file:
   `ssh dut 'umask 077; docker exec stream247-postgres-1 pg_dump -U stream247 -d stream247 -Fc > ~/backups/stream247-pre-v2.3.0-rc.1.dump'`
2. Repin: `ssh dt '~/repin.sh v2.3.0-rc.1 --dry-run'`, then without `--dry-run`.
3. Count the migrations after the first start; this prints `7`:

   ```sh
   ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
   SELECT COUNT(*) FROM schema_migrations WHERE id >= '20261001_002';
   SQL
   ```

4. Right after the repin: **Admin → Settings → Channel language** to German. Until then the poll, the
   skip bar and the chat answers are English.
5. The DUT checks. They are in `PLANS.md` under *DUT checks for the next release candidate*, each with its
   commands and what passes, the soak check included. The checks of 2.2.0-rc.1 run too, since that
   candidate never reached the DUT: the DUT sections of M75, M76, M78, M79, M80 and M82 in
   `planning/archive/plans-m0-m83.md`, without the live bridge check of M78 (that would be M66). (The
   labels A1, A2, B1, B2, C and D of the previous handoff named these checks; they exist nowhere else.)
6. Live status, on the broadcast channel only:
   `ssh dut 'docker exec stream247-playout-1 yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/jimpanse247'`
7. Soak start: the command of step 10 of *Safe Upgrade Flow* in `docs/deployment.md`, from the release checkout on the DUT, measured
   through `CHECK_BASE_URL=http://127.0.0.1:3000` with `COMPOSE_PROJECT_NAME=stream247`. Then `tmux ls`
   and the soak check in `PLANS.md` (the log's first line and its `Baseline container restarts` line).
   The old start, `~/scripts/start-soak.sh` from `~`, measures the public route and sees no container
   restart (review finding R31).
8. After 24 h, the result: `ssh dut 'grep -E "outage|complete" ~/logs/soak-<stamp>.log'`. Passed means
   `soak-monitor-complete` in the log. A pass with an outage is "passed with failure", never clean.
   Report `outages`, `outageSecondsMax` and the uplink restarts with it, and the critical incidents of
   the 24 hours (last command of the soak check).
9. Passed: the session writes `release: v2.3.0` (`package.json`, the image defaults in
   `docker-compose.yml` and `.env.production.example`, `docs/deployment.md`, the `CHANGELOG.md` section
   `## 2.3.0`); after its green push CI the owner pushes the tag `v2.3.0` on it, backs up again and repins
   `v2.3.0`. Failed: the fix, then `v2.3.0-rc.2` the same way.

Rolling back at any point: `docs/deployment.md`, *Rollback to 2.1.0*. Dated and one-off blocks are
listed and deleted first (2.1.0 would air them every week and erase their dates), or the pre-upgrade
dump is restored into an empty database instead; then `ssh dt '~/repin.sh v2.1.0 --dry-run'` and without.

## After v2.3.0 is out (the last commit of M106)

- Record the DUT check results and the soak in the milestone notes of `PLANS.md`, then move the rows of
  M83-M106 to **Shipped** and their sections to `planning/archive/`, text unchanged (`AGENTS.md`,
  *Releases*).
- Delete this file.

## Open owner decisions

- `planning/suggestions-2026-10-04.md`: 27 findings outside the milestones, each with a recommendation.
  Nobody starts any of them before the owner names numbers.
- M86: confirm that only cycles in which the database cannot be reached count towards the five-minute
  exit (recommended: keep it so; see the M86 notes in `PLANS.md`).

## Rules that are not in the code

- The broadcast channel is `jimpanse247`, the bot account is `3JakeC`; check live status on the channel.
- Never print or commit a secret or a stream key; never move the relay pin `bluenviron/mediamtx:1.15.4`.
- M66 and the soak part of M57 never without the owner; M77 and M81 only on the owner's word.
- UI text changes need the design and wording baselines re-recorded on a fresh stack.
