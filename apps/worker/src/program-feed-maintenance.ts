/**
 * Segments left behind by playout runs that have ended.
 *
 * The HLS muxer is told to delete_segments, and it does — for the segments it knows about. With
 * append_list, each playout process appends to the playlist it inherits, and whatever was still
 * inside the window when the previous process died is never anyone's to remove. Measured on the
 * test channel: 8878 files, 3.7 GB, the oldest from 125 days ago, in a directory whose live window
 * is six segments. Most run prefixes hold exactly three files — the window size at the moment that
 * run stopped.
 *
 * Two rules, and the second is the one that matters. A segment is only removed when the playlist
 * does not mention it *and* it is older than a margin. The playlist is the authoritative index of
 * what a reader may still ask for, but a segment can be written a moment before the playlist naming
 * it is flushed, and the uplink can be mid-download of one that has just rolled out of the window.
 * The margin covers both, and makes this safe to run while the channel is on air.
 */

export type ProgramFeedSegment = {
  name: string;
  modifiedAtMs: number;
};

export const PROGRAM_FEED_SEGMENT_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * How many segments one sweep may remove.
 *
 * The sweep runs on the transition, which is already the most timing-sensitive moment this system
 * has: on the test channel every boundary stalls the uplink's encoder for around a minute. A first
 * run against the backlog measured there would have deleted 8847 files in that window. Capped, the
 * cost of a boundary stays roughly constant and the backlog drains over successive transitions
 * instead of landing on one of them.
 */
export const PROGRAM_FEED_SWEEP_LIMIT = 400;

export function selectStaleProgramFeedSegments(args: {
  segments: ProgramFeedSegment[];
  playlist: string;
  nowMs: number;
  minAgeMs?: number;
  limit?: number;
}): string[] {
  const minAgeMs = args.minAgeMs ?? PROGRAM_FEED_SEGMENT_MIN_AGE_MS;

  // An unreadable or empty playlist means "no reference information", not "nothing is referenced".
  // Without this, one failed read empties the directory the channel is reading from — the sweep
  // becomes the outage it was written to prevent.
  if (!args.playlist.trim()) {
    return [];
  }

  // Substring matching against the whole playlist rather than parsing it: segment names are unique
  // and the playlist is small, so this cannot miss a reference by misreading a directive.
  const referenced = (name: string) => args.playlist.includes(name);

  return args.segments
    .filter((segment) => !referenced(segment.name))
    .filter((segment) => args.nowMs - segment.modifiedAtMs >= minAgeMs)
    // Oldest first, so a capped sweep drains the backlog from its far end rather than nibbling at
    // whatever the directory listing happened to return first.
    .sort((left, right) => left.modifiedAtMs - right.modifiedAtMs)
    .slice(0, args.limit ?? PROGRAM_FEED_SWEEP_LIMIT)
    .map((segment) => segment.name);
}

/** Bytes a sweep would reclaim, for reporting what happened rather than that something happened. */
export function sumSegmentBytes(segments: Array<{ name: string; bytes: number }>, names: string[]): number {
  const wanted = new Set(names);
  return segments.filter((segment) => wanted.has(segment.name)).reduce((total, segment) => total + segment.bytes, 0);
}
