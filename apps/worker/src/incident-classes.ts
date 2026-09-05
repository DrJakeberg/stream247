/**
 * What every incident fingerprint means, and when it is over.
 *
 * Measured on the running channel on 2026-08-27: the incident list carried 50+ open entries, 40+ of
 * them "critical", the oldest from 5 July -- and every single one described something that had
 * finished long ago. An ffmpeg process that exited once in July. A discontinuity storm the uplink
 * recovered from in the same minute. A worker loop that crashed and restarted. Only a handful of
 * fingerprints ever called `resolveIncident`; everything else was reported and then carried
 * forever. The surface an operator opens to answer "what is broken right now" answered with forty
 * corpses, and the one entry that mattered was somewhere among them.
 *
 * The distinction that fixes it is not "how severe" but "what kind of thing is this":
 *
 * - a STATE incident describes a condition that is either true or not true right now -- the disk is
 *   nearly full, no destination is configured, the metadata sync is waiting for the broadcaster
 *   connection. It belongs in the list exactly as long as the condition holds, and the code that
 *   raises it already knows when it stops holding, so it closes it itself.
 * - an EVENT incident describes something that happened and is over -- a process exited, a stall was
 *   detected and restarted out of, a loop crashed. Nothing at the reporting site can ever close it,
 *   because by the time it is written the event is already in the past. These are the ones that
 *   accumulated.
 *
 * Event incidents are therefore closed from the outside, by proof that the part of the system they
 * belong to has been demonstrably healthy for a while (see `planIncidentResolutions`). The registry
 * below is the whole mapping, in one place on purpose: a new reporting site cannot be added without
 * an entry here, because `tests/unit/incident-classes.test.ts` reads every `fingerprint:` literal
 * out of the worker source and fails on anything this file does not classify.
 *
 * No I/O lives here, so the thresholds and the classification can be tested without a database.
 */

import { canBlameUplinkForStall } from "./uplink-progress.js";

export type IncidentArea = "playout" | "uplink" | "worker" | "twitch" | "source" | "system";

export type IncidentKind = "state" | "event";

export type IncidentFamily = {
  /** The whole fingerprint, or -- for a keyed family -- everything in front of the key. */
  fingerprint: string;
  /**
   * `false` for a fingerprint that is one fixed string. `"suffix"` when the reporting site appends
   * a key (`<fingerprint>.<key>`), `"infix"` when the key sits between the prefix and `keySuffix`.
   * A key is only allowed when it names a bounded, configured thing -- a destination, an output
   * profile, a stored source. Never an asset id: see the note on `playout.ffmpeg.exit` below.
   */
  keyed: false | "suffix" | "infix";
  /** The fixed tail behind the key, for infix families only. */
  keySuffix?: string;
  kind: IncidentKind;
  area: IncidentArea;
  /**
   * Set on event families whose repeats are not evidence that anything is wrong, so they do not
   * hold the rest of their area open. Only the two `*.ffmpeg.stderr` families qualify: they are
   * raised by `line.toLowerCase().includes("error")`, and a perfectly healthy encode prints
   * "Error while decoding stream" over a single corrupt packet often enough that letting one gate
   * an area would freeze the list on a channel that is fine. They are still closed themselves, on
   * their own repeats.
   */
  noisy?: true;
  /** Why this is a state or an event. One sentence, so the next reader does not have to guess. */
  why: string;
};

const STATE_FAMILIES: IncidentFamily[] = [
  {
    fingerprint: "playout.twitch-cache.failed",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The cached replay is unusable for as long as the cache job keeps failing; the cache job closes it."
  },
  {
    fingerprint: "playout.asset-preparation.failed",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The current item cannot be resolved into a playable input until it can; resolution closes it."
  },
  {
    fingerprint: "playout.source-snapshot.failed",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The scene's video source is not delivering frames until it is; the sampler closes it."
  },
  {
    fingerprint: "playout.scene-render.failed",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The on-air scene cannot be rendered until it can; the renderer closes it."
  },
  {
    fingerprint: "schema.drift",
    keyed: false,
    kind: "state",
    area: "system",
    why: "The database is missing declared columns until a migration adds them; the next boot closes it."
  },
  {
    fingerprint: "overlay.ticker-stale",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The ticker on air trails the setting until the next programme; the next programme closes it."
  },
  {
    fingerprint: "playout.ticker-strip.failed",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The ticker line cannot be drawn as a crawl until it can; the strip renderer closes it."
  },
  {
    fingerprint: "playout.audio-lane.failed",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The configured audio lane has no usable input until it has one; the lane resolver closes it."
  },
  {
    fingerprint: "playout.prefetch.failed",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The next queued item does not probe cleanly until it does; the next probe closes it."
  },
  {
    fingerprint: "playout.output.missing",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "No destination is configured -- a configuration condition that holds until someone configures one."
  },
  {
    fingerprint: "playout.no-asset",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "There is nothing playable to put on air, which stays true until there is."
  },
  {
    fingerprint: "playout.crash-loop",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "Crash-loop protection is currently holding playout back; it is cleared when protection lifts."
  },
  {
    fingerprint: "playout.live-bridge.exit",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The Live Bridge input is down and stays down until it reconnects; the reconnect closes it."
  },
  {
    fingerprint: "playout.destination",
    keyed: "infix",
    keySuffix: "failed",
    kind: "state",
    area: "playout",
    why: "One named destination is in its failure cooldown until it rejoins; recovery closes it per destination."
  },
  {
    fingerprint: "program-feed.input",
    keyed: false,
    kind: "state",
    area: "playout",
    why: "The uplink cannot read the program feed until the feed is fresh again; the uplink cycle closes it."
  },
  {
    fingerprint: "uplink.output.missing",
    keyed: false,
    kind: "state",
    area: "uplink",
    why: "No uplink destination is configured -- true until one is; the uplink cycle closes it."
  },
  {
    fingerprint: "disk.watermark.evicted",
    keyed: false,
    kind: "state",
    area: "system",
    why: "Free space is below the eviction mark and stays below it until eviction or an operator helps."
  },
  {
    fingerprint: "disk.watermark.exhausted",
    keyed: false,
    kind: "state",
    area: "system",
    why: "Free space is below the mark with nothing left to evict; it holds until space is freed."
  },
  {
    fingerprint: "system.volume.low",
    keyed: false,
    kind: "state",
    area: "system",
    why: "The system volume is below its mark and nothing here can free it; only an operator ends it."
  },
  {
    fingerprint: "source.local-library.empty",
    keyed: false,
    kind: "state",
    area: "source",
    why: "The local library holds nothing playable, which is true until something is added."
  },
  {
    fingerprint: "source.direct-media.invalid",
    keyed: false,
    kind: "state",
    area: "source",
    why: "A configured direct media URL is unusable until it is corrected."
  },
  {
    fingerprint: "source",
    keyed: "suffix",
    kind: "state",
    area: "source",
    why: "One named source fails to ingest until its next run succeeds; that run closes it per source."
  },
  {
    fingerprint: "twitch.metadata.waiting-for-broadcaster",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "The metadata sync has no channel it may write to, which holds until the broadcaster connects."
  },
  {
    fingerprint: "twitch.category.lookup.failed",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "The desired category has no resolvable id until one resolves; the next lookup closes it."
  },
  {
    fingerprint: "twitch.refresh.failed",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "The stored token cannot be refreshed, so the connection stays unusable until a refresh works."
  },
  {
    fingerprint: "twitch.chat.login-rejected",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "Twitch refuses the chat login while the token lacks chat access; a successful login closes it."
  },
  {
    fingerprint: "twitch.reconcile.failed",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "The channel is out of sync with the intended state until a reconciliation succeeds."
  },
  {
    fingerprint: "twitch.schedule.sync.failed",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "The published schedule is out of date until a sync succeeds; the sync closes it."
  },
  {
    fingerprint: "twitch.schedule.duration.skipped",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "Schedule blocks stay unpublishable while they exceed the duration limit; shortening them closes it."
  },
  {
    fingerprint: "twitch.eventsub.sync.failed",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "The EventSub subscriptions do not match the intended set until a sync succeeds."
  },
  {
    fingerprint: "twitch.eventsub.sync.skipped",
    keyed: false,
    kind: "state",
    area: "twitch",
    why: "EventSub is configured incompletely, which holds until the configuration is completed."
  },
  {
    fingerprint: "alerts.delivery",
    keyed: false,
    kind: "state",
    area: "system",
    why: "An alert channel is rejecting deliveries, which holds until a delivery succeeds; the next working delivery resolves it."
  },
  {
    fingerprint: "alerts.unconfigured",
    keyed: false,
    kind: "state",
    area: "system",
    why: "An alert was raised with no channel configured, which holds until a webhook or SMTP is set up; the next alert that finds one resolves it."
  },
  {
    fingerprint: "secrets.key-mismatch",
    keyed: false,
    kind: "state",
    area: "system",
    why: "Stored secrets fail to decrypt with the current APP_SECRET, which holds until that secret is restored or every value is re-entered."
  }
];

const EVENT_FAMILIES: IncidentFamily[] = [
  {
    fingerprint: "moderation.checkin.persist-failed",
    keyed: false,
    kind: "event",
    area: "twitch",
    why: "A moderator's check-in could not be written; the moderator was told and can try again, so nothing holds."
  },
  {
    fingerprint: "playout.feed-audio",
    keyed: false,
    kind: "event",
    area: "playout",
    why: "A restart already happened because the feed carried video without audio; the restart is the end of it."
  },
  {
    fingerprint: "playout.feed-stall",
    keyed: false,
    kind: "event",
    area: "playout",
    why: "A restart already happened because the feed stopped advancing; the restart is the end of it."
  },
  {
    fingerprint: "playout.ffmpeg.exit",
    keyed: false,
    kind: "event",
    area: "playout",
    why: "A playout process exited once. Deliberately unkeyed: keying it by asset produced one open critical entry per asset id and turned a single recurring cause into dozens of rows. The asset belongs in the message, not in the identity of the problem."
  },
  {
    fingerprint: "playout.ffmpeg.stderr",
    keyed: false,
    kind: "event",
    area: "playout",
    noisy: true,
    why: "One stderr line mentioning an error was printed at one moment; nothing about it stays true."
  },
  {
    fingerprint: "playout.start.failed",
    keyed: false,
    kind: "event",
    area: "playout",
    why: "One start attempt threw. The next cycle retries, so the throw is a past event, not a condition."
  },
  {
    fingerprint: "playout.switch.failed",
    keyed: false,
    kind: "event",
    area: "playout",
    why: "One switch attempt threw. The next cycle retries, so the throw is a past event, not a condition."
  },
  {
    fingerprint: "uplink.ffmpeg.stderr",
    keyed: false,
    kind: "event",
    area: "uplink",
    noisy: true,
    why: "One uplink stderr line mentioning an error was printed at one moment."
  },
  {
    fingerprint: "uplink.process.exit",
    keyed: false,
    kind: "event",
    area: "uplink",
    why: "The uplink process exited once and the loop reconnects on its own; the exit is over."
  },
  {
    fingerprint: "uplink.no-progress",
    keyed: "suffix",
    kind: "event",
    area: "uplink",
    why: "One output profile's uplink was restarted after never encoding a frame; the restart ends the episode."
  },
  {
    fingerprint: "uplink.discontinuity-storm",
    keyed: "suffix",
    kind: "event",
    area: "uplink",
    why: "One output profile's uplink was reattached after a timestamp storm; reattaching ends it."
  },
  {
    fingerprint: "uplink.encoder-stall",
    keyed: "suffix",
    kind: "event",
    area: "uplink",
    why: "One output profile's uplink was restarted after out_time stood still; the restart ends it."
  },
  {
    fingerprint: "uplink.destination-stall",
    keyed: "suffix",
    kind: "event",
    area: "uplink",
    why: "One output profile's uplink was restarted after every destination stalled; the restart ends it."
  },
  {
    fingerprint: "worker.loop.stalled",
    keyed: false,
    kind: "event",
    area: "worker",
    why: "The worker cycle hung once and the process was restarted; the restart is the end of it."
  },
  {
    fingerprint: "worker.loop.crashed",
    keyed: false,
    kind: "event",
    area: "worker",
    why: "The worker cycle threw once and the loop continued; the throw is a past event."
  },
  {
    fingerprint: "playout.loop.stalled",
    keyed: false,
    kind: "event",
    area: "playout",
    why: "The playout cycle hung once and the process was restarted; the restart is the end of it."
  },
  {
    fingerprint: "playout.loop.crashed",
    keyed: false,
    kind: "event",
    area: "playout",
    why: "The playout cycle threw once and the loop continued; the throw is a past event."
  },
  {
    fingerprint: "uplink.loop.stalled",
    keyed: false,
    kind: "event",
    area: "uplink",
    why: "The uplink cycle hung once and the process was restarted; the restart is the end of it."
  },
  {
    fingerprint: "uplink.loop.crashed",
    keyed: false,
    kind: "event",
    area: "uplink",
    why: "The uplink cycle threw once and the loop continued; the throw is a past event."
  }
];

export const INCIDENT_FAMILIES: IncidentFamily[] = [...STATE_FAMILIES, ...EVENT_FAMILIES];

/**
 * Fingerprint shapes this build no longer writes, but existing databases still hold.
 *
 * `playout.ffmpeg.exit.<assetId>` is the whole list: keying an ffmpeg exit by asset id meant every
 * asset that ever failed left its own permanently open critical entry, and no running code will
 * ever raise or resolve those strings again. They can only be closed from here.
 */
export const RETIRED_INCIDENT_FINGERPRINTS: Array<{ prefix: string; area: IncidentArea; replacedBy: string }> = [
  { prefix: "playout.ffmpeg.exit.", area: "playout", replacedBy: "playout.ffmpeg.exit" }
];

const EXACT_FAMILIES = new Map(INCIDENT_FAMILIES.filter((family) => family.keyed === false).map((family) => [family.fingerprint, family]));
// Longest prefix first, so `source.local-library.empty` is never swallowed by the keyed `source`
// family before its own exact entry gets a chance.
const KEYED_FAMILIES = INCIDENT_FAMILIES.filter((family) => family.keyed !== false).sort(
  (left, right) => right.fingerprint.length - left.fingerprint.length
);

/** The family a stored fingerprint belongs to, or null when nothing in the registry owns it. */
export function classifyIncidentFingerprint(fingerprint: string): IncidentFamily | null {
  const exact = EXACT_FAMILIES.get(fingerprint);
  if (exact) {
    return exact;
  }

  for (const family of KEYED_FAMILIES) {
    const prefix = `${family.fingerprint}.`;
    if (!fingerprint.startsWith(prefix) || fingerprint.length <= prefix.length) {
      continue;
    }
    if (family.keyed === "infix" && !fingerprint.endsWith(`.${family.keySuffix}`)) {
      continue;
    }
    if (family.keyed === "suffix" && RETIRED_INCIDENT_FINGERPRINTS.some((entry) => fingerprint.startsWith(entry.prefix))) {
      continue;
    }
    return family;
  }

  return null;
}

/**
 * Like `classifyIncidentFingerprint`, but also accepts the bare family prefix of a keyed family.
 *
 * The enforcement test reads `fingerprint:` expressions out of the worker source, where a keyed
 * family appears as the literal part of a template (`uplink.encoder-stall` out of
 * `` `uplink.encoder-stall.${running.key}` ``). That prefix is not a valid fingerprint on its own,
 * but it is exactly the thing that has to be registered.
 */
export function classifyIncidentReference(reference: string): IncidentFamily | null {
  return (
    classifyIncidentFingerprint(reference) ??
    KEYED_FAMILIES.find((family) => family.fingerprint === reference) ??
    null
  );
}

/** The fingerprint a reporting site should use. Suffix-keyed families pass their key. */
export function buildIncidentFingerprint(family: string, key?: string): string {
  return key === undefined || key === "" ? family : `${family}.${key}`;
}

/**
 * How long an area must be healthy and quiet before its finished events are closed.
 *
 * Ten minutes. It has to be longer than any recovery the runtime performs on its own, or a channel
 * that restarts every few minutes would keep clearing its own list between restarts and look calm
 * while it flaps: the longest default watchdog window is the uplink's 300s "never encoded a frame"
 * restart, and ten minutes is comfortably past it -- 40 playout cycles, 20 worker cycles. It also
 * has to be short enough that an operator who fixed something sees the list clear while still
 * looking at it.
 *
 * Deliberately a constant and not a managed setting. This is not a property of the plant, it is the
 * honesty threshold of a reporting surface; exposing it would invite someone to set it to thirty
 * seconds and get back exactly the lying list this work removes.
 */
export const INCIDENT_AREA_STABLE_MS = 10 * 60_000;

/**
 * How old a retired fingerprint must be before the sweep closes it.
 *
 * Seven days. Retired shapes cannot be re-raised by this build, so the age is not about them being
 * finished -- it is the guard against a rollback: if an operator goes back to the previous image
 * mid-upgrade, that image writes the per-asset shape again, and a week of separation makes it
 * obvious which rows are backlog and which are live.
 */
export const INCIDENT_BACKLOG_GRACE_MS = 7 * 24 * 60 * 60_000;

/**
 * The most quiet a recurring fault can be asked for.
 *
 * The quiet a fault has to prove scales with how long it has been coming back (see
 * `planIncidentResolutions`), which is what stops a fault on a longer cycle than the base window
 * from being closed in every gap and reported again in every burst. Uncapped, a fault that recurred
 * across a bad week would demand a week of silence and the list would never recover from it. Six
 * hours is where the requirement stops adding safety: an area that is measurably healthy and has
 * said nothing for six hours is not in the middle of anything.
 */
export const INCIDENT_RECURRENCE_QUIET_CAP_MS = 6 * 60 * 60_000;

/** How stale the worker's last cycle may be before the worker area stops counting as healthy. */
const WORKER_CYCLE_FRESH_MS = 120_000;

/** How stale the playout heartbeat may be before a direct-output playout stops counting as healthy. */
const PLAYOUT_HEARTBEAT_FRESH_MS = 120_000;

const AREA_LABEL: Record<IncidentArea, string> = {
  playout: "playout",
  uplink: "the uplink",
  worker: "the worker loop",
  twitch: "the Twitch connection",
  source: "the source",
  system: "the system"
};

function ageMs(timestamp: string, nowMs: number): number {
  const parsed = timestamp ? new Date(timestamp).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? nowMs - parsed : Number.POSITIVE_INFINITY;
}

export type IncidentAreaHealthInput = {
  nowMs: number;
  /** True when the programme is produced as an HLS feed the uplink reads back. */
  programFeedMode: boolean;
  /** `STREAM247_UPLINK_INPUT_MODE`, so this can ask `canBlameUplinkForStall` the same question. */
  uplinkInputMode: string;
  /** True when the persistent relay uplink is switched on at all. */
  relayEnabled: boolean;
  /** `playout.workerHeartbeatAt`: when the worker loop last completed a cycle, "" when never. */
  workerHeartbeatAt: string;
  /** The same allowance `readProgramFeedRuntimeStatus` uses to call the playlist stale. */
  programFeedStaleMs: number;
  /** The resolved uplink watchdog windows, which decide how much uptime proves anything. */
  uplinkWatchdogMs: { stallMs: number; graceMs: number; noProgressRestartMs: number };
  /** False when any destination the uplink publishes to is currently in its error state. */
  uplinkDestinationsHealthy: boolean;
  playout: {
    status: string;
    heartbeatAt: string;
    programFeedStatus: string;
    /** The playlist's mtime. Unlike the status word, this keeps ageing when nobody recomputes it. */
    programFeedUpdatedAt: string;
    uplinkStatus: string;
    /**
     * The start of the YOUNGEST running uplink process (`getRunningUplinkStartedAt`). With several
     * output profiles the oldest would let one permanently crash-looping profile read as "up for
     * 45 minutes".
     */
    uplinkStartedAt: string;
    uplinkHeartbeatAt: string;
  };
};

/**
 * Which areas are measurably healthy right now.
 *
 * Every signal is one the runtime already writes; nothing new is probed. What each one is worth,
 * though, is not obvious, and two earlier versions of this function got it wrong in ways worth
 * recording:
 *
 * - `programFeedStatus` is written only by the playout and uplink PROCESSES. The worker, which runs
 *   the resolution pass, never recomputes it. If both stop, the last "fresh" sits in the database
 *   unchanged forever and a check on that word alone declares playout permanently healthy -- and
 *   then closes `playout.loop.crashed` precisely because playout crashed. The word is therefore
 *   only believed alongside two things that age on their own: the playlist's mtime
 *   (`programFeedUpdatedAt`) within the same allowance the status itself uses, and a live playout
 *   heartbeat. Direct output has no feed and uses the heartbeat alone, which is where the
 *   asymmetry came from.
 * - a running uplink proves nothing by itself. In hls mode `canBlameUplinkForStall` switches off
 *   every stall watchdog while the feed is not fresh, so nothing restarts the uplink, its uptime
 *   grows past any window, and the cycle tail still writes status "running" with a fresh
 *   heartbeat. That is the documented 65-minute outage where the channel was dark the whole time.
 *   Uplink health therefore requires the input to be fresh FIRST -- if the watchdogs are disarmed
 *   there is nothing to conclude -- and only then treats uptime as evidence, because with the
 *   watchdogs armed a process that has not been restarted is a process whose out_time advanced.
 *   That inference is only as good as the windows themselves, which are managed and can be raised
 *   to hours, so the required uptime is the longest of them rather than a fixed ten minutes.
 *
 * The worker area is the honest exception: the pass runs immediately after the heartbeat write it
 * reads, so "the worker is alive" is very nearly a tautology. It is kept because the check still
 * catches the case that matters -- a pass running from a stale snapshot, or a worker whose
 * heartbeat write is failing -- not because it is independent evidence.
 */
export function measureIncidentAreaHealth(input: IncidentAreaHealthInput): IncidentArea[] {
  const healthy: IncidentArea[] = [];
  const { playout, nowMs } = input;
  const playoutHeartbeatFresh = ageMs(playout.heartbeatAt, nowMs) <= PLAYOUT_HEARTBEAT_FRESH_MS;

  if (input.programFeedMode) {
    if (
      playout.programFeedStatus === "fresh" &&
      ageMs(playout.programFeedUpdatedAt, nowMs) <= input.programFeedStaleMs &&
      playoutHeartbeatFresh
    ) {
      healthy.push("playout");
    }
  } else if (["running", "standby"].includes(playout.status) && playoutHeartbeatFresh) {
    healthy.push("playout");
  }

  // The watchdogs only restart an uplink they are allowed to blame, and uptime is only evidence
  // once every one of them has had its full window to fire.
  const uplinkWatchdogsArmed = canBlameUplinkForStall(input.uplinkInputMode, playout.programFeedStatus);
  const requiredUplinkUptimeMs = Math.max(
    INCIDENT_AREA_STABLE_MS,
    input.uplinkWatchdogMs.stallMs + input.uplinkWatchdogMs.graceMs,
    input.uplinkWatchdogMs.noProgressRestartMs
  );

  if (!input.relayEnabled) {
    // No uplink process runs at all, so nothing in that area can be failing right now.
    healthy.push("uplink");
  } else if (
    uplinkWatchdogsArmed &&
    input.uplinkDestinationsHealthy &&
    playout.uplinkStatus === "running" &&
    ageMs(playout.uplinkHeartbeatAt, nowMs) <= PLAYOUT_HEARTBEAT_FRESH_MS &&
    ageMs(playout.uplinkStartedAt, nowMs) >= requiredUplinkUptimeMs
  ) {
    healthy.push("uplink");
  }

  if (ageMs(input.workerHeartbeatAt, nowMs) <= WORKER_CYCLE_FRESH_MS) {
    healthy.push("worker");
  }

  return healthy;
}

export type IncidentResolutionPlanEntry = {
  fingerprint: string;
  area: IncidentArea;
  reason: "recovered" | "backlog";
  message: string;
};

export type IncidentResolutionInput = {
  incidents: ReadonlyArray<{
    fingerprint: string;
    status: string;
    /** Kept across a reopen by `upsertIncident`, so it is the family's first-ever report. */
    createdAt?: string;
    updatedAt: string;
    message?: string;
  }>;
  healthyAreas: ReadonlyArray<IncidentArea>;
  nowMs: number;
  stableMs?: number;
  backlogGraceMs?: number;
  recurrenceQuietCapMs?: number;
};

/**
 * Which open event incidents are demonstrably over.
 *
 * Three conditions, all required. The area must be measurably healthy right now (the caller's
 * `healthyAreas`); the incident itself must not have been re-reported inside its own quiet window;
 * and nothing else in its area may have been reported inside the base window either. The last two
 * are read off the incidents themselves: `updatedAt` is refreshed by every repeat of the same
 * fingerprint, so the newest open event in an area is exactly "when this part of the system last
 * misbehaved". One fresh event therefore holds the whole area open, which is the honest answer --
 * an area that is still producing events has not recovered. The exception is the families marked
 * `noisy`, which still have to wait out their own repeats but do not speak for their area.
 *
 * The per-incident window is not fixed, because "quiet for ten minutes" is worthless against a
 * fault whose cycle is longer than ten minutes. A programme that fails at every item boundary, or
 * an uplink that drops every quarter of an hour, would be closed in every gap and reported again in
 * every burst: green for ten minutes out of fifteen while the channel keeps falling over.
 * `upsertIncident` preserves `created_at` across a reopen, so the distance between first and last
 * report is exactly how long this family has been coming back, and the quiet demanded scales with
 * it -- capped, so a bad week does not demand a week of silence. A genuine one-off has a span of
 * zero and closes on the base window, unchanged.
 *
 * State incidents are never returned. They are closed by the code that knows their condition, and
 * closing one from here would claim a disk had space or a token had refreshed without checking.
 * Fingerprints the registry does not own are not returned either: an unclassified string is more
 * likely a state incident from another build than a finished event, and guessing wrong hides a
 * real problem.
 */
export function planIncidentResolutions(input: IncidentResolutionInput): IncidentResolutionPlanEntry[] {
  const stableMs = input.stableMs ?? INCIDENT_AREA_STABLE_MS;
  const backlogGraceMs = input.backlogGraceMs ?? INCIDENT_BACKLOG_GRACE_MS;
  const healthy = new Set(input.healthyAreas);
  const open = input.incidents.filter((incident) => incident.status === "open");

  type Candidate = {
    incident: (typeof open)[number];
    area: IncidentArea;
    reason: "recovered" | "backlog";
    noisy: boolean;
  };

  const candidates = open
    .map((incident): Candidate | null => {
      const family = classifyIncidentFingerprint(incident.fingerprint);
      if (family) {
        return family.kind === "event"
          ? { incident, area: family.area, reason: "recovered", noisy: family.noisy === true }
          : null;
      }
      const retired = RETIRED_INCIDENT_FINGERPRINTS.find((entry) => incident.fingerprint.startsWith(entry.prefix));
      return retired ? { incident, area: retired.area, reason: "backlog", noisy: false } : null;
    })
    .filter((entry): entry is Candidate => entry !== null);

  // "Quiet" is per area and counts every open event in it, including the ones about to be closed.
  const lastEventAgeMs = new Map<IncidentArea, number>();
  for (const candidate of candidates) {
    if (candidate.noisy) {
      continue;
    }
    const age = ageMs(candidate.incident.updatedAt, input.nowMs);
    const known = lastEventAgeMs.get(candidate.area);
    if (known === undefined || age < known) {
      lastEventAgeMs.set(candidate.area, age);
    }
  }

  const graceDays = Math.round(backlogGraceMs / (24 * 60 * 60_000));
  const recurrenceCapMs = input.recurrenceQuietCapMs ?? INCIDENT_RECURRENCE_QUIET_CAP_MS;

  /** How long this particular entry has to have been silent, given how long it kept coming back. */
  const requiredQuietMs = (candidate: Candidate): number => {
    const firstSeenAgeMs = ageMs(candidate.incident.createdAt ?? candidate.incident.updatedAt, input.nowMs);
    const lastSeenAgeMs = ageMs(candidate.incident.updatedAt, input.nowMs);
    const recurrenceSpanMs = Number.isFinite(firstSeenAgeMs) ? Math.max(0, firstSeenAgeMs - lastSeenAgeMs) : 0;
    return Math.max(stableMs, Math.min(recurrenceSpanMs, recurrenceCapMs));
  };

  return candidates
    .filter((candidate) => healthy.has(candidate.area))
    .filter((candidate) => ageMs(candidate.incident.updatedAt, input.nowMs) >= requiredQuietMs(candidate))
    .filter((candidate) => (lastEventAgeMs.get(candidate.area) ?? Number.POSITIVE_INFINITY) >= stableMs)
    .filter((candidate) => candidate.reason === "recovered" || ageMs(candidate.incident.updatedAt, input.nowMs) >= backlogGraceMs)
    .map((candidate) => {
      const quietMinutes = Math.round(requiredQuietMs(candidate) / 60_000);
      const note =
        candidate.reason === "recovered"
          ? `Closed automatically: this entry describes a past event, and ${AREA_LABEL[candidate.area]} has been healthy with nothing new reported for ${quietMinutes} minutes.`
          : `Closed automatically: this entry describes a past event under a fingerprint this build no longer uses, it was last reported more than ${graceDays} days ago, and ${AREA_LABEL[candidate.area]} is healthy now. It stayed open only because nothing ever closed it.`;
      // resolveIncident replaces the stored message with whatever it is given, so the note carries
      // the original with it. Dropping it would delete the only record of what actually happened --
      // the exit code, the stderr tail, the asset -- at the moment the entry becomes history.
      const original = (candidate.incident.message ?? "").trim();

      return {
        fingerprint: candidate.incident.fingerprint,
        area: candidate.area,
        reason: candidate.reason,
        message: original === "" ? note : `${original} — ${note}`
      };
    });
}
