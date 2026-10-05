# Suggestions outside the milestones (2026-10-04, after M104)

What M85-M104 found outside their own milestone, bundled with a recommendation each. The owner received
this list in German with the same numbers on 2026-10-04 and has not named any yet. **Nobody starts an
item before the owner names its number.** Recommended first package: 1, 2 and 3, because each lets one
broken or noisy source crash or stall the playout loop.

## Runs stably and heals itself

1. **Noisy ffmpeg output crashes the playout loop.** Every ffmpeg output line triggers an unawaited write,
   every error line an incident. In a test an mp4 without range support (about 800 error lines a minute)
   exhausted the connection pool and the loop crashed.
   Source: M98, follow-up 2 in `PLANS.md`. Recommendation: do it, as a small milestone with 2 and 3.
2. **A pool sticks on a broken item.** The fallback bridges every boundary, the rotation never moves on,
   breaker and quarantine learn almost nothing. In a test a pool stayed on a 404 item for over four
   minutes.
   Source: M98, follow-up 1 in `PLANS.md`. Recommendation: do it, with 1 and 3.
3. **A dead host stalls the whole worker cycle.** The yt-dlp timeout is per call; with three or more
   sources on the same dead host the cycle runs long enough for the stall guard to fire.
   Source: M87. Recommendation: do it, with 1 and 2.
4. **Overlay settings are partly read unguarded.** More JSON columns (layer order, scenes and others) are
   parsed without protection; M85 guarded only `custom_layers_json`.
   Source: M85. Recommendation: do it, as a small milestone with 5.
5. **Nobody checks that Twitch deletes old schedule segments.** A failed delete goes unnoticed.
   Source: M88. Recommendation: do it, with 4.
6. **A frozen process does not restart.** Since M103 a process exits after five minutes of failing its own
   healthcheck; a stopped process or one with a blocked event loop cannot, and Compose does not restart
   unhealthy containers. The optional relay healthcheck (R3) is missing too.
   Source: M103, *Limits* in `PLANS.md`. Recommendation: owner decides first whether a watchdog outside
   the process should restart frozen containers; recommended answer yes, together with the relay
   healthcheck.

## Installation and access

7. **A self-hosted RTMP target can hang.** The uplink first sends an empty H.264 header, MediaMTX rejects
   it, and the output never sends again. Measured only with stand-in images; Twitch accepts the header on
   the DUT.
   Source: M98, follow-up 3 in `PLANS.md`; the M99 wizard offers "Another RTMP service". Recommendation:
   owner decides whether targets other than Twitch must work reliably; recommended yes, re-measure with
   the real image first and fix only if confirmed.
8. **The setup text about `CHANNEL_TIMEZONE` is not always true.** The form says the variable overrides
   the stored value; for an invalid value it does not.
   Source: M85. Recommendation: do it, as a small wording milestone with 12 and 13.
9. **Owner password: old sessions stay valid.** After a change or reset, sessions stay valid for up to
   30 days, including one signed in with a leaked password; the minimum length of 10 is hard-coded in
   first-run setup.
   Source: M91. Recommendation: do it, as its own small milestone, early.
10. **Two details in the wizard.** A regional Twitch ingest is labelled "Another RTMP service", and newly
    playable sources are only ticked when the step is opened again.
    Source: M99, left on purpose in review. Recommendation: leave, both only affect display and
    preselection.
11. **Searchable time-zone list.** Suggested by the research, not built.
    Source: M91. Recommendation: leave, the zone field is already prefilled with the browser zone.

## Planning the programme without a manual

12. **Two schedule help texts are wrong since M88.** The "Conflicts only" tooltip says "on the same
    weekday" although overlaps across midnight count too; the cuepoint tip says cuepoints re-arm after
    midnight. M104 changed neither.
    Source: M88, M93. Recommendation: do it, with 8 and 13.
13. **The library list sits below curation sets and bulk editing.** R2 suggested moving it above; M99 left
    it out.
    Source: M99. Recommendation: do it, with 8 and 12.
14. **The week view does not know the Twitch cache cooldown.** A Twitch VOD that could not be cached is
    skipped for a while but still listed in the week view.
    Source: M94; M97 "Not built". Recommendation: do it, as a small milestone with 15, 16 and 17.
15. **The week projection is off in three places.** In the running block the next item starts "now"
    instead of after the current one. When a dated block shares the pool of the weekly block it cuts, the
    weekly block gets its items before the dated one. The 5,000-item limit cuts a 24-hour block of very
    short clips too early.
    Source: M97, review paragraph ("Left"). Recommendation: do it, with 14, 16 and 17.
16. **`/channel` sometimes shows wrong times.** When the current item overruns its block, the next block
    in the list still starts on time. When the current video's duration is unknown it is missing, and
    "Next" shows an item from "now" that is not on air.
    Source: M100, "Left" and an open review note. Recommendation: do it, with 14, 15 and 17.
17. **The live summary miscounts cuepoints of dated blocks.** It ignores their air windows; the worker
    honours them (since M93), so what airs is right.
    Source: M101, "Left". Recommendation: do it, with 14, 15 and 16.
18. **The Day lens still speaks internally.** It counts minutes ("1440m scheduled") with internal terms;
    its video timeline starts every block at the stored position, so two blocks of one pool on one day
    show the same first videos.
    Source: M97 ("Not built", U6) and *Known follow-ups*. Recommendation: do it, as a small milestone with
    19, because the block form lives in the Day lens.
19. **Editing dated blocks is incomplete.** Editing a whole repeat series checks only against the
    weekday of the edited copy; the carry-over hint in the block form and the "for N days" help are
    missing.
    Source: M93. Recommendation: do it, with 18.
20. **DST change in March 2027.** A block that starts in the skipped hour airs from 03:00, but the Twitch
    segment and cuepoints count from 03:30; one that ends in it goes to Twitch too long. Week view and Day
    lens use wall-clock lengths.
    Source: M101, "Left". Recommendation: leave, one night a year and M101 accepted the Twitch segment
    this way; if it is done, then before 2027-03-28.
21. **Small things on `/channel`.** A daily 24-hour block gives one "Up next" card per day, local files
    have no thumbnail, `laterScheduleItems` sits unused in the snapshot.
    Source: M100, "Left". Recommendation: leave, none of it falsifies the programme or its times.

## Operating the channel

22. **Operator actions get lost or stay invisible.** The live view does not show holds such as "Remove
    next"; Resume only works for Pin, Fallback or Insert. Skip clears a queue rebuild requested just
    before, Restart an open Refresh; a pending restart is lost without a log line when the reconnect or
    standby slate takes over.
    Source: M89, M94. Recommendation: do it, as its own small milestone.
23. **`!now` during a short recovery.** While playout briefly reads "recovering", e.g. after a Skip, the
    bot answers that nothing is on.
    Source: M104, the only open review note (documented). Recommendation: leave, the state is short and
    the review accepted it.

## Tests and docs

24. **The real ffprobe tests do not run in CI.** The validate job installs ffmpeg only after `pnpm test`;
    they passed locally.
    Source: M96. Recommendation: do it, as a small milestone with 25.
25. **`PLANS.md` is far too long.** About 1,100 lines instead of under 300 (the M84 limit), and an M64 note
    names old section numbers of the guide. Docs only.
    Source: M88, M92, M95. Recommendation: do it, with 24.

## Owner only

26. **Check the Twitch labels in the guide.** The cloud cannot reach twitch.tv. At the next Twitch login,
    check that Creator Dashboard Settings -> Stream leads to "Primary Stream key" and that
    dev.twitch.tv/console/apps names the client type "Confidential"; report only differences.
27. **Delete two old branches.** The proposal branch is superseded; the research branch's fixes reached
   `main` with M88.

   ```sh
   git push origin --delete claude/proposal-2026-10-te1vlg
   git push origin --delete claude/r1-scheduling-competitors-v5o5zi
   ```
