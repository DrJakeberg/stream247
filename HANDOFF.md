# Handoff - 2026-10-05

State of the work for a session that continues it, local or cloud. Read `AGENTS.md` and `PLANS.md`
first. Delete this file when v2.2.0 is tagged, released and repinned (milestone M83).

## Where things stand

| What | State |
| --- | --- |
| v2.1.0 | Released 2026-10-02 (commit `799ff8b`), GitHub release published, DUT repinned to it. Soak of rc.2: passed with one outage (220 s, the nightly network blip). |
| v2.2.0-rc.1 | Tagged and released as a prerelease on 2026-10-02 (commit `a0fb063`). **Not yet on the DUT**: backup, repin and soak are the owner's next step (below). |
| v2.2.0 | Release commit `e81b6f4` (`release: v2.2.0`) is on `main`, push CI green. **Not tagged**: the tag waits for a passed rc.1 soak (owner decision 2026-10-02, "with soak"). |
| M84-M104 | All 21 merged to `main` after `e81b6f4` (pull requests #10 to #30, last merge `5529679`). They ship with the version after 2.2.0. New migrations in M85, M89, M93, M96 and M104. |
| Open pull requests | None. |

`package.json` on `main` says 2.2.0 and `CHANGELOG.md` has no section for M84-M104 yet: the next release
commit writes it from the milestone notes in `PLANS.md`. Never edit the `2.2.0` section for later work.

## The v2.2.0 tag goes on `e81b6f4`, not on the newest `main`

`main` now carries M84-M104, which the rc.1 soak does not test. v2.2.0 must stay the soaked code, so the
tag names the release commit explicitly:

```sh
git fetch origin && git tag v2.2.0 e81b6f4d7ad25fd8fa57fb4010690c334763fdd2 && git push origin v2.2.0
```

Tags in this repository are lightweight. The release workflow retags the `main-e81b6f4…` images and
creates the GitHub release from the `2.2.0` section of `CHANGELOG.md`; check it with
`gh api repos/DrJakeberg/stream247/releases/tags/v2.2.0` (draft and prerelease both false). If the soak
fails, `e81b6f4` is never tagged; a `v2.2.0-rc.2` follows instead.

## Owner steps, in order (only the owner reaches the DUT and the Portainer host)

The DUT (`ssh dut`) and the Portainer host (`ssh dt`) are on the owner's LAN. A session without that
network never guesses a result: it names the command and waits for the output.

1. Backup (mandatory, rc.1 adds two tables):
   `ssh dut 'umask 077; docker exec stream247-postgres-1 pg_dump -U stream247 -d stream247 -Fc > ~/backups/stream247-pre-v2.2.0-rc.1.dump'`
2. Repin: `ssh dt '~/repin.sh v2.2.0-rc.1 --dry-run'`, then without `--dry-run`.
3. Right after the repin: **Admin -> Settings -> Channel language** to German. Until then the poll and
   the skip bar are English.
4. DUT checks A1 (migrations, indexes, `source_breakers`) and A2 (channel language), then B1/B2 after the
   first programme changes, C (operator clicks) and D (the morning after the nightly blip). Their source is
   the DUT sections of M75, M76, M78, M79, M80 and M82 in `planning/archive/plans-m0-m83.md`. The live
   bridge check of M78 is left out: it would be M66.
5. Live status, on the broadcast channel only:
   `ssh dut 'docker exec stream247-playout-1 yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/jimpanse247'`
6. Soak start: `ssh dut 'cd ~ && ~/scripts/start-soak.sh 24; tmux ls'`
7. After 24 h, the result: `ssh dut 'grep -E "outage|complete" ~/logs/<soaklog>; grep -c " status=ok " ~/logs/<soaklog>'`.
   Passed means `soak-monitor-complete` in the log. A pass with an outage is "passed with failure",
   never clean. Report `outages`, `outageSecondsMax` and the uplink restart delta with it.
8. Passed: the owner pushes the tag above (tag pushes from the cloud are refused), then backs up again
   and repins `v2.2.0`.

## After v2.2.0 is out (the last commit of M83)

- Record the DUT check results and the soak in `planning/archive/plans-m0-m83.md` (sections M75-M82 and a
  new M83 section).
- Move the M83 row of `PLANS.md` to **Shipped** and drop "tag pending" from the 2.2.0 line there.
- `CHANGELOG.md:14` says the candidate's checks are recorded "in `PLANS.md` under M83"; point it at
  `planning/archive/plans-m0-m83.md` instead.
- Delete this file.

## The release after 2.2.0

It ships M84-M104. Its DUT checks are listed in `PLANS.md` under *DUT checks for the next release
candidate*. It has migrations, so the backup before the repin is mandatory again.

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
