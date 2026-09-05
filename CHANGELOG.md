# Changelog

## Unreleased

### Fixed

- Every visible setting now does what it says, or it is gone (M60). "Show clock" and "Show next item"
  finally reach the picture: they flipped a flag the on-air layout never read, so the clock and the
  next card were drawn regardless. Removed from the studio because nothing consumed them: "Show
  schedule teaser", "Show queue preview" with its count, the website-embed and widget layer kinds
  (the renderer cannot draw an external page and there is no browser overlay), and the engagement
  "Chat mode", "Style" and "Alert position". Stored values stay where they are; the API keeps
  accepting the fields. The library upload accepts exactly the formats the worker's scan ingests —
  it used to take `.avi` and four audio types that were copied to disk and then ignored.

- The scene studio was unusable on any screen, and the pixel baseline had frozen the fault as the
  expected picture. `.scene-designer-preview` is a grid, a grid's rows stretch by default, and the
  column was as tall as the form beside it — some 4700px — so the "Scene Preview" label sat at the
  top, its select a screen lower, the rendered picture somewhere in the middle and the drag help at
  the very bottom, with blank space between them. Start-aligned now, and sticky from 901px so the
  picture stays in view while the operator scrolls the form. Measured after: toolbar at y=691,
  picture at y=800, help at y=1209, sidebar 3484px tall beside a 570px column.

- The admin content column had no width cap, against the layout rule in `docs/ui.md`: on a 2560px
  display a paragraph ran 2200px wide. `.content-stack` caps its children at `--workspace-max`
  (1440px); the scene studio widens that to 1800px with `workspace-wide`, because there the preview
  is the work. Its "Published scene state" aside opts into `grid-aside` and sits beside the controls
  from 1560px viewport width instead of below the whole form. A viewport query on purpose: the first
  cut measured the workspace with inline-size containment, and that containment let the content
  column grow past the viewport on every admin page.

### Added

- `InfoTip`, the (i) beside a label. `Input`, `Select`, `Textarea`, `Panel` and `AdminPageHeader`
  take an `info` text and render it behind a real button that opens on hover and on keyboard focus,
  wired through `aria-describedby`. The scene studio's header, both panels and the preview toolbar
  carry the first four. The control-density budget does not count them: an explanation is not
  something the operator does to the channel.

- Every field label in the admin UI now carries an (i) explanation — 254 of them across 38
  components, each derived from the code that consumes the value rather than from the label, and
  each tried by two independent reviewers before it stayed: 228 objections were raised and applied.
  33 labels were left bare with a stated reason (section headings that already carry a paragraph,
  read-only status rows, the per-card selection checkbox, a `<summary>`). The reviewers also found
  settings that nothing reads — the scene's show/hide toggles for clock, next item, schedule teaser
  and queue preview, the embed/widget layer fields, the engagement chat mode, style and alert
  position — and left those without an explanation rather than describe an effect that does not
  exist; they are listed in `PLANS.md` under M59 as decisions to take.

  Two things the first verification runs taught about a tip inside a `<label>`: a `<button>` is a
  labelable element and takes the label away from the field, so the trigger is a `span` with
  `role="button"`; and a label's text is everything under it, hidden or not, so a tooltip element
  made `getByLabel("Password")` match the e-mail field whose explanation mentioned the password.
  The explanation is therefore a `data-tip` attribute drawn with CSS and exposed through
  `aria-description` — no tooltip element in the DOM. Both were proven in a two-field harness first.

- `tests/e2e/studio-layout.spec.ts` asserts the studio layout by measurement — column alignment,
  the distances between toolbar, picture and help, the column staying shorter than half the form,
  the picture still on screen after scrolling 1500px — and that an (i) opens on focus. The pixel
  baseline cannot see any of that: its 1% tolerance is ~23,000px at 1440x1600, and four 16px
  buttons passed it unnoticed.

## 1.5.47 - 2026-09-05

### Fixed

- The release run failed on a wording baseline that had nothing to do with the release. `live-status`
  lists the upcoming blocks with how much of each the fill still covers — "Selected from Lokale
  Bibliothek for 840 minutes" — and that number is decided by the wall clock against the seeded
  schedule, exactly like the status-rail values the baseline already drops. It read 1020 on a
  Saturday afternoon, on CI and locally alike. The minutes are now masked as data, the way times,
  days and ages already were, and the snapshot is regenerated with the mask in place. Test-only.

- The studio preview and the channel disagreed about what was on air during an insert. The worker
  hands whatever asset is playing straight to `overlayOnAirChapterTitle` and lets that helper's own
  guards decide; the preview gated the same lookup on `queueKind === "asset"`. An insert is an
  asset, playing, with `currentAssetId` pointing at it — so a chaptered insert was named by its
  queue entry in the studio and by its chapter on the channel, for the same second of the same file.

  Measured before fixing: the insert case failed with `'queue entry title'` where the channel says
  `'The middle part'`, while the plain asset case beside it passed as a control. The live branch
  keeps its own wording and is pinned by a test, because a live bridge has no asset to take a
  chapter from. Standby and reconnect are untouched in practice: the worker draws them with
  `writeStandbySlate`, which runs precisely when there is no asset.

- An incident could open and resolve leaving nothing behind at all. Measured on the live channel:
  `playout.prefetch.failed` opened somewhere inside a twenty-minute window and resolved at 13:06:08.
  Neither container logged a line — 30 of the 48 `upsertIncident` call sites have no
  `logRuntimeEvent` beside them — and `resolveIncident` then wrote its resolution text over the
  `message` column, which had held the probe's actual error. Log gone, message gone. The only reason
  anyone knew was a control round that happened to poll the table inside the window.

  Incidents are now announced once per ONSET, in the one place every caller already passes through
  rather than at 30 call sites. Per onset and not per call, because an incident that stays open is
  re-upserted on every reconciliation cycle and a line each time would bury the one that counts. The
  announcement sits AFTER the write: `withSerializedStateWrite` re-runs its whole callback on a
  retryable error, so a line inside would print again on every retry and print at all for a write
  that then threw — announcing an incident the table never received. The values logged are the
  redacted ones; an ffmpeg line quoting the publish URL reached this table with the stream key
  intact on 2026-09-01, and a log sink is no safer a place for it than a column.

  Self-resolution does not overwrite the message: it passes no resolution text, and the column only
  changes under `COALESCE(NULLIF($2, ''), message)`. So an incident that expires on its own keeps
  its diagnosis; only an explicit `resolveIncident(fingerprint, text)` replaces it.

### Documentation

- `getLiveBridgeFfmpegCommand` carries the same audio-starvation shape as the asset path, and the
  arithmetic is now written down beside it. If the live source stops delivering audio, the picture
  continues off the endless scene pipe, and unlike the asset path nothing cuts the run short —
  `targetKind: "live"` is excluded from the duration bound, so only the feed-audio watchdog ends it,
  at 90s. That is late: the uplink storms at 120 discontinuity lines in a fixed 60s window, and a
  20-30s silent stretch measured 200-600 lines at a boundary. Left unpadded on purpose, because
  `-shortest` is set on that path and the picture is already endless, so an unbounded `apad` has
  nothing finite to bind to and there is no duration to bound it from. The comment says explicitly
  that the exposure is arithmetic and NOT an observation — the live bridge has never run on this
  installation, zero audit entries matching "live" — so the next reader checks instead of trusting
  it. Two confident and wrong comments on this same path already cost three weeks.

- The uplink restarted itself at some asset boundaries and not others, and the padding shipped in
  1.5.46 did not stop it. Measured across nine boundaries: each encode's output PTS starts at zero,
  so the reader offsets both streams by the outgoing asset's elapsed output time — separately per
  stream. The two values disagree by how far audio had run ahead of video in the dying encode.
  Storms 13.45/13.22/12.25/11.84s against quiet boundaries 6.69/6.52/3.52/2.43/1.07s: a total split,
  with ffmpeg's `dts_delta_threshold` default of 10s in the gap. Under it only the backwards clause
  fires, once; over it the forward clause fires too and every packet re-derives an offset, about ten
  log lines a second, until the storm guard kills the process — confirmed by the kill times matching
  the last line to the second at all four storms.

  The threshold is now 60s on the HLS input only; the rtmp input carries one continuous timeline and
  keeps the default. 60 clears the largest skew `apad` can produce rather than the largest one
  observed, and stays finite so a dead input is still caught by out_time stall detection and the
  feed-audio watchdog. Why audio leads by 12s at some seams and 1s at others is NOT explained: the
  same asset, from a complete local file, produced 13.45s, 13.22s and 1.07s at comparable overruns.
  This treats the symptom. It also records that the `apad` comment beside it diagnoses the opposite
  sign — the outgoing file carried continuous audio 20s past its cut, and steady-state feed audio
  tracks video to within 17ms — and leaves both readings standing, because which one holds for
  which boundary is not known.

## 1.5.46 - 2026-09-03

### Fixed

- Every programme boundary restarted the uplink, and had done since 2026-08-19. Viewers saw an
  interruption at every asset change on a 24/7 channel.

  The feed carried **video without audio for the last 20-30 seconds of every asset**. The input
  reaches EOF and `-map 0:a?` simply stops — but the picture does not, because `overlay` ends with
  its LONGEST input and the scene pipe never ends, and the duration bound only cuts at
  `duration + margin`. The uplink's reader keeps its timestamp offset per FILE and `next_dts` per
  STREAM, so across that silent stretch audio's clock freezes while video advances; when the next
  asset restores audio, no single offset satisfies both streams and the reader oscillates — video
  backwards, audio forwards, packet after packet — until the storm guard kills the uplink.

  The proof is arithmetic rather than argument. The two `new offset` clusters sit exactly the silent
  stretch apart, and the lower one is exactly the outgoing asset's recorded duration:

  | boundary | lower cluster | recorded duration | separation | overrun |
  |---|---|---|---|---|
  | 03:33 | — | — | 31.897 s | 32.04 s |
  | 07:44 | 15040.05 s | 15040 s | 26.93 s | 26.95 s |
  | 07:56 | 739.04 s | 739 s | 20.92 s | 18.98 s + start |

  Three boundaries, three different separations, each one predicted by how far that asset overran.
  Reproduced locally in the production shape: 321 discontinuity lines, and the tail segments carry
  no audio stream at all. With the audio padded: 1 line, and 86 audio packets in the same segment.

  The programme's own audio is now padded with silence, for the duration bound's margin plus thirty
  seconds of slack, so it lasts through the overrun and then stops. The conditions are all
  exclusions and each is load-bearing: scene mode only, because text and none take video straight
  from the input and the picture ends with the file; never where `-shortest` is set, because it
  binds the output to the shortest stream and in scene mode the picture is endless; and not for a
  looping audio lane or a picture-in-picture mix, neither of which starves.

  **The bound is the important part, and it came out of review.** An unbounded `apad` fixes the
  storm and disables the feed-audio watchdog for ever, because that watchdog keys on audio packet
  PRESENCE and `apad` manufactures real AAC frames indefinitely — measured on the compiled
  watchdog: without padding the tail segments carry `audioPackets=0` and it fires at 96s; with an
  unbounded pad it never fires again. That is worst exactly where it is the only net.
  `durationSeconds` is written only by the yt-dlp path, so every local-library file and every
  direct-media URL is permanently unknown-duration — and the global fallback asset is by
  construction a local-library file. An unbounded pad would have let the fallback, the thing that
  plays when everything else has already failed, sit on a frozen frame with digital silence and
  nothing in the system able to end it: the very failure the feed-audio watchdog exists to stop.
  The picture-in-picture mix already refuses the same trade in the same words. Verified: 90s of
  content plus `pad_dur=45` gives 134.98s of audio against 200s of video, and a test drives the
  real watchdog over a padded feed to show it still fires once the pad runs out.

  Two comments had explained this away for three weeks — one crediting `dts_delta_threshold`, which
  is passed nowhere and gates the wrong direction, and one asserting that "a healthy uplink reports
  zero" when a healthy boundary reports 244. Both were corrected first, which is what made anyone
  look.

### Fixed

- One Docker Hub blip took a whole CI run with it. Run 33710726231 died at `pnpm test:fresh-compose`
  after hanging fifteen seconds on `auth.docker.io` without reaching a single layer, taking twelve
  green steps and seventeen unrun ones with it. Nothing in the commit was implicated: the push run
  for the same SHA pulled that identical tag in the same minute and passed, and a re-run of the
  failed one passed too. The pull inside `docker compose up -d` simply has nowhere to put a second
  attempt.

  Every image the job fetches from a registry we do not own is now pulled once, up front, with a
  retry. The pull happens either way; this moves it.

  The load-bearing part is not the retry, it is the two ceilings. Runs on a ref are serialised with
  `cancel-in-progress: false`, so an unbounded network step blocks every later commit — the exact
  wedge the job's own 45-minute ceiling was added for. Measured against a registry that answers
  headers and then trickles the body: a single `docker pull` ran 98 seconds and was still going.
  So each attempt is capped at 60s and the step at 6 minutes, and the worst case is arithmetic
  rather than hope.

  Retries cover transport failures only. A missing tag, a 429 or a denied pull is the registry
  stating a fact, and facts are not flaky: those go red on the first attempt, so a bad version bump
  still reads as a bad version bump. Classification is by exit status first and text second, because
  a killed pull leaves no output at all.

  Three adversarial reviews of the design and a stub-docker harness over eight scenarios found four
  defects before it shipped, all of which read as correct: a pipe into `grep -q` that inverts under
  `pipefail` when the writer dies on SIGPIPE; a coverage rule written as a registry denylist, which
  would silently drop the relay the day it is mirrored into our own registry; an output-capturing
  `$( )` that would make a hung pull a step emitting zero bytes; and `rc=$?` read after a `fi`,
  where an `if` with no `else` returns 0 when its condition fails — so the status check was inert
  and every timed-out pull was reported as "the registry answered". The harness found that last one;
  reading the code did not.

### Added

- The channel now says when a ticker edit has not reached the screen. The crawling line is one image
  the encoder moves, made when a programme starts, and the period it moves by comes from that line's
  own ink — so a new text needs a new graph and the graph is fixed for the life of the process. A
  few minutes on a channel playing assets; on the standby slate or a live bridge, which run until
  the selection changes, possibly not at all.

  This does not fix that. It makes it visible, which is the difference between a documented
  limitation and a silent one: before it, an operator typed a correction, watched the studio preview
  update, and had no way to learn that the channel was still running the old line. A cleared ticker
  counts as stale too — the band belongs to the process while a crawl runs, so emptying the field
  does not take the old line off the screen.

  Checked where the payload is written rather than on the render tick, and the resolve only fires
  when something was actually raised: `resolveIncident` takes the global serialized write lock,
  the one every state mutation contends for, so resolving unconditionally would have taken it every
  reconciliation cycle for ever, for a zero-row update, on a channel with no ticker configured at
  all.

## 1.5.45 - 2026-09-03

### Fixed

- The audit trail could lose a sign-in to an uplink reconnecting. Every entry competed for one
  window of the newest 500, so the trail was only ever as long as the noisiest thing writing to it.
  Measured on the live channel: 142 entries over 31 hours, of which 100 were `uplink.cycle` and
  `worker.cycle` — 70% reconciliation chatter. At that rate the window fills in about four days,
  and from then on an authentication, a permission grant or a deleted destination is pushed out by
  traffic that means nothing.

  A second, equally bounded window now keeps the entries a trail exists for: authentication,
  authorisation, credentials, where the stream is sent, who silenced an alarm, and destructive
  deletions. Deliberately not every operator action — protecting everything protects nothing,
  because the protected window would then fill with the same traffic the general one does.

  Both writers use it: the one that appends a row and prunes around it, and the one that rewrites
  the whole table from memory. The rule is a single POSIX-compatible pattern so the pruning SQL and
  the predicate cannot drift; verified against the live database, where Postgres and JavaScript
  select the same three types out of the twelve present, and against four thousand fuzzed strings
  without a disagreement.

  The first version of this protected nothing. The state read was capped at the general window and
  the rewrite replaces the table with what that read returned — so a protected entry below the cap
  was destroyed by the very next state mutation, whatever it was. Measured: five hundred protected
  entries gone after one no-op edit, and neither shipped integration test could see it, one because
  it drives a different write path and the other because it seeds fewer rows than the cap. The read
  now takes both windows. There is a test that buries a sign-in under six hundred cycle events and
  then makes an unrelated edit.

  The prune orders by `created_at` twice and the table carried only its primary key, so both
  subqueries scanned and sorted it in full inside the serialized write lock — 1.28ms to 11.89ms at a
  thousand rows. An index gives that back.

- The studio preview did not know that chapters exist. A long recording with chapters is named on
  air by the chapter that is actually playing — the worker has resolved that from elapsed playback
  since chapters were added — and the web app named the file. So the channel said "Advent of Code ·
  Day 7" and the preview said "Advent of Code", for the same second of the same asset.

  The resolver moves into the core package and both sides call it.

  Corrected from the first draft of this entry, which claimed the asset display title "moves with
  it": it did not. It was written three times, a fourth copy joined them in core, and three stayed —
  found by adversarial review, not by anyone reading the diff. What has since happened is smaller
  and true: the private copy inside `apps/web/lib/server/state.ts` is gone and that file calls
  core's, and the worker's and the web app's are now held against core's by a test over a battery of
  inputs including whitespace-only titles, zero-width characters and a right-to-left override. They
  agree; nothing was holding them to it before.

- The studio and the channel wrote the next block's times differently — "20:00 to 22:00" in the web
  app, "20:00-22:00" on air, for the same block of the same schedule. Whichever an operator read,
  the other was what viewers saw. One concept, two implementations, and nothing making them agree:
  the same shape as the overlay mode that ran text on air while the studio drew a scene.

  The broadcast wins, because the preview exists to show what airs. Both now call one function, and
  a test fails if any payload site starts formatting it inline again. The pages' own prose still
  reads "20:00 to 22:00" where it is a sentence rather than something the channel broadcasts.

### Added

- The database is now asked, after every set of migrations, whether it has the columns this build
  writes to — and says so loudly when it does not. That is the check the design-studio breakage
  needed and did not have: a column added to the base-schema block alone reaches a fresh install and
  nothing else, and because the columns in question are only written on an explicit save, the
  channel ran on with clean logs while every save failed.

  The columns the source declares are generated into a manifest by
  `scripts/generate-schema-manifest.mjs` and kept honest by a test that re-parses the SQL and fails,
  naming the column, when the two disagree. Verified against the live database once written: 39
  tables, 460 columns, nothing missing and nothing extra. That comparison also caught a fault in the
  parser itself — `schema_migrations` closes its statement on the next line, so requiring the
  semicolon made the body run on into the surrounding JavaScript and offer "async", "await",
  "const" and five more as columns.

  It reports drift; it does not repair it. Repairing would mean running DDL on every boot against a
  live database, and that lock is not worth paying to save writing a migration on purpose.

  Adversarial review then hardened it in three ways. The unit test compares the manifest against the
  parser that produced it, so anything the parser cannot see is invisible to it — a wrapped column
  definition contributing "default" as a column, a commented-out ALTER, a multi-line CHECK that
  swallows five real columns, each of which would raise a critical incident on every boot of a
  healthy channel, forever. The comparison against a real migrated database is now an integration
  test asserting both directions, which is the only thing that has ever caught a parser fault.

  The columns are read from `pg_catalog.pg_attribute` rather than `information_schema.columns`,
  which only shows what the current role holds a privilege on: measured, a role with SELECT on one
  table saw 26 of 460 columns, so on any deployment where the application is not the database owner
  the check would have reported four hundred missing columns on every boot.

  And the stated cause of the deadlock this feature already survived was wrong. It was not pool
  contention: the incident write goes through the serialized state write, which opens by awaiting
  the very bootstrap promise that is still running the migrations. A promise awaiting itself hangs
  at any pool size, so the obvious reading of the old wording — raise the pool — would have fixed
  nothing.

## 1.5.44 - 2026-09-03

### Fixed

- The design studio could not save. `panel_placements_json` and `ticker_rotate_seconds` were added
  to the base-schema block and to nothing else, and that block is itself a migration under one fixed
  id — once the id is recorded it never runs again, so a fresh install had the columns and every
  existing one did not. Measured on the live channel: `overlay_settings` carried 33 columns and
  neither of these two, in `overlay_settings` and `overlay_drafts` alike, and
  `SELECT panel_placements_json` answered `column ... does not exist`.

  Both are in the column list of `upsertOverlaySettingsTable`, which `updateOverlaySettingsRecord`
  and `publishOverlayDraftRecord` call, so every save and every publish out of the studio failed
  against that database — including the one an operator makes by dragging a panel, which is exactly
  what writes `panel_placements_json`. Nothing said so: that write only happens on an explicit
  save, so the channel ran on and the logs stayed clean.

  The migration it never got is now written. It is additive and idempotent, and its defaults are the
  readers' own fallbacks, so there is nothing to backfill.

## 1.5.43 - 2026-09-02

### Changed

- The ticker runs. It used to be a dwell: one message held still, the next taking its place on a
  timer, because the renderer redraws on `SCENE_RENDER_INTERVAL_MS` — 2000ms by default, floored at
  1000ms — and a line drawn into the frame at that rate cannot crawl, it can only teleport 118px a
  step. That reasoning was sound and it was about the wrong thing: the crawl was never the
  rasteriser's job.

  ffmpeg moves it now, at the output frame rate, for nothing per frame. The line is rendered once
  per programme as a transparent strip; a bed the size of the band's clear run does the clipping,
  and as many copies of the strip as the bed needs are laid down a period apart, so the line tiles
  the band continuously and enters at its right-hand edge. The period is held at the band's own
  width, so a short notice sweeps across on its own rather than appearing four times side by side;
  a line longer than the band already exceeds that and keeps its designed gap. Measured before any of it was written:
  exactly 4px of travel per frame at 120px/s and 30fps, clipped to the band.

  All the messages join into one running line, so the automatic rotation is gone. The seconds
  setting stops meaning how long a message stands and starts meaning how long one crossing of the
  band takes, clamped into a legible 40-240px/s on the design grid and scaled with the frame. It is
  now offered for a single notice as well as for several. The studio preview draws the line at
  rest, because a still picture cannot show it moving.

  On air the band is drawn empty and belongs to the process rather than to the current text: a
  ticker cleared mid-programme would otherwise take the band away and leave the line crawling over
  bare video. A strip that fails to render leaves the renderer drawing the line at rest, so a
  failure costs the motion and never the picture — and it now raises an incident, because the
  fallback is quiet enough to hide: the band still draws and the line still appears, standing still
  instead of running.

  The cost of rendering the strip once instead of feeding it is real and worth stating plainly: a
  ticker edited mid-programme reaches the screen at the next block, where the dwell replaced it
  within one render tick. The period the encoder moves the line by is derived from the ink's own
  width, so a new text needs a new graph, and the graph is fixed for the life of the process. On a
  channel playing assets that is a few minutes. On the standby slate or a live bridge, which run
  until the selection changes, there may be no next block at all, and the only way to replace a
  ticker is a playout restart — which interrupts the stream. The emergency banner is a separate
  field still drawn on the two-second tick, so an actual emergency keeps its own way onto the
  screen.

### Fixed

- The scene overlay filter was written out three times in `apps/worker/src/index.ts` — for an
  asset, for a live bridge and for the standby slate — and none of the three could be reached from
  a test. They agreed with one another by luck. They now build one graph from one function, which
  is also what let the ticker crawl reach all three instead of whichever was remembered.

- The crawl laid down exactly two copies of the strip, which tiles only a bed narrower than one
  period. Measured on the ordinary case — "Welcome to the stream" at 1080p, 213px of ink in a
  1722-wide band — the rightmost column ever painted was 665: a thousand pixels of permanently
  black bar, and the next pass materialising a quarter of the way across the band every three
  seconds instead of entering at its right edge, which is the teleport the crawl exists to remove.
  The copy count now comes out of the ink: `(K-1)*period + ink >= bandWidth`. Found by review
  before it shipped; the suite could not see it because its ffmpeg probe ran two seconds and one
  wrap takes nearly seven. There is now a test that runs a whole period, and with the old two
  copies it fails with 761px of dead band and a 593px jump.

- The strip's canvas was an estimate treated as a fact. A line of glyphs wider than 1.3 em — the
  loaded face carries some at 2.02 — outgrew it and was silently CUT, so the crawl ran a period
  that did not match its ink and the tail of the operator's text never reached air. The ink is now
  measured against the canvas and the strip redrawn on a wider one when it has reached the edge.

- A ticker panel dragged in the studio during a programme moved the band and left the line crawling
  where the band used to be, over bare video, until the next block: the ffmpeg graph is fixed when
  the programme starts and the renderer was reading the placement live. In crawl mode the band is
  now drawn at the placement the crawl was built against, so the two cannot part company.

- `overlay` ends with its LONGEST input, not with the picture it is drawing onto. The crawl adds a
  looped image and a colour source, both endless, so without `shortest=1` on the last overlay a
  two-second programme produced thirteen minutes of output and was still running when the probe
  killed it. The crawl now ends with the picture it draws onto, whenever that picture ends.

  Stated more carefully than it first was: this does not change when a playout process ends today.
  On air the scene pipe never EOFs either, so the picture being drawn onto is itself endless and
  the graph is bounded by nothing — exactly as it was before the crawl existed. What ends a
  programme is the worker, through the duration bound or a stop. The first draft of this entry
  claimed the channel would have hung at every boundary without it; that was measured against a
  finite scene input and is not true of production.

## 1.5.42 - 2026-09-02

### Fixed

- The overlay in the studio was not the overlay on air. The preview drew the scene; the broadcast
  ran the old `drawtext` overlay — no scene, no custom layers, no chat, no game, no ticker, no
  clock — for the entire length of a programme, hours for a VOD. A camera the operator had decided
  to attach was dropped without a word, and nothing raised an incident, so the only trace was a
  single `scene.render.recovery.skip` log line.

  The trigger was a programme ending normally. ffmpeg leaves with code 0, and the exit path writes
  status `idle`, `lastExitCode` `String(0)` — the string `"0"`, which is truthy — and a fresh
  heartbeat, then asks for the next cycle straight away. That satisfied every clause of the
  recovery skip that was meant for crash restarts, so the next process skipped the initial scene
  frame, fell back to text mode, and stayed there: the mode is baked into the ffmpeg command and
  cannot be changed while the process runs. Since `lastExitCode` is never cleared on a successful
  start, it stuck from the second process onward. The missing incident had the same root — the
  fallback incident lives inside the very call that was being skipped.

  The skip dated from a renderer that screenshotted Chromium and took about ten seconds. Measured
  now on the production box while it was encoding the channel, the native renderer needs 201ms for
  a cold 1920x1080 frame, 125ms warm, 82ms cold at 1280x720 and 106ms for the busiest frame the
  overlay draws. It was saving a fifth of a second and costing a whole programme, so it is gone
  along with its 60-second window: every playout process now renders its first frame, and the
  previous exit code has no say in what the channel shows.

  A renderer that genuinely stalls — the one hazard the skip gestured at — is now handled where it
  belongs. The first frame is bounded at five seconds, about twenty-five times the worst measured
  render, and a timeout raises the existing `playout.scene-render.failed` incident, which now also
  states that the programme on air will run to its end in text mode.

## 1.5.41 - 2026-09-02

### Security

- Detecting an unreadable secret was not enough: the next write destroyed it, and the two-factor
  bypass came back. Found by the adversarial review of v1.5.39, reproduced against a real Postgres.
  With a rotated or lost `APP_SECRET`, every stored secret decrypts to nothing and the login
  correctly refuses — but the first full-state write after that, which a moderator's `!game` is
  enough to trigger, deleted and re-inserted every user with an empty secret and wrote encrypted
  defaults over the managed config. That erased the only copy of the two-factor secrets, the Twitch
  credentials, the stream keys and the relay key, beyond recovery even with the right `APP_SECRET`
  restored — and because the column was then empty, the flag that makes the login refuse went with
  it and the second factor was silently skipped again.

  Nothing now encrypts over a ciphertext the process could not read. Users keep their stored value
  on both write paths, the managed config is left alone when its payload will not open, and the
  test that proves it rotates the key underneath a live store: without the guard the stored
  ciphertext reads `''`, with it the byte-for-byte original.

## 1.5.40 - 2026-09-02

### Fixed
- The Twitch chat connection could not be switched off. An install with the chat rail hidden, the
  moderation policy off and viewer control off still held an IRC connection open around the clock.
  The bridge was taught to stay up for any consumer that needs it — check-ins, votes, viewer
  requests, the chat game — and the chat game's consumer flag was `Boolean(chatGameForBridge.gameId)`.
  The chat game's settings row has no enabled field at all: `gameId` defaults to `snake` and is
  never empty, so that expression was constant true. One consumer that could never be off kept the
  connection up for every install, and the chat rail's description on the engagement page — which
  promises the connection stays up for the other consumers — read as if the rest could still be
  switched off.
  The chat game's on and off is the overlay scene — a layer of kind "game" — and the bridge follows
  that now. It follows the layer's presence rather than its enabled flag on purpose: stopping a
  round keeps the layer and only disables it, so a bridge that watched the flag would drop the
  connection the moment a game ended and the next `!snake` would never arrive. A studio with no
  game layer at all has never had the chat game switched on, and that is the case where the
  connection is not needed for it.
- The queue limit for `!request` did not hold within a cycle. With the limit at two and ten viewers
  typing `!request` inside the same thirty-second window, all ten were accepted, and the same title
  went into the queue once per asker. Both the limit and the "that one is already in the queue"
  check were decided against the cycle's snapshot of the playout queue, and the worker decides
  every request accumulated since the last cycle in one loop — the snapshot does not move while
  that loop runs, so all ten saw the same number. The record written for an accepted request was
  then retired as played on the loop's very next turn, for the same reason, so even the count that
  did reach the database was wiped before it could be read.
  The pass now carries what it has already accepted, and the limit and the duplicate check are
  decided against that. Two are accepted and the remaining eight are told the queue is full; the
  same title is queued once. Nothing new is stored.


- The on-air clock stood still on a quiet channel. Found while measuring the ticker: the overlay
  clock is drawn from the wall clock, but the frame cache key never carried it, so on a channel
  where nothing else moved — a long VOD, no chat, no game — the renderer kept pushing the picture
  it already had and the time on screen stayed at whatever minute it was when something last
  changed. The key now carries the clock string that is drawn rather than the instant it came
  from, so it changes once a minute instead of once a render and the cache still spares the
  rasteriser in between.

### Added

- The ticker goes on air. The scene payload has carried `tickerText` since the first overlay, the
  studio has had a field for it, and the renderer drew it nowhere — measured on the rasteriser
  before anything was touched: setting the text, clearing it and replacing it all produced layout
  checksum `0eca45b0776bab1f`. It is now the seventh built-in panel, with the same placement, the
  same opacity and the same drag handle as the other six, and it draws only while it has a text.

  It rotates rather than crawls, and that was decided by measurement, not taste. The on-air
  renderer redraws on `SCENE_RENDER_INTERVAL_MS` — 2000ms by default, floored at 1000ms — so the
  picture changes half a time to one time per second; the 1fps pipe re-pushes the cached PNG in
  between and never produces a frame the renderer did not draw. A Latin glyph at fontSize 24
  advances 14.24px on this rasteriser, so crawling the 1776px safe area in 30 seconds at the
  default rate means 118.4px per frame, which is 8.3 characters of sideways teleport per step; the
  most generous setting anybody would accept — the 1000ms floor, a full minute per crossing — still
  jumps 29.6px, 2.1 characters. A crawl wants 25 to 60 frames a second and this pipeline has half
  of one. So messages separated by `·` take turns instead, one standing for its dwell, which is
  sharp at every rate above.

  That made the frame cache the load-bearing part. `sceneFrameCacheKey` carried no clock, so a
  ticker that advanced in the layout would have been rasterised exactly never. The key now carries
  the drawn line: the empty string forever without a text, one message forever with one, and moving
  exactly once per dwell with several — so a channel with no ticker re-renders no more often than
  it did before.

  Legibility, over video the panel has no say in: the fill is `rgba(8,10,15,0.94)`, the same alpha
  as the existing "solid" surface so the palette gains no number to keep in step. White ink on it
  measures 19.87:1 over black video and 17.64:1 over white — the two ends of what a video frame can
  be. A line too long for the box is cut at the box, not drawn past it: 180 characters of Latin and
  180 of full-width CJK both draw 1722px into 1728px of inner width, by the chat panel's own rule
  of taking the line count from the box height rather than from a character budget.

  Measured on the way and not expected: `resolvePlacementBox` floors every box at 8% of the safe
  area, so the clock's box is 77px tall where the clock draws 48. The ticker's first default at
  y=120 overlapped it by 13 pixels; it sits at 150 now, clearing the deepest box in the top bar.

  The five golden frames keep their recorded checksums — the ticker text in their shared payload is
  cleared, because it never reached the picture and now would. A sixth fixture is the frame that
  draws one.

## 1.5.39 - 2026-09-02

### Added

- The overlay panels can be dragged and resized on the studio preview, the way an OBS layout is
  built. The preview has been the broadcast renderer's own picture since stage 2; it is now the
  editing surface as well. Taking hold of a box moves an outline only — nothing is redrawn during
  the movement — and letting go commits the percents and asks for a new frame; the last good frame
  stays on screen until that one arrives, and a failed render no longer replaces it with an error
  box. Dragging a panel that is still in the flex flow places it, seeded from where the flow had
  it, so an operator no longer has to find a checkbox before they can move anything. The four
  number fields stay beside every box: a drag says "about here", the fields say exactly where, and
  clicking a box on the picture opens the sidebar at its row.

  This rests on one new function. `resolvePlacementBox` turned percents into frame pixels and had
  no inverse; `resolvePlacementPercent` is that inverse, next to it in the same file, reading the
  same safe area through the same `overlayScale` and applying the same clamps. Round trip measured
  over 65341 boxes per output size: exact at 1920x1080 and at 1280x720. At 854x480 and 640x360 the
  forward resolver rounds offset and size separately, and 1.10% resp. 0.55% of boxes end one pixel
  past the safe rectangle — a box no percent can reproduce, because the resolver's own width clamp
  refuses it; the inverse returns the largest box that fits and the test says so rather than
  hiding it.

  The preview is drawn at the profile's real output size, not always 1920x1080. That matters:
  `overlayScale` floors at 0.35 and every dimension is rounded, so at 1280x720 the safe band is
  646px of 720 where at 1920x1080 it is 968 of 1080. Handles placed against the wrong size would
  be handles in the wrong place.

  Snapping is OBS's: an 8-design-pixel grid, edges and centres of the safe rectangle, the frame and
  every other panel within 6 design pixels, and Alt to ignore both. Six, because the preview is
  about a third of design size — measured at 3.137 design pixels per screen pixel on a 1440
  viewport — and a finer threshold would fire on which physical pixel the mouse landed on. That is
  also why the arrow keys exist: one design pixel, eight with shift. They move the stored percent
  rather than the resolved box, because at 1280x720 one output pixel is 1.5 design pixels, and
  nudging the resolved box made eight presses come to 8.5. A logo or image drawn with fit: contain
  keeps its shape while it is resized, since a box of the wrong shape only adds letterbox margin.

  Overlapping panels are named, not forbidden — a logo is supposed to be able to sit on a panel.
  The warning appears live while a box is being dragged, and the publish review carries an
  "Overlapping panels" section with both names and the shared rectangle.

  Every box on the preview is one focusable control that the arrow keys operate; the eight resize
  grips are not focusable and are not controls. The studio's control budget moves from 62 to 64:
  the page measured 61 before, and the three added are one handle per panel the frame actually
  draws — the lower third, the next card and the clock.

- The overlay can hold several named scenes, and one of them is on air. Until now a channel had
  exactly one layer set: building a second look meant rebuilding the first one afterwards. An
  operator can now add, rename, duplicate and delete scenes in the studio, and the scene picked
  there is the one that goes on air at the next publish — the switch reaches the picture through
  the same payload the renderer already reads, so it costs no process restart and no gap: the
  overlay is a pipe of frames whose content changes, not an ffmpeg argument. A scene may
  optionally name one of the stored video sources (M57); that source fills in for any source
  layer in the scene that names none, so a duplicated scene can be pointed at another camera in
  one step. If that source is later removed, the layer falls back to the still picture exactly as
  an unlinked layer does. Migration `20260902_003_named_overlay_scenes` adds `scenes_json` and
  `active_scene_id` to `overlay_settings` and `overlay_drafts` and turns what was on air into the
  first scene, named "Main scene". Existing installations keep their picture unchanged: the reader
  derives that one scene from the stored layer set even before the backfill has run, so the
  upgrade window has no state in which the overlay draws something else. The studio's control
  budget moves from 56 to 62 — a select for the scene, its name, its video source, and add /
  duplicate / delete; the picker is a select precisely so the count cannot grow with the number of
  scenes.

### Security

- A lost or rotated `APP_SECRET` silently turned two-factor login off. Finding [10] of the
  codebase review, verified twice: every stored value then fails its auth tag, decryption returned
  an empty string for all of them without a word — Twitch credentials, stream keys and the relay
  key read as never entered, the uplink stopped — and the login gate, which tested the two-factor
  secret for truthiness, let every local password through without the second factor while the
  account still said 2FA was on. Now a well-formed ciphertext that will not open is a failure: the
  first one per process is logged with the way out and raised as the critical incident "Stored
  secrets cannot be decrypted with the current APP_SECRET", and a two-factor login whose secret is
  unreadable is refused (423) with the same instructions instead of skipped.

### Fixed

- Taking hold of the clock or the "up next" card moved it. Placing a panel seeds its box from where
  the flex flow already puts it, precisely so that the act of placing changes nothing on air — but
  the store capped x and y at 90%, and two of the six seeds sit past that: the clock's left edge is
  at 91.6% because it is 149 design pixels wide against a 1776-pixel safe area, and the next card's
  top is at 90.7% for the same reason. Both were clamped on save, so the clock jumped 28 design
  pixels and the next card 8 — nothing visible in the studio, a moved panel on air. Found by
  dragging them. The cap moves to 100% for the built-in panels and for custom layers; what keeps a
  box on the frame was never that cap but `resolvePlacementBox` clamping width against the room x
  leaves, which is unchanged. A drag now stops at the frame's edge with its size intact.

- The `!request` cooldown and the queue cap on the viewer-control page were never enforced.
  Finding [5] of the codebase review, verified twice: the worker evaluated every request against an
  empty history and a queue count of zero — the table for the history existed and nothing wrote to
  it — so one viewer could push any number of items into the running channel while the page
  claimed a per-viewer cooldown and a cap. Every accepted request is recorded now, the cooldown
  looks back over the history, a request whose asset has left the queue stops counting against the
  cap, and the cap is the number of requests still waiting.
- A moderator's `!here` was confirmed in chat before the window was saved, and a failed save
  vanished. Finding [11] of the codebase review, verified twice: the bridge answered "checked in"
  at once, then fired the write and discarded its rejection — a pool timeout or a transient
  Postgres error left the moderator believing in coverage that never started, with no window, no
  audit entry and no log line. The confirmation now follows the write; a rejected write is said
  in the room ("could not be saved — please try again"), logged, and raised as an incident.

- Alerts said nothing when they failed, and said the same thing every 30 seconds when they did
  not. Findings [12] and [9] of the codebase review, verified twice: the Discord webhook's
  response was never read, the email rejection vanished in `allSettled`, "nothing configured"
  returned silently — so an operator with a deleted webhook believed alerts were on for hours —
  and nothing deduplicated, so a persistent Twitch reconcile failure sent the same post and email
  every cycle. Delivery now reports per channel and logs it; a failed channel raises the warning
  incident "Alerts are not reaching a channel" and a working one resolves it; an alert with no
  channel configured raises an info incident once; and one condition is sent once per half hour.

- The chat mode was written to the broadcast channel every 30 seconds, whatever it was and
  whatever the moderation policy said. Finding [6] of the codebase review, verified twice: the
  worker PATCHed Twitch's chat settings on every reconcile with no memory of its last write and
  no regard for the policy's own switch, so a moderator who lifted emote-only by hand on Twitch
  was overridden within half a minute, and an operator who switched the policy off still had
  Stream247 forcing emote-only on the channel. Now one decision runs before every write: a
  switched-off policy never writes and the status page says so; an unchanged mode is not
  rewritten inside ten minutes; after that it is written once more, so a hand change does not
  silently outlive a policy that is on. Every write is logged as
  `twitch.chat_settings.written` with the mode and the reason — the line that was missing when a
  moderator's `!here` could not be proven from the logs.

## 1.5.38 - 2026-09-02

### Changed

- The overlay's own panels can be moved and faded, like every layer an operator adds themselves.
  Before: the lower third, the next card, the chat panel, the vote panel, the clock and the
  emergency banner hung in a fixed flex flow. They had no position, no size and no opacity — the
  four number fields the studio offers were only ever for layers the operator added, and the
  built-in panels went where the layout decided. Now each of the six takes the same box a custom
  layer takes — x, y, width and height as percentages of the safe area, plus opacity clamped 5-100
  — resolved by the same function, with a folded "Panel placement" group in the scene form. A panel
  nobody has moved is still in the flow and draws the frame it always drew: the golden-frame
  checksums are unchanged, and the boxes the studio seeds put every panel back on the same pixel
  (measured at 1920x1080: 0,0 drift for the lower third, vote panel, clock and chat at either
  bottom corner). What the flow gave for free, fitting, is now arithmetic: the chat panel reads its
  message count out of its box height (26px of padding plus 30 per message) instead of the
  stacking budget it used to inherit, and the vote panel drops the options that would not fit
  (115px of chrome plus 51 each).

- A chat game can now fill the picture and can be as transparent as the operator wants. Before: a
  box over the whole 1920x1080 frame drew a 104px cell and a 1694x952 board — 77.77% of the frame —
  shoved against the left of a panel that stopped 25px short of the bottom edge, with 207px of dead
  fill to its right; and the only way to make the panel transparent was its opacity, which faded
  the board with it (the snake measured alpha 11 at 5%). Now the panel takes the height of the box
  it was given, the board is centred in what the text rows leave (reserved by what those rows
  measure, 65px, rather than a flat 84), and the same box draws a 107px cell and a 1742x979 board,
  82.24% of the frame with 89px of margin on each side. The backdrop has its own 0-100 opacity,
  measured alpha 0 with the snake still at 255, and every cell is outlined so the board survives
  the fill going away: a white snake head on white video measured 1.00:1 against its surroundings
  before and 13.79:1 now.

- One overlay, one preview. The studio's scene tab showed two drawings of the same scene side by
  side — the studio's own HTML rebuild on the left, the frame the on-air renderer produces on the
  right — and the dashboard said Stream247 "captures" an `/overlay` address as its internal overlay
  output, with a link to open that page. Nothing captured it any more: since the native renderer
  went on air, the browser page was a third drawing of the scene that no viewer and no pipeline
  looked at, and the rebuild beside the preview disagreed with the broadcast in known ways — a 5%
  safe area where the renderer uses 3.75% by 5.19%, panel sizes and opacities the renderer clamps
  away, every panel half again as large at 1280x720. An operator looking at the studio could not
  tell which of the three pictures was the truth.

  Now there is one. The studio preview is the renderer's frame and nothing else; the dashboard and
  the studio say that the picture is drawn by the playout and the preview is the same drawing. The
  `/overlay` page, its chromeless variant, the `noindex` middleware that guarded it, the studio's
  HTML rebuild and the engagement SSE stream that fed the page are gone, and ~670 lines of overlay
  CSS with them. The on-air picture itself has not changed: the renderer in `packages/core` is
  untouched and its golden frames still match. `POST /api/overlay/events` stays exactly where it
  is — Twitch has that URL registered as its EventSub callback; only the `GET` that streamed
  engagement to the browser overlay answers 405 now. `SCENE_RENDERER_ENABLED=0` still switches the
  playout to the text overlay path.
### Security

- The Twitch stream key was written in clear text into the incident list and the container log.
  Measured on the running channel on 2026-09-01T23:31Z: when the uplink could not open its RTMP
  connection, ffmpeg echoed the publish URL, key and all, and that line became the message of the
  `uplink.ffmpeg.stderr` incident the GUI shows, and a runtime-log line in `docker logs`. Whoever
  holds that key can broadcast on the channel. The relay key was already guarded with care; the
  same class of secret was leaking through a side door.

  Redaction now lives in the sinks — the runtime log redacts every string in its payload, the
  incident store redacts title and message — and in both ffmpeg stderr readers before the line goes
  anywhere, so no caller can forget it. What is hidden: the last segment of an RTMP/RTMPS/SRT
  publish URL, key-shaped query parameters on any scheme, userinfo passwords, webhook tokens,
  Bearer/OAuth tokens and Twitch's own key shape; the host and the path stay readable, so the
  operator still sees where it failed. Migration `20260902_001_redact_stored_secrets` rewrites the
  incidents and audit entries already on disk through the same function. **Rotate the stream key
  on Twitch after upgrading** — it has been readable in the GUI and the logs for as long as an
  uplink error has been recorded there.
### Fixed

- "Active chatters" was two numbers. The overlays page reads "live with N active chatters in the
  last W minutes" from the engagement game tracker, which counts the room over the operator's
  engagement window (1–30 minutes, default 10). The skip vote needs a share of the active chatters,
  and its runtime kept a roster of its own over a hard-coded five minutes. Measured with one chat
  history through both counts — twelve viewers talk, one asks for a skip twelve minutes later,
  window set to 15 — the page said 12 and the skip threshold counted 1, so a skip the page implied
  needed 8 votes was decided by the absolute floor of 5 instead. Narrower windows cut the other
  way: with the setting at 1 minute the page reported fewer people than the skip vote demanded a
  share of.

  The worker now keeps one roster of who spoke when (`active-chatters.ts`), shared by the tracker
  and the skip vote, with one window read from the engagement settings on every snapshot. The
  overlays page wording is unchanged; the number it prints is now the number a skip is measured
  against. The chat panel's own five-minute message lifetime is a display lifetime, not a count,
  and stays what it was — its comment no longer claims to mirror the chatter window.

## 1.5.37 - 2026-09-01

### Fixed

- A rejected Twitch connect attempt marked a working connection broken, and three features went
  quiet behind it. Measured on the running DUT on 2026-09-01: the identity connection record read
  `status: error` with the message about a callback arriving without a matching state cookie, while
  the token stored beside it had been issued minutes earlier, validated against Twitch with all
  nine scopes including `chat:read` and `chat:edit`, and was carrying a live IRC session that had
  completed its handshake and stayed up. `lastMetadataSyncAt` was empty — it had never run once.

  `recordTwitchError` wrote the error status unconditionally. Directly beside it, the broadcaster
  slot's equivalent has always refused to downgrade a connected slot for exactly this reason; the
  identity slot never got that guard. So a double-clicked connect button, a stale tab, or a second
  callback arriving late was enough to take a healthy connection down. Metadata sync, moderation
  sync and event registration are all gated on the connected status, so all three stopped at once:
  the emote-only switch was never toggled even though the presence calculation correctly asked for
  the normal chat mode from three active windows, Twitch stayed on emote-only, and
  `twitch.eventsub.sync.skipped` reported registration skipped for a connection that was not
  actually missing. To the operator this looked like the check-in command doing nothing, when the
  command had in fact been recognised and had created its presence windows.

  Both slots now share one decision, and it turns on what a failure is evidence *about*. A rejected
  connect attempt says nothing about the token already stored and cannot touch the status. A
  failure of the stored connection itself — a revoked or expired token, the shape a refresh reports
  as a 401 — still marks it broken, because suppressing that would leave the dashboard claiming a
  connection that cannot do any work. Every failure still reaches the audit trail either way.

### Added

- The Twitch connection status now has a second source: measurement. The error status was written
  from memory — something failed once, and the record kept saying so — which left the install above
  with no way back that did not involve another trip through OAuth for a token that was fine the
  whole time. When the record says broken and a token is still stored, the worker now asks Twitch
  whether that token works and what it may do, and puts the connection back to connected when the
  answer is at least as capable as reconnecting would be. It only ever moves in that one direction:
  deciding a connection is broken stays with the code that actually tried to use it. Triggered by
  the error status rather than by a timer, so a healthy connection is never re-checked, and limited
  to one check per ten minutes so a permanently dead token cannot turn into steady background load
  against Twitch's rate limit. Every outcome is logged, including the three different reasons not
  to heal: a rejected token, a valid token whose grant is too short, and an unreachable Twitch that
  told us nothing.

### Changed

- The dashboard's Twitch card speaks. It printed the stored status value directly, so an operator
  read the single word "error" above a raw upstream message, and a workspace that had never
  connected read a hyphenated database token. Neither said the thing that mattered — that title and
  category updates and the emote-only switch had gone quiet behind that one word. The card now
  names the state in ordinary language, names what is paused while it lasts, and distinguishes a
  connection that is repairing itself from one that genuinely needs the account connected again.
  The stored message stays available underneath rather than leading.
### Fixed

- Chat games and emotes, three things the adversarial review of that change found and measured
  before it shipped. A studio already holding its maximum of eight custom layers accepted `!snake`,
  silently dropped the ninth layer the game needed, still flipped the overlay on and still told the
  room "Snake is on air" while nothing was drawn; a start the store has no room for is now refused
  with a reply that says so, and nothing is written. On the broadcast renderer a message at every
  documented limit — a 14-glyph name, six emotes, 40 characters — drew its emote row 84px past the
  chat panel onto bare video and squeezed the chatter's name to 0px; the name is now fixed and the
  row yields. The same measurement showed a fault older than emotes: satori applies `lineClamp`
  only to a block container, and the text label was flex, so a wide message had always drawn two
  lines where the panel's height budget assumes one — and so did the text runs inside an emote row,
  which the adversarial review caught after the first repair. Both draw one line now. And a bare
  game name typed in passing —
  "2048" — started a round, because the parser copied the check-in's optional "!"; starting or
  stopping now needs the bang, while asking about the games still answers without it.
- The chat overlay drew emote codes as words. Twitch never sends emote pictures: a PRIVMSG carries
  the literal text plus an `emotes` tag naming which ranges of that text are emotes. The bridge's
  IRC parser read `display-name`, `badges`, `mod` and `id` out of the tags and dropped `emotes`
  entirely, so nothing downstream could tell "Kappa" the emote from "Kappa" the word, and the panel
  had no choice but to draw the word.

  The tag is now read into ordered occurrences, split into text runs and emote pictures once per
  message (not per frame), carried through the `chat_overlay_messages` row, and drawn as inline
  `<img>` nodes. Positions are counted in code points, which is Twitch's own unit — slicing the
  raw string would put every emote after an emoji two characters off — and the trim the parser
  already applied shifts them by the same amount.

  Measured against satori 0.29 and resvg on this machine, 1920x1080: a text-only frame rasterises
  in ~81ms (satori 2.9ms, resvg 78ms). One emote by https URL costs satori 61.6ms cold and 12.8ms
  once satori's own image cache is warm; the same emote inlined as a data URI costs 2.0ms. At the
  renderer's one-frame-per-second cadence the URL path is affordable, so no separate image cache
  was added.

  What did need care: satori determines an image's intrinsic size by fetching it, and on a failed
  fetch it throws `Image size cannot be determined` — which loses the whole frame, not just the
  emote. Measured: twelve emote URLs of which two 404 threw the entire render; one unresolvable
  host threw in 2.5ms. Declaring `width` and `height` on the image node makes satori skip the
  unreachable picture and render everything else (~19ms). Every emote node therefore carries a
  declared size, and a smoke test rasterises a frame with a deliberately unresolvable emote host to
  hold that property. The stored emote address is also pinned to `static-cdn.jtvnw.net/emoticons/`
  on the way into and out of the row, so text a stranger typed can never become an outbound request
  to somewhere else. No schema change: the segments live inside the existing `messages` jsonb
  column, and a row written before this change simply has no segments and draws as plain text.

  Twitch sends the `emotes` tag to every member of the room and serves the pictures from an
  unauthenticated CDN, so this works with the moderator account exactly as it would with the
  broadcaster's.

- The chat game's direction emotes did nothing. `reconcileChatGame` treats a game as active only
  while `overlay.enabled` is true *and* some scene layer of kind `game` is enabled — and a fresh
  install has `enabled: false` and `customLayers: []`. Every `⬆` the room sent was resolved against
  a runtime with no settings and no state and was discarded silently. There was no way for a viewer
  to fix that and no way for an operator to guess it: the only cure was adding a Chat Game layer by
  hand in Scene Studio first.

- Chat had no way to ask about games or start one. `!game` now answers in chat with what is
  running, the games there are, and how to steer them; `!snake`, `!minesweeper` and `!2048` start a
  round and `!game stop` ends it. The "!" is optional, matching the moderator check-in, and a
  command must be the whole message — talking about snake cannot start one.

  Starting a round provisions what it needs: it enables the overlay and adds an enabled Chat Game
  layer, using the studio's own default placement so the operator can move, rename or switch off
  afterwards exactly as usual. An existing game layer is re-enabled rather than duplicated, and
  stopping switches the layer off while leaving the overlay published — chat started the game, it
  did not publish the overlay. The reconcile runs immediately rather than on the next 30s cycle, so
  a board appears while the viewer is still looking. Info is open to the room; starting and
  stopping require the moderator badge Twitch puts in the message tags, because they change a live
  broadcast — no broadcaster right and no API call is involved. Commands do real work at most once
  every five seconds, so a room typing in unison cannot become a write storm.

## 1.5.36 - 2026-09-01

### Fixed

- The audit trail held nothing but heartbeats. `audit_events` is a ring buffer capped at 100 rows,
  and the worker and uplink loops each wrote a routine entry into it every 30 seconds. Measured on
  the running DUT on 2026-09-01: all 100 rows were `worker.cycle` (32) and `uplink.cycle` (68), and
  the oldest of them was 17 minutes old. Not one security-relevant entry had survived. Everything
  the trail exists to answer was gone within about a quarter of an hour — Twitch account
  connections and their OAuth callbacks, `relay.internal_key.revealed` (added specifically so that
  reading a secret leaves a mark), rejected relay publishes, sign-ins, settings changes. An earlier
  review had noted that the rate limit bounds repeated harvesting without making the audit line
  durable; this is that gap, measured.

  Routine liveness and security evidence no longer share a table. The worker loop records
  `playout_runtime.worker_heartbeat_at`, beside the playout and uplink heartbeats that were already
  there, and the uplink loop simply stops writing `uplink.cycle` — it had already written
  `uplink_heartbeat_at` on every path it can exit through, so the audit entry was only ever the
  noisier copy of a timestamp the runtime row already held. With no routine writer left, a
  security-relevant entry cannot be displaced by routine traffic at all; the property holds by
  construction rather than by a retention policy that has to keep classifying events correctly.

  All five readers move to the runtime heartbeat: system readiness, `getWorkerHealth`, the incident
  area classifier that decides whether the worker area is healthy, and the worker and uplink
  healthchecks. The scheduled-reconnect path turned out to be the one uplink exit that never
  awaited a heartbeat write of its own — it relied on a fire-and-forget write in the process exit
  handler — so it records one directly now.

  The retention bound rises from 100 to 500 and becomes a single shared constant, because the
  prune, the hydrate `LIMIT` and the persist slice all have to agree or the table silently
  truncates on the next state write. 500 covers weeks to months of operator activity now that the
  routine traffic is gone, and just under an hour of the worst case an attacker can drive — the
  relay throttle caps rejected-publish entries at ten a minute — against ten minutes before. The
  table still travels with the full state serialisation, so it stays bounded; at the 85 bytes a row
  measures, 500 rows is about 42 KB, proportionate to the sync-run and incident tables already
  carried alongside it. The per-row insert in that rewrite became one batched statement so the
  higher bound does not land on every state write.

  Schema: `20260901_001_worker_heartbeat_runtime`, additive. Existing rows keep their data and
  start with an empty heartbeat, which reads as "missing" exactly as an absent `worker.cycle` entry
  did, until the worker completes its next cycle at most 30 seconds later.

  Visible change: the per-source activity panel in the admin UI now shows only real events. It was
  already filtered by source, so in practice it had been showing nothing at all.

## 1.5.35 - 2026-08-28

### Fixed

- Twitch chat never connected, and said it did. The identity OAuth flow asked for seven scopes,
  none of them `chat:read` — but the IRC bridge authenticates with that same token, so Twitch
  refused every login. Measured against the running DUT on 2026-08-28: `/oauth2/validate` returns
  the token's scopes with no chat scope among them, and an IRC handshake using it answers
  `:tmi.twitch.tv NOTICE * :Login unsuccessful` and closes the socket ten seconds later. The bridge
  saw none of that. `parseTwitchIrcMessage` matches PRIVMSG and nothing else, so the refusal fell
  through unread, and `sync()` reconnected into the same refusal on every worker cycle — roughly
  fifteen seconds connected, fifteen seconds gone, around the clock. It also wrote its `connected`
  status from the TLS connect callback, before Twitch had looked at the token at all, so the stored
  status alternated `connected`/`disconnected` and read as a flaky network rather than a login that
  could never succeed. Every poll closed `no-votes` with `voterCount: 0` because no chat line ever
  arrived. Four changes: the flow now requests `chat:read` and `chat:edit`; the bridge reads NOTICE
  and recognises Twitch's refusal wordings; `connected` is reported only on the `001` welcome, the
  one signal that means the token was accepted; and a refused login goes into a five-minute
  cooldown keyed to the token, so it stops hammering Twitch but retries immediately once the
  operator reconnects the account. The refusal is raised as a Twitch incident quoting what Twitch
  said, resolved by the next real login, and the opening handshake lines are logged — capped, and
  never the token — so the next occurrence is readable from the log instead of inferred from socket
  counts. PING/PONG was checked and was already correct; it was not the cause.
  **Existing installs must reconnect the Twitch account once**: tokens already stored carry the old
  grant, and no code change can add a scope to a token Twitch has already issued.

- a source that answers with nothing no longer closes its own incident. v1.5.34 made the resolve
  per source, which was necessary and not sufficient: it keys on `failedSourceIds`, and a listing
  that comes back empty without throwing never enters that set. So both connector syncs still
  finished such a run with `resolveIncident("source.<kind>.<id>")`. A Twitch archive listing that
  comes back empty does not throw, so on 2026-08-27 each 30-second cycle wrote a `skipped` run with
  zero discovered assets and then re-closed the one entry that could have explained the hours of
  filler — and the same call erased entries a genuine failure had raised a cycle earlier. The
  source row said "Ingestion failed" while the incident list said nothing at all. The two halves
  now compose: the per-source gate says whether this cycle's ingest was clean, the run history says
  whether the source is actually delivering, and a resolve needs both. A gate-only resolve still
  closes the entry for a source that answered with nothing; a history-only resolve still closes it
  for a partial `scanMediaFiles` walk that returned files while a directory was unreadable. A
  source that has stopped delivering is reported under the same existing fingerprint, which
  `incident-classes.ts` already registers as a state in the source area: it holds while the drought
  holds and the next delivering run closes it. No new family, so one broken source cannot appear
  twice. Reporting waits for three consecutive barren checks — one empty listing is the blip the
  v1.5.33 asset-preserve rule absorbs correctly, and at the 30s worker cadence three is still under
  two minutes. A source with nothing stored that no pool draws on stays out of the list: that is a
  setting, not an incident, and an entry no action can close is the failure M58 removed
- the Twitch sync reconciles its incidents after the loop, like the YouTube sync. The call sat
  inside the per-source `try`, which the invalid-URL branch `continue`s past — so the one source an
  operator is most likely to be in the middle of fixing was the one whose entry never resolved

### Changed

- the sources page says what it knows instead of printing what it stored. It showed the last run's
  summary next to a raw ISO timestamp, the last-synced stamp again above that, and three counts
  ending in "pool refs" / "schedule refs" — none of which answers "is this happening now" or "does
  the programme care". It now reads "Last checked 4 minutes ago, found 49 videos", or "Nothing came
  back the last 3 times, the first of them 12 minutes ago. The 49 stored videos stay playable.",
  and once a drought is long enough to matter it names the scheduled blocks it reaches and whether
  they still have anything to play. That source → pool → block chain already existed in
  `getSourceReferences` and had never been said out loud; it is what nobody could see on the day.
  The same sentences go into the incident message, so the live status view carries the consequence
  rather than only the fault. Text only — no control was added, so the page's density budget is
  unchanged. This sits one level above v1.5.34's `describeSourceSyncStatus`, which stays the
  authority on what a single sync did to the archive and keeps writing the status badge and the
  source note; the sentence describes the run history the badge cannot see — how long the drought
  has run and what it costs the schedule — and reports the count of still-playable items rather
  than repeating the badge's "(assets preserved)" back at the operator two centimetres away

### Removed

- the `redis` service. It is not being retired after outliving its use — it was never used at all.
  Compose provisioned a `redis:7-alpine` container with a `./data/redis` volume and a `redis-cli
  ping` healthcheck, and `web`, `worker`, `playout` and `uplink` each declared
  `depends_on: redis: condition: service_healthy`, so four services waited on a container no code
  ever opened a connection to. There is no redis client anywhere in `apps/` or `packages/` and no
  `redis` or `ioredis` dependency in any `package.json`. The single thing that ever read `REDIS_URL`
  was `packages/config`'s `getConfig`, deleted outright in M56 part 1 as dead code; the container
  it pointed at outlived it by four milestones. Removing it takes a container, a bind mount, a
  healthcheck and four start-order gates out of every install, and shortens cold start by however
  long the redis healthcheck took to pass. Also gone from `docker-compose.dev.yml`, the five
  scripts that generate their own stacks (`dev-stack.sh`, `e2e-smoke.sh`,
  `fresh-compose-bootstrap-smoke.sh`, `queue-continuity-smoke.sh`, `runtime-parity-smoke.sh`), both
  `.env` examples, and the docs that described it as part of the persistence model. No smoke script
  needed a count adjusted — they all assert on service names, not on how many containers came up.
- for operators, at the next stack update: the `redis` container is stopped and removed and the
  stack starts one service fewer. Its bind mount `./data/redis` remains on disk as an empty
  leftover directory and can be deleted by hand whenever convenient. Nothing to migrate and nothing
  to back up first, because nothing was ever stored in it. A stale `REDIS_URL` left in an existing
  `stack.env` is inert. This does not reach a running install on its own — it lands the next time
  the stack file itself is updated, not when image tags are re-pinned

## 1.5.34 - 2026-08-28

### Fixed

- a broken media mount no longer deletes the local library, the global fallback with it. The audit
  that followed the v1.5.33 sync wipe found the same absence-of-evidence shape four more times, and
  this one was worse than the original: `walkMediaFiles` wrapped the whole recursive scan in
  `catch { return []; }`, so an unmounted volume, an NFS timeout, EACCES, EMFILE or a single
  unreadable subdirectory was indistinguishable from an empty library — and `syncLocalMediaLibrary`
  then handed that empty list to `replaceAssetsForSourceIds` and deleted every local asset. Where
  the Twitch incident dropped the channel onto the standby video, this path deleted the standby
  video too, and the emptied `state.assets` then defeated `collectDiskProtectedAssetIds`, releasing
  the VOD cache and thumbnails of still-scheduled assets to the watermark sweep. `scanMediaFiles`
  now reports whether the walk completed, and a scan that did not is fed to the same
  `decideSourceAssetReplacement` rule the connector syncs use, so the stored rows survive and emit
  `source.sync.assets_preserved`. The source status, notes, incident and sync run name the scan
  failure instead of claiming an empty library
- a direct media source whose URL fails validation keeps its stored asset. The invalid-URL branch
  in `syncDirectMediaSources` skipped asset building but left the source id in the wholesale delete
  list, so a typo or a mid-cycle edit silently deleted the asset. `planDirectMediaSync` now derives
  the usable entries and the unusable source ids in one pass, and the sync routes through the same
  per-source preservation. The Twitch sync's own invalid-URL branch, which relied on the
  keep-empty-result rule catching it by accident, is now explicit as well
- `replaceAssetsForSourceIds` refuses to empty a populated source unless the caller opts in with
  `allowEmptyReplacement`. Its only guard was `sourceIds.length === 0`; the incoming asset list was
  never looked at, which is what let every one of these bugs reach the database. Emptying a source
  is still legitimate — the syncs that computed both lists from the same evidence say so — and a
  merely shrinking result is untouched, because a source going from 49 items to 1 is an ordinary
  playlist edit
- a source status now says whether a failed sync kept its assets. Both the YouTube and Twitch
  status writes reported `Ingestion failed` from the raw incoming count, so a source whose archive
  had just been protected looked identical to one that had been emptied — opposite situations for
  an operator. `describeSourceSyncStatus` derives the status, the preserved flag and the count that
  is actually still playable from the same outcome the replacement decision uses
- a chapter probe that came back empty is no longer a final answer. `chaptersProbeStatus: "ok"` was
  an absorbing state with no re-probe path and no reset in the UI, but a rate limit, a geo- or
  subscriber-restricted variant and a yt-dlp extractor regression all report "no chapters" too — so
  an asset could sit on the wrong category and title on air indefinitely. The asymmetry made it
  worse: `"failed"` healed through its cooldown, `"ok"` never healed. An empty result is now
  trusted for `CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS` (default one week, `0` disables) and then
  probed once more, sorted behind never-probed assets and failure retries so the per-cycle budget
  and the cycle-await ceiling are unchanged. Assets that have chapters are still never selected, so
  operator edits keep winning outright
- a failed thumbnail render no longer destroys the good thumbnail. `ensureLocalAssetThumbnail`
  deleted the existing file and pointed `ffmpeg -y` straight at the target path, so an OOM kill,
  disk pressure or plain load left the asset with no picture, or a truncated one readers would
  serve. It now renders to a temp path and renames only a finished file, the pattern
  `captureSourceSnapshot` already used; the disk sweep collects `.jpg.tmp` leftovers
- YouTube ingestion incidents resolve per source instead of behind a global `hadFailure` flag. One
  failing source kept every healthy sibling's incident open, and with a permanently broken source
  they never resolved at all

## 1.5.33 - 2026-08-27

### Fixed

- a failed source ingest no longer takes the running programme off air. `syncTwitchVodSources` and
  `syncYoutubePlaylistSources` collect assets from every enabled source and finish with
  `replaceAssetsForSourceIds(allSourceIds, collected)` — a delete-then-reinsert. A source whose
  ingest threw contributed zero assets but stayed in the delete list, so one transient yt-dlp error
  deleted that source's entire archive. Measured on the running channel (v1.5.31): eight process
  starts in the eight minutes after 18:57 against a normal two to three per hour, strictly
  alternating fallback slate and scheduled programme, each programme item cut after 76-91 seconds.
  With the pool emptied, `choosePlaybackCandidate` found no preferred asset and fell to
  `global_fallback`; because the on-air asset's row no longer existed, neither stickiness guard
  could re-select it, and the cycle cut the running item through `stopPlayoutProcess("switch")`.
  The next worker sync re-inserted the rows and playout switched back — hence the alternation. A
  sync may now only delete a source's stored assets when it has positive evidence the source holds
  that content: a throw, or an unexpectedly empty listing for a source that currently has assets,
  keeps the stored rows and emits `source.sync.assets_preserved`. Stale rows are recoverable and
  invisible to viewers; deleted rows take the channel off air
- a deliberate playout stop now says why. `stopPlayoutProcess(reason)` took a reason string,
  consumed it as a boolean and threw it away, and `playout.process.exit` reported only
  `planned: true` — which conflated "a watchdog or a target switch killed it" with "ffmpeg reached
  the end of the asset cleanly". Five of the eight stop paths (`switch`, `destination-missing`,
  `scheduled-reconnect`, `crash-loop-reset`, `restart-requested`) emitted no event of their own, so
  eight consecutive deliberate stops left no trace of their cause and the diagnosis above had to be
  reconstructed from timestamps. The exit event now carries `plannedReason` and `ranForMs`
- the playout loop no longer sleeps through a wake it was explicitly asked for.
  `requestImmediatePlayoutCycle` read a callback handle that `waitForNextLoop` installs only while
  the loop sleeps, so a wake requested from inside a running cycle found it null and was dropped.
  Both in-cycle callers were affected: the boundary fallback bridge and the deferred-prefetch
  follow-up, whose own comment promises the queue warms "immediately instead of waiting out the
  loop delay". It never did. This is the 15 seconds of the ~18s fallback bridge measured at two of
  three asset boundaries; the remaining ~3s is the follow-up cycle's own work. Wakes are now
  latched and consumed before the loop sleeps, edge-triggered and burst-limited so the loop-stall
  guard and the cycle-await budget are untouched
- a stale prefetch is now structurally unable to redirect a boundary. `decideBoundaryPlaybackInput`
  trusted that the caller had looked the probe up under the right key; it now takes the selected
  asset id and the probe carries the asset it was resolved for, so a probe belonging to a different
  asset is ignored. Declining a prefetch costs a few seconds of fallback, while honouring one that
  belongs to a previously queued asset would put the wrong programme on air

### Added

- `playout.boundary.gap` reports, per boundary, how long viewers spent off programme content
  (`gapMs`) and how many fallback processes covered it (`bridgeStarts`). The bridging duration was
  previously only recoverable by hand-subtracting timestamps of two unrelated
  `playout.process.start` events. Observation only — nothing it produces feeds a decision

## 1.5.32 - 2026-08-27

### Fixed

- the incident list tells the truth about what is broken now (M58). Measured on the running
  channel: 50+ open entries, 40+ of them "critical", the oldest from 5 July — and every one of them
  a past event that nothing ever closed. Only a handful of fingerprints ever called `resolveIncident`;
  the rest were reported and then carried forever, so the surface an operator opens during an
  outage answered "what is broken?" with forty corpses. Every fingerprint family is now classified
  in one registry as either a **state** (a condition that is true until it is not — a filling disk,
  a missing destination, a metadata sync waiting for the broadcaster connection; closed by the code
  that knows the condition, as before) or an **event** (something that happened and is over — a
  process exit, a stall the runtime restarted out of, a crashed loop). Event incidents are now
  closed from outside, once their part of the system has been measurably healthy and quiet, with a
  resolution note that says plainly they were closed automatically because they describe a past
  event. The health proof uses only signals the runtime already writes, and weighs each one against
  what it is actually worth: the program feed's status word is believed only beside the playlist
  mtime that ages on its own and a live playout heartbeat, because the worker never recomputes that
  word and a frozen "fresh" would otherwise let it close the incidents that say playout died; a
  running uplink counts only once its input is fresh (with a stale feed every uplink watchdog is
  disarmed, which is exactly the documented outage where the process ran 65 minutes without
  encoding a frame while the channel was dark), its destinations are out of error, and its youngest
  process has stood longer than the operator's own watchdog windows. A new reporting site cannot
  skip the decision: a test reads every `fingerprint:` in the worker — including templates that
  begin with an interpolation, which is how both loop watchdogs are written and how they slipped
  past the first version of the scan — and fails on anything the registry does not classify. The
  windows are deliberately constants and not managed settings: they are the honesty threshold of a
  reporting surface, and a field would invite setting them to nothing
- a fault that keeps coming back is not declared over in the gaps between its bursts. The quiet an
  entry has to prove scales with how long its family has been recurring — `created_at` survives a
  reopen, so first-to-last report is that span — capped at six hours so a bad week does not demand a
  week of silence. Without it a channel failing every quarter of an hour would have read green for
  ten minutes out of every fifteen
- one entry per ffmpeg exit instead of one per asset. `playout.ffmpeg.exit.<assetId>` gave every
  asset that ever failed its own permanently open critical row, which is most of what filled the
  list; the deduplication on fingerprint was working all along, the fingerprint was simply too
  granular. The asset now names itself in the message, where the detail belongs. Old per-asset rows
  are unreachable by any running code, so the sweep closes them by their retired shape once they
  are past the grace and playout is healthy — no migration, because a migration cannot see whether
  the channel is well and would either close them blindly or, on the freshly restarted container it
  runs in, close nothing at all
- both incident panels now say how old each open entry is — last reported first, because that is
  what separates the channel's current problem from July's, then first seen — and a capped panel
  says how many further open incidents it is not showing. The admin status chip counts every open
  incident instead of the five the live snapshot carries, so it no longer reads "5" while forty are
  open. An automatic resolution keeps the original message in front of its note: resolving replaces
  the stored text, and losing the exit code and stderr tail at the moment an entry becomes history
  would be the wrong trade

## 1.5.31 - 2026-08-27

### Added

- the operator surfaces the live-source work had been missing (M57 stage 2, Etappe E). Most
  importantly the emergency rollback path is usable again: since the relay started checking
  credentials, publishing the programme through it (`STREAM247_RELAY_ENABLED=1`) and reading it
  back on the uplink's rtmp input (`STREAM247_UPLINK_INPUT_MODE=rtmp`) only work with the internal
  relay key embedded in the configured URLs, and nothing could produce that string — the runbooks
  said to treat the rollback as unavailable. Settings → Operations → **Relay access** now hands an
  owner or admin both ready-to-paste lines: the group is rendered only for those roles and the route
  enforces them again, POST rather than a page render so the key never reaches the server-rendered
  HTML, one `relay.internal_key.revealed` audit line per reveal naming the actor and never the
  value, rate limited per account, fail-closed when the session can no longer be named, and every
  failure answers identically without the key or the underlying error. The reveal is strictly a
  READ: it uses a new non-generating reader, so clicking it can neither mint a key on an install
  that has none nor overwrite one that the current app secret cannot decrypt — either would have
  invalidated the key every running container still holds, during the incident the button exists
  for. The rate limit bounds repeated harvesting; it does not make the audit line durable, since the
  audit ring keeps only the newest 100 entries across all routes
- **Sound from live video sources** in the same panel: the live source gain (0-200, default 40)
  had been a managed value with no field since Etappe D. Whole percents only, refused rather than
  silently clamped, and carrying the honest caveat that a live source's sound is mixed only into
  items whose length is known in advance — on anything else the camera is embedded as picture only,
  so the feed-audio watchdog stays the safety net
- the studio's video source manager now says in words what playback last did with each pushed
  source — live in the programme, waiting for the camera, paused after a failed attempt with the
  cooldown counted down, or still picture only with the reason. "Live" is reported only from the
  fact that a live input really went into the running command, never from the decision to attach
  one: an intent that never landed (no resolvable address, or a start that took no input) reads as
  picture-only, and a live bridge or standby slate clears the state instead of leaving a stale
  "live" standing. Persisted through migration `20260826_004_overlay_video_source_live_state`
  (three additive columns, empty on existing rows), written only when the state changes, and kept
  off the broadcast path entirely — the write is detached and order-chained, so an observation can
  never slow down or block a camera going on air

## 1.5.30 - 2026-08-27

### Added

- pushed video sources (M57 stage 2, ingest foundation): a stored video source can now receive
  its picture instead of naming an address. The relay runs a mounted config with HTTP auth
  against the web app — publishing `src-<id>` needs that source's publish key (issued once in
  the studio's video source manager, rotatable, stored encrypted, migration `20260826_002`),
  internal reads and the legacy programme path need a self-generating internal relay key (new
  `managed_secrets` table, migration `20260826_003`). Ingest host ports are RTMP `1935/tcp` and
  SRT `8890/udp`; the relay API and RTSP read side stay container-internal. The auth endpoint
  answers every refusal with the same bare 403, rate-limits per address, audits rejected
  publishes, and the policy itself is a pure, constant-time-compared function. A pushed source's
  internal playback URL is derived on read — never stored — so the stage-1 snapshot sampler
  shows pushed cameras with no further configuration
- the live-attach groundwork for pushed sources (decision only): each playout cycle computes
  whether it would attach the scene's pushed source as a live input and logs
  `playout.source-live.attach_decision` (decision + reason, on change) without acting. Presence
  is asked from the relay API with a 2s bound only when the new managed gate (default off, env
  fallback) and the source layer gate are both on and the scene carries a source layer; every
  uncertain answer decides "skip". The three-minute attach circuit breaker exists and is pinned
  by tests; its trigger arrives with the attach stage, as does the starting-gain setting
  (clamped 0–200, default 40) that already resolves through managed config
- pushed video sources can now be attached LIVE, not just sampled (M57 stage 2, Etappen C+D):
  when the feature is on, the upcoming programme is an asset, the scene carries a source layer, and
  the relay reports the source publishing, the playout attaches it as a third ffmpeg input — a
  picture-in-picture window laid under the scene overlay exactly where the snapshot panel would sit,
  with `eof_action=pass` so a feed that drops never freezes the frame. Its audio is mixed under the
  programme at the configured gain (default 40%) with `normalize=0` (no level jump when the source
  comes or goes) and no padding (a lost source simply falls silent). The mix is built only when the
  programme asset has a KNOWN finite duration — an unknown-duration programme keeps its own audio as
  the sole track so the feed-audio watchdog (which reads the programme's audio out of the muxed
  segment to catch a source that runs dry without EOF) is never masked by live PiP sound — and only
  after the source's audio is probe-confirmed, so a relay that advertises a track the pull cannot
  deliver falls back to video-only instead of crashing ffmpeg. The RTSP read is bounded at 4 s, the
  live window is computed bit-identically to the renderer's panel, and a failed attach start opens
  the attach breaker so the next starts go attach-free — a bad feed cannot crash-loop the channel.
  Attach and detach happen only at natural asset boundaries, never mid-asset; the relay presence poll
  runs only while an asset is selected, never during a live bridge or standby slate. Off by default;
  a DT soak gate precedes any deploy

### Changed

- the rtmp relay rollback paths now require the internal relay key embedded in the relay URL
  overrides; until an operator surface reveals that key, treat the rtmp rollback as unavailable
  rather than weakening the relay auth config (see docs/deployment.md)

### Security

- hardened `/api/relay/auth`, which is internet-facing (the `web` port is published and Traefik
  routes the host), against two abuse paths found in review. Its rate limit now keys on the real
  transport peer (`X-Forwarded-For` from our Traefik) instead of the attacker-controlled `ip`
  field in the request body, so the limit can neither be evaded by rotating that value nor turned
  against a legitimate publisher by spoofing its address. Rejected-publish audit writes are now
  throttled — at most one line per source per minute and a hard global ceiling per minute — so a
  flood of bad publishes can no longer erase the security audit trail (each write runs an
  INSERT+DELETE against the 100-row cap) or starve legitimate state writes by holding the
  serialized write lock. A non-object JSON body (literal `null`, a string, an array) now returns
  the same bare 403 as every other refusal instead of a distinguishable 500.

## 1.5.29 - 2026-08-26

### Added

- the self-monitoring now covers the volumes eviction cannot help. A second, observation-only
  watermark watches free space on the worker's root filesystem — the closest measurable stand-in
  for the OS and database volumes, since the database's own volume cannot be statfs'd from the
  worker — and reports `pg_database_size` for context. Crossing below the warning mark raises one
  critical incident plus one alert per breach (fingerprint-deduped), resolved only above the
  higher all-clear mark; nothing is ever evicted there. Thresholds are managed config with env
  fallback (`STREAM247_SYSTEM_VOLUME_TRIGGER_PERCENT` / `STREAM247_SYSTEM_VOLUME_RECOVER_PERCENT`,
  defaults 10/15), editable inside the folded disk group of the admin settings
- a conservative asset-retention sweep against unbounded library growth. Hourly, the worker
  classifies every asset row: kept while its source exists, kept while anything references it
  (pools — cursor, insert, audio lane, or the pool still listing the vanished source; schedule
  cuepoints; curated sets; the entire playout runtime including the queue; chat votes, viewer
  requests and skip campaigns; global fallbacks), and kept until it has been *observed* orphaned
  for the whole protection window (`STREAM247_ASSET_RETENTION_PROTECT_DAYS`, default 7 — the
  clock is the sweep's own first-seen mark in the new `asset_retention_marks` table, migration
  `20260825_006`, so losing a source never makes old assets deletable the same day). Deletion is
  gated behind a managed switch that ships OFF (`STREAM247_ASSET_RETENTION_ENABLED`, only "1"
  enables); the candidate and kept-because counters are logged on every sweep either way, so an
  operator watches first and enables second
- embedded video sources on air (M57, stage 1): a new positioned scene layer shows a slow-refresh
  picture from a stored camera or feed. The playout encode keeps its two video inputs — a
  short-lived capture grabs one frame every few seconds (managed cadence, default 5s, env
  fallback) and the native renderer draws it as an overlay panel, so a dying feed can never stall
  the encode. Feed addresses are stored encrypted in their own table (app-secret key, the managed
  destination stream-key pattern), never appear in the scene payload, any listing, log or
  incident, and the layer itself carries only placement plus a source reference. A feed that goes
  away hides the layer on air instead of freezing; the studio shows the outage as status. The
  whole path sits behind a managed feature switch that defaults off. Repeated capture failures
  raise a warning incident that auto-resolves on the next good frame, and the snapshot directory
  joined the disk-watermark eviction ladder as its cheapest stage
- logo, image and text layers now render on the on-air picture through the same native renderer
  (previously browser overlay only), with the panels' existing ink and surface vocabulary and the
  same safe-area clamping as the game panel. Website/widget embeds stay browser-overlay-only —
  the rasteriser cannot run an iframe — and the studio now says so where those layers are edited

- chapter auto-detection now reaches every remote source, not just single Twitch VODs. Collection
  connectors list their items with `--flat-playlist`, which never carries chapters, so YouTube
  playlist/channel items, Twitch channel archives and direct media always arrived chapterless. A
  budgeted backfill now spends `CHAPTER_BACKFILL_PER_CYCLE` (default 3) metadata-only probes per
  worker cycle on such assets — yt-dlp for YouTube/Twitch, ffprobe for embedded MP4/MKV chapters —
  and stores the result through the same only-fill-empty rule as re-ingest, so operator-edited
  chapter lists always win. A completed probe is final even when it finds no chapters; a failed
  one waits out `CHAPTER_BACKFILL_FAILURE_COOLDOWN_SECONDS` (default 1800). The discovered
  chapters run through the existing boundary emission and Helix sync unchanged
- operational decisions moved from `.env` into the GUI (M56, part 1), on the managed-config
  pattern the Twitch credentials established: a value saved in settings wins, the env variable
  stays as fallback, and web and worker share one resolver per family in `packages/core` so the
  two sides cannot drift. Concretely: encoder quality (speed preset, video bitrate ceiling,
  buffer size, audio bitrate) as a folded group on the studio output tab; the disk watermark
  (on/off, trigger and recovery percent — the pair is validated before saving and rejected whole,
  exactly like the worker treats it) and the chat, alerts and Twitch schedule sync feature
  switches as folded groups in the admin settings; the EventSub webhook secret in the managed
  credentials form, with the same keep-on-empty semantics as every other stored secret. An empty
  managed value changes nothing: existing env-driven installs behave bit for bit as before,
  including the runtime gates' historical only-"1"-enables semantics
- the remaining operational env families followed (M56, part 2), as three more folded groups in
  the admin settings operations panel, each saving through its own partial route so no form can
  blank a sibling's values. "Replay cache": the Twitch VOD cache switch, remote-fallback switch,
  size ceilings in GB (whole cache, minimum free, largest single replay — a per-replay ceiling
  above the cache is rejected whole), retention and partial-download ages, download timeout,
  failure cooldown and the download speed ceiling; the cache root path stays env-only, a mount
  point is infrastructure. "Watchdog thresholds": the feed-silence, frozen-feed and encoder-stall
  watchdogs, the never-started encoder restart and the planned end-of-video margin, all as
  seconds with a spoken description of what each guard does. "Feed tuning": planned reconnect
  cadence and window, program-feed segment length, window size and failover margin; the relay
  topology stays env-only, deploy wiring is not a runtime decision. Because these values steer
  restarts, every managed number is validated against bounds derived from each module's own
  invariants (form and API refuse, the shared resolver additionally clamps a corrupted store),
  the feed-stall floor is pinned above the longest configurable segment, and a managed download
  timeout still passes the cycle-budget clamp, so no GUI value can outlive the loop stall guard.
  The worker's playout and uplink modes now refresh managed config at each cycle start, so a
  saved value reaches a running channel without a restart. The loop stall guard itself stays
  env-only on purpose: the GUI must not be able to lower the process's own self-protection

### Removed

- the dead `packages/config` package. Its `getConfig` (REDIS_URL, MOD_PRESENCE_ENABLED,
  MOD_PRESENCE_COMMAND) was imported by nothing; the workspace dependency, path mappings, build
  steps and Dockerfile copy went with it

## 1.5.28 - 2026-08-25

### Fixed

- the channel page's "Up next" now looks past midnight: after the last block of the evening it
  shows the next occurrence in the weekly grid instead of claiming nothing further is scheduled —
  on a 24/7 channel that answer was wrong whenever any block existed later in the week. This is
  also what made CI's wording baselines fail on every evening run
- "!here 5" works with the default moderation policy. requirePrefix: false treated the bang as
  forbidden rather than optional, so the exact command the spec and the check-in form both show
  was silently ignored on a default install; strict configs still require the prefix
- every compose service now caps its container logs (json-file, 20m × 5). The OS disk is the one
  partition the media-root watermark does not watch, and unbounded ffmpeg stderr was the likeliest
  way to fill it

### Added

- two more chat games on the M54 framework: Minesweeper and 2048. Minesweeper is steered by
  coordinates typed in chat ("b3", case-insensitive, spreadsheet-style columns): the seeded board
  commits on the first dig and never under it, a dig flood-reveals to the numbered frontier, a
  mine ends the round, clearing every safe cell wins it. 2048 reuses the snake's emote→direction
  map unchanged on its own four-by-four board: classic slide-and-merge with each tile merging at
  most once per move, spawns drawn from the state's own seed cursor, round over when no move is
  left. Both keep the framework's promises — no clock, no `Math.random`, same seed plus same
  inputs equals the same board — persist through the same runtime row, and render through the
  same panel, which now draws numbers inside cells and, for coordinate-driven games, column
  letters and row numbers around the grid. The studio picker offers all three games and folds
  away the fields the selected game ignores (the emote map for Minesweeper, the grid for 2048);
  no schema change was needed, because the settings row already stored the game id with snake as
  its default
- the chat window now renders in the broadcast frame, not only in the browser preview. Chat
  messages previously existed solely in the web overlay page, which stopped feeding the encode
  when the native satori renderer replaced the Chromium screenshot path — so "chat on stream" was
  silently preview-only. The worker's chat bridge now flushes its ring buffer (display name,
  text, timestamp; never user ids or logins) to a `chat_overlay_messages` singleton row within a
  second of a change, and the playout render loop projects the row into a chat panel that joins
  the overlay's flex flow at the corner `chatPosition` names — displacing the lower third, the
  vote panel, and the next card instead of ever overlapping them. The panel shows at most eight
  one-line messages (each hard-clamped, control characters and bidi overrides stripped; Twitch
  emote codes stay visible as words since the renderer draws text, not emote images) and a
  message ages off air after five minutes, the same window that defines an active chatter — which
  is also what takes a dead worker's last flush off the broadcast. Moderation reaches the frame
  too: the bridge mirrors CLEARMSG and CLEARCHAT into its buffer, so a deleted or banned
  message leaves the stream on the next flush instead of replaying on the one surface no
  moderator can refresh. Empty or disabled chat renders nothing — no empty panel frame
- skip-vote progress now renders on air, closing the follow-up left by the 1.5.27 poll fix. The
  `!skip` tally lived only in worker memory, so viewers voting to skip rallied nobody: nothing was
  persisted and the playout container had nothing to draw. The worker now flushes the campaign's
  numbers — votes, threshold, window end, never voter identities — to a `chat_skip_vote` singleton
  row within a second of an accepted vote, and the playout render loop projects the row into the
  engagement panel with the same shared-projection pattern as the poll. A row older than its own
  window renders nothing, so a worker restart cannot fabricate progress from a dead campaign; an
  asset boundary or disabling viewer control clears the row instead of letting it linger. When the
  poll and a campaign are live at once, the one panel slot goes to whichever runs out of time
  first (ties to the skip campaign, whose failure mode is silent) — with default settings the poll
  still shows first, then the campaign inherits the slot
- broadcaster-slot OAuth connect (M51 completion): the broadcast channel's own account can now be
  connected from the browser through a flow kept fully separate from the identity connection —
  own start route with only the `channel:manage:broadcast` and `channel:manage:schedule` scopes,
  own namespaced single-use state cookie, and a callback that verifies the authorised Twitch
  login matches the configured broadcast channel before storing anything; connecting the wrong
  account (typically the identity) is rejected with a message naming both accounts and stores no
  token. The dashboard's waiting entry became the actual connect link, a connected slot can be
  disconnected, and the worker refreshes the slot token ahead of expiry and on 401 like the
  identity token, so metadata sync flips on — and stays on — without a restart

## 1.5.27 - 2026-08-25

### Added

- chapters per video (M53): each asset can carry a chapter list — offset, Twitch category, stream
  title — auto-filled from VOD metadata at ingest (Twitch VOD chapters name the game on air, so
  the chapter title doubles as the category candidate) and editable per video in the library.
  During playback the worker emits `playout.chapter.boundary` events as offsets are crossed; the
  on-air hero title and the Twitch metadata sync follow the chapter that is actually playing,
  through the M51 broadcaster gate and throttled to one channel write per 30 seconds. Operator
  edits survive re-ingest; an empty chapter list behaves exactly as before the feature existed

### Fixed

- assets with a known duration end on time instead of being rescued by watchdogs. Remotely
  streamed VODs (CloudFront-backed Twitch assets too large to cache) reach their end without
  ffmpeg receiving EOF: the fps=60 filter manufactured video from the last frame ("More than 1000
  frames dup"), audio went silent, the uplink encoder stalled and its watchdog restarted it after
  ~45s — one viewer-visible discontinuity per asset end — and only at 91s of silence did the
  feed-audio watchdog rotate the asset. The playout now ends the asset deliberately once elapsed
  playback passes its known duration plus a margin (PLAYOUT_DURATION_BOUND_MARGIN_SECONDS, default
  15s), through the same planned-transition path a natural boundary takes: no incident, a
  playout.duration_bound.end runtime event, and the next queue item starting in the same cycle.
  Assets with an unknown duration behave exactly as before, with the feed-audio watchdog as the
  net; live-bridge input is never cut

- the chat poll now renders on air. Voting always worked — ballots counted, the tally flushed to
  Postgres, the winner promoted to the front of the queue — but the playout container never read
  any of it back: the vote panel predates the native scene renderer, and when the overlay moved
  in-process from the Chromium screenshot nothing was wired to feed the engagement view, so
  viewers voted in a poll they could not see. The playout render loop now projects the persisted
  poll row into the vote panel on every render interval, sharing the projection with the
  worker-side tally so the two sides of the process boundary cannot drift; the countdown ticks
  between the worker's change-driven flushes and the deadline inside the row takes an orphaned
  poll off air. Skip-vote progress still cannot be drawn on air — its tally is never persisted —
  and remains a follow-up

## 1.5.26 - 2026-08-25

### Fixed

- live streams no longer outlive the clients that opened them. A run of the visual suite left the
  web process holding 22 SSE connections with zero established sockets on its port; each kept
  polling, Postgres committed 115 transactions a second with nobody connected, and the process took
  16 seconds to answer its own health check at 0% CPU. The disconnect listener now registers before
  the first await, and the stream additionally closes itself when nothing is reading what it
  enqueues. Measured after: 0 connections, 2 transactions a second (v1.5.26)
- local image builds had been failing for five days without anyone noticing, because the dev stack
  kept serving the last image that worked. `.dockerignore` listed `node_modules`, which Docker
  matches only at the context root, so every workspace package's node_modules was copied in from
  the developer's machine — pnpm symlinks into a store the image does not have. The pattern matches
  at any depth now and both builder stages take the whole installed tree from deps. The same change
  broke the worker image, caught by scripts/clean-checkout-build.sh, which now rebuilds every image
  from a pristine clone the way CI does (v1.5.26)
- playout restarts when its process is alive but the feed has stopped advancing. Caught live:
  ffmpeg blocked 3h43m at 0% CPU on a remote source that stopped delivering, reconnect flags set
  and never firing, the uplink exiting "end of input" once a minute, the channel dark for four
  minutes. Same idea as the uplink's encoder-stall watchdog, one stage earlier; a 90-second grace
  period keeps ordinary boundaries out of reach (v1.5.26)
- the on-air label chip picks black or white ink by the accent's luminance instead of always dark —
  a dark accent used to letter it invisibly, on the one surface nobody inside the product looks at.
  Accent-coloured headings on the panel are kept when they clear 4.5:1 and replaced with white when
  they cannot, so safety does not take the channel's colour away from choices that were fine
  (v1.5.26)
- playout logs its ffmpeg stderr to the container log and the overlay pipe reports its open and
  close with frames written, so a failed transition leaves a reason behind instead of an exit code
  beside an empty field. The first incident after deployment was answerable within minutes — and
  the answer corrected the original report: exit 255 with planned:true is the worker's own asset
  switch, not a crash (v1.5.26)

### Changed

- the program feed directory is swept at each boundary: segments no playlist references and older
  than ten minutes are removed, capped at 400 per sweep so the cost of a transition stays constant.
  Measured before: 8878 files, 3.7 GB, the oldest 125 days old, in a directory whose live window is
  six segments — the record of eight thousand playout restarts (v1.5.26)
- the operator surfaces were simplified against measured control counts, each page holding its
  budget as a test: live control 33 to 22, live status 62 to 25, sources 48 to 30, pools 41 to 17,
  scene editor 79 to 54. One primary action per page, held by the same test; repair actions,
  destination/source/pool editors and the live bridge fold away; dead links on the go-live
  checklist are gone. The public channel page gained the one control it lacked: a watch link
  (v1.5.26)
- stored identifiers no longer reach text people read: scheduled_match and its fifteen siblings,
  missing-config, preset and source ids, "pool cursor", "worker-side hysteresis". Cuepoints are
  "Timed inserts" and audio lanes are "Replacement audio", both named from behaviour in core rather
  than guessed. A wording baseline records every surface as reviewable text, and an identifier scan
  with a visible, self-pruning exception list holds the state (v1.5.26)
- the dev fixture seeds a gapless week at fixed times, actually writes its two assets (the previous
  call was an UPDATE that matched nothing and reported success), and files them under a source that
  exists — so the baselines photograph a workspace with content instead of recording empty states
  as truth (v1.5.26)

## 1.5.25 - 2026-08-23

### Fixed

- restart the playout when its source has run dry. A VOD finished and ffmpeg did not exit: the
  `fps=60` filter kept manufacturing frames by duplicating the last one — over ten million of them
  across two and a half days — so video packets kept flowing and every liveness check stayed green.
  The channel was off the air that entire time, because audio cannot be duplicated: the program feed
  carried a silent audio stream, the uplink could not determine its parameters and reported
  "Nothing was written into output file, because at least one of its streams received no packets",
  and nothing ever reached Twitch. Audio is now the signal — a feed carrying video without audio
  past `PLAYOUT_FEED_SILENCE_MS` is treated as an exhausted source. A feed that never carried audio
  is never judged, so a silent clip does not restart forever, and a feed with no video either is
  left to the existing process supervision (v1.5.25)

### Changed

- three visual snapshots now mask their runtime regions rather than asserting content. Pinning the
  schedule day and masking the scene clock both looked right and both failed again two days later
  with no code change: what varies is server state and server time, which `page.clock` cannot
  reach. Narrowing what they assert is the trade — a net that goes red on a calendar rather than on
  a regression is one people stop reading (v1.5.25)

## 1.5.24 - 2026-08-21

### Fixed

- `/login` returned 500 on every workspace with Twitch configured. The page built the authorize URL
  while rendering, which mints a single-use OAuth state and writes it to a cookie — something
  Next.js only permits in a Route Handler or Server Action. `/setup` and the dashboard took the same
  path. Introduced with the OAuth state fix in 1.5.19 and invisible until now, because the visual
  suite runs against a stack with no Twitch credentials, where the function returns early and never
  reaches the cookie write: the one environment that could not reproduce it. Pages now check whether
  sign-in is configured and link to a route that mints the URL on click, so the state is also fresh
  when it is used rather than dating from the page render (v1.5.24)
- stop deleting VODs fetched ahead of their slot. The delete set was derived by elimination —
  everything not on air, in the runtime queue, or still downloading — and a completed download fails
  all three the moment it lands. Measured on the production channel: 19.1GB removed seconds after
  the 52 minutes it took to fetch, then fetched again. Exactly one asset stops playing per
  transition, and that one is now named rather than inferred (v1.5.24)
- restart an uplink that has never encoded anything. This state was reported and deliberately never
  acted on, reasoning that a false positive costs a restart loop while a false negative costs no
  more than the previous behaviour. It cost the channel: the uplink ran 65 minutes without a single
  frame, never opened an RTMP connection, and logged the condition every 15 seconds while nothing
  reached Twitch. `UPLINK_NO_PROGRESS_RESTART_MS` (5 minutes) now bounds it (v1.5.24)
- pin the two visual snapshots that depended on the server's clock. `page.clock` freezes the browser
  only, so the schedule page rendered a different week each morning and the scene preview raced its
  own clock between server paint and hydration — both passed when their baseline was taken and
  failed two days later with no code change (v1.5.24)

## 1.5.23 - 2026-08-20

Design consolidation, and the two gaps the 1.5.22 rollout exposed in production.

### Fixed

- collect abandoned partial downloads. They were left entirely to the prune, which only runs
  immediately before a download starts — and the new size policy makes that a dead end: once every
  scheduled VOD is over the limit no download ever starts, nothing prunes, and the partials stay
  forever. Measured at 13.8GB on the production channel, invisible to a release that skipped every
  transient file. The release now applies the prune's own test: old enough, and no live job holding
  the lock (v1.5.23)

### Changed

- one definition for the five state tones. `status-chip-*`, `badge-*`, `programming-status-*`,
  `schedule-block-*`, `toast-*`, `.warning`/`.danger` and `.field-error` said the same five things in
  their own colours — agreeing on meaning, disagreeing on value, which is how one drifts out of
  contrast while the rest stay fine. They now map onto
  `--tone-{positive,caution,critical,neutral,info}-{fg,bg,border}`; class names are unchanged, so no
  markup moved. Info became a real channel instead of three literals inside one pill. Colour
  literals: 100 → 93 (v1.5.23)
- removed `Card`, `PageHeader` and `Button` from the design-system primitives. Card and PageHeader
  duplicated Panel and AdminPageHeader, which carry 17 and 11 usages against zero for the newer
  pair; Button was never used either. Consolidating onto the incumbents keeps the visual result
  identical (v1.5.23)

### Added

- a fixed playout runtime for the dev stack. It leaves worker/playout/uplink stopped so the UI is
  reproducible, which also left every live surface reporting "nothing on air" — so the pages that
  report on a running channel were outside the visual suite by construction. The runtime the stopped
  worker would own is now seeded through the same `updatePlayoutRuntime` production uses, with fixed
  ids and fixed instants (v1.5.23)
- `/live?tab=status` and `?tab=control` in the visual baseline. They were excluded for flakiness;
  with the runtime pinned rather than masked, two consecutive verification runs pass 28/28. These
  are the pages an operator opens when something is wrong (v1.5.23)
- `tests/unit/design-tones.test.ts`, which resolves the channel syntax
  (`rgb(var(--brand-rgb) / 0.12)`) the existing contrast test cannot read. The token layer is
  finally covered by the standard it was written to serve (v1.5.23)

## 1.5.22 - 2026-08-19

The VOD cache does what it was always meant to, plus the audit findings that were still open.

### Added

- cache a Twitch VOD when it fits, stream it live when it does not. `TWITCH_VOD_CACHE_MAX_ASSET_BYTES`
  (default 20GB) is checked before any bandwidth is spent, and an oversized VOD is marked
  `too-large` and played straight from Twitch — a settled state, so it raises no incident and is
  never retried. Below the limit the VOD is cached and released as soon as it is neither on air nor
  still ahead in the queue. Keyed on what is in use rather than on a playback-ended event, because
  playback ends in more ways than it begins: a skip, a crash, a boundary, an operator override
  (v1.5.22)
- `TWITCH_VOD_CACHE_LIMIT_RATE` caps download bandwidth so caching cannot take the line from the
  live stream (v1.5.22)

### Fixed

- size the VOD from its bitrate and duration. Twitch reports neither `filesize` nor
  `filesize_approx` for its HLS VODs — verified against live VODs on two yt-dlp versions — so the
  first version of the size check was unreachable and the limit did nothing at all. `--max-filesize`
  could not cover for it either: yt-dlp consults it only for progressive HTTP downloads, never for
  fragmented HLS, measured at 95MB downloaded against a 1MiB cap (v1.5.22)
- never read an empty playout selection as "no cached file is needed". The playout reports no
  current asset while reconnecting, in standby, and on a freshly restarted process — in each of
  those the release would have deleted the entire cache, turning a routine restart into a full
  re-download of every scheduled VOD (v1.5.22)
- stop the blueprint import overwriting the live playout runtime. It read the whole app state, spent
  the request building a new one and wrote it back, so importing a blueprint while the channel was
  on air rewound the worker's heartbeats, restart counters and uplink status — without holding the
  state write lock (v1.5.22)
- stop EventSub reporting dead subscriptions as configured. Twitch keeps a subscription listed after
  it stops delivering; matching on type and condition alone counted `authorization_revoked` and
  `notification_failures_exceeded` as present, so the channel silently received nothing. Revocations
  were also processed as notifications, turning "this subscription is dead" into a cheer alert on
  the overlay attributed to "Viewer" (v1.5.22)
- let two moderators check in during the same second. `presence_windows` used `expires_at` as its
  primary key, and that value is the check-in time plus a duration from a short list (v1.5.22)
- refresh the broadcaster token with nothing on air. The refresh sat behind an early return taken
  when no asset and no schedule block were active, but the chat bridge authenticates with the stored
  token on every cycle — so an empty programme expired the token and took chat down with it
  (v1.5.22)
- stop template application locking the schedule editor. It skipped the overlap check every other
  way of creating a block performs, and the editor refuses to save while conflicts exist (v1.5.22)
- fill the schedule video timeline on every day. A preview is built for a date; the page built one
  for today and filtered it by the selected weekday, leaving six days out of seven empty (v1.5.22)
- validate schedule overlaps under the lock that writes them. Two editors saving at once each
  validated against a snapshot without the other's block, and both writes succeeded (v1.5.22)

## 1.5.21 - 2026-08-19

Three production failures found by watching the 1.5.20 channel, plus what an adversarial review of
the first fix turned up.

### Fixed

- stop the on-air overlay throttling the encode to half real time. ffmpeg is told the scene pipe
  delivers 1fps and the `overlay` filter cannot emit a frame until both of its inputs have one, so
  a writer that slept the 2000ms render interval between frames paced the *entire* encode, not just
  the overlay: playout produced 30 seconds of programme per minute of wall clock and the channel
  fell steadily further behind. Writing and rasterising are now independent, and the writer paces
  against the wall clock. Measured on the production channel afterwards: 90 segments in 180s, 100.0%
  of real time (v1.5.21)
- stop scene loop teardown from killing the worker. The fd-3 pipe had no `error` listener — the
  drain wait supplied one by accident — and teardown aborts the loop and SIGTERMs ffmpeg in the same
  turn, so the pipe lost its reader with nothing listening. An unhandled stream error is an uncaught
  exception, which this process answers with `exit(1)`, at every ordinary asset boundary. Reproduced
  against real ffmpeg: 3/3 runs died with ECONNRESET, 3/3 survive with the listener (v1.5.21)
- keep the scene renderer alive when its own error path fails. The incident write inside the
  handler goes through the same database whose failure would have put it there, so one Postgres blip
  could kill the loop and freeze the lower third for the rest of the run with no incident raised
  (v1.5.21)
- detect an uplink that is running but no longer producing. ffmpeg stayed alive while emitting 450
  timestamp discontinuities a minute and handing audio and video opposite ~117s offsets, so the
  tracks audibly drifted apart while every destination still reported `ready` — process liveness
  cannot tell "running" from "working". The supervisor now watches ffmpeg's own `out_time` and
  restarts through the unplanned-stop path, so it lands in the restart tally instead of being
  absorbed silently (v1.5.21)

### Added

- `TWITCH_VOD_CACHE_LIMIT_RATE` caps cache download bandwidth. The cache was measured pulling
  145 Mbit/s on a host whose job is pushing a live stream out. Defaults to unlimited, since the right
  number depends on the link (v1.5.21)
- `UPLINK_STALL_TIMEOUT_MS` / `UPLINK_STALL_GRACE_MS` tune the encoder stall verdict. Watch for
  `uplink.encoder_stall.restart` and `uplink.encoder.no_progress` (v1.5.21)

### Operations

- `docker stats --no-stream` is not usable for judging whether the uplink is encoding. Consecutive
  samples on the same healthy process read 0.05% and 17.43% while its 30-second cgroup average was
  99%. Measure `cpu.stat` usage over a window, or the interface counters, before concluding anything
  from CPU. This is the reason the stall detector watches `out_time` rather than CPU.
- the overlay's staleness is bounded by the writer's lead, not by buffer sizes. `-thread_queue_size`
  cannot provide that bound: frames queue in Node's stream buffer and the OS pipe long before
  ffmpeg's own queue, and the more cheaply a transparent lower third compresses, the deeper that
  backlog runs.
- an uplink stall is only blamed on the uplink when the program feed is `fresh`. Otherwise a playout
  outage would become an uplink restart loop lasting exactly as long as the outage.

## 1.5.20 - 2026-08-19

Follow-up to the 1.5.19 rollout, from watching it run in production.

### Fixed

- stop the Twitch VOD cache prune from deleting a download that is still running. It evicts
  transient files to stay under the cache cap and protected only the target path of the download
  that triggered it, so with several large VODs queued each new job deleted the previous job's
  partial — 21GB of progress removed 15 minutes in, then restarted from zero. That is the same
  "never finishes" failure the 7200s download timeout used to cause, relocated from the playout
  cycle into the background runner: no longer fatal, but an endless loop that burns bandwidth and
  never produces a cached file. The lock a running job maintains now exempts its partial and the
  fragment files yt-dlp writes beside it; a stale lock still frees them (v1.5.20)

### Operations

- `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=1` on the production channel. With it at 0 the playout
  refuses to stream a VOD that is not fully cached and bridges to fallback content instead — which,
  combined with VODs larger than the cache cap, meant the channel showed fallback indefinitely even
  with playout healthy. Restart-freedom is not the same as a healthy channel; check the actual
  ffmpeg input, not just the absence of errors.
- `TWITCH_VOD_CACHE_MAX_BYTES` still defaults to 20GB while the scheduled VODs exceed that, so
  nothing stays cached for long. Raise it or run the source as a direct stream deliberately.

## 1.5.19 - 2026-08-18

Emergency production release. Supersedes the 1.5.18 tag, whose release build failed before
publishing any image (the Release workflow ran before CI had pushed the `main-<sha>` snapshots it
pulls from). No 1.5.18 images exist; 1.5.19 is the artifact to deploy.

Carries the 1.5.18 playout fix below plus a critical, remotely exploitable authentication flaw and
four runtime failure modes, all found by an adversarially-verified audit pass over the product.

### Breaking

- **`APP_SECRET` must be at least 32 characters in production and may not be the published
  `stream247-dev-secret` constant.** A deployment that does not satisfy this now fails instead of
  silently signing sessions with a guessable key. `pnpm release:preflight` checks it before rollout
  and prints the remedy (`openssl rand -base64 48`). Rotating the value invalidates existing
  sessions, so everyone signs in again once.

### Security

- close a full workspace takeover via the Twitch OAuth connect callback. The route had no auth
  guard, `middleware.ts` only matches `/overlay`, and the OAuth `state` was the literal flow name
  that no callback read back. An attacker could authorise their own Twitch account against the
  publicly discoverable client_id, hand the code to the callback to overwrite the workspace's
  broadcasterId and tokens, then complete SSO — which grants "owner" to whoever matches that
  broadcasterId — and hold an owner session without ever knowing a password. State is now random,
  single-use, flow-scoped and bound to an HttpOnly cookie, and the connect callback requires an
  owner/admin session (v1.5.19)
- stop falling back to the published `stream247-dev-secret` constant when `APP_SECRET` is unset in
  production. This project is source-available, so that fallback let anyone forge a session cookie
  for any user id. Startup now fails loudly and rejects secrets under 32 characters (v1.5.19)
- expire session cookies. The issue timestamp was already inside the signed payload but was never
  checked, so a leaked cookie was valid forever. Default 30 days via `SESSION_MAX_AGE_SECONDS`
  (v1.5.19)
- stop library uploads escaping `MEDIA_LIBRARY_ROOT`. The subfolder sanitiser kept "." in its
  allowed character class so ordinary names survive, which also let a ".." segment through
  untouched: "../../etc" sanitised to itself. Traversal segments are now dropped, backslashes count
  as separators, and a containment check on the resolved destination backs it up (v1.5.19)
- rate-limit password login and TOTP verification. Neither had a limit or lockout, so both were
  unbounded brute-force surfaces; a six-digit TOTP with a +/-1 step window is well within reach
  unthrottled. Login is keyed on the targeted account and the client, TOTP on the account alone,
  and a success clears the counter (v1.5.19)

### Changed

- blocks that cross midnight stay on the schedule. Occurrences were built by filtering on the
  weekday of the queried date alone, so a block scheduled Monday 23:00 for two hours vanished at
  00:00 and the channel fell out of its programmed pool for the rest of the night. The same block
  also claimed to be on air on its own morning, because matching compared wall-clock strings.
  Occurrences now carry the previous day's overrun explicitly and match on minute ranges (v1.5.19)
### Added

- **Viewer control**: Twitch chat can steer the programme. A poll opens once per programme item and
  closes before the boundary, so viewers see the result before it takes effect; `!request` adds a
  released library item to the queue under a per-viewer cooldown and an outstanding-request cap; and
  a `!skip` vote needs both a share of active chatters and an absolute floor. The live poll renders
  in the on-air overlay. Configure it under Studio → Engagement — it ships **disabled**, because
  enabling it hands programme decisions to anonymous chat (v1.5.19)

  Three properties worth knowing before switching it on:
  - a vote can only reorder what is already queued, so chat influences the running order without
    bypassing the schedule
  - a tie is reported as a tie and leaves the schedule untouched, rather than being broken by
    candidate order that viewers cannot see
  - re-voting moves a viewer's ballot instead of adding one, so a tally can never exceed the number
    of distinct voters

### Fixed

- escalate to SIGKILL when stopping playout. The guard also required `!currentProcess.killed`, but
  Node sets `killed` as soon as SIGTERM is delivered, so escalation was unreachable and an ffmpeg
  blocked on a dead input never died — turning a 5s stop into a 300s stall and a container restart.
  A hard stop deadline now bounds the wait even for a child that survives SIGKILL (v1.5.19)
- clear `plannedStopReason` on the early-return path of `stopPlayoutProcess`, so the next genuine
  crash is no longer recorded as an operator-planned stop (v1.5.19)
- handle unhandled promise rejections instead of dying. The fire-and-forget state writes in the
  ffmpeg stderr handler could reject during a transient Postgres outage and kill the broadcast with
  no incident, no alert and no log entry (v1.5.19)
- attach an 'error' listener to both spawned ffmpeg processes; a spawn failure was rethrown
  asynchronously as an uncaught exception the caller's try/catch could not see (v1.5.19)
- split liveness from readiness. Every check in the project used `/api/health`, which returned 200
  unconditionally, so a rollout with Postgres unreachable passed its gates and reported healthy.
  `/api/health` stays liveness (200 while the process serves — restarting the web container does
  not fix a dead database and only removes the UI needed to diagnose it), and the new `/api/ready`
  fails closed with 503 when persistence is unreachable or the workspace was never initialised.
  `upgrade-rehearsal.sh` now gates on `/api/ready` (v1.5.19)
- escape operator-configured chat commands and vote tokens before interpolating them into regular
  expressions run against every IRC message; a command containing "(" threw inside the socket data
  handler and took the worker down (v1.5.19)

## 1.5.18 - 2026-08-18 (unreleased; no images published)

Emergency production fix. DUT had been in a playout restart loop for ~38 hours: 423 restarts,
one every ~5 minutes, with the program pinned to fallback content the whole time.

The boundary-stability work in 1.5.11–1.5.17 assumed an expensive remote resolve stays within
"~60-120s" (queue-prefetch.ts). That assumption was documented in comments but never enforced in
code, and production ran with `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS=7200` — 24x the 300s
loop stall guard. `raceResolveAgainstDeath` did not help, because it only unblocks when the
covering playout process dies, and that process was healthily playing the fallback.

### Fixed

- take Twitch VOD downloads off the playout reconciliation cycle entirely: cycles now do a
  read-only cache lookup (`peekTwitchVodCache`) and hand uncached assets to a detached job
  runner, so an unbounded download can no longer consume the cycle's stall budget (v1.5.18)
- resume interrupted VOD downloads instead of restarting them: background jobs use a stable part
  path with `--continue`. The previous per-attempt random path meant a multi-GB VOD restarted
  from zero on every container restart, so with a 5-minute restart cycle it could never finish
  no matter how large the configured timeout was (v1.5.18)
- clamp every timeout awaited on a reconciliation cycle to half the loop stall budget, so an
  operator-configured value can no longer outlive the watchdog that is supposed to catch it
  (v1.5.18)

### Added

- `cycle-budget.ts` as the single source of truth for the loop stall budget and the derived
  ceiling for awaited cycle operations, making the previously implicit timing contract explicit
  and testable (v1.5.18)
- advisory file lock with heartbeat and stale-holder takeover, so the worker and playout
  containers sharing the media volume cannot both write the same resume file (v1.5.18)

## 1.5.17 - 2026-06-12

Accepted runtime-stable production baseline. A clean 24h DUT soak completed naturally
(1415/1415 healthy samples; 100% scheduled_match; 0 readiness failures, 0 programFeed=stale,
0 broadcastReady=false, 0 destination=degraded, 0 uplink unplanned-restart delta) with multiple
clean playout boundaries and no boundary-coupled uplink restarts. Scheduled-path acceptance
granted. Caps the boundary-stability campaign whose fixes all held simultaneously in the soak.

### Fixed

- never block the post-boundary start path on queue prefetch: while no playout process is running, the per-cycle expensive-resolve budget is forced to 0, and an expensive resolve already in flight when the playout process exits is abandoned within milliseconds (the background resolve still populates the probe cache, with in-flight dedup) — closing a ~94s no-playout gap that drained the program-feed buffer (v1.5.17)
- keep the program-feed HLS `EXT-X-MEDIA-SEQUENCE` continuous across playout runs by dropping the per-run `-hls_start_number_source` override, so the persistent uplink demuxer no longer sees a per-boundary sequence jump ("skipping … segments ahead, expired from playlists"), hits EOF, and restarts once per asset boundary into destination degradation (v1.5.16)
- bridge to the local fallback immediately on a clean natural boundary (not only a failed exit) when the next scheduled asset needs a cold expensive remote resolve, so coverage is never dark during the resolve (v1.5.15)
- bridge to local fallback on a failure-driven dark gap and invalidate the probe cache after an immediate ffmpeg input-open failure so a dead/expired resolved URL is re-resolved instead of reused (v1.5.14)
- cap remote queue prefetch to one expensive resolve per playout cycle so a cascade of uncached remote queue assets cannot exceed the loop stall guard and force-restart the playout container (v1.5.13)

### Changed

- bound the single-destination recovery window by lowering the destination-failure cooldown and uplink destination-stall restart defaults to 60s (v1.5.12)

## 1.1.2 - 2026-04-19

### Added

- added cache-backed Twitch VOD playback so archive assets are verified locally before playout uses them
- added a persistent local relay/uplink publishing mode so program playout failures no longer directly own the external RTMP session

### Changed

- moved scheduled output reconnect ownership to the uplink path, keeping the default Twitch reconnect cadence at 48 hours
- updated production pins and release guidance for the relay/uplink runtime

## 1.0.3 - 2026-04-03

### Fixed

- fixed Twitch channel archive ingestion so channel connectors sync archive VODs instead of failing on offline channel pages
- fixed Twitch archive playback URL normalization for `v<id>` entries emitted by `yt-dlp`
- fixed worker/playout healthchecks by marking ESM worker packages explicitly as modules
- fixed source validation for real YouTube handle/channel URLs and repaired the sources UI for long names and URLs
- fixed playout state recovery so valid assets can automatically clear crash-loop protection
- blocked destructive source deletion while sources are still referenced by pools or schedule blocks
- fixed standby-to-asset switching so the old FFmpeg process is fully stopped before a new one starts
- fixed pool playout selection so the currently running asset stays active instead of rotating every worker cycle

## 1.0.2 - 2026-04-03

### Fixed

- fixed `playout_runtime` persistence SQL so worker and playout no longer crash on PostgreSQL-backed state writes
- stable production env example now points at `v1.0.2`

## 1.0.1 - 2026-03-27

### Added

- added `.env.production.example` with pinned `v1.0.0` image tags for stable deployment
- clarified README and deployment docs to distinguish evaluation envs from production-pinned envs

## 1.0.0 - 2026-03-27

First stable self-hosted release for running a Twitch-first 24/7 channel with Docker, GHCR images, scheduling, source ingestion, playout control, Twitch sync, overlays, and operator tooling.

### Added

- Docker / GHCR delivery with `web`, `worker`, and `playout` images
- setup wizard with owner bootstrap and local login
- Twitch broadcaster connect and Twitch SSO for team access
- encrypted-at-rest managed secret storage with `.env` fallback
- PostgreSQL-backed runtime state and persistent operational data
- local media, direct media URL, YouTube playlist, and Twitch VOD ingestion
- minute-accurate schedule editing with drag-and-drop timeline repositioning
- FFmpeg-based playout foundation with fallback selection and operator overrides
- browser-source overlay page and overlay studio
- Twitch title, category, and schedule segment sync
- moderation policy, incidents, drift checks, Discord alerts, and SMTP email alerts
- worker/playout healthchecks, crash-loop protection, release preflight, upgrade rehearsal, and soak-monitor tooling

### Operational Notes

- `latest` is for evaluation and non-production testing.
- Production deployments should pin explicit version tags such as `v1.0.0`.
- Read `docs/upgrading.md`, `docs/backup-and-restore.md`, and `docs/operations.md` before production upgrades.

## Versioning Policy

- `latest` is for evaluation and non-production testing.
- Production deployments should pin explicit version tags such as `v1.0.0`.
- Read `docs/upgrading.md` before upgrading between versions.
