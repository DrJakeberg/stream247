/**
 * How far audio stood from video in the programme feed at a cut (M61).
 *
 * The uplink derives one timestamp offset per stream at a boundary, and the difference between the
 * two is what separated storms from quiet boundaries (uplink-progress.ts, UplinkSeamState). That is
 * the reader's view. This is the writer's: the last audio and video packet times in the newest
 * segment the outgoing encoder wrote, taken right before the duration bound stops it. If the two
 * agree here and disagree at the reader, the seam is the reader's doing; if audio already leads here,
 * the encode produced it.
 */
export function lastPtsSecondsFromProbeOutput(output: string): number | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim().replace(/,+$/, ""))
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) {
    return null;
  }
  const value = Number(last);
  return Number.isFinite(value) ? value : null;
}

export type FeedAvLead = {
  lastAudioPtsSeconds: number;
  lastVideoPtsSeconds: number;
  /** Positive: audio ran ahead of video. */
  audioLeadSeconds: number;
};

export function resolveFeedAvLead(args: { lastAudioPtsSeconds: number | null; lastVideoPtsSeconds: number | null }): FeedAvLead | null {
  if (args.lastAudioPtsSeconds === null || args.lastVideoPtsSeconds === null) {
    return null;
  }
  return {
    lastAudioPtsSeconds: args.lastAudioPtsSeconds,
    lastVideoPtsSeconds: args.lastVideoPtsSeconds,
    audioLeadSeconds: Math.round((args.lastAudioPtsSeconds - args.lastVideoPtsSeconds) * 1000) / 1000
  };
}
