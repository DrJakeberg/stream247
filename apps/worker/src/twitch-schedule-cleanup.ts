// Old Twitch schedule segments are deleted, or kept and tried again (M113).
//
// Until M113 the schedule sync sent a DELETE for every segment whose block run was no longer planned and
// never looked at the answer; the full replace after it then forgot the segment. A delete Twitch refused
// or never answered left the old segment on the channel's schedule for good, and nobody saw it.
//
// Now the answer decides. A 2xx or a 404 means the segment is gone. Anything else, or no answer, keeps the
// segment in the stored list while it still lies ahead, so a later sync tries again, and raises a warning
// until no such segment is left. A segment that has started by now is no longer an upcoming entry of the
// schedule; it is dropped after a failed delete, as before, and only logged.
//
// A kept segment does not count as a change of the schedule: without that, every worker cycle would see
// keys that differ from the plan and send the whole schedule again. Its retry rides on the regular sync,
// every 15 minutes at most, or on the next real change.

export type StoredTwitchScheduleSegment = {
  key: string;
  segmentId: string;
  startTime: string;
};

export type TwitchSegmentDeleteAnswer = { status: number } | { error: string };

export type StaleTwitchSegmentFailure = {
  key: string;
  segmentId: string;
  // An HTTP status, or the error of a request that got none (timeout, refused connection).
  reason: string;
  kept: boolean;
};

/** Whether Twitch's answer to a segment DELETE means the segment is no longer on the schedule. */
export function isTwitchSegmentGone(answer: TwitchSegmentDeleteAnswer): boolean {
  return "status" in answer && ((answer.status >= 200 && answer.status < 300) || answer.status === 404);
}

/**
 * Deletes each stale segment through `deleteSegment` (one request each, in order) and sorts the outcome:
 * `kept` are the segments a later sync must try again, `failures` every delete that did not take.
 */
export async function deleteStaleTwitchScheduleSegments<T extends StoredTwitchScheduleSegment>(args: {
  stale: T[];
  now: Date;
  deleteSegment: (segment: T) => Promise<TwitchSegmentDeleteAnswer>;
}): Promise<{ kept: T[]; failures: StaleTwitchSegmentFailure[] }> {
  const kept: T[] = [];
  const failures: StaleTwitchSegmentFailure[] = [];

  for (const segment of args.stale) {
    let answer: TwitchSegmentDeleteAnswer;
    try {
      answer = await args.deleteSegment(segment);
    } catch (error) {
      answer = { error: error instanceof Error ? error.message : String(error) };
    }
    if (isTwitchSegmentGone(answer)) {
      continue;
    }

    const startMs = new Date(segment.startTime).getTime();
    // An unreadable start time is kept: better one more retry than an old segment nobody hears about.
    const upcoming = !Number.isFinite(startMs) || startMs > args.now.getTime();
    if (upcoming) {
      kept.push(segment);
    }
    failures.push({
      key: segment.key,
      segmentId: segment.segmentId,
      reason: "status" in answer ? `status ${String(answer.status)}` : answer.error,
      kept: upcoming
    });
  }

  return { kept, failures };
}

/**
 * The stored keys the sync compares with the plan: every stored key except those kept after a failed
 * delete. A kept key is not a change of the schedule, so it does not force a sync on every cycle.
 */
export function listComparableTwitchSegmentKeys(storedKeys: string[], keptAfterFailedDelete: ReadonlySet<string>): string[] {
  return storedKeys.filter((key) => !keptAfterFailedDelete.has(key));
}

/** The warning text for segments kept after a failed delete; one line per sync, not per segment. */
export function describeKeptTwitchSegments(failures: StaleTwitchSegmentFailure[]): string {
  const kept = failures.filter((failure) => failure.kept);
  const reasons = [...new Set(kept.map((failure) => failure.reason))].slice(0, 3).join(", ");
  return `Twitch did not delete ${String(kept.length)} old segment(s) of the channel's schedule (${reasons}), so viewers may still see them. The next schedule sync, within 15 minutes, tries again.`;
}
